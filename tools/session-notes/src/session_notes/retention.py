"""Audio retention (D-072): recorded audio is deleted 14 days after the GM approves the notes.

``approve`` marks a session's notes as approved (``notes/approved.json``); the later journal
reveal flow for the player recap writes the same marker. ``cleanup`` finds sessions whose
approval is older than the retention period and deletes their audio only: every audio file and
the recorder's raw packet files. Transcripts, the timeline and the notes stay. What was deleted
is written to ``notes/audio-deleted.json``. Nothing is deleted without ``apply=True``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

RETENTION_DAYS = 14
AUDIO_SUFFIXES = frozenset(
    {".wav", ".flac", ".ogg", ".oga", ".opus", ".mp3", ".m4a", ".aac", ".wma", ".rec", ".webm"}
)
# Craig downloads are zips of per-speaker audio.
AUDIO_ARCHIVE = ("craig-", ".zip")
APPROVED = "approved.json"
DELETED = "audio-deleted.json"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def approve(session: Path, by: str = "GM", now: datetime | None = None) -> Path:
    notes = session / "notes"
    if not (notes / "notes.json").exists():
        raise FileNotFoundError(f"No notes in {notes}; write them before approving.")
    path = notes / APPROVED
    path.write_text(
        json.dumps({"approved_at": (now or _now()).isoformat(), "by": by}) + "\n",
        encoding="utf-8",
    )
    return path


def approved_at(session: Path) -> datetime | None:
    path = session / "notes" / APPROVED
    if not path.exists():
        return None
    return datetime.fromisoformat(json.loads(path.read_text(encoding="utf-8"))["approved_at"])


def audio_files(session: Path) -> list[Path]:
    """Every audio file in the session folder (any depth), plus Craig zips."""
    found = []
    for path in session.rglob("*"):
        if not path.is_file():
            continue
        name = path.name.lower()
        if path.suffix.lower() in AUDIO_SUFFIXES or (
            name.startswith(AUDIO_ARCHIVE[0]) and name.endswith(AUDIO_ARCHIVE[1])
        ):
            found.append(path)
    return sorted(found)


@dataclass(slots=True)
class CleanupItem:
    session: Path
    approved: datetime
    files: list[Path] = field(default_factory=list)

    @property
    def bytes(self) -> int:
        return sum(f.stat().st_size for f in self.files if f.exists())


def due_sessions(
    root: Path, days: int = RETENTION_DAYS, now: datetime | None = None
) -> list[CleanupItem]:
    cutoff = (now or _now()) - timedelta(days=days)
    items = []
    for session in sorted(p for p in root.iterdir() if p.is_dir()):
        when = approved_at(session)
        if when is None or when > cutoff:
            continue
        files = audio_files(session)
        if files:
            items.append(CleanupItem(session, when, files))
    return items


def cleanup(
    root: Path, days: int = RETENTION_DAYS, apply: bool = False, now: datetime | None = None
) -> list[CleanupItem]:
    """Return what is due; delete it only when ``apply`` is true."""
    items = due_sessions(root, days, now)
    if not apply:
        return items
    for item in items:
        record = {
            "deleted_at": (now or _now()).isoformat(),
            "approved_at": item.approved.isoformat(),
            "retention_days": days,
            "files": [str(f.relative_to(item.session)) for f in item.files],
            "bytes": item.bytes,
        }
        for f in item.files:
            f.unlink(missing_ok=True)
        log = item.session / "notes" / DELETED
        earlier = json.loads(log.read_text(encoding="utf-8")) if log.exists() else []
        log.write_text(json.dumps(earlier + [record], indent=1) + "\n", encoding="utf-8")
    return items
