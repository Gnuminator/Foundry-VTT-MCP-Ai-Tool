"""Hotword / prompt text from a vocabulary file.

The file holds terms separated by commas or lines. Blank lines, ``# comment`` lines and
``=== heading ===`` lines are skipped (the same format ``session_pipeline`` reads).
"""

from __future__ import annotations

import re
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
