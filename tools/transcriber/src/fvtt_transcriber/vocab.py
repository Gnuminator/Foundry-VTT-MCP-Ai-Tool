"""Hotword / prompt text from a vocabulary file.

The file holds terms separated by commas or lines. Blank lines, ``# comment`` lines and
``=== heading ===`` lines are skipped (the same format ``session_pipeline`` reads).
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from pathlib import Path

_HEADING = re.compile(r"^=+\s*.+?\s*=+$")


def parse_terms(text: str) -> list[str]:
    terms: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or _HEADING.match(line):
            continue
        terms.extend(t.strip() for t in line.split(",") if t.strip())
    return list(dict.fromkeys(terms))


def load_terms_text(path: Path) -> str:
    """The vocabulary as one comma separated string (what faster-whisper takes as hotwords)."""
    return ", ".join(parse_terms(path.read_text(encoding="utf-8")))


# ---------------------------------------------------------------- hotwords budget
#
# faster-whisper puts the hotwords in front of every 30 s window as a prompt ("previous text"). The
# prompt may hold at most ``max_length // 2 - 1`` tokens (Whisper's max_length is 448, so 223) and
# faster-whisper silently cuts the rest off the END of the string. With condition_on_previous_text
# off (our default) the hotwords own that whole budget; with it on they share it with the previous
# window's text. A long list is also more likely to be recited back by the model (benchmark:
# large-v3 recited the list, turbo did not). So the list is capped by tokens, names first.

HOTWORD_TOKEN_LIMIT = 223
DEFAULT_HOTWORD_TOKENS = 200  # a margin under the hard limit; about 50 names
_CHARS_PER_TOKEN = 2.3  # conservative (measured 2.7 to 3.2 on name lists with the Whisper tokenizer)

TokenCounter = Callable[[str], int]


def estimate_tokens(text: str) -> int:
    """Upper-side estimate of the Whisper token count of ``text`` (used when no tokenizer is loaded)."""
    return math.ceil(len(text) / _CHARS_PER_TOKEN)


def hotwords_string(terms: list[str]) -> str:
    return ", ".join(terms)


def fit_terms(
    terms: list[str],
    max_tokens: int = DEFAULT_HOTWORD_TOKENS,
    count: TokenCounter = estimate_tokens,
) -> tuple[list[str], list[str]]:
    """``(kept, dropped)``: terms in priority order (the file order), kept while the joined string
    (``"A, B, C"`` with the leading space faster-whisper adds) stays within ``max_tokens``. A term
    that does not fit is dropped and shorter ones after it may still fit; an earlier term is never
    displaced by a later one."""
    max_tokens = max(1, min(max_tokens, HOTWORD_TOKEN_LIMIT))
    kept: list[str] = []
    dropped: list[str] = []
    for term in terms:
        if count(" " + hotwords_string([*kept, term])) <= max_tokens:
            kept.append(term)
        else:
            dropped.append(term)
    return kept, dropped


def load_hotword_terms(path: Path) -> list[str]:
    """The priority-ordered terms of a names or vocabulary file."""
    return parse_terms(path.read_text(encoding="utf-8"))
