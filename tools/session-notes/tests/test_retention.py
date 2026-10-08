from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from session_notes.cli import main
from session_notes.retention import approve, audio_files, cleanup

NOW = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)


def make_session(root: Path, name: str, approved_days_ago: int | None) -> Path:
    s = root / name
    (s / "raw").mkdir(parents=True)
    (s / "notes").mkdir()
    (s / "transcripts" / "json").mkdir(parents=True)
    for f in ("1-anna.ogg", "2-bo.ogg", "raw/1-anna.rec", "craig-abc.flac.zip", "S1__x.wav"):
        (s / f).write_bytes(b"audio")
    for f in ("raw/events.jsonl", "notes/notes.json", "transcripts/json/anna.json", "speakers.json"):
        (s / f).write_text("{}", encoding="utf-8")
    if approved_days_ago is not None:
        approve(s, now=NOW - timedelta(days=approved_days_ago))
    return s


def test_audio_files_finds_audio_only(tmp_path: Path) -> None:
    s = make_session(tmp_path, "a", None)
    names = sorted(str(p.relative_to(s)).replace("\\", "/") for p in audio_files(s))
    assert names == ["1-anna.ogg", "2-bo.ogg", "S1__x.wav", "craig-abc.flac.zip", "raw/1-anna.rec"]


def test_cleanup_lists_by_default_and_deletes_with_apply(tmp_path: Path) -> None:
    old = make_session(tmp_path, "old", 15)
    recent = make_session(tmp_path, "recent", 13)
    never = make_session(tmp_path, "never", None)

    listed = cleanup(tmp_path, days=14, now=NOW)
    assert [i.session.name for i in listed] == ["old"]
    assert (old / "1-anna.ogg").exists()  # nothing deleted without apply

    done = cleanup(tmp_path, days=14, apply=True, now=NOW)
    assert [i.session.name for i in done] == ["old"]
    assert audio_files(old) == []
    for kept in ("notes/notes.json", "raw/events.jsonl", "transcripts/json/anna.json", "speakers.json"):
        assert (old / kept).exists()
    record = json.loads((old / "notes" / "audio-deleted.json").read_text(encoding="utf-8"))
    assert record[0]["retention_days"] == 14 and len(record[0]["files"]) == 5
    assert audio_files(recent) and audio_files(never)
    assert cleanup(tmp_path, days=14, apply=True, now=NOW) == []  # nothing left to do


def test_approve_needs_notes(tmp_path: Path) -> None:
    (tmp_path / "s" / "notes").mkdir(parents=True)
    with pytest.raises(FileNotFoundError):
        approve(tmp_path / "s")


def test_cli_cleanup_dry_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    s = make_session(tmp_path, "old", None)
    approve(s, now=datetime.now(timezone.utc) - timedelta(days=30))  # the CLI uses the real clock
    monkeypatch.setenv("FVTT_SESSIONS_DIR", str(tmp_path))
    assert main(["cleanup", "--days", "14"]) == 0
    out = capsys.readouterr().out
    assert "would delete" in out and "Nothing deleted" in out
    assert (tmp_path / "old" / "1-anna.ogg").exists()
    assert main(["cleanup", "--days", "14", "--yes"]) == 0
    assert not (tmp_path / "old" / "1-anna.ogg").exists()


def test_cli_cleanup_needs_days(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    """D-097: no default retention. `cleanup` and `cleanup --yes` without --days refuse."""
    s = make_session(tmp_path, "old", None)
    approve(s, now=datetime.now(timezone.utc) - timedelta(days=30))
    monkeypatch.setenv("FVTT_SESSIONS_DIR", str(tmp_path))
    for argv in (["cleanup"], ["cleanup", "--yes"]):
        with pytest.raises(SystemExit) as exc:
            main(argv)
        assert exc.value.code == 2
        assert "--days" in capsys.readouterr().err
    assert (s / "1-anna.ogg").exists()
