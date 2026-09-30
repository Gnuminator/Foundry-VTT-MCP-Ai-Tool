from __future__ import annotations

import json
from pathlib import Path

import pytest
from helpers import FakeClaude, scene_answer, write_session

from session_notes.claude_runner import ClaudeCli, ClaudeError, UsageLimitError
from session_notes.model import Scene, load_roster, load_timeline
from session_notes.prompts import scene_prompt
from session_notes.run import Options, Writer
from session_notes.scenes import split_scenes
from session_notes.validate import check_lines, repair

# Two scenes, each longer than the 2-minute minimum, split by a pause over 90 s.
ROWS = [
    (10.0, 14.0, "Anna", "Vi går mod Barovia."),
    (40.0, 45.0, "Bo", "Jeg tjekker døren for fælder."),
    (70.0, 75.0, "GM", "Døren er låst. Madam Eva venter ved Sær Pool."),
    (100.0, 104.0, "Anna", "Hvem har snacks?"),
    (130.0, 134.0, "Bo", "Jeg slår en natural 20."),
    (160.0, 164.0, "GM", "Låsen springer op."),
    (400.0, 405.0, "GM", "Næste morgen står I ved porten."),
    (430.0, 434.0, "Anna", "Vi banker på."),
    (460.0, 464.0, "Bo", "Jeg holder vagt."),
    (490.0, 494.0, "GM", "Ingen svarer."),
    (520.0, 524.0, "Anna", "Vi går ind."),
    (550.0, 560.0, "GM", "Hallen er mørk og kold."),
]


@pytest.fixture
def session(tmp_path: Path) -> Path:
    s = write_session(tmp_path, ROWS)
    (s / "names.txt").write_text("Madam Eva\nTser Pool\n# comment\n", encoding="utf-8")
    return s


def test_timeline_ids_roster_and_uncertain_words(session: Path) -> None:
    lines = load_timeline(session / "timeline" / "timeline.jsonl")
    assert [ln.id for ln in lines][:3] == ["u000001", "u000002", "u000003"]
    assert lines[2].uncertain == ("Sær",)
    roster = load_roster(session, lines)
    assert roster.players == {"Anna": "Ireena", "Bo": "Bo", "GM": "GM"}
    assert roster.names == ["Madam Eva", "Tser Pool"]
    prompt = scene_prompt(Scene(1, lines[:3]), roster)
    assert "- Anna plays Ireena" in prompt
    assert "u000003 [00:01:10] GM: Døren er låst." in prompt
    assert "[unsure: Sær]" in prompt


def test_scene_split_on_long_pause_and_long_scenes() -> None:
    from session_notes.model import Line

    def ln(i: int, start: float) -> Line:
        return Line(f"u{i:06d}", start, start + 4, "a", "A", "A", "x")

    lines = [ln(i, i * 5.0) for i in range(1, 11)] + [ln(i, 200 + i * 5.0) for i in range(11, 41)]
    scenes = split_scenes(lines, gap=90, min_seconds=10)
    assert [len(s.lines) for s in scenes] == [10, 30]
    long = [ln(i, i * 10.0) for i in range(1, 201)]  # 2000 s, no pause
    parts = split_scenes(long, max_seconds=900, min_seconds=10)
    assert len(parts) >= 3 and sum(len(p.lines) for p in parts) == 200
    assert all(p.end - p.start <= 900 for p in parts)


def test_check_and_repair(session: Path) -> None:
    lines = load_timeline(session / "timeline" / "timeline.jsonl")
    scene = Scene(1, lines[:3])
    ans = scene_answer(scene_prompt(scene, load_roster(session, lines)))
    assert check_lines(ans, scene) == []
    ans["lines"][1]["da"] = "Helt anden tekst som ingen har sagt noget om overhovedet i dag"
    ans["lines"][1]["en"] = "Something entirely different that nobody said at all"
    log = repair(ans, scene)
    assert ans["lines"][1]["da"] == "Jeg tjekker døren for fælder." and ans["lines"][1]["raw_kept"]
    assert any("u999999" in entry for entry in log)
    assert ans["events"][0]["cites"] == ["u000001"]
    swapped = dict(ans, lines=[ans["lines"][1], ans["lines"][0], ans["lines"][2]])
    assert check_lines(swapped, scene) == ["lines out of order"]


def test_full_run_writes_both_languages(session: Path) -> None:
    fake = FakeClaude()
    result = Writer(session, fake).run()
    assert (result.scenes, result.fallbacks, result.paused) == (2, 0, None)
    assert [k for k, _ in fake.calls] == ["scene", "scene", "session"]
    notes = session / "notes"
    t = (notes / "transcript.da.md").read_text(encoding="utf-8")
    assert "**[00:00:10] Ireena (Anna):** Vi går mod Barovia. ^u000001" in t
    scenes_en = (notes / "scenes.en.md").read_text(encoding="utf-8")
    assert "[[transcript.en#^u000001|00:00:10]]" in scenes_en
    assert "### GM only" in scenes_en and "u999999" not in scenes_en
    recap = (notes / "recap.player.en.md").read_text(encoding="utf-8")
    assert "Draft: waiting for the GM's approval" in recap and "Previously..." in recap
    data = json.loads((notes / "notes.json").read_text(encoding="utf-8"))
    assert data["session"]["title_en"] == "Session" and len(data["scenes"]) == 2
    # A second run uses the checkpoints and makes no calls.
    again = FakeClaude()
    Writer(session, again).run()
    assert again.calls == []


def test_retry_then_split_then_raw(session: Path) -> None:
    # calls 1 and 2 (scene 1 whole) drop a line; halves 3 and 4: 3 ok, 4 errors -> raw half
    fake = FakeClaude(bad_lines={1, 2}, fail={4: "error"})
    result = Writer(session, fake, Options(workers=1)).run()
    assert result.fallbacks == 1
    events = [row["event"] for row in result.audit]
    assert events.count("scene_invalid") == 2 and "scene_split" in events
    assert "scene_fallback" in events
    data = json.loads((session / "notes" / "notes.json").read_text(encoding="utf-8"))
    first = data["scenes"][0]
    assert len(first["lines"]) == 6 and first["lines"][-1]["raw_kept"]


def test_usage_limit_pauses_and_resumes(session: Path) -> None:
    fake = FakeClaude(fail={2: "limit"})
    result = Writer(session, fake, Options(workers=1)).run()
    assert result.paused and result.scenes == 1
    assert "Ikke skrevet endnu" in (session / "notes" / "summary.da.md").read_text("utf-8")
    resumed = FakeClaude()
    result2 = Writer(session, resumed).run()
    assert result2.paused is None and [k for k, _ in resumed.calls] == ["scene", "session"]


def test_speakers_json_overrides_and_marks_the_gm(session: Path) -> None:
    (session / "speakers.json").write_text(
        json.dumps({"gm": {"player": "Rikke", "character": "GM"}, "bo": {"character": "Vorn"}}),
        encoding="utf-8",
    )
    fake = FakeClaude()
    Writer(session, fake, Options(workers=1)).run()
    prompt = fake.calls[0][1]
    assert "- Rikke is the GM (narrates, rules, plays all NPCs)" in prompt
    assert "- Bo plays Vorn" in prompt and "- Anna plays Ireena" in prompt
    assert "u000002 [00:00:40] Bo (Vorn): Jeg tjekker" in prompt
    assert fake.efforts == ["low", "low", "medium"]


def test_parallel_scenes_keep_order_and_resume_after_limit(tmp_path: Path) -> None:
    # Eight scenes of 3 lines each, 200 s apart (each longer than the 2-minute minimum).
    rows = []
    for s in range(8):
        base = s * 400.0
        rows += [(base + t, base + t + 4, "Anna", f"Scene {s} line {t}") for t in (0.0, 60.0, 125.0)]
    session = write_session(tmp_path, rows)

    class LimitOnSceneFive(FakeClaude):
        def __call__(self, prompt, schema, model, effort="low"):  # type: ignore[override]
            if "Scene 5 line" in prompt:
                self.calls.append(("scene", prompt))
                raise UsageLimitError("usage limit reached")
            return super().__call__(prompt, schema, model, effort)

    first = Writer(session, LimitOnSceneFive(), Options(workers=3)).run()
    assert first.paused and first.scenes < 8
    resumed = FakeClaude()
    second = Writer(session, resumed, Options(workers=3)).run()
    assert second.paused is None and second.scenes == 8
    assert [k for k, _ in resumed.calls].count("scene") == 8 - first.scenes
    data = json.loads((session / "notes" / "notes.json").read_text(encoding="utf-8"))
    assert [s["index"] for s in data["scenes"]] == list(range(1, 9))
    assert data["session"] is not None


def test_only_scene(session: Path) -> None:
    fake = FakeClaude()
    Writer(session, fake, Options(only_scene=2)).run()
    assert [k for k, _ in fake.calls] == ["scene"]
    assert "u000007" in fake.calls[0][1] and "u000001" not in fake.calls[0][1]


def test_cli_parse_success_and_errors() -> None:
    cli = ClaudeCli.__new__(ClaudeCli)
    cli.records = []
    ok = {
        "subtype": "success",
        "is_error": False,
        "structured_output": {"a": 1},
        "duration_ms": 2300,
        "usage": {"input_tokens": 2, "cache_creation_input_tokens": 100, "output_tokens": 9},
    }
    assert cli.parse(0, json.dumps(ok), "", "sonnet") == {"a": 1}
    assert cli.records[0].input_tokens == 102 and cli.records[0].seconds == 2.3
    limit = {"subtype": "success", "is_error": True, "result": "Claude AI usage limit reached"}
    with pytest.raises(UsageLimitError):
        cli.parse(1, json.dumps(limit), "", "sonnet")
    with pytest.raises(UsageLimitError):
        cli.parse(1, "not json", "Error: 429 rate limit", "sonnet")
    with pytest.raises(ClaudeError):
        cli.parse(1, "not json", "crash", "sonnet")
    with pytest.raises(ClaudeError):
        cli.parse(0, json.dumps({"subtype": "success", "is_error": False}), "", "sonnet")
