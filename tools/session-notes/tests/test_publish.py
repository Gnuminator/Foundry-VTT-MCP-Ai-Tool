from __future__ import annotations

import json
import socket
import threading
from pathlib import Path
from typing import Any, Callable

import pytest

from session_notes.cli import main
from session_notes.publish import EXIT_LATER, blocks, build, inline, publish

SESSION = {
    "title_da": "Vejen til Barovia",
    "title_en": "The road to Barovia",
    "summary_da": "Kort resumé.",
    "summary_en": "Short summary.",
    "changed_da": ["Ireena følger med"],
    "changed_en": ["Ireena joins"],
    "recap_player_da": "I gik ind i *tågen*.\n\nSå kom **ulvene** <script>x</script>.",
    "recap_player_en": "You walked into the *fog*.",
}
SCENES = [
    {
        "index": 1,
        "title_da": "Tågen",
        "title_en": "The fog",
        "start": 7,
        "end": 307,
        "summary_da": "Tåge.",
        "summary_en": "Fog.",
        "events": [{"da": "En ulv hylede", "en": "A wolf howled", "cites": ["u000001"]}],
        "npcs": [{"name": "Ireena", "da": "bange", "en": "scared", "cites": []}],
        "quotes": [{"id": "u000002", "da": "Løb!", "en": "Run!"}],
        "gm_only": [{"da": "Strahd ser med", "en": "Strahd watches", "cites": []}],
    }
]


def make_session(root: Path, name: str = "2026-10-03_0913-rehearsal") -> Path:
    s = root / name
    (s / "notes").mkdir(parents=True)
    (s / "notes" / "notes.json").write_text(
        json.dumps({"roster": {}, "names": {}, "scenes": SCENES, "session": SESSION}),
        encoding="utf-8",
    )
    return s


class FakeBridge:
    """A control port that answers ``session_notes`` with ``handler(params)``."""

    def __init__(self, handler: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
        self.handler = handler
        self.requests: list[dict[str, Any]] = []
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen()
        self.port = self.sock.getsockname()[1]
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self) -> None:
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            with conn:
                buf = b""
                while b"\n" not in buf:
                    chunk = conn.recv(65536)
                    if not chunk:
                        break
                    buf += chunk
                req = json.loads(buf.split(b"\n", 1)[0])
                self.requests.append(req)
                answer = {"id": req["id"], **self.handler(req["params"])}
                conn.sendall((json.dumps(answer) + "\n").encode("utf-8"))

    def close(self) -> None:
        self.sock.close()


def item(**over: Any) -> dict[str, Any]:
    base = {
        "sessionId": "2026-10-03_0913-rehearsal",
        "status": "staged",
        "stagedAt": "2026-10-04T08:00:00.000Z",
        "autoPut": True,
        "waitingFor": [],
        "recapRevealed": False,
    }
    base.update(over)
    return base


def test_inline_escapes_then_marks_up() -> None:
    assert inline("a <b> & *c* **d**") == "a &lt;b&gt; &amp; <em>c</em> <strong>d</strong>"
    assert inline("2 * 3 * 4") == "2 * 3 * 4"


def test_blocks_paragraphs_and_lists() -> None:
    assert blocks("one\ntwo\n\n- a\n- b") == "<p>one two</p><ul><li>a</li><li>b</li></ul>"


def test_build_pages_danish_first(tmp_path: Path) -> None:
    staged = build(make_session(tmp_path))
    assert staged.session_id == "2026-10-03_0913-rehearsal"
    assert staged.date == "2026-10-03"
    assert staged.title == "Vejen til Barovia"
    pages = {p["key"]: p for p in staged.pages}
    assert [p["title"] for p in staged.pages] == ["Recap", "GM summary", "Scenes"]
    recap = pages["recap"]["html"]
    assert recap.index("tågen") < recap.index("<h2>English</h2>") < recap.index("fog")
    assert "<script>" not in recap and "&lt;script&gt;" in recap
    assert "<h3>Hvad ændrede sig</h3><ul><li>Ireena følger med</li></ul>" in pages["summary"]["html"]
    scenes = pages["scenes"]["html"]
    assert "<h2>1. Tågen</h2><p><em>00:00:07 to 00:05:07</em></p>" in scenes
    assert "<li><strong>Ireena</strong>: bange</li>" in scenes
    assert "<h3>Kun for GM</h3>" in scenes
    assert "transcript" not in scenes and "u000001" not in scenes


def test_build_needs_finished_notes(tmp_path: Path) -> None:
    s = tmp_path / "x"
    (s / "notes").mkdir(parents=True)
    with pytest.raises(FileNotFoundError):
        build(s)


def test_publish_stages_once_then_follows_status(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    state: dict[str, Any] = {"staged": None}

    def handler(p: dict[str, Any]) -> dict[str, Any]:
        if p["action"] == "status":
            if state["staged"] is None:
                return {"error": {"message": "No session notes", "code": "not-found"}}
            return {"result": state["staged"]}
        state["staged"] = item(waitingFor=["feature-off"])
        return {"result": state["staged"]}

    bridge = FakeBridge(handler)
    try:
        first = publish(s, port=bridge.port)
        assert first.code == 0
        assert "the \"Session notes\" switch" in first.message
        assert [r["params"]["action"] for r in bridge.requests] == ["status", "stage"]
        stage = bridge.requests[1]["params"]
        assert stage["languages"] == ["da", "en"] and len(stage["pages"]) == 3
        assert (s / "notes" / "published.json").exists()
        publish(s, port=bridge.port)
        assert [r["params"]["action"] for r in bridge.requests] == ["status", "stage", "status"]
    finally:
        bridge.close()


def test_publish_writes_approved_json_once_approved(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    bridge = FakeBridge(
        lambda p: {
            "result": item(
                status="approved", approvedAt="2026-10-05T19:00:00.000Z", approvedBy="reveal"
            )
        }
    )
    try:
        outcome = publish(s, port=bridge.port)
    finally:
        bridge.close()
    assert outcome.code == 0 and "audio clock started" in outcome.message
    marker = json.loads((s / "notes" / "approved.json").read_text(encoding="utf-8"))
    assert marker["approved_at"].startswith("2026-10-05T19:00:00")
    assert marker["by"] == "reveal (Foundry)"


def test_publish_later_when_bridge_down_or_no_world(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        free = probe.getsockname()[1]
    assert publish(s, port=free).code == EXIT_LATER

    def handler(p: dict[str, Any]) -> dict[str, Any]:
        if p["action"] == "status":
            return {"error": {"message": "No session notes", "code": "not-found"}}
        return {"error": {"message": "Foundry is not connected", "code": "no-world"}}

    bridge = FakeBridge(handler)
    try:
        assert publish(s, port=bridge.port).code == EXIT_LATER
        assert main(["publish", str(s), "--port", str(bridge.port)]) == EXIT_LATER
    finally:
        bridge.close()


def test_publish_passes_world(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    bridge = FakeBridge(lambda p: {"result": item()})
    try:
        publish(s, port=bridge.port, world="curse-of-strahd")
    finally:
        bridge.close()
    assert bridge.requests[0]["params"]["world"] == "curse-of-strahd"


def test_control_host_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    from session_notes.publish import control_host

    monkeypatch.delenv("FOUNDRY_AI_CONTROL_HOST", raising=False)
    monkeypatch.delenv("MCP_CONTROL_HOST", raising=False)
    assert control_host() == "127.0.0.1"
    monkeypatch.setenv("MCP_CONTROL_HOST", "foundry-pi")
    assert control_host() == "foundry-pi"
    monkeypatch.setenv("FOUNDRY_AI_CONTROL_HOST", "other")
    assert control_host() == "other"
