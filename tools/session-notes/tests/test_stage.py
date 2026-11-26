"""NPC on stage: the GM's lines get an "[as Name]" mark and the names reach the roster."""

from __future__ import annotations

import json
from pathlib import Path

from helpers import write_session

from session_notes import stage
from session_notes.model import apply_speakers, load_roster, load_timeline

ROWS = [
    (10.0, 14.0, "Danni", "Welcome, travellers."),
    (40.0, 45.0, "Danni", "I am Hrafne, and I do not like strangers."),
    (60.0, 62.0, "Anna", "We mean no harm."),
    (80.0, 85.0, "Danni", "Then go."),
]
START = "2026-11-22T19:06:00+00:00"


def make(tmp: Path) -> Path:
    session = write_session(tmp / "2026-11-22-discord", ROWS)
    (session / "raw").mkdir()
    (session / "raw" / "session.json").write_text(
        json.dumps({"startedAt": START, "stoppedAt": "2026-11-22T21:09:00+00:00"}), encoding="utf-8"
    )
    (session / "speakers.json").write_text(
        json.dumps({"danni": {"player": "Danni", "character": "GM"}}), encoding="utf-8"
    )
    return session


def log_line(at: str, name: str | None) -> str:
    return json.dumps(
        {
            "eventType": "npc-on-stage",
            "timestamp": at,
            "actorName": name,
            "details": {"onStage": name is not None},
        }
    )


def test_gm_lines_inside_a_stage_window_are_marked(tmp_path: Path) -> None:
    session = make(tmp_path)
    log = tmp_path / "log.jsonl"
    log.write_text(
        "\n".join(
            [
                log_line("2026-11-22T19:06:30+00:00", "Hrafne"),  # 30 s in
                log_line("2026-11-22T19:07:30+00:00", None),  # 90 s in
                json.dumps({"eventType": "session-start", "timestamp": START}),
            ]
        ),
        encoding="utf-8",
    )
    assert stage.export(session, [log]) == 2
    lines = apply_speakers(load_timeline(session / "timeline" / "timeline.jsonl"), session)
    assert lines[0].text == "Welcome, travellers."
    assert lines[1].text.startswith("[as Hrafne] I am Hrafne")
    assert lines[2].text == "We mean no harm."  # a player is never marked
    # 80 s in is before the off event at 90 s, so the NPC is still on stage.
    assert lines[3].text == "[as Hrafne] Then go."
    assert lines[1].character == "GM"


def test_a_window_ends_when_the_npc_goes_off_stage(tmp_path: Path) -> None:
    session = make(tmp_path)
    (session / "stage.json").write_text(
        json.dumps(
            [
                {"at": "2026-11-22T19:06:30+00:00", "name": "Hrafne"},
                {"at": "2026-11-22T19:07:00+00:00", "name": None},
            ]
        ),
        encoding="utf-8",
    )
    lines = apply_speakers(load_timeline(session / "timeline" / "timeline.jsonl"), session)
    assert lines[1].text.startswith("[as Hrafne]")
    assert lines[3].text == "Then go."  # 80 s in: off stage since 60 s


def test_stage_names_join_the_roster(tmp_path: Path) -> None:
    session = make(tmp_path)
    (session / "stage.json").write_text(
        json.dumps([{"at": "2026-11-22T19:06:30+00:00", "name": "Hrafne"}]), encoding="utf-8"
    )
    lines = load_timeline(session / "timeline" / "timeline.jsonl")
    assert "Hrafne" in load_roster(session, lines).names


def test_no_stage_file_changes_nothing(tmp_path: Path) -> None:
    session = make(tmp_path)
    lines = apply_speakers(load_timeline(session / "timeline" / "timeline.jsonl"), session)
    assert all(not line.text.startswith("[as ") for line in lines)
