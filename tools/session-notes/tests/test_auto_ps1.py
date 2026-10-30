"""Smoke tests for ``auto.ps1``: the pass lock and ``Write-Status -KeepFresh`` (#420 review L5).

The script is Windows PowerShell 7 only (it resolves ``..\\..`` and runs a scheduled task on the
user's PC), so these skip elsewhere and in CI's Linux python job. They run it for real with
``FVTT_SESSIONS_DIR`` pointing at a temp folder and a stand-in ``python.cmd`` first on PATH, so no
Claude, Docker or bridge is involved.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

AUTO = Path(__file__).resolve().parents[1] / "auto.ps1"
PWSH = shutil.which("pwsh")

pytestmark = pytest.mark.skipif(
    sys.platform != "win32" or PWSH is None, reason="auto.ps1 needs Windows and pwsh"
)


def run_pass(sessions: Path, fake_bin: Path | None = None, **env: str) -> tuple[int, str]:
    full = {k: v for k, v in os.environ.items() if k != "FVTT_PI_HOST"}
    full["FVTT_SESSIONS_DIR"] = str(sessions)
    if fake_bin is not None:
        full["PATH"] = f"{fake_bin}{os.pathsep}{full['PATH']}"
    full.update(env)
    assert PWSH is not None
    done = subprocess.run(
        [PWSH, "-NoProfile", "-NonInteractive", "-File", str(AUTO)],
        env=full,
        capture_output=True,
        text=True,
        timeout=120,
    )
    return done.returncode, done.stdout + done.stderr


def make_lock(sessions: Path, content: str, age_minutes: float = 0) -> Path:
    lock = sessions / ".auto.lock"
    lock.write_text(content, encoding="utf-8")
    if age_minutes:
        then = time.time() - age_minutes * 60
        os.utime(lock, (then, then))
    return lock


def dead_pid() -> int:
    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait()
    return proc.pid


@pytest.fixture
def sessions(tmp_path: Path) -> Path:
    folder = tmp_path / "sessions"
    folder.mkdir()
    return folder


def test_a_live_lock_stops_the_pass_and_stays(sessions: Path) -> None:
    lock = make_lock(sessions, str(os.getpid()))
    code, out = run_pass(sessions)
    assert code == 0 and "Another pass is running" in out
    assert lock.read_text(encoding="utf-8").strip() == str(os.getpid())


def test_a_lock_of_a_dead_pass_is_removed_at_once(sessions: Path) -> None:
    lock = make_lock(sessions, str(dead_pid()), age_minutes=1)
    code, out = run_pass(sessions)
    assert code == 0 and "Removing a stale lock" in out and "Another pass" not in out
    assert not lock.exists()  # this pass took the lock and released it at the end


def test_an_unreadable_lock_blocks_for_ten_minutes_only(sessions: Path) -> None:
    make_lock(sessions, "", age_minutes=2)
    assert "Another pass is running" in run_pass(sessions)[1]
    make_lock(sessions, "not a pid", age_minutes=30)
    code, out = run_pass(sessions)
    assert code == 0 and "Removing a stale lock" in out


def test_a_lock_older_than_six_hours_is_stale_even_if_the_pid_is_alive(sessions: Path) -> None:
    make_lock(sessions, str(os.getpid()), age_minutes=7 * 60)
    assert "Removing a stale lock" in run_pass(sessions)[1]


# --- Write-Status -KeepFresh ------------------------------------------------------------------


@pytest.fixture
def folder_with_timeline(sessions: Path) -> Path:
    folder = sessions / "2026-10-01-test"
    (folder / "timeline").mkdir(parents=True)
    (folder / "timeline" / "timeline.jsonl").write_text("{}\n", encoding="utf-8")
    return folder


def fake_python(tmp: Path, writes_status: bool) -> Path:
    """A python.cmd that stands in for `python -m session_notes run <folder>`: exit 2, and
    optionally the specific status.json the real run writes before failing."""
    bin_dir = tmp / ("bin-writes" if writes_status else "bin-silent")
    bin_dir.mkdir()
    lines = ["@echo off", 'if "%~3"=="consent" exit /b 0']
    if writes_status:
        lines += [
            'mkdir "%~4\\notes" 2>nul',
            '>"%~4\\notes\\status.json" echo {"state":"incomplete","message":"two scenes are raw"}',
        ]
    lines.append("exit /b 2")
    (bin_dir / "python.cmd").write_text("\r\n".join(lines) + "\r\n", encoding="ascii")
    return bin_dir


def read_status(folder: Path) -> dict[str, str]:
    return json.loads((folder / "notes" / "status.json").read_text(encoding="utf-8-sig"))


def test_a_failed_notes_run_keeps_the_status_the_run_wrote(
    tmp_path: Path, sessions: Path, folder_with_timeline: Path
) -> None:
    code, out = run_pass(sessions, fake_python(tmp_path, writes_status=True))
    assert code == 0 and "notes failed (exit 2)" in out
    assert read_status(folder_with_timeline) == {
        "state": "incomplete",
        "message": "two scenes are raw",
    }


def test_a_failed_notes_run_replaces_an_old_status(
    tmp_path: Path, sessions: Path, folder_with_timeline: Path
) -> None:
    notes = folder_with_timeline / "notes"
    notes.mkdir()
    old = notes / "status.json"
    old.write_text(json.dumps({"state": "paused", "message": "old", "at": "x"}), encoding="utf-8")
    then = time.time() - 3600
    os.utime(old, (then, then))
    code, _ = run_pass(sessions, fake_python(tmp_path, writes_status=False))
    status = read_status(folder_with_timeline)
    assert code == 0 and status["state"] == "failed" and "exit 2" in status["message"]
    assert (sessions / ".auto.lock").exists() is False


def test_a_session_without_recorded_consent_is_not_processed(
    sessions: Path, folder_with_timeline: Path
) -> None:
    (folder_with_timeline / "raw").mkdir()
    (folder_with_timeline / "raw" / "session.json").write_text(
        json.dumps({"tracks": [{"userId": "42", "username": "ann", "file": "1-ann.rec"}]}),
        encoding="utf-8",
    )
    code, out = run_pass(sessions)  # real python, so the real consent check runs; no Claude
    status = read_status(folder_with_timeline)
    assert code == 0 and "recording consent is missing" in out
    assert status["state"] == "waiting" and "No recorded yes" in status["message"]
    assert not (folder_with_timeline / "notes" / "notes.json").exists()
