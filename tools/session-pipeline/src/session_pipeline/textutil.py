"""Small text helpers shared by the filters, the merge and the name fixer."""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

TERMINAL_CHARS = ".!?…"
_TOKEN_RE = re.compile(r"\w+(?:['’-]\w+)*", re.UNICODE)
_CLOSERS = "\"')]}»”’"


def norm_key(token: str) -> str:
    """Lower-case a single token and strip surrounding punctuation ("Døren." -> "døren")."""
    tokens = _TOKEN_RE.findall(unicodedata.normalize("NFC", token).lower())
    return " ".join(tokens)


def norm_tokens(text: str) -> list[str]:
    """Lower-cased word tokens of a text, punctuation removed (inner hyphens/apostrophes kept)."""
    return _TOKEN_RE.findall(unicodedata.normalize("NFC", text).lower())


def norm_text(text: str) -> str:
    return " ".join(norm_tokens(text))


def ends_clause(token: str, terminal_chars: str = TERMINAL_CHARS) -> bool:
    """True when a word token ends a sentence (terminal punctuation, closing quotes ignored)."""
    t = token.strip().rstrip(_CLOSERS)
    return bool(t) and t[-1] in terminal_chars


def similarity(a: str, b: str) -> float:
    """Normalised text similarity in [0, 1] (difflib ratio on punctuation-free lower case)."""
    na, nb = norm_text(a), norm_text(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb, autojunk=False).ratio()


def fmt_hms(seconds: float) -> str:
    s = max(int(seconds), 0)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"
