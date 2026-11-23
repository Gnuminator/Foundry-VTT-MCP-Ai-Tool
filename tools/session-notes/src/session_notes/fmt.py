"""The fixed words of the notes format (design "Session notes format", 2026-11-23).

Every page uses the same headings in the same order in Danish and English, and an empty heading
says "None" / "Ingen". One place for them, so the pages cannot drift apart.
"""

from __future__ import annotations

from .model import clock

NONE = {"da": "Ingen", "en": "None"}

# The headings of a scene, in their fixed order: (key in the scene notes, heading).
SCENE_HEADINGS = {
    "da": (
        ("events", "Hvad der skete"),
        ("decisions", "Beslutninger"),
        ("npcs", "NPC'er mødt"),
        ("threads", "Åbne tråde"),
        ("quotes", "Citater"),
        ("gm_only", "Kun for GM"),
    ),
    "en": (
        ("events", "What happened"),
        ("decisions", "Decisions"),
        ("npcs", "NPCs met"),
        ("threads", "Open threads"),
        ("quotes", "Quotes"),
        ("gm_only", "GM only"),
    ),
}

SETTING_LABEL = {
    "da": {
        "game": "i spillet",
        "table": "ved bordet",
        "mixed": "i spillet, derefter ved bordet",
    },
    "en": {
        "game": "in the game",
        "table": "at the table",
        "mixed": "in the game, then at the table",
    },
}

# The Table page: (topic key from the scene notes, heading), in order.
TABLE_HEADINGS = {
    "da": (
        ("house_rules", "Husregler"),
        ("proposed", "Foreslået, ikke afgjort"),
        ("play_style", "Spillestil"),
        ("absence", "Fravær"),
        ("planning", "Planlægning"),
        ("open", "Åbent ved bordet"),
    ),
    "en": (
        ("house_rules", "House rules"),
        ("proposed", "Proposed, not settled"),
        ("play_style", "Play style"),
        ("absence", "Absence"),
        ("planning", "Planning"),
        ("open", "Open at the table"),
    ),
}
TABLE_NAME = {"da": "Bordet", "en": "Table"}
AT_TABLE = {"da": "Ved bordet", "en": "At the table"}
SEE = {"da": "se", "en": "see"}


def stamp(ids: list[str], lang: str, starts: dict[str, float]) -> str:
    """One timestamp link per line: the moment it starts (the earliest cited line)."""
    known = [i for i in ids if i in starts]
    if not known:
        return ""
    first = min(known, key=lambda i: starts[i])
    return f" ([[transcript.{lang}#^{first}|{clock(starts[first])}]])"


def table_link(lang: str, topic_heading: str | None = None) -> str:
    name = TABLE_NAME[lang]
    if topic_heading:
        return f"[[table.{lang}#{topic_heading}|{name}, {topic_heading}]]"
    return f"[[table.{lang}|{name}]]"
