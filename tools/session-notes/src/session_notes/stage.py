"""NPC on stage: whose voice the GM's lines are.

The bridge logs a ``npc-on-stage`` event in its session log each time the GM puts an NPC on the TV
(or takes it off). ``export`` copies the ones that fall inside a recording into
``<session>/stage.json``; ``apply_stage`` then marks the GM's lines in those windows as
``[as Hrafne] ...`` (the character stays "GM", so nothing that tests for the GM changes), and
``names`` gives the NPC names to the roster so they are spelled right.

``stage.json`` is a list of ``{"at": ISO time, "name": "Hrafne" | null}`` in time order; ``null``
means nobody is on stage from then on. Times are mapped onto the timeline with ``startedAt`` from
``raw/session.json`` (the recorder's zero).
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

STAGE_EVENT = "npc-on-stage"


def _parse_time(value: object) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _recording_span(session: Path) -> tuple[float, float | None] | None:
    path = session / "raw" / "session.json"
    if not path.exists():
        return None
    try:
        meta = json.loads(path.read_text(encoding="utf-8-sig"))
    except ValueError:
        return None
    if not isinstance(meta, dict):
        return None
    start = _parse_time(meta.get("startedAt"))
    if start is None:
        return None
    return start, _parse_time(meta.get("stoppedAt"))


def load_events(session: Path) -> list[tuple[float, str | None]]:
    """``stage.json`` as (unix time, NPC name or None), sorted by time. Broken entries are skipped."""
    path = session / "stage.json"
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except ValueError:
        return []
    events: list[tuple[float, str | None]] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        at = _parse_time(item.get("at"))
        name = item.get("name")
        if at is None or not (name is None or isinstance(name, str)):
            continue
        events.append((at, name.strip() or None if isinstance(name, str) else None))
    events.sort(key=lambda e: e[0])
    return events


def names(session: Path) -> list[str]:
    """The NPC names that were on stage, once each, in order."""
    seen: list[str] = []
    for _, name in load_events(session):
        if name and name not in seen:
            seen.append(name)
    return seen


def npc_at(events: list[tuple[float, str | None]], when: float) -> str | None:
    """Who was on stage at ``when`` (unix time): the last event at or before it."""
    current: str | None = None
    for at, name in events:
        if at > when:
            break
        current = name
    return current


def apply_stage(lines: list, session: Path) -> list:
    """Mark the GM's lines that start while an NPC is on stage; other lines are returned as they are."""
    from .model import Line, is_gm  # late: model imports this module

    events = load_events(session)
    span = _recording_span(session)
    if not events or span is None:
        return lines
    zero = span[0]
    out = []
    for line in lines:
        npc = npc_at(events, zero + line.start) if is_gm(line.character) else None
        if npc and not line.text.startswith("[as "):
            line = Line(line.id, line.start, line.end, line.speaker, line.player, line.character,
                        f"[as {npc}] {line.text}", line.uncertain)
        out.append(line)
    return out


def export(session: Path, log_files: list[Path]) -> int:
    """Write ``stage.json`` from bridge session-log files. Returns how many events fall in the recording."""
    span = _recording_span(session)
    if span is None:
        raise ValueError("raw/session.json with startedAt is needed to place the events")
    start, stop = span
    rows: list[tuple[float, str | None]] = []
    for path in log_files:
        with path.open(encoding="utf-8-sig") as fh:
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    entry = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(entry, dict) or entry.get("eventType") != STAGE_EVENT:
                    continue
                at = _parse_time(entry.get("timestamp"))
                if at is None or at < start or (stop is not None and at > stop):
                    continue
                details = entry.get("details") if isinstance(entry.get("details"), dict) else {}
                name = entry.get("actorName") if details.get("onStage") else None
                rows.append((at, name if isinstance(name, str) and name else None))
    rows.sort(key=lambda r: r[0])
    out = [
        {"at": datetime.fromtimestamp(at).astimezone().isoformat(timespec="seconds"), "name": name}
        for at, name in rows
    ]
    (session / "stage.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    return len(out)
