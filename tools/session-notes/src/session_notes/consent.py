"""Recording consent (D-097): nothing is turned into text or notes unless every speaker said yes.

``<sessions>/consent.json`` lives on the PC only, next to the recordings (never in the repo)::

    {"players": {"<discord user id>": {"name": "...", "answer": "yes", "date": "2026-11-02"}}}

The key is the Discord user id (stable; names change). ``check`` compares it with the tracks the
recorder listed in ``raw/session.json``. Every speaker needs a recorded answer. A "yes" passes. A
"no" passes only after that speaker's audio is gone from the session folder (the player guide
promises the track is deleted before anything becomes text); the tool never deletes audio itself.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

CONSENT_FILE = "consent.json"
ANSWERS = ("yes", "no")
EXIT_NO_CONSENT = 77
AUDIO_RE = re.compile(r"\.(ogg|oga|opus|flac|wav|mp3|m4a|rec)$", re.I)


@dataclass
class ConsentResult:
    ok: bool
    message: str
    missing: list[str] = field(default_factory=list)


def consent_path(sessions: Path) -> Path:
    return sessions / CONSENT_FILE


def load_consent(sessions: Path) -> dict[str, dict[str, Any]]:
    path = consent_path(sessions)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    players = data.get("players") if isinstance(data, dict) else None
    if not isinstance(players, dict):
        return {}
    return {str(k): v for k, v in players.items() if isinstance(v, dict)}


def set_consent(
    sessions: Path, user_id: str, answer: str, name: str = "", when: str | None = None
) -> Path:
    if answer not in ANSWERS:
        raise ValueError(f"answer must be yes or no, got {answer!r}")
    if not (user_id.isascii() and user_id.isdigit()):
        raise ValueError(
            f"{user_id!r} is not a Discord user id (digits only; `consent check <session>` "
            "prints the ids of the speakers)"
        )
    path = consent_path(sessions)
    if path.is_file():
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            # Never overwrite a file we cannot read: it may hold the only record of a "no".
            raise ValueError(f"{path} cannot be read ({exc}); fix or move it first") from exc
    players = load_consent(sessions)
    old = players.get(user_id, {})
    players[user_id] = {
        "name": name or old.get("name", ""),
        "answer": answer,
        "date": when or date.today().isoformat(),
    }
    sessions.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(CONSENT_FILE + ".tmp")
    tmp.write_text(
        json.dumps({"players": players}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    tmp.replace(path)
    return path


def _audio_left(session: Path, track_file: str) -> bool:
    """Any audio file of this track (`1-name.rec` -> `1-name.ogg`, `raw/1-name.rec`) still there."""
    stem = Path(track_file).stem
    for folder in (session, session / "raw"):
        if folder.is_dir():
            for f in folder.iterdir():
                if f.is_file() and AUDIO_RE.search(f.name) and f.stem == stem:
                    return True
    return False


def check_consent(session: Path, sessions: Path | None = None) -> ConsentResult:
    sessions = sessions or session.parent
    meta = session / "raw" / "session.json"
    try:
        tracks = json.loads(meta.read_text(encoding="utf-8")).get("tracks")
    except (OSError, ValueError, AttributeError):
        return ConsentResult(
            False, "No raw/session.json, so the speakers (and their consent) cannot be checked."
        )
    if not isinstance(tracks, list) or not tracks:
        return ConsentResult(False, "raw/session.json lists no speakers; consent cannot be checked.")
    given = load_consent(sessions)
    need: list[str] = []
    gone: list[str] = []
    for t in tracks:
        uid = str(t.get("userId", ""))
        label = f"{t.get('displayName') or t.get('username') or '?'} (id {uid})"
        answer = given.get(uid, {}).get("answer")
        if answer == "yes":
            continue
        if answer == "no":
            if _audio_left(session, str(t.get("file", ""))):
                gone.append(label)
            continue
        need.append(label)
    if need or gone:
        parts = []
        if need:
            parts.append(f"No recorded yes from {len(need)} speaker(s): {', '.join(need)}.")
        if gone:
            parts.append(
                f"{', '.join(gone)} said no, but the audio track is still there: delete it first."
            )
        return ConsentResult(False, " ".join(parts), need + gone)
    return ConsentResult(True, f"Consent recorded for all {len(tracks)} speaker(s).")
