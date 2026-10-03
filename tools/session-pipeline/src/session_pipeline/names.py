"""Deterministic name fixing.

* Rules ``correct: [wrong, ...]`` are applied whole-word, case-insensitively, keeping the case style
  of what was heard ("strad" -> "strahd", "Strad" -> "Strahd", "STRAD" -> "STRAHD"). A rule never
  touches a longer word: "Dag" does not change "Dagstorp".
* A near-name suggester compares words that are not ordinary words with a known-name list
  (difflib ratio). ``suggest`` only reports; ``fix`` also applies the confident hits (auto-fix, see
  ``NameSuggester``) and leaves the rest as suggestions.

The name list and the rules are inputs. Later they come from the Foundry world.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from session_pipeline.textutil import norm_tokens

_WORD_RE = re.compile(r"\w+(?:['’-]\w+)*", re.UNICODE)


@dataclass(frozen=True, slots=True)
class Fix:
    wrong: str  # the rule's wrong spelling (lower case)
    correct: str
    count: int = 1
    heard: str = ""  # the text as it was found, e.g. "Strad"

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"wrong": self.wrong, "correct": self.correct, "count": self.count}
        if self.heard:
            d["heard"] = self.heard
        return d


@dataclass(frozen=True, slots=True)
class Suggestion:
    """A near-name hit. ``replacement`` is what an automatic fix writes (for a hit on one part of a
    multi-word name it is that part only). ``blocked`` is empty when the hit is confident enough to
    apply, otherwise the reason it stays a suggestion."""

    heard: str
    suggested: str
    score: float
    replacement: str = ""
    start: int = -1  # character span of ``heard`` in the text that was searched
    end: int = -1
    blocked: str = ""

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "heard": self.heard,
            "suggested": self.suggested,
            "score": round(self.score, 3),
        }
        if self.blocked:
            d["blocked"] = self.blocked
        return d


def _match_case(found: str, correct: str) -> str:
    letters = [c for c in found if c.isalpha()]
    if len(letters) > 1 and all(c.isupper() for c in letters):
        return correct.upper()
    # canonical mixed case inside a word ("D'Arcy", "NPC") stays; a capital after a space does not count
    if any(i > 0 and c.isupper() and correct[i - 1] != " " for i, c in enumerate(correct)):
        return correct
    if letters and letters[0].isupper():
        return correct[:1].upper() + correct[1:]
    if letters and all(c.islower() for c in letters):
        return correct.lower()
    return correct


class NameRules:
    """Compiled ``correct -> [wrongs]`` rules."""

    def __init__(self, rules: Mapping[str, Iterable[str]]) -> None:
        self.by_wrong: dict[str, str] = {}
        for correct, wrongs in rules.items():
            for wrong in wrongs:
                w = " ".join(wrong.split()).lower()
                if w and w != correct.lower():
                    self.by_wrong.setdefault(w, correct)
        alts = sorted(self.by_wrong, key=len, reverse=True)
        body = "|".join(r"\s+".join(re.escape(p) for p in a.split(" ")) for a in alts)
        # whole word: no word character before, none after (hyphenated compounds count as one word)
        self._rx = (
            re.compile(rf"(?<!\w)(?<!\w-)(?:{body})(?!\w|-\w)", re.IGNORECASE | re.UNICODE)
            if alts
            else None
        )

    def __bool__(self) -> bool:
        return self._rx is not None

    def apply(self, text: str) -> tuple[str, list[Fix]]:
        if self._rx is None:
            return text, []
        counts: Counter[tuple[str, str, str]] = Counter()

        def sub(m: re.Match[str]) -> str:
            key = " ".join(m.group(0).split()).lower()
            correct = self.by_wrong[key]
            new = _match_case(m.group(0), correct)
            counts[(key, correct, m.group(0))] += 1
            return new

        out = self._rx.sub(sub, text)
        return out, [Fix(k[0], k[1], n, k[2]) for k, n in counts.items()]


def parse_rules(data: Mapping[str, Any]) -> NameRules:
    """Rules from a decoded JSON object ``{"Strahd": ["Strad", "Strod"], ...}``."""
    clean: dict[str, list[str]] = {}
    for correct, wrongs in data.items():
        if not isinstance(correct, str) or not isinstance(wrongs, list):
            raise ValueError(f"rule {correct!r} must map to a list of wrong spellings")
        clean[correct] = [str(w) for w in wrongs]
    return NameRules(clean)


class NameSuggester:
    """Find words that look like known names but are not ordinary words.

    ``suggest`` only reports. ``fix`` also rewrites the confident hits (auto-fix): a hit is applied
    only when its similarity reaches ``auto_threshold``, none of its words is an ordinary word (the
    session's own frequent words, ``--ordinary-words`` and the shipped Danish and English lists,
    except words that are part of a known name), the word is at least ``min_len`` letters, and no
    other known name scores almost as well (ambiguity). Every other hit stays a suggestion.

    Glued names: the recogniser sometimes writes a name and its neighbouring word as one word
    ("stratser" for "Strahd ser"). A word that is neither a name nor an ordinary word is split
    into a name part and an ordinary word (either order). It is fixed automatically only when
    the name part is a known name or a rule's wrong spelling exactly (``aliases``) and the other
    part is not a Danish ending or prefix that would turn a real word apart ("Barovianer" is not
    "Barovia ner"); every other glued hit stays a suggestion.
    """

    # Short words a name is often glued to. The shipped lists only hold words of 4 letters or
    # more, and these are exactly the neighbours the recogniser swallows.
    GLUED_SHORT_WORDS = frozenset(
        {
            # Danish
            "at", "af", "da", "de", "du", "en", "er", "et", "fik", "fra", "får", "gik", "han",
            "har", "hun", "jeg", "jo", "kan", "man", "med", "men", "nok", "nu", "og", "om", "op",
            "os", "på", "ser", "sig", "sin", "sit", "skal", "som", "så", "til", "ud", "var", "vi",
            "vil", "den", "det", "der", "dig", "mig", "ham", "dem", "ikke", "lige", "bare",
            # English
            "and", "the", "has", "had", "was", "is", "it", "he", "she", "we", "you", "to", "of",
            "in", "on", "at", "can", "will", "did", "got", "saw", "sees", "says", "said", "but",
        }
    )
    # Leftovers that are more likely an ending or a prefix than a separate word: suggest only.
    GLUED_SUFFIXES = frozenset(
        {"e", "s", "er", "en", "et", "ne", "ns", "es", "ers", "ens", "ets", "ner", "nes", "erne",
         "ernes", "ene", "isk", "iske", "sk", "ske", "ish", "ian", "ians", "ing", "ings"}
    )
    GLUED_PREFIXES = frozenset(
        {"u", "be", "for", "mis", "van", "gen", "sam", "af", "an", "op", "ud", "over", "under",
         "anti", "un", "re", "pre", "non"}
    )

    def __init__(
        self,
        known_names: Iterable[str],
        ordinary_words: Iterable[str] = (),
        cutoff: float = 0.85,
        min_len: int = 4,
        min_partial_len: int = 5,
        auto_threshold: float = 0.85,
        block_words: Iterable[str] | None = None,
        ambiguity_margin: float = 0.03,
        aliases: Mapping[str, str] | None = None,
        glued_min_len: int = 6,
    ) -> None:
        self.cutoff = cutoff
        self.glued_min_len = glued_min_len
        # Exact one-word forms for the glued-name split: a rule's wrong spelling -> its correct
        # name, and every one-word form of a known name -> (display name, replacement).
        self._aliases: dict[str, tuple[str, str]] = {
            w.lower(): (c, c) for w, c in (aliases or {}).items() if " " not in w.strip()
        }
        self.min_len = min_len
        self.min_partial_len = min_partial_len
        self.auto_threshold = auto_threshold
        self.ambiguity_margin = ambiguity_margin
        self.names = list(dict.fromkeys(n.strip() for n in known_names if n.strip()))
        self.known_tokens: set[str] = set()
        # (lower-case comparison string, display name, text an automatic fix writes)
        self._targets: list[tuple[str, str, str]] = []
        seen: set[tuple[str, str]] = set()
        for name in self.names:
            toks = norm_tokens(name)
            originals = _WORD_RE.findall(unicodedata.normalize("NFC", name))
            self.known_tokens.update(toks)
            forms: list[tuple[str, str]] = [(" ".join(toks), name)] if len(toks) > 1 else []
            need = min_partial_len if len(toks) > 1 else min_len
            for k, t in enumerate(toks):
                if len(t) >= need:
                    whole = len(toks) == 1
                    forms.append((t, name if whole else (originals[k] if k < len(originals) else t)))
            for form, replacement in forms:
                if form and (form, name) not in seen:
                    seen.add((form, name))
                    self._targets.append((form, name, replacement))
        self.ordinary = {w.lower() for w in ordinary_words} - self.known_tokens
        if block_words is None:
            from session_pipeline.wordlists import all_ordinary_words

            block_words = all_ordinary_words()
        self.block = (self.ordinary | {w.lower() for w in block_words}) - self.known_tokens
        self._forms = {f for f, _, _ in self._targets}
        self._max_words = max((len(t.split()) for t, _, _ in self._targets), default=1)
        self._cache: dict[str, tuple[Suggestion, float] | None] = {}
        for form, display, replacement in self._targets:
            if " " not in form:
                self._aliases.setdefault(form, (display, replacement))

    def _glued(self, heard: str, start: int, end: int) -> Suggestion | None:
        """A name glued to an ordinary word: the best split of ``heard``, or None."""
        low = heard.lower()
        if len(low) < self.glued_min_len or not low.isalpha() or low in self.block:
            return None
        best: tuple[tuple[int, float, int], Suggestion] | None = None
        for k in range(2, len(low) - 1):
            for name_first in (True, False):
                name_part, other = (low[:k], low[k:]) if name_first else (low[k:], low[:k])
                if len(name_part) < self.min_len or (
                    other not in self.block and other not in self.GLUED_SHORT_WORDS
                ):
                    continue
                exact = self._aliases.get(name_part)
                if exact is not None:
                    display, repl, score = exact[0], exact[1], 1.0
                else:
                    hit = self._best_plain(name_part)
                    if hit is None:
                        continue
                    display, repl, score = hit[0].suggested, hit[0].replacement, hit[0].score
                other_heard = heard[k:] if name_first else heard[:k]
                replacement = f"{repl} {other_heard}" if name_first else f"{other_heard} {repl}"
                affix = other in (self.GLUED_SUFFIXES if name_first else self.GLUED_PREFIXES)
                blocked = "" if exact is not None and not affix else ("glued_affix" if affix else "glued")
                # Prefer an exact name, then the higher score, then the longer name part.
                rank = (1 if exact is not None else 0, score, len(name_part))
                if best is None or rank > best[0]:
                    best = (rank, Suggestion(heard, display, score, replacement, start, end, blocked))
        return best[1] if best else None

    def _best_plain(self, phrase: str) -> tuple[Suggestion, float] | None:
        """Best hit and the best score of a *different* name (0.0 when there is none)."""
        if phrase in self._cache:
            return self._cache[phrase]
        sm = SequenceMatcher(None, autojunk=False)
        sm.set_seq2(phrase)
        best: Suggestion | None = None
        scores: dict[str, float] = {}
        n_words = phrase.count(" ")
        for form, display, replacement in self._targets:
            if form.count(" ") != n_words:  # never swallow or skip a neighbouring word
                continue
            if abs(len(form) - len(phrase)) > max(len(form), len(phrase)) * 0.3:
                continue
            sm.set_seq1(form)
            if sm.real_quick_ratio() < self.cutoff or sm.quick_ratio() < self.cutoff:
                continue
            score = sm.ratio()
            if score >= self.cutoff:
                scores[display] = max(score, scores.get(display, 0.0))
                if best is None or score > best.score:
                    best = Suggestion(phrase, display, score, replacement)
        result: tuple[Suggestion, float] | None = None
        if best is not None:
            runner_up = max((v for k, v in scores.items() if k != best.suggested), default=0.0)
            result = (best, runner_up)
        self._cache[phrase] = result
        return result

    def _best(self, phrase: str) -> tuple[Suggestion, float, str] | None:
        """Like ``_best_plain`` but also tries the phrase without a final "s" (Danish genitive or an
        English plural: "Handells" is "Handell" plus "s"). Returns the hit, the runner-up score and
        the phrase that was actually matched."""
        hit = self._best_plain(phrase)
        matched = phrase
        if len(phrase) > self.min_len and phrase.endswith("s") and " " not in phrase:
            stem = self._best_plain(phrase[:-1])
            if (
                stem is not None
                and not stem[0].replacement.lower().endswith("s")
                and (hit is None or stem[0].score > hit[0].score)
            ):
                best = stem[0]
                hit = (Suggestion(phrase, best.suggested, best.score, best.replacement + "s"), stem[1])
                matched = phrase[:-1]
        if hit is None:
            return None
        return hit[0], hit[1], matched

    def _block_reason(self, tokens: list[str], low: str, score: float, runner_up: float) -> str:
        if score < self.auto_threshold:
            return "below_threshold"
        if len(low.replace(" ", "")) < self.min_len or any(len(t) < 3 for t in tokens):
            return "short"
        if any(t in self.block for t in tokens):
            return "ordinary_word"
        if score - runner_up < self.ambiguity_margin:
            return "ambiguous"
        return ""

    def suggest(self, text: str, every: bool = False) -> list[Suggestion]:
        """Hits for one piece of text, in text order. Never changes the text. A word heard twice is
        reported once unless ``every`` is set."""
        found = [(m.group(0), m.group(0).lower(), m.start(), m.end()) for m in _WORD_RE.finditer(text)]
        used = [False] * len(found)
        out: list[Suggestion] = []
        for n in range(min(self._max_words, len(found)), 0, -1):
            for i in range(len(found) - n + 1):
                if any(used[i : i + n]):
                    continue
                window = found[i : i + n]
                low = " ".join(w[1] for w in window)
                if n == 1 and (len(low) < self.min_len or low in self.ordinary):
                    continue
                if low in self.known_tokens and n == 1:
                    continue
                if n > 1 and all(w[1] in self.ordinary for w in window):
                    continue
                if low in self._forms:
                    continue
                hit = self._best(low)
                glued = self._glued(window[0][0], window[0][2], window[0][3]) if n == 1 else None
                # A split with an exact name beats a fuzzy match of the whole word, which would
                # swallow the neighbour ("ogvallaki" is close to "Vallaki", but it is "og Vallaki").
                if glued is not None and (hit is None or glued.score >= 1.0):
                    if every or not any(o.heard == glued.heard for o in out):
                        out.append(glued)
                    used[i] = True
                    continue
                if hit is not None:
                    best, runner_up, matched = hit
                    heard = " ".join(w[0] for w in window)
                    repeated = any(o.heard == heard and o.suggested == best.suggested for o in out)
                    if best.replacement == heard or (repeated and not every):
                        continue
                    reason = self._block_reason(
                        [*[w[1] for w in window], matched], low, best.score, runner_up
                    )
                    out.append(
                        Suggestion(
                            heard,
                            best.suggested,
                            best.score,
                            best.replacement,
                            window[0][2],
                            window[-1][3],
                            reason,
                        )
                    )
                    for k in range(i, i + n):
                        used[k] = True
        out.sort(key=lambda s: s.start)
        return out

    def fix(self, text: str, apply: bool = True) -> tuple[str, list[Suggestion], list[Suggestion]]:
        """``(new text, applied hits, hits left as suggestions)``. With ``apply`` False nothing is
        rewritten and every hit is left as a suggestion."""
        hits = self.suggest(text, every=True)
        if not apply:
            return text, [], hits
        applied = [h for h in hits if not h.blocked]
        for h in sorted(applied, key=lambda s: -s.start):
            text = text[: h.start] + fix_case(h.heard, h.replacement) + text[h.end :]
        left: list[Suggestion] = []
        for h in hits:
            if h.blocked and not any(o.heard == h.heard and o.suggested == h.suggested for o in left):
                left.append(h)
        return text, applied, left


def fix_case(heard: str, replacement: str) -> str:
    letters = [c for c in heard if c.isalpha()]
    if len(letters) > 1 and all(c.isupper() for c in letters):
        return replacement.upper()
    return replacement


def ordinary_from_frequency(texts: Iterable[str], min_count: int = 3) -> set[str]:
    """Words that occur at least ``min_count`` times in the session's own text count as ordinary."""
    counts: Counter[str] = Counter()
    for t in texts:
        counts.update(norm_tokens(t))
    return {w for w, n in counts.items() if n >= min_count}
