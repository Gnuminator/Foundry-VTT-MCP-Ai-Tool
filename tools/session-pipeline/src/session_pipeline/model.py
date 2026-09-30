"""Typed input model and the adapter from faster-whisper style per-speaker JSON.

Accepted shapes (both produced by faster-whisper with ``word_timestamps=True``):

* flat: ``{"segments": [...], "words": [...]}`` where words are matched to segments by time
  (this is what our benchmark scripts write; the word confidence key is ``p``),
* nested: every segment carries its own ``"words"`` list (``probability`` or ``p``).

A segment that ends up with no words gets synthetic words spread over its time span in
proportion to their length, so the rest of the pipeline can always work on words.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class InputError(ValueError):
    """The transcription JSON does not have the expected shape."""


@dataclass(frozen=True, slots=True)
class Word:
    start: float
    end: float
    word: str
    probability: float = 1.0

    @property
    def duration(self) -> float:
        return self.end - self.start

    @property
    def text(self) -> str:
        return self.word.strip()


@dataclass(frozen=True, slots=True)
class Segment:
    start: float
    end: float
    text: str
    no_speech_prob: float = 0.0
    avg_logprob: float = 0.0
    compression_ratio: float = 1.0
    words: tuple[Word, ...] = ()
    synthetic_words: bool = False

    @property
    def duration(self) -> float:
        return self.end - self.start


@dataclass(slots=True)
class Track:
    speaker: str
    segments: list[Segment] = field(default_factory=list)

    @property
    def words(self) -> list[Word]:
        return [w for s in self.segments for w in s.words]


def words_text(words: list[Word] | tuple[Word, ...]) -> str:
    """Join word tokens into a line of text (whisper tokens carry their own leading space)."""
    return " ".join(w.text for w in words if w.text)


def _num(d: dict[str, Any], key: str, default: float | None = None, *alt: str) -> float:
    for k in (key, *alt):
        if k in d and d[k] is not None:
            try:
                return float(d[k])
            except (TypeError, ValueError) as ex:
                raise InputError(f"field {k!r} is not a number: {d[k]!r}") from ex
    if default is None:
        raise InputError(f"missing required field {key!r}")
    return default


def _parse_word(d: Any) -> Word:
    if not isinstance(d, dict):
        raise InputError(f"word entry is not an object: {d!r}")
    text = d.get("word", d.get("text"))
    if not isinstance(text, str):
        raise InputError("word entry has no 'word' text")
    return Word(
        start=_num(d, "start"),
        end=_num(d, "end"),
        word=text,
        probability=_num(d, "probability", 1.0, "p"),
    )


def synthesize_words(start: float, end: float, text: str) -> tuple[Word, ...]:
    """Spread the tokens of ``text`` over [start, end] in proportion to their length."""
    tokens = text.split()
    if not tokens:
        return ()
    total = sum(len(t) for t in tokens)
    span = max(end - start, 0.0)
    out: list[Word] = []
    cursor = start
    for i, tok in enumerate(tokens):
        t_end = end if i == len(tokens) - 1 else cursor + span * len(tok) / total
        out.append(Word(cursor, t_end, " " + tok, 1.0))
        cursor = t_end
    return tuple(out)


def _assign_words(segments: list[dict[str, Any]], words: list[Word]) -> list[list[Word]]:
    """Attach flat words to segments by time (midpoint inside the segment), else the nearest one."""
    buckets: list[list[Word]] = [[] for _ in segments]
    if not segments:
        return buckets
    bounds = [(_num(s, "start"), _num(s, "end")) for s in segments]
    last = len(bounds) - 1
    i = 0
    for w in words:  # both lists are sorted by start, so one forward pointer is enough
        mid = (w.start + w.end) / 2
        while i < last and mid > bounds[i][1] + 0.05:
            i += 1
        s, e = bounds[i]
        if s - 0.05 <= mid <= e + 0.05:
            buckets[i].append(w)
            continue
        # in a gap: nearest of the previous and the current segment
        prev = max(i - 1, 0)
        d_prev = min(abs(mid - bounds[prev][0]), abs(mid - bounds[prev][1]))
        d_cur = min(abs(mid - s), abs(mid - e))
        buckets[prev if d_prev < d_cur else i].append(w)
    return buckets


def parse_track(data: dict[str, Any], speaker: str | None = None) -> Track:
    """Build a Track from a decoded transcription JSON object."""
    if not isinstance(data, dict):
        raise InputError("top level of the transcription JSON must be an object")
    spk = speaker or data.get("speaker")
    if not isinstance(spk, str) or not spk:
        raise InputError("no speaker id (pass one or include a 'speaker' field)")
    raw_segments = data.get("segments")
    if not isinstance(raw_segments, list):
        raise InputError("missing 'segments' list")
    raw_segments = sorted(
        (s for s in raw_segments if isinstance(s, dict)), key=lambda s: _num(s, "start")
    )
    flat_words = sorted(
        (_parse_word(w) for w in data.get("words", []) or []), key=lambda w: (w.start, w.end)
    )
    nested = any(isinstance(s.get("words"), list) and s["words"] for s in raw_segments)
    flat_buckets = None if nested else _assign_words(raw_segments, flat_words)
    segments: list[Segment] = []
    for i, s in enumerate(raw_segments):
        start, end = _num(s, "start"), _num(s, "end")
        text = s.get("text", "")
        if not isinstance(text, str):
            raise InputError("segment 'text' must be a string")
        if nested:
            words = tuple(
                sorted((_parse_word(w) for w in s.get("words") or []), key=lambda w: w.start)
            )
        else:
            assert flat_buckets is not None
            words = tuple(flat_buckets[i])
        synthetic = False
        if not words and text.strip():
            words, synthetic = synthesize_words(start, end, text), True
        segments.append(
            Segment(
                start=start,
                end=end,
                text=text.strip(),
                no_speech_prob=_num(s, "no_speech_prob", 0.0),
                avg_logprob=_num(s, "avg_logprob", 0.0),
                compression_ratio=_num(s, "compression_ratio", 1.0),
                words=words,
                synthetic_words=synthetic,
            )
        )
    return Track(speaker=spk, segments=segments)


def track_id_from_name(path: str | Path) -> str:
    """``S1__gnuminator.json`` -> ``gnuminator``; ``gnuminator.json`` -> ``gnuminator``."""
    stem = Path(path).stem
    return stem.rsplit("__", 1)[-1] if "__" in stem else stem


def load_track(path: str | Path, speaker: str | None = None) -> Track:
    """Load one per-speaker JSON file. The speaker id defaults to the file name part after ``__``."""
    p = Path(path)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as ex:
        raise InputError(f"{p.name}: not valid JSON ({ex})") from ex
    spk = speaker or track_id_from_name(p)
    try:
        return parse_track(data, spk)
    except InputError as ex:
        raise InputError(f"{p.name}: {ex}") from ex
