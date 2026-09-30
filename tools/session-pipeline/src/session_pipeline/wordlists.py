"""Ordinary-word lists shipped with the package (Danish and English).

They guard the automatic name fix: a heard word that is an ordinary word is never rewritten into a
name ("handel" must not become a name that looks like it). The lists are derived from the Leipzig
Corpora Collection (CC BY 4.0); the source, licence and attribution are in each file's header and in
the repository's CREDITS.md. Rebuild them with ``scripts/build_wordlists.py``.
"""

from __future__ import annotations

from functools import cache
from importlib import resources

LANGUAGES = ("da", "en")


def parse_wordlist(text: str) -> frozenset[str]:
    return frozenset(
        line.strip().lower() for line in text.splitlines() if line.strip() and not line.startswith("#")
    )


@cache
def ordinary_words(language: str) -> frozenset[str]:
    """The shipped list for ``da`` or ``en``."""
    if language not in LANGUAGES:
        raise ValueError(f"no word list for {language!r} (have {', '.join(LANGUAGES)})")
    text = (resources.files("session_pipeline") / "data" / f"words_{language}.txt").read_text(
        encoding="utf-8"
    )
    return parse_wordlist(text)


def all_ordinary_words() -> frozenset[str]:
    return frozenset().union(*(ordinary_words(lang) for lang in LANGUAGES))
