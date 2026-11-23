"""``session-notes report``: send the run status and the approved recap to the bridge.

The dashboard may run on another host than the recordings (the Pi), where there is no sessions
folder to read. So the notes run sends two things over the control port (``session_notes``,
action ``report``), best effort:

* the ``notes/status.json`` of the newest session folder (how the last pass ended), and
* the player recap (``recap.player.<lang>.md``) of the newest approved session folder.

Only dated ``*-discord`` folders count (``2026-10-04_1930-discord``, restarts ``-2``, ``-3``);
``livekit-recordings``, ``.incoming`` and the like are not sessions. Never raises: a bridge that
is down or too old just means the dashboard falls back to its own folder.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .publish import BridgeError, call, control_port
from .retention import APPROVED
from .status import STATUS_FILE

SESSION_FOLDER = re.compile(r"^\d{4}-\d{2}-\d{2}[A-Za-z0-9_-]*-discord(?:-\d+)?$")
STATES = ("done", "paused", "incomplete", "failed", "waiting", "published")
_RESTART = re.compile(r"^(.*-discord)(?:-(\d+))?$")
LANGS = ("da", "en")


def _newest_key(name: str) -> tuple[str, int]:
    m = _RESTART.match(name)
    return (m.group(1), int(m.group(2) or 0)) if m else (name, 0)


def session_folders(root: Path) -> list[Path]:
    """The dated ``*-discord`` folders of ``root``, newest first."""
    try:
        found = [p for p in root.iterdir() if p.is_dir() and SESSION_FOLDER.match(p.name)]
    except OSError:
        return []
    return sorted(found, key=lambda p: _newest_key(p.name), reverse=True)


def read_status(session: Path) -> dict[str, Any] | None:
    try:
        raw = json.loads((session / "notes" / STATUS_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict) or raw.get("state") not in STATES:
        return None
    status: dict[str, Any] = {
        "session": session.name,
        "state": raw["state"],
        "message": str(raw.get("message") or ""),
    }
    if isinstance(raw.get("at"), str):
        status["at"] = raw["at"]
    return status


def read_recap(session: Path) -> dict[str, Any] | None:
    """The player recap of an approved session, or None."""
    notes = session / "notes"
    if not (notes / APPROVED).is_file():
        return None
    text: dict[str, str] = {}
    for lang in LANGS:
        try:
            body = (notes / f"recap.player.{lang}.md").read_text(encoding="utf-8")
        except OSError:
            continue
        if body.strip():
            text[lang] = body
    return {"session": session.name, "text": text} if text else None


def build_report(root: Path) -> dict[str, Any]:
    """What to send, a full snapshot (None clears a part on the bridge): the newest session's
    status and the newest approved session's recap. Empty when there is no session folder."""
    folders = session_folders(root)
    if not folders:
        return {}
    params: dict[str, Any] = {"status": read_status(folders[0]), "recap": None}
    for folder in folders:
        if not (folder / "notes" / APPROVED).is_file():
            continue
        # Only the newest approved session counts: last night's, not an older one.
        params["recap"] = read_recap(folder)
        break
    return params


def send_report(root: Path, port: int | None = None, world: str | None = None) -> str:
    """Send the report; returns one line for the log. Never raises."""
    params = build_report(root)
    if not params:
        return "Nothing to report to the bridge."
    params["action"] = "report"
    if world:
        params["world"] = world
    try:
        call(port or control_port(), params, timeout=10.0)
    except (BridgeError, ValueError) as exc:
        return f"Not reported to the bridge: {exc}"
    return "Reported to the bridge: " + " and ".join(k for k in ("status", "recap") if params.get(k))
