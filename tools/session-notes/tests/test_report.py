from __future__ import annotations

import json
import socket
from pathlib import Path

import pytest

from session_notes.cli import main
from session_notes.report import build_report, send_report, session_folders
from test_publish import FakeBridge


def write(root: Path, name: str, state: str | None = None, recap: dict[str, str] | None = None, approved: bool = False) -> None:
    notes = root / name / "notes"
    notes.mkdir(parents=True)
    if state:
        (notes / "status.json").write_text(
            json.dumps({"state": state, "message": f"{state} now", "at": "2026-11-22T21:00:00+01:00"}),
            encoding="utf-8",
        )
    for lang, text in (recap or {}).items():
        (notes / f"recap.player.{lang}.md").write_text(text, encoding="utf-8")
    if approved:
        (notes / "approved.json").write_text("{}", encoding="utf-8")


def test_only_dated_discord_folders_count(tmp_path: Path) -> None:
    write(tmp_path, "2026-11-01_1900-discord", "done")
    write(tmp_path, "2026-11-01_1900-discord-2", "paused")
    write(tmp_path, "livekit-recordings", "failed")
    write(tmp_path, ".incoming", "failed")
    write(tmp_path, "2026-11-02x..-discord-evil", "failed")
    assert [p.name for p in session_folders(tmp_path)] == [
        "2026-11-01_1900-discord-2",
        "2026-11-01_1900-discord",
    ]
    report = build_report(tmp_path)
    assert report["status"]["state"] == "paused"
    assert report["recap"] is None  # a full snapshot: None clears an old recap on the bridge


def test_recap_is_the_newest_approved_sessions_only(tmp_path: Path) -> None:
    write(tmp_path, "2026-10-01_1900-discord", "published", {"en": "Old."}, approved=True)
    write(tmp_path, "2026-11-01_1900-discord", "paused", {"en": "New, not approved."})
    report = build_report(tmp_path)
    assert report["status"]["session"] == "2026-11-01_1900-discord"
    assert report["recap"] == {"session": "2026-10-01_1900-discord", "text": {"en": "Old."}}


def test_nothing_to_report_without_sessions(tmp_path: Path) -> None:
    assert build_report(tmp_path) == {}
    assert send_report(tmp_path / "missing") == "Nothing to report to the bridge."


def test_sends_status_and_recap_over_the_control_port(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write(tmp_path, "2026-11-01_1900-discord", "failed", {"da": "Hej.", "en": "Hi."}, approved=True)
    bridge = FakeBridge(lambda p: {"result": {}})
    try:
        assert send_report(tmp_path, port=bridge.port, world="strahd").startswith("Reported")
        monkeypatch.setenv("FVTT_SESSIONS_DIR", str(tmp_path))
        assert main(["report", "--port", str(bridge.port)]) == 0
        assert len(bridge.requests) == 2
    finally:
        bridge.close()
    params = bridge.requests[0]["params"]
    assert params["action"] == "report" and params["world"] == "strahd"
    assert params["status"]["state"] == "failed"
    assert params["recap"]["text"] == {"da": "Hej.", "en": "Hi."}


def test_a_bridge_that_is_down_or_refuses_is_only_a_line(tmp_path: Path) -> None:
    write(tmp_path, "2026-11-01_1900-discord", "done")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        free = probe.getsockname()[1]
    assert send_report(tmp_path, port=free).startswith("Not reported")
    bridge = FakeBridge(lambda p: {"error": {"message": "Unknown action", "code": "bad-request"}})
    try:
        assert send_report(tmp_path, port=bridge.port).startswith("Not reported")
    finally:
        bridge.close()
