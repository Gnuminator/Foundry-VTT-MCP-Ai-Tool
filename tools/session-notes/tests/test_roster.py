"""roster.json: Discord user id to character, who is GM, applied to a recording and checked."""

from __future__ import annotations

import json
from pathlib import Path

from helpers import FakeClaude, write_session

from session_notes import roster
from session_notes.cli import main
from session_notes.run import Options, Writer

ROWS = [
    (10.0, 14.0, "Anna", "Vi går mod Maravia."),
    (40.0, 45.0, "Bo", "Jeg tjekker døren for fælder."),
    (70.0, 75.0, "Rikke", "Døren er låst."),
]
TRACKS = {
    "tracks": [
        {"file": "1-anna.ogg", "userId": "111", "displayName": "Anna"},
        {"file": "2-bo.ogg", "userId": "222", "displayName": "Bo"},
        {"file": "3-rikke.ogg", "userId": "333", "displayName": "Rikke"},
    ]
}


def make(tmp: Path, roster_data: dict | None) -> tuple[Path, Path]:
    sessions = tmp / "sessions"
    session = write_session(sessions / "2026-11-22-discord", ROWS)
    (session / "raw").mkdir()
    (session / "raw" / "session.json").write_text(json.dumps(TRACKS), encoding="utf-8")
    if roster_data is not None:
        (sessions / "roster.json").write_text(json.dumps(roster_data), encoding="utf-8")
    return sessions, session


FULL = {
    "gm": "333",
    "players": {
        "111": {"name": "Anna", "character": "Ilvara", "pronouns": "she/her"},
        "222": {"name": "Bo", "character": "Vorn"},
    },
}


def test_roster_reaches_the_prompt_with_gm_line_and_characters(tmp_path: Path) -> None:
    _, session = make(tmp_path, FULL)
    fake = FakeClaude()
    Writer(session, fake, Options(workers=1)).run()
    prompt = fake.calls[0][1]
    assert "- Rikke is the GM (narrates, rules, plays all NPCs)" in prompt
    assert "- Anna plays Ilvara (she/her)" in prompt and "- Bo plays Vorn" in prompt
    assert "Bo (Vorn): Jeg tjekker" in prompt


def test_speakers_json_character_wins_over_the_roster(tmp_path: Path) -> None:
    _, session = make(tmp_path, FULL)
    (session / "speakers.json").write_text(json.dumps({"bo": {"character": "Other"}}), encoding="utf-8")
    fake = FakeClaude()
    Writer(session, fake, Options(workers=1)).run()
    assert "- Bo plays Other" in fake.calls[0][1]


def test_check_lists_missing_speakers(tmp_path: Path, capsys, monkeypatch) -> None:
    sessions, session = make(tmp_path, {"gm": "333", "players": {"111": {"character": "Ilvara"}}})
    res = roster.check(session)
    assert not res.ok and res.missing == ["Bo (id 222)"]
    monkeypatch.setenv("FVTT_SESSIONS_DIR", str(sessions))
    assert main(["roster", "check", session.name]) == 1
    assert "Bo (id 222)" in capsys.readouterr().out
    (sessions / "roster.json").write_text(json.dumps(FULL), encoding="utf-8")
    assert main(["roster", "check", session.name]) == 0


def test_check_without_a_roster_or_a_gm(tmp_path: Path) -> None:
    _, session = make(tmp_path, None)
    assert not roster.check(session).ok and len(roster.check(session).missing) == 3
    _, session2 = make(tmp_path / "b", {"players": {u: {"character": "X"} for u in ("111", "222", "333")}})
    assert "no GM" in roster.check(session2).message


def test_no_roster_leaves_everything_as_before(tmp_path: Path) -> None:
    _, session = make(tmp_path, None)
    fake = FakeClaude()
    Writer(session, fake, Options(workers=1)).run()
    assert "- Anna plays Ilvara" in fake.calls[0][1]  # the test timeline's own character
