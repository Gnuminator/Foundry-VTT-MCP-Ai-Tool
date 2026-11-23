"""The recording roster: who plays whom, and who is the GM, kept by hand once for every recording.

``<sessions>/roster.json`` lives on the PC next to the recordings (never in the repo)::

    {"gm": "<discord user id>",
     "players": {"<discord user id>": {"name": "Anna", "character": "Ilvara", "pronouns": "she/her"}}}

The key is the Discord user id (stable; display names change), the same id ``consent.json`` uses.
``raw/session.json`` lists each track with its ``userId``, so the roster reaches every new
recording without a ``speakers.json`` edit. A character or pronouns written in a session's own
``speakers.json`` still wins for that session. ``gm`` marks the GM; ``"character": "GM"`` on a
player entry does the same.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROSTER_FILE = "roster.json"
GM = "GM"


@dataclass
class Check:
    ok: bool
    message: str
    missing: list[str] = field(default_factory=list)


def track_key(file: str) -> str:
    """`1-anna.ogg` -> `anna`: the speaker id the transcriber and speakers.json use."""
    return re.sub(r"^\d+-", "", Path(file).stem)


def load(sessions: Path) -> dict[str, dict[str, str]]:
    """User id -> {name, character, pronouns} (only the keys that are set). Empty without a file;
    a file that is there but unreadable raises ValueError (a typo must not silently drop the roster)."""
    path = sessions / ROSTER_FILE
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"{path} is not valid JSON ({exc})") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path} must be an object with \"gm\" and \"players\"")
    out: dict[str, dict[str, str]] = {}
    players = data.get("players")
    for uid, entry in (players.items() if isinstance(players, dict) else []):
        if isinstance(entry, dict):
            out[str(uid)] = {k: str(entry[k]).strip() for k in ("name", "character", "pronouns") if entry.get(k)}
    gm = data.get("gm")
    if gm:
        out.setdefault(str(gm), {})["character"] = GM
    return out


def tracks(session: Path) -> list[dict[str, Any]]:
    try:
        found = json.loads((session / "raw" / "session.json").read_text(encoding="utf-8")).get("tracks")
    except (OSError, ValueError, AttributeError):
        return []
    return [t for t in found if isinstance(t, dict)] if isinstance(found, list) else []


def for_speakers(session: Path, sessions: Path | None = None) -> dict[str, dict[str, str]]:
    """Speaker id (the track name without its number) -> roster entry, for this session's tracks."""
    roster = load(sessions or session.parent)
    if not roster:
        return {}
    out: dict[str, dict[str, str]] = {}
    for t in tracks(session):
        entry = roster.get(str(t.get("userId", "")))
        if entry:
            out[track_key(str(t.get("file", "")))] = entry
    return out


def check(session: Path, sessions: Path | None = None) -> Check:
    """Speakers of the recording that the roster does not list, and whether it names a GM."""
    sessions = sessions or session.parent
    found = tracks(session)
    if not found:
        return Check(False, "No raw/session.json, so the speakers cannot be checked against the roster.")
    try:
        roster = load(sessions)
    except ValueError as exc:
        return Check(False, str(exc), [_label(t) for t in found])
    if not roster:
        return Check(False, f"There is no roster ({sessions / ROSTER_FILE}); every speaker is missing.",
                     [_label(t) for t in found])
    missing = [_label(t) for t in found if not roster.get(str(t.get("userId", "")), {}).get("character")]
    parts = []
    if missing:
        parts.append(f"Not in the roster (no character): {', '.join(missing)}.")
    here = [roster.get(str(t.get("userId", "")), {}) for t in found]
    if not any(e.get("character", "").strip().lower() in {"gm", "dm", "game master", "dungeon master"} for e in here):
        parts.append('No GM among this recording\'s speakers ("gm": "<user id>" in the roster).')
    if parts:
        return Check(False, " ".join(parts), missing)
    return Check(True, f"All {len(found)} speaker(s) are in the roster.")


def _label(t: dict[str, Any]) -> str:
    return f"{t.get('displayName') or t.get('username') or '?'} (id {t.get('userId', '')})"
