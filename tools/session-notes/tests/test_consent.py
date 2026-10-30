"""Recording consent gate (D-097): who may be turned into text."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from session_notes.cli import EXIT_NO_CONSENT, main
from session_notes.consent import check_consent, load_consent, set_consent

TRACKS = [
    {"userId": "11", "username": "ann", "displayName": "Ann", "file": "1-ann.rec"},
    {"userId": "22", "username": "bo", "displayName": "Bo", "file": "2-bo.rec"},
]


@pytest.fixture
def sessions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "sessions"
    root.mkdir()
    monkeypatch.setenv("FVTT_SESSIONS_DIR", str(root))
    return root


def make_session(sessions: Path, tracks: list[dict[str, str]] = TRACKS) -> Path:
    folder = sessions / "2026-11-01_2000-discord"
    (folder / "raw").mkdir(parents=True)
    (folder / "raw" / "session.json").write_text(json.dumps({"tracks": tracks}), encoding="utf-8")
    for t in tracks:
        stem = Path(t["file"]).stem
        (folder / "raw" / t["file"]).write_bytes(b"x")
        (folder / f"{stem}.ogg").write_bytes(b"x")
    return folder


def test_nothing_recorded_blocks_and_names_everyone(sessions: Path) -> None:
    result = check_consent(make_session(sessions))
    assert not result.ok and "Ann (id 11)" in result.message and "Bo (id 22)" in result.message


def test_one_missing_answer_blocks(sessions: Path) -> None:
    folder = make_session(sessions)
    set_consent(sessions, "11", "yes")
    result = check_consent(folder)
    assert not result.ok and result.missing == ["Bo (id 22)"]


def test_every_yes_passes(sessions: Path) -> None:
    folder = make_session(sessions)
    set_consent(sessions, "11", "yes", name="Ann")
    set_consent(sessions, "22", "yes")
    assert check_consent(folder).ok


def test_a_no_blocks_until_the_audio_is_deleted(sessions: Path) -> None:
    folder = make_session(sessions)
    set_consent(sessions, "11", "yes")
    set_consent(sessions, "22", "no")
    blocked = check_consent(folder)
    assert not blocked.ok and "delete it first" in blocked.message
    for f in [folder / "raw" / "2-bo.rec", folder / "2-bo.ogg"]:
        f.unlink()
    assert check_consent(folder).ok


def test_a_changed_mind_overwrites_and_keeps_the_name(sessions: Path) -> None:
    set_consent(sessions, "11", "yes", name="Ann", when="2026-11-02")
    set_consent(sessions, "11", "no")
    entry = load_consent(sessions)["11"]
    assert entry["answer"] == "no" and entry["name"] == "Ann"


def test_missing_or_empty_speaker_list_blocks(sessions: Path) -> None:
    bare = sessions / "bare"
    bare.mkdir()
    assert not check_consent(bare).ok
    assert not check_consent(make_session(sessions, tracks=[])).ok


def test_ids_must_be_digits_and_answers_yes_or_no(sessions: Path) -> None:
    with pytest.raises(ValueError):
        set_consent(sessions, "ann", "yes")
    with pytest.raises(ValueError):
        set_consent(sessions, "11", "maybe")


def test_a_broken_consent_file_counts_as_no_consent(sessions: Path) -> None:
    folder = make_session(sessions)
    (sessions / "consent.json").write_text("{not json", encoding="utf-8")
    assert not check_consent(folder).ok


def test_cli_check_exit_code_and_status(sessions: Path) -> None:
    folder = make_session(sessions)
    assert main(["consent", "check", str(folder), "--write-status"]) == EXIT_NO_CONSENT
    status = json.loads((folder / "notes" / "status.json").read_text(encoding="utf-8"))
    assert status["state"] == "waiting" and "No recorded yes" in status["message"]
    assert main(["consent", "set", "11", "yes"]) == 0
    assert main(["consent", "set", "22", "yes"]) == 0
    assert main(["consent", "check", str(folder)]) == 0
    assert main(["consent", "set", "oops", "yes"]) == 1


def test_set_refuses_to_overwrite_an_unreadable_file(sessions: Path) -> None:
    broken = sessions / "consent.json"
    broken.write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError, match="cannot be read"):
        set_consent(sessions, "11", "yes")
    assert broken.read_text(encoding="utf-8") == "{not json"
    with pytest.raises(ValueError):
        set_consent(sessions, "١٢", "yes")  # non-ASCII digits are not a Discord id
