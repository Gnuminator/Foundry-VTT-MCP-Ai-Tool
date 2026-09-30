"""The names.txt builder. Fake tool outputs and synthetic names only."""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from session_pipeline.cli import main
from session_pipeline.namelist import (
    build,
    classify_actor,
    clean_name,
    collect_world_names,
    dashboard_fetch,
    merge_names,
    parse_choices,
    read_extra,
    render,
)

ACTORS = [
    {"id": "a1", "name": "Vera Hollis", "detail": "character, player-owned", "group": "character"},
    {"id": "a2", "name": "Gus the Bold", "detail": "character, player-owned"},
    {"id": "a3", "name": "Old Marrow", "detail": "npc"},
    {"id": "a4", "name": "Wolf 1", "detail": "npc"},
    {"id": "a5", "name": "Wolf 2", "detail": "npc"},
    {"id": "a6", "name": "The Test Party", "detail": "group"},
    {"id": "a7", "name": "Rowboat", "detail": "vehicle"},
    {"id": "a8", "name": "Vera Hollis", "detail": "npc"},  # same name as a PC
]
SCENES = [
    {"id": "s1", "name": "Harbour Gate"},
    {"id": "s2", "name": "New Scene"},
    {"id": "s3", "name": "Cellar (level 2)"},
]
ITEMS = [{"id": "i1", "name": "Sunblade"}, {"id": "i2", "name": "42"}]
JOURNALS = [{"id": "j1", "name": "Session notes, part one"}]
WORLD = {"actor": ACTORS, "scene": SCENES, "item": ITEMS, "journal": JOURNALS}


def fake_fetch(kind, filt):
    return WORLD[kind]


def test_clean_name():
    assert clean_name("Wolf 3") == "Wolf"
    assert clean_name("Goblin (2)") == "Goblin"
    assert clean_name("Harbour Gate [GM]") == "Harbour Gate"
    assert clean_name("Session notes, part one") == "Session notes part one"
    assert clean_name("New Scene") is None
    assert clean_name("42") is None
    assert clean_name("Ab") is None
    assert clean_name("one two three four five six") is None
    assert clean_name("  Mira   Dawn ") == "Mira Dawn"


def test_classify_actor():
    assert classify_actor({"detail": "character, player-owned"}) == "pc"
    assert classify_actor({"detail": "character"}) == "pc"
    assert classify_actor({"detail": "npc"}) == "npc"
    assert classify_actor({"detail": "group"}) == "group"
    assert classify_actor({"detail": "vehicle"}) == "skip"
    assert classify_actor({}) == "skip"


def test_world_names_are_ordered_by_priority_and_deduplicated():
    w = collect_world_names(fake_fetch)
    assert w.pcs == ["Vera Hollis", "Gus the Bold"]
    assert w.groups == ["The Test Party"]
    assert w.npcs == ["Old Marrow", "Wolf"]  # Wolf 1 and Wolf 2 collapse, the PC's namesake is not repeated
    assert w.scenes == ["Harbour Gate", "Cellar"]
    assert w.items == [] and w.journals == []
    assert w.ordered() == ["Vera Hollis", "Gus the Bold", "The Test Party", "Old Marrow", "Wolf",
                           "Harbour Gate", "Cellar"]


def test_items_and_journals_only_when_asked():
    w = collect_world_names(fake_fetch, items=True, journals=True)
    assert w.items == ["Sunblade"]
    assert w.journals == ["Session notes part one"]
    assert w.ordered()[-2:] == ["Sunblade", "Session notes part one"]


def test_parse_choices_reads_a_tool_answer():
    payload = {"ok": True, "name": "list-ref-choices", "result": {"kind": "actor", "choices": ACTORS[:2] + [{"id": "x"}]}}
    assert [c["name"] for c in parse_choices(payload)] == ["Vera Hollis", "Gus the Bold"]
    with pytest.raises(ValueError, match="refused"):
        parse_choices({"ok": False, "error": "gm-required"})
    with pytest.raises(ValueError, match="unexpected"):
        parse_choices({"ok": True, "result": {}})


def test_extra_list_goes_first_and_merges_case_insensitively(tmp_path):
    extra = tmp_path / "extra.txt"
    extra.write_text("# hand kept\nvera hollis\nGrim Lantern\n", encoding="utf-8")
    names, world, warning = build(fake_fetch, read_extra(extra))
    assert warning is None and world is not None
    assert names[:3] == ["vera hollis", "Grim Lantern", "Gus the Bold"]
    assert len([n for n in names if n.lower() == "vera hollis"]) == 1
    assert merge_names(["A b"], ["a  B", "C"]) == ["A b", "C"]


def test_offline_uses_the_extra_list_only(tmp_path):
    extra = tmp_path / "extra.txt"
    extra.write_text("Grim Lantern\n", encoding="utf-8")
    names, world, warning = build(None, read_extra(extra))
    assert names == ["Grim Lantern"] and world is None and warning is None


def test_unreachable_dashboard_falls_back_with_a_warning():
    def boom(kind, filt):
        raise ConnectionRefusedError("connection refused")

    names, world, warning = build(boom, ["Grim Lantern"])
    assert names == ["Grim Lantern"] and world is None
    assert warning and "extra list only" in warning


def test_render_is_one_name_per_line_after_comments():
    text = render(["A b", "C"])
    lines = text.splitlines()
    assert lines[0].startswith("#") and lines[-2:] == ["A b", "C"]


class _Handler(BaseHTTPRequestHandler):
    seen: list = []

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        _Handler.seen.append((self.path, body, self.headers.get("X-CoGM-Token")))
        answer = {"ok": True, "name": body["name"], "result": {"kind": body["args"]["kind"], "choices": WORLD[body["args"]["kind"]]}}
        data = json.dumps(answer).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


@pytest.fixture
def dashboard():
    _Handler.seen = []
    srv = HTTPServer(("127.0.0.1", 0), _Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def test_dashboard_fetch_posts_list_ref_choices_with_the_token(dashboard):
    rows = dashboard_fetch(dashboard, token="t0k")("scene", None)
    assert [r["name"] for r in rows] == ["Harbour Gate", "New Scene", "Cellar (level 2)"]
    path, body, token = _Handler.seen[0]
    assert path == "/api/tool" and token == "t0k"
    assert body == {"name": "list-ref-choices", "args": {"kind": "scene", "limit": 500}}


def test_cli_names_from_a_dashboard(dashboard, tmp_path, capsys):
    out = tmp_path / "s" / "names.txt"
    extra = tmp_path / "extra.txt"
    extra.write_text("Grim Lantern\n", encoding="utf-8")
    assert main(["names", "--out", str(out), "--dashboard", dashboard, "--extra", str(extra)]) == 0
    names = [ln for ln in out.read_text(encoding="utf-8").splitlines() if not ln.startswith("#")]
    assert names == ["Grim Lantern", "Vera Hollis", "Gus the Bold", "The Test Party", "Old Marrow", "Wolf",
                     "Harbour Gate", "Cellar"]
    assert "wrote 8 names" in capsys.readouterr().out


def test_cli_names_offline_and_nothing_to_write(tmp_path, capsys):
    out = tmp_path / "names.txt"
    extra = tmp_path / "extra.txt"
    extra.write_text("Grim Lantern\n", encoding="utf-8")
    assert main(["names", "--out", str(out), "--offline", "--extra", str(extra)]) == 0
    assert "Grim Lantern" in out.read_text(encoding="utf-8")
    assert main(["names", "--out", str(tmp_path / "none.txt"), "--offline"]) == 2
    assert "no names" in capsys.readouterr().err


def test_cli_names_dashboard_down_uses_the_extra_list(tmp_path, capsys):
    extra = tmp_path / "extra.txt"
    extra.write_text("Grim Lantern\n", encoding="utf-8")
    out = tmp_path / "names.txt"
    assert main(["names", "--out", str(out), "--dashboard", "http://127.0.0.1:9", "--extra", str(extra)]) == 0
    assert "warning" in capsys.readouterr().err
    assert "Grim Lantern" in out.read_text(encoding="utf-8")
