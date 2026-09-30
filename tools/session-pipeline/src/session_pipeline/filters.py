"""Per-track hallucination filter.

Runs on one speaker's track before the merge. Every removal is recorded (what and why) so nothing
vanishes silently. Order of the rules:

1. whole-segment drops: no-speech probability, compression ratio, stock caption phrases,
   recited vocabulary lists / one name repeated;
2. identical consecutive segments (loop across segments);
3. inside a segment: repeated sentences, repeated word n-grams, repeated characters in one token;
4. too-short segments and words;
5. low-confidence sidecar (words stay in the text, they are only listed).

All thresholds live in :class:`FilterConfig`.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from typing import Any

from session_pipeline.model import Segment, Track, Word, words_text
from session_pipeline.textutil import ends_clause, norm_key, norm_tokens

DEFAULT_STOCK_PHRASES: tuple[str, ...] = (
    # Danish
    r"undertekster af",
    r"undertekstning af",
    r"tekstet af",
    r"teksting af",
    r"tekster af",
    r"tekst af",
    r"oversat af",
    r"oversættelse af",
    r"tak fordi (?:du|i) så med",
    r"tak for (?:at|du) (?:se|så) med",
    r"husk at (?:abonnere|like)",
    r"vi ses i næste (?:video|afsnit)",
    # English
    r"thanks? for watching",
    r"thank you for watching",
    r"subtitles? by",
    r"captions? by",
    r"transcribed by",
    r"translated by",
    r"please (?:like and )?subscribe",
    r"like and subscribe",
    r"don'?t forget to subscribe",
    r"see you (?:in the )?next (?:video|time|episode)",
    r"amara\.org",
)


@dataclass(frozen=True, slots=True)
class FilterConfig:
    max_no_speech_prob: float = 0.85
    max_compression_ratio: float = 2.4
    min_segment_s: float = 0.1  # a real 160 ms "Sorry." was dropped at 0.2
    min_word_s: float = 0.0  # 0 = off: over half of real Danish words are under 200 ms, see README
    low_confidence: float = 0.6
    # repetition loops
    char_loop_pattern: str = r"(.{2,}?)\1{3,}"
    word_loop_min_repeats: int = 5  # real "nej nej nej nej" and laughter survive
    word_loop_max_ngram: int = 12
    sentence_repeat_min: int = 3
    segment_repeat_min: int = 3
    # recited vocabulary
    recite_min_terms: int = 3
    recite_term_repeat: int = 4
    recite_repeat_share: float = 0.6
    recite_glue: tuple[str, ...] = ("og", "and", "eller", "or")
    # stock captions
    stock_phrases: tuple[str, ...] = DEFAULT_STOCK_PHRASES
    stock_max_words: int = 12


@dataclass(frozen=True, slots=True)
class Dropped:
    """Something a filter removed (a whole segment, a line, or the repeated part of a loop)."""

    speaker: str
    start: float
    end: float
    text: str
    reason: str
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "speaker": self.speaker,
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "reason": self.reason,
            "text": self.text,
        }
        if self.detail:
            d["detail"] = self.detail
        return d


@dataclass(frozen=True, slots=True)
class LowConfidenceWord:
    speaker: str
    start: float
    end: float
    word: str
    probability: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "speaker": self.speaker,
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "word": self.word.strip(),
            "probability": round(self.probability, 3),
        }


@dataclass(slots=True)
class FilterResult:
    track: Track
    dropped: list[Dropped] = field(default_factory=list)
    low_confidence: list[LowConfidenceWord] = field(default_factory=list)


class VocabIndex:
    """Lookup structure over a vocabulary (one term may have several words)."""

    def __init__(self, terms: Iterable[str]) -> None:
        self.terms: set[tuple[str, ...]] = set()
        self.partial: set[str] = set()
        for raw in terms:
            toks = tuple(norm_tokens(raw))
            if not toks:
                continue
            self.terms.add(toks)
            if len(toks) > 1:
                self.partial.update(t for t in toks if len(t) >= 4)
        self.max_len = max((len(t) for t in self.terms), default=0)

    def __bool__(self) -> bool:
        return bool(self.terms)


def parse_vocab(text: str) -> list[str]:
    """Terms from a vocabulary file: commas or new lines separate terms, ``# x`` and ``=== X ===`` are skipped."""
    out: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or re.fullmatch(r"=+\s*.*?\s*=+", line):
            continue
        out.extend(p.strip() for p in line.split(",") if p.strip())
    return list(dict.fromkeys(out))


# ---------------------------------------------------------------- whole-segment rules


def is_stock_caption(text: str, cfg: FilterConfig) -> str | None:
    """Return the matched phrase when a short segment is a stock caption, else None."""
    if len(norm_tokens(text)) > cfg.stock_max_words:
        return None
    low = " ".join(norm_tokens(text))
    for phrase in cfg.stock_phrases:
        if re.search(rf"(?<!\w){phrase}(?!\w)", low, re.IGNORECASE):
            return phrase
    return None


def recitation_reason(words: tuple[Word, ...], vocab: VocabIndex, cfg: FilterConfig) -> str | None:
    """Detect a segment that only recites vocabulary terms or repeats one name phrase."""
    if not vocab:
        return None
    keys = [k for k in (norm_key(w.word) for w in words) if k]
    # multi-token keys (e.g. "e g") are flattened so they line up with vocabulary tokens
    keys = [t for k in keys for t in k.split()]
    if not keys:
        return None
    i = covered = units = other = 0
    counts: Counter[tuple[str, ...]] = Counter()
    while i < len(keys):
        for length in range(min(vocab.max_len, len(keys) - i), 0, -1):
            term = tuple(keys[i : i + length])
            if term in vocab.terms:
                units += 1
                covered += length
                counts[term] += 1
                i += length
                break
        else:
            if keys[i] in vocab.partial:
                units += 1
                covered += 1
            elif keys[i] not in cfg.recite_glue:
                other += 1
            i += 1
    if other == 0 and units >= cfg.recite_min_terms:
        return f"only vocabulary terms ({units} terms)"
    if counts:
        term, n = counts.most_common(1)[0]
        if n >= cfg.recite_term_repeat and n * len(term) / len(keys) >= cfg.recite_repeat_share:
            return f"name repeated {n} times ({' '.join(term)})"
    return None


# ---------------------------------------------------------------- loop collapsing


def _keys(words: list[Word]) -> list[str]:
    return [norm_key(w.word) for w in words]


def collapse_sentence_repeats(words: list[Word], min_repeat: int) -> tuple[list[Word], list[Word]]:
    """Keep one copy of a sentence that is repeated ``min_repeat`` or more times in a row."""
    chunks: list[list[Word]] = [[]]
    for w in words:
        chunks[-1].append(w)
        if ends_clause(w.word):
            chunks.append([])
    if not chunks[-1]:
        chunks.pop()
    ckeys = [" ".join(_keys(c)).strip() for c in chunks]
    kept: list[Word] = []
    removed: list[Word] = []
    i = 0
    while i < len(chunks):
        j = i + 1
        while ckeys[i] and j < len(chunks) and ckeys[j] == ckeys[i]:
            j += 1
        if j - i >= min_repeat:
            kept.extend(chunks[i])
            for c in chunks[i + 1 : j]:
                removed.extend(c)
        else:
            for c in chunks[i:j]:
                kept.extend(c)
        i = j
    return kept, removed


def collapse_ngram_loops(
    words: list[Word], min_repeats: int, max_ngram: int
) -> tuple[list[Word], list[Word]]:
    """Keep one copy of a word n-gram that is repeated ``min_repeats`` or more times in a row."""
    keys = _keys(words)
    kept: list[Word] = []
    removed: list[Word] = []
    i = 0
    while i < len(words):
        hit = 0
        reps = 0
        if keys[i]:
            for n in range(1, min(max_ngram, (len(words) - i) // min_repeats) + 1):
                gram = keys[i : i + n]
                if not all(gram):
                    continue
                r = 1
                while keys[i + r * n : i + (r + 1) * n] == gram:
                    r += 1
                if r >= min_repeats:
                    hit, reps = n, r
                    break
        if hit:
            kept.extend(words[i : i + hit])
            removed.extend(words[i + hit : i + hit * reps])
            i += hit * reps
        else:
            kept.append(words[i])
            i += 1
    return kept, removed


def collapse_char_loops(words: list[Word], pattern: str) -> tuple[list[Word], list[str]]:
    """Collapse ``hahahahaha`` style loops inside a single token. Returns new words and removed text."""
    rx = re.compile(pattern, re.DOTALL)
    out: list[Word] = []
    removed: list[str] = []
    for w in words:
        body = w.word.strip()
        new = rx.sub(r"\1", body)
        if new != body:
            removed.append(body)
            lead = w.word[: len(w.word) - len(w.word.lstrip())]
            out.append(replace(w, word=lead + new))
        else:
            out.append(w)
    return out, removed


def _span_dropped(speaker: str, ws: list[Word], reason: str, detail: str = "") -> Dropped:
    return Dropped(speaker, ws[0].start, ws[-1].end, words_text(ws), reason, detail)


def _collapse_in_segment(
    seg: Segment, speaker: str, cfg: FilterConfig, dropped: list[Dropped]
) -> Segment:
    words = list(seg.words)
    changed = False
    words, rem = collapse_sentence_repeats(words, cfg.sentence_repeat_min)
    if rem:
        dropped.append(_span_dropped(speaker, rem, "loop_sentence", "repeated sentence collapsed"))
        changed = True
    words, rem = collapse_ngram_loops(words, cfg.word_loop_min_repeats, cfg.word_loop_max_ngram)
    if rem:
        dropped.append(_span_dropped(speaker, rem, "loop_words", "repeated words collapsed"))
        changed = True
    new_words, rem_text = collapse_char_loops(words, cfg.char_loop_pattern)
    if rem_text:
        for t in rem_text:
            dropped.append(Dropped(speaker, seg.start, seg.end, t, "loop_chars", "repeated characters collapsed"))
        words, changed = new_words, True
    if not changed:
        return seg
    return replace(seg, words=tuple(words), text=words_text(words))


# ---------------------------------------------------------------- the filter


def filter_track(track: Track, cfg: FilterConfig | None = None, vocab: Iterable[str] = ()) -> FilterResult:
    cfg = cfg or FilterConfig()
    index = vocab if isinstance(vocab, VocabIndex) else VocabIndex(vocab)
    spk = track.speaker
    dropped: list[Dropped] = []
    survivors: list[Segment] = []

    for seg in track.segments:
        reason = detail = ""
        if seg.no_speech_prob > cfg.max_no_speech_prob:
            reason, detail = "no_speech", f"no_speech_prob {seg.no_speech_prob:.2f}"
        elif seg.compression_ratio > cfg.max_compression_ratio:
            reason, detail = "compression", f"compression_ratio {seg.compression_ratio:.2f}"
        elif (phrase := is_stock_caption(seg.text, cfg)) is not None:
            reason, detail = "stock_caption", phrase
        elif (why := recitation_reason(seg.words, index, cfg)) is not None:
            reason, detail = "recited_vocab", why
        if reason:
            dropped.append(Dropped(spk, seg.start, seg.end, seg.text, reason, detail))
        else:
            survivors.append(seg)

    # identical consecutive segments (a loop that Whisper split into many segments)
    kept: list[Segment] = []
    i = 0
    while i < len(survivors):
        key = " ".join(norm_tokens(survivors[i].text))
        j = i + 1
        while key and j < len(survivors) and " ".join(norm_tokens(survivors[j].text)) == key:
            j += 1
        kept.append(survivors[i])
        if j - i >= cfg.segment_repeat_min:
            for extra in survivors[i + 1 : j]:
                dropped.append(
                    Dropped(spk, extra.start, extra.end, extra.text, "loop_segment", f"{j - i} identical segments in a row")
                )
        else:
            kept.extend(survivors[i + 1 : j])
        i = j

    result: list[Segment] = []
    low: list[LowConfidenceWord] = []
    for seg in kept:
        seg = _collapse_in_segment(seg, spk, cfg, dropped)
        words = [w for w in seg.words if w.duration >= cfg.min_word_s or not w.text]
        short_words = [w for w in seg.words if w.text and w.duration < cfg.min_word_s]
        if short_words and len(short_words) < len(seg.words):
            dropped.append(_span_dropped(spk, short_words, "too_short_word", f"under {cfg.min_word_s * 1000:.0f} ms"))
        elif short_words:
            dropped.append(Dropped(spk, seg.start, seg.end, seg.text, "too_short", f"under {cfg.min_word_s * 1000:.0f} ms"))
        words = [w for w in words if w.text]
        if not words:
            continue
        span = words[-1].end - words[0].start
        if span < cfg.min_segment_s:
            dropped.append(Dropped(spk, seg.start, seg.end, words_text(words), "too_short", f"segment {span * 1000:.0f} ms"))
            continue
        if len(words) != len(seg.words):
            seg = replace(seg, words=tuple(words), text=words_text(words))
        result.append(seg)
        low.extend(
            LowConfidenceWord(spk, w.start, w.end, w.word, w.probability)
            for w in words
            if w.probability < cfg.low_confidence and not seg.synthetic_words
        )
    return FilterResult(Track(spk, result), dropped, low)
