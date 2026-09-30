"""The session pipeline's timeline, as the notes writer sees it.

Every timeline line gets a stable id (``u000001``, 1-based, in timeline order). Notes cite these
ids, and the Markdown transcripts carry them as Obsidian block anchors (``^u000001``).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

# Words the recogniser was unsure about are passed to Claude as hints.
UNCERTAIN_BELOW = 0.5


@dataclass(frozen=True, slots=True)
class Line:
    id: str
    start: float
    end: float
    speaker: str
    player: str
    character: str
    text: str
    uncertain: tuple[str, ...] = ()


@dataclass(slots=True)
class Scene:
    index: int  # 1-based
    lines: list[Line] = field(default_factory=list)

    @property
    def start(self) -> float:
        return self.lines[0].start

    @property
    def end(self) -> float:
        return self.lines[-1].end

    @property
    def ids(self) -> list[str]:
        return [line.id for line in self.lines]


@dataclass(slots=True)
class Roster:
    """Who plays whom, and the names the notes should spell right."""

    players: dict[str, str] = field(default_factory=dict)  # player -> character
    names: list[str] = field(default_factory=list)


def line_id(n: int) -> str:
    return f"u{n:06d}"


def clock(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def load_timeline(path: Path) -> list[Line]:
    lines: list[Line] = []
    with path.open(encoding="utf-8") as fh:
        for raw in fh:
            raw = raw.strip()
            if not raw:
                continue
            row = json.loads(raw)
            words = row.get("words") or []
            uncertain = tuple(
                w["word"].strip()
                for w in words
                if w.get("probability", 1.0) < UNCERTAIN_BELOW and w.get("word", "").strip()
            )
            player = str(row.get("player") or row.get("speaker") or "?")
            lines.append(
                Line(
                    id=line_id(len(lines) + 1),
                    start=float(row["start"]),
                    end=float(row["end"]),
                    speaker=str(row.get("speaker") or player),
                    player=player,
                    character=str(row.get("character") or player),
                    text=str(row.get("text", "")).strip(),
                    uncertain=uncertain,
                )
            )
    return lines


def load_roster(session: Path, lines: list[Line]) -> Roster:
    """Players and characters from the timeline; known names from ``names.txt`` if present."""
    roster = Roster()
    for line in lines:
        roster.players.setdefault(line.player, line.character)
    names_file = session / "names.txt"
    if names_file.exists():
        for raw in names_file.read_text(encoding="utf-8").splitlines():
            name = raw.strip()
            if name and not name.startswith("#") and not name.startswith("==="):
                roster.names.append(name)
    return roster
