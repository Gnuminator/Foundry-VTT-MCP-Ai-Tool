"""``notes/status.json``: how the last run for a session ended, for the GM to read.

Written by ``run`` (and by ``auto.ps1`` for the steps around it). States: ``done``, ``paused``
(usage limit, the next pass continues), ``incomplete`` (some scenes are still raw and will be
tried again), ``failed``. The file is replaced whole each time.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

STATUS_FILE = "status.json"


def write_status(session: Path, state: str, message: str, **extra: Any) -> Path:
    notes = session / "notes"
    notes.mkdir(parents=True, exist_ok=True)
    path = notes / STATUS_FILE
    payload = {
        "state": state,
        "message": message,
        "at": datetime.now().astimezone().isoformat(timespec="seconds"),
        **extra,
    }
    tmp = path.with_name(STATUS_FILE + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    tmp.replace(path)
    return path
