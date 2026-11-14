from __future__ import annotations

import json
from pathlib import Path

import pytest
from helpers import FakeClaude, write_session

from session_notes.layers import check_depth, mark_uncertain, repair_depth
from session_notes.model import Line
from session_notes.run import Options, Writer
from test_notes import ROWS


@pytest.fixture
def session(tmp_path: Path) -> Path:
    return write_session(tmp_path, ROWS)


def opts(**kw: object) -> Options:
    return Options(workers=1, layers=True, **kw)  # type: ignore[arg-type]


def test_layers_are_off_by_default(session: Path) -> None:
    fake = FakeClaude()
    Writer(session, fake, Options(workers=1)).run()
    assert [k for k, _ in fake.calls].count("depth") == 0
    assert not (session / "notes" / "raw.da.md").exists()
    assert not (session / "notes" / "index.da.md").exists()


def test_layers_write_raw_depth_and_index(session: Path) -> None:
    fake = FakeClaude()
    result = Writer(session, fake, opts()).run()
    assert result.depth_missing == 0 and result.paused is None
    assert [k for k, _ in fake.calls].count("depth") == 2  # one per scene
    notes = session / "notes"
    raw = (notes / "raw.da.md").read_text(encoding="utf-8")
    assert "[Sær?]" in raw and "^u000003" in raw and "## Scene 2" in raw
    depth = (notes / "depth.da.md").read_text(encoding="utf-8")
    assert "### Første del" in depth and "[[transcript.da#^u000001|00:00:10]]" in depth
    assert "u999999" not in depth  # unknown citation dropped
    assert "Ufærdige" not in depth
    index = (notes / "index.da.md").read_text(encoding="utf-8")
    for target in ("summary.da", "depth.da", "scenes.da", "transcript.da", "raw.da"):
        assert f"[[{target}|" in index
    data = json.loads((notes / "notes.json").read_text(encoding="utf-8"))
    assert data["layers"] == {"depth_complete": True}


def test_depth_is_cached_and_resumes_after_a_limit(session: Path) -> None:
    # calls: 2 scenes, 1 session summary, then depth for scene 1 (4) and scene 2 (5)
    first = FakeClaude(fail={5: "limit"})
    result = Writer(session, first, opts()).run()
    assert result.paused and result.depth_missing == 1
    assert "Ufærdige" in (session / "notes" / "depth.da.md").read_text(encoding="utf-8")
    again = FakeClaude()
    result2 = Writer(session, again, opts()).run()
    assert result2.depth_missing == 0
    assert [k for k, _ in again.calls] == ["depth"]  # only the missing scene is written


def test_a_bad_depth_answer_is_retried_then_left_missing(session: Path) -> None:
    class Empty(FakeClaude):
        def __call__(self, prompt, schema, model, effort="low"):  # type: ignore[no-untyped-def]
            if "beats" in schema["properties"]:
                self.calls.append(("depth", prompt))
                return {"beats": []}
            return super().__call__(prompt, schema, model, effort)

    fake = Empty()
    result = Writer(session, fake, opts()).run()
    assert result.depth_missing == 2
    assert [k for k, _ in fake.calls].count("depth") == 4  # two tries per scene
    assert "mangler dybdegående noter" in (session / "notes" / "depth.da.md").read_text(
        encoding="utf-8"
    )


def test_check_and_repair_depth() -> None:
    scene = {"lines": [{"id": f"u{i:06d}"} for i in range(1, 25)]}
    assert check_depth({"beats": []}, scene) == ["no beats"]
    assert "an empty beat" in check_depth(
        {"beats": [{"heading": "a", "text": " ", "cites": ["u000001"]}]}, scene
    )
    assert "no beat cites a line of the scene" in check_depth(
        {"beats": [{"heading": "a", "text": "x " * 80, "cites": ["u999999"]}]}, scene
    )
    thin = check_depth({"beats": [{"heading": "a", "text": "kort", "cites": ["u000001"]}]}, scene)
    assert thin and thin[0].startswith("too thin")
    ok = {"beats": [{"heading": "a", "text": "ord " * 80, "cites": ["u000001", "u999999"]}]}
    assert check_depth(ok, scene) == []
    assert repair_depth(ok, scene) and ok["beats"][0]["cites"] == ["u000001"]


def test_mark_uncertain_words() -> None:
    line = Line("u000001", 0, 1, "a", "A", "A", "Ved Sær Pool, ikke.", ("Pool",))
    assert mark_uncertain(line) == "Ved Sær [Pool?], ikke."


class Empty(FakeClaude):
    """Every in-depth answer fails the check; the retry prompts are kept."""

    def __call__(self, prompt, schema, model, effort="low"):  # type: ignore[no-untyped-def]
        if "beats" in schema["properties"]:
            self.calls.append(("depth", prompt))
            return {"beats": []}
        return super().__call__(prompt, schema, model, effort)


def test_retry_prompt_names_the_problem(session: Path) -> None:
    fake = Empty()
    Writer(session, fake, opts()).run()
    depth_prompts = [p for k, p in fake.calls if k == "depth"]
    assert "Your previous answer was rejected: no beats" in depth_prompts[1]
    assert "rejected" not in depth_prompts[0]


def test_a_scene_that_never_passes_is_given_up_after_three_runs(session: Path) -> None:
    for run in range(3):
        fake = Empty()
        result = Writer(session, fake, opts(fallback_gap_s=0)).run()
        assert [k for k, _ in fake.calls].count("depth") == 4, run  # both scenes, two tries
    assert result.depth_missing == 0
    again = FakeClaude()
    assert Writer(session, again, opts(fallback_gap_s=0)).run().depth_missing == 0
    assert [k for k, _ in again.calls].count("depth") == 0  # accepted, not asked again
    text = (session / "notes" / "depth.da.md").read_text(encoding="utf-8")
    assert "ingen dybdegående noter" in text and "Ufærdige" not in text


def test_quick_reruns_do_not_use_up_the_depth_retries(session: Path) -> None:
    for _ in range(4):
        result = Writer(session, Empty(), opts()).run()  # default gap: 30 minutes
    assert result.depth_missing == 2


def test_corrupt_depth_cache_is_a_miss_and_changed_lines_invalidate(session: Path) -> None:
    Writer(session, FakeClaude(), opts()).run()
    work = session / "notes" / ".work"
    (work / "depth-001.json").write_text('{"key": "x", "no', encoding="utf-8")  # cut mid-write
    again = FakeClaude()
    assert Writer(session, again, opts()).run().depth_missing == 0
    assert [k for k, _ in again.calls] == ["depth"]  # only scene 1, written again
    # the scene notes changed (a new title): the old in-depth notes are not reused
    cached = json.loads((work / "scene-001.json").read_text(encoding="utf-8"))
    cached["notes"]["title_da"] = "Ny titel"
    (work / "scene-001.json").write_text(json.dumps(cached), encoding="utf-8")
    third = FakeClaude()
    Writer(session, third, opts()).run()
    kinds = [k for k, _ in third.calls]
    assert kinds.count("depth") == 1  # scene 1 again, scene 2 still cached


def test_layers_with_a_raw_scene_skip_its_depth(session: Path) -> None:
    fake = FakeClaude(fail={1: "error", 2: "error", 3: "error", 4: "error"})
    result = Writer(session, fake, opts()).run()
    assert result.pending == 1 and result.depth_missing == 1  # scene 2 waits for the summary
    assert [k for k, _ in fake.calls].count("depth") == 0
    text = (session / "notes" / "depth.da.md").read_text(encoding="utf-8")
    assert "Ufærdige" in text
