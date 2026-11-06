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


def run_pass(
    sessions: Path, fake_bin: Path | None = None, args: tuple[str, ...] = (), **env: str
) -> tuple[int, str]:
    full = {k: v for k, v in os.environ.items() if k != "FVTT_PI_HOST"}
    full["FVTT_SESSIONS_DIR"] = str(sessions)
    if fake_bin is not None:
        full["PATH"] = f"{fake_bin}{os.pathsep}{full['PATH']}"
    full.update(env)
    assert PWSH is not None
    done = subprocess.run(
        [PWSH, "-NoProfile", "-NonInteractive", "-File", str(AUTO), *args],
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


# --- Tells to the GM bot channel -----------------------------------------------------------------


def make_bin(
    tmp: Path, consent: int = 0, run: int = 0, publish: int = 0, node: int = 0
) -> tuple[Path, Path]:
    """A python.cmd that answers `session_notes consent|run|publish` with the given exit codes, and a
    node.cmd that stands in for announce.mjs: it logs its arguments and exits with ``node``."""
    bin_dir = tmp / "bin-tells"
    bin_dir.mkdir()
    calls = tmp / "node-calls.txt"
    python_lines = [
        "@echo off",
        f'if "%~3"=="consent" exit /b {consent}',
        f'if "%~3"=="run" exit /b {run}',
        f'if "%~3"=="publish" exit /b {publish}',
        "exit /b 0",
    ]
    (bin_dir / "python.cmd").write_text("\r\n".join(python_lines) + "\r\n", encoding="ascii")
    node_lines = ["@echo off", f'echo %* >> "{calls}"', f"exit /b {node}"]
    (bin_dir / "node.cmd").write_text("\r\n".join(node_lines) + "\r\n", encoding="ascii")
    return bin_dir, calls


def tells(calls: Path) -> list[str]:
    return calls.read_text(encoding="utf-8").splitlines() if calls.exists() else []


@pytest.fixture
def folder_with_notes(sessions: Path) -> Path:
    """Notes written (notes.json with a session), not yet approved: the pass publishes them."""
    folder = sessions / "2026-10-01-test"
    (folder / "timeline").mkdir(parents=True)
    (folder / "timeline" / "timeline.jsonl").write_text("{}\n", encoding="utf-8")
    (folder / "notes").mkdir()
    (folder / "notes" / "notes.json").write_text('{"session": {}}', encoding="utf-8")
    return folder


def test_a_paused_notes_run_tells_once_a_day(
    tmp_path: Path, sessions: Path, folder_with_timeline: Path
) -> None:
    bin_dir, calls = make_bin(tmp_path, run=75)
    assert run_pass(sessions, bin_dir)[0] == 0
    assert run_pass(sessions, bin_dir)[0] == 0  # the next hourly pass: same event, same day
    sent = tells(calls)
    assert len(sent) == 1 and "gm-bot" in sent[0] and "2026-10-01-test" in sent[0]
    assert "paused" in sent[0]
    assert (sessions / ".notes-tells.json").exists()


def test_a_session_without_consent_tells_the_gm_once(
    tmp_path: Path, sessions: Path, folder_with_timeline: Path
) -> None:
    bin_dir, calls = make_bin(tmp_path, consent=77)
    run_pass(sessions, bin_dir)
    run_pass(sessions, bin_dir)
    sent = tells(calls)
    assert len(sent) == 1 and "consent" in sent[0] and "2026-10-01-test" in sent[0]


def test_another_consent_code_tells_nothing(
    tmp_path: Path, sessions: Path, folder_with_timeline: Path
) -> None:
    bin_dir, calls = make_bin(tmp_path, consent=2)
    run_pass(sessions, bin_dir)
    assert tells(calls) == []


def test_a_failed_publish_tells(tmp_path: Path, sessions: Path, folder_with_notes: Path) -> None:
    bin_dir, calls = make_bin(tmp_path, publish=1)
    code, _ = run_pass(sessions, bin_dir)
    sent = tells(calls)
    assert code == 0 and len(sent) == 1 and "failed" in sent[0]


def test_raw_scenes_that_get_published_tell_the_gm(
    tmp_path: Path, sessions: Path, folder_with_notes: Path
) -> None:
    (folder_with_notes / "notes" / "status.json").write_text(
        json.dumps({"state": "incomplete", "message": "two scenes are raw", "at": "x"}),
        encoding="utf-8",
    )
    bin_dir, calls = make_bin(tmp_path, publish=0)
    run_pass(sessions, bin_dir)
    sent = tells(calls)
    assert len(sent) == 1 and "raw" in sent[0]


def test_a_clean_publish_tells_nothing(
    tmp_path: Path, sessions: Path, folder_with_notes: Path
) -> None:
    bin_dir, calls = make_bin(tmp_path, publish=0)
    run_pass(sessions, bin_dir)
    assert tells(calls) == []


def test_a_tell_that_cannot_be_posted_never_fails_the_pass_and_is_retried(
    tmp_path: Path, sessions: Path, folder_with_notes: Path
) -> None:
    bin_dir, calls = make_bin(tmp_path, publish=1, node=1)
    code, out = run_pass(sessions, bin_dir)
    assert code == 0 and "tell not posted" in out
    assert not (sessions / ".notes-tells.json").exists()  # not recorded: the next pass tries again
    run_pass(sessions, bin_dir)
    assert len(tells(calls)) == 2


def test_a_dry_run_posts_nothing(tmp_path: Path, sessions: Path, folder_with_timeline: Path) -> None:
    bin_dir, calls = make_bin(tmp_path, consent=77)
    code, out = run_pass(sessions, bin_dir, args=("-DryRun",))
    assert code == 0 and "would tell the GM bot channel" in out
    assert tells(calls) == [] and not (sessions / ".notes-tells.json").exists()
