"""Recap inbox (I-132): export needs consent, notes come back, nothing else leaves."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from session_notes.cli import main
from session_notes.consent import set_consent
from session_notes.inbox import export_session, import_notes, pending, sync

TRACKS = [{"userId": "11", "username": "ann", "displayName": "Ann", "file": "1-ann.rec"}]


@pytest.fixture
def dirs(tmp_path: Path) -> tuple[Path, Path]:
    sessions, inbox = tmp_path / "sessions", tmp_path / "inbox"
    sessions.mkdir()
    inbox.mkdir()
    return sessions, inbox


def make_session(sessions: Path) -> Path:
    folder = sessions / "2026-11-01_2000-discord"
    (folder / "raw").mkdir(parents=True)
    (folder / "raw" / "session.json").write_text(json.dumps({"tracks": TRACKS}), encoding="utf-8")
    (folder / "1-ann.ogg").write_bytes(b"audio")
    (folder / "timeline").mkdir()
    (folder / "timeline" / "timeline.jsonl").write_text('{"text": "hej"}\n', encoding="utf-8")
    (folder / "names.txt").write_text("Ilvara\n", encoding="utf-8")
    return folder


def test_export_needs_consent(dirs: tuple[Path, Path]) -> None:
    sessions, inbox = dirs
    folder = make_session(sessions)
    assert "no consent" in (export_session(folder, sessions, inbox) or "")
    assert pending(inbox) == []


def test_export_copies_text_only_then_notes_come_back(dirs: tuple[Path, Path]) -> None:
    sessions, inbox = dirs
    folder = make_session(sessions)
    set_consent(sessions, "11", "yes")
    assert export_session(folder, sessions, inbox) is None
    sent = inbox / "sessions" / folder.name
    assert sorted(p.relative_to(sent).as_posix() for p in sent.rglob("*") if p.is_file()) == [
        "names.txt",
        "timeline/timeline.jsonl",
    ]
    assert export_session(folder, sessions, inbox) == "already in the inbox"
    assert pending(inbox) == [sent]
    # the routine writes notes (and a work cache that must not travel back)
    (sent / "notes" / ".work").mkdir(parents=True)
    (sent / "notes" / ".work" / "scene-001.json").write_text("{}", encoding="utf-8")
    (sent / "notes" / "notes.json").write_text("{}", encoding="utf-8")
    assert pending(inbox) == []
    assert import_notes(inbox, sessions) == [folder.name]
    assert (folder / "notes" / "notes.json").is_file()
    assert not (folder / "notes" / ".work").exists()
    assert import_notes(inbox, sessions) == []


def test_sync_without_git_and_cli_off_by_default(
    dirs: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    sessions, inbox = dirs
    make_session(sessions)
    set_consent(sessions, "11", "yes")
    report = sync(sessions, inbox, use_git=False)
    assert report.exported == ["2026-11-01_2000-discord"]
    monkeypatch.delenv("FVTT_RECAP_INBOX", raising=False)
    assert main(["inbox", "sync"]) == 0
    assert main(["inbox", "pending"]) == 1
