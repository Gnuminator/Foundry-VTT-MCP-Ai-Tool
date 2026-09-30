"""Deterministic name fixing.

* Rules ``correct: [wrong, ...]`` are applied whole-word, case-insensitively, keeping the case style
  of what was heard ("strad" -> "strahd", "Strad" -> "Strahd", "STRAD" -> "STRAHD"). A rule never
  touches a longer word: "Dag" does not change "Dagstorp".
* A near-name suggester compares words that are not ordinary words with a known-name list
  (difflib ratio) and only *suggests*. It never changes text.

The name list and the rules are inputs. Later they come from the Foundry world.
"""

from __future__ import annotations

import re
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
    heard: str
    suggested: str
    score: float

    def to_dict(self) -> dict[str, Any]:
        return {"heard": self.heard, "suggested": self.suggested, "score": round(self.score, 3)}


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
    """Suggest known names for words that look like them but are not ordinary words."""

    def __init__(
        self,
        known_names: Iterable[str],
        ordinary_words: Iterable[str] = (),
        cutoff: float = 0.85,
        min_len: int = 4,
        min_partial_len: int = 5,
    ) -> None:
        self.cutoff = cutoff
        self.min_len = min_len
        self.min_partial_len = min_partial_len
        self.names = list(dict.fromkeys(n.strip() for n in known_names if n.strip()))
        self.known_tokens: set[str] = set()
        self._targets: list[tuple[str, str]] = []  # (lower-case comparison string, display name)
        seen: set[tuple[str, str]] = set()
        for name in self.names:
            toks = norm_tokens(name)
            self.known_tokens.update(toks)
            forms = [" ".join(toks)] if len(toks) > 1 else []
            forms += [t for t in toks if len(t) >= (min_partial_len if len(toks) > 1 else min_len)]
            for f in forms:
                if f and (f, name) not in seen:
                    seen.add((f, name))
                    self._targets.append((f, name))
        self.ordinary = {w.lower() for w in ordinary_words} - self.known_tokens
        self._forms = {f for f, _ in self._targets}
        self._max_words = max((len(t.split()) for t, _ in self._targets), default=1)
        self._cache: dict[str, Suggestion | None] = {}

    def _best(self, phrase: str) -> Suggestion | None:
        if phrase in self._cache:
            return self._cache[phrase]
        sm = SequenceMatcher(None, autojunk=False)
        sm.set_seq2(phrase)
        best: Suggestion | None = None
        for form, display in self._targets:
            if abs(len(form) - len(phrase)) > max(len(form), len(phrase)) * 0.3:
                continue
            sm.set_seq1(form)
            if sm.real_quick_ratio() < self.cutoff or sm.quick_ratio() < self.cutoff:
                continue
            score = sm.ratio()
            if score >= self.cutoff and (best is None or score > best.score):
                best = Suggestion(phrase, display, score)
        self._cache[phrase] = best
        return best

    def suggest(self, text: str) -> list[Suggestion]:
        """Suggestions for one piece of text. Never changes the text."""
        found = [(m.group(0), m.group(0).lower()) for m in _WORD_RE.finditer(text)]
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
                if hit is not None:
                    if any(o.heard == " ".join(w[0] for w in window) and o.suggested == hit.suggested for o in out):
                        continue
                    out.append(Suggestion(" ".join(w[0] for w in window), hit.suggested, hit.score))
                    for k in range(i, i + n):
                        used[k] = True
        return out


def ordinary_from_frequency(texts: Iterable[str], min_count: int = 3) -> set[str]:
    """Words that occur at least ``min_count`` times in the session's own text count as ordinary."""
    counts: Counter[str] = Counter()
    for t in texts:
        counts.update(norm_tokens(t))
    return {w for w, n in counts.items() if n >= min_count}
