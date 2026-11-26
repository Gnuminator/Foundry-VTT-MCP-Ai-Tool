"""The session pipeline's timeline, as the notes writer sees it.

Every timeline line gets a stable id (``u000001``, 1-based, in timeline order). Notes cite these
ids, and the Markdown transcripts carry them as Obsidian block anchors (``^u000001``).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .roster import for_speakers as roster_for_speakers

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
    pronouns: dict[str, str] = field(default_factory=dict)  # player -> "he/him", from speakers.json


def line_id(n: int) -> str:
    return f"u{n:06d}"


def clock(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def load_timeline(path: Path) -> list[Line]:
    lines: list[Line] = []
    with path.open(encoding="utf-8-sig") as fh:
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


GM_NAMES = frozenset({"gm", "dm", "game master", "dungeon master"})


def is_gm(character: str) -> bool:
    return character.strip().lower() in GM_NAMES


def apply_speakers(lines: list[Line], session: Path) -> list[Line]:
    """Let ``<session>/speakers.json`` (track id -> player, character) override the timeline.

    It is the same file the session pipeline reads, so a character or a GM mark added after the
    transcription (``"character": "GM"``) still reaches the notes without a new merge.
    """
    from .stage import apply_stage

    return apply_stage(_apply_speaker_table(lines, session), session)


def _apply_speaker_table(lines: list[Line], session: Path) -> list[Line]:
    path = session / "speakers.json"
    if not path.exists() and not roster_for_speakers(session):
        return lines
    table = json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else {}
    known = roster_for_speakers(session)
    out = []
    for line in lines:
        entry = table.get(line.speaker) or {}
        mine = known.get(line.speaker) or {}
        player = str(mine.get("name") or entry.get("player") or line.player)
        character = str(entry.get("character") or mine.get("character") or entry.get("player") or line.character)
        out.append(
            Line(line.id, line.start, line.end, line.speaker, player, character, line.text,
                 line.uncertain)
        )
    return out


def load_roster(session: Path, lines: list[Line]) -> Roster:
    """Players and characters from the timeline; known names from ``names.txt`` if present."""
    roster = Roster()
    for line in lines:
        roster.players.setdefault(line.player, line.character)
    speakers = session / "speakers.json"
    if speakers.exists():
        try:
            table = json.loads(speakers.read_text(encoding="utf-8-sig"))
        except ValueError:
            table = {}
        for entry in table.values() if isinstance(table, dict) else []:
            if not isinstance(entry, dict) or not entry.get("pronouns"):
                continue
            player = str(entry.get("player") or "")
            if player in roster.players:
                roster.pronouns[player] = str(entry["pronouns"]).strip()
    player_of = {line.speaker: line.player for line in lines}
    for key, entry in roster_for_speakers(session).items():
        if entry.get("pronouns") and player_of.get(key):
            roster.pronouns.setdefault(player_of[key], entry["pronouns"])
    names_file = session / "names.txt"
    if names_file.exists():
        for raw in names_file.read_text(encoding="utf-8-sig").splitlines():
            name = raw.strip()
            if name and not name.startswith("#") and not name.startswith("==="):
                roster.names.append(name)
    from .stage import names as stage_names

    for name in stage_names(session):
        if name not in roster.names:
            roster.names.append(name)
    return roster
