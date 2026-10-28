from __future__ import annotations

import json
from pathlib import Path

import pytest
from helpers import FakeClaude, scene_answer, write_session

from session_notes.claude_runner import AuthError, ClaudeCli, ClaudeError, UsageLimitError
from session_notes.model import Scene, load_roster, load_timeline
from session_notes.prompts import scene_prompt
from session_notes.run import Options, Writer
from session_notes.scenes import split_scenes
from session_notes.validate import check_lines, repair

# Two scenes, each longer than the 2-minute minimum, split by a pause over 90 s.
ROWS = [
    (10.0, 14.0, "Anna", "Vi går mod Maravia."),
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
    assert roster.players == {"Anna": "Ilvara", "Bo": "Bo", "GM": "GM"}
    assert roster.names == ["Madam Eva", "Tser Pool"]
    prompt = scene_prompt(Scene(1, lines[:3]), roster)
    assert "- Anna plays Ilvara" in prompt
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
    assert "**[00:00:10] Ilvara (Anna):** Vi går mod Maravia. ^u000001" in t
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
    assert "- Bo plays Vorn" in prompt and "- Anna plays Ilvara" in prompt
    assert "u000002 [00:00:40] Bo (Vorn): Jeg tjekker" in prompt
    assert fake.efforts == ["medium", "medium", "medium"]


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


def test_session_summary_retried_once(session: Path) -> None:
    fake = FakeClaude(fail={3: "error"})  # scenes are calls 1 and 2; the summary fails once
    result = Writer(session, fake, Options(workers=1)).run()
    assert [k for k, _ in fake.calls] == ["scene", "scene", "session", "session"]
    assert "session_ok" in [row["event"] for row in result.audit]


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
    # A logged-out claude fails every scene the same way: stop like a limit, but say how to fix it.
    with pytest.raises(AuthError, match="/login"):
        cli.parse(1, "not json", "Failed to authenticate: OAuth session expired", "sonnet")
    with pytest.raises(AuthError):
        cli.parse(1, json.dumps({"subtype": "success", "is_error": True, "result": "Not logged in"}), "", "sonnet")
    with pytest.raises(ClaudeError):
        cli.parse(1, "not json", "crash", "sonnet")
    with pytest.raises(ClaudeError):
        cli.parse(0, json.dumps({"subtype": "success", "is_error": False}), "", "sonnet")


def _all_fail(upto: int = 60) -> dict[int, str]:
    return {i: "error" for i in range(1, upto)}


def test_raw_fallback_scene_is_not_cached_and_blocks_the_session_part(session: Path) -> None:
    # Scene 1 fails on every call (4 calls), scene 2 is fine.
    fake = FakeClaude(fail={1: "error", 2: "error", 3: "error", 4: "error"})
    result = Writer(session, fake, Options(workers=1)).run()
    assert result.fallbacks == 1 and result.pending == 1
    assert [kind for kind, _ in fake.calls].count("session") == 0  # no session summary yet
    assert not (session / "notes" / ".work" / "scene-001.json").exists()
    assert (session / "notes" / ".work" / "scene-002.json").exists()
    data = json.loads((session / "notes" / "notes.json").read_text(encoding="utf-8"))
    assert data["session"] is None

    # The next run asks about scene 1 again, and now it works.
    again = FakeClaude()
    result2 = Writer(session, again, Options(workers=1)).run()
    assert result2.fallbacks == 0 and result2.pending == 0
    assert [kind for kind, _ in again.calls] == ["scene", "session"]
    data = json.loads((session / "notes" / "notes.json").read_text(encoding="utf-8"))
    assert data["session"] is not None


def test_a_scene_that_keeps_failing_is_accepted_raw_after_three_runs(session: Path) -> None:
    for run_no in (1, 2, 3):
        fake = FakeClaude(fail=_all_fail())
        opts = Options(workers=1, only_scene=1, fallback_gap_s=0)
        result = Writer(session, fake, opts).run()
        assert result.fallbacks == 1
        assert result.pending == (1 if run_no < 3 else 0)
    assert (session / "notes" / ".work" / "scene-001.json").exists()


def test_quick_reruns_do_not_use_up_the_retries(session: Path) -> None:
    # Default gap (30 min): three passes in a row during one outage still leave the scene pending.
    for _ in range(4):
        result = Writer(
            session, FakeClaude(fail=_all_fail()), Options(workers=1, only_scene=1)
        ).run()
        assert result.pending == 1
    assert not (session / "notes" / ".work" / "scene-001.json").exists()


def test_old_cached_raw_scene_is_tried_again(session: Path) -> None:
    Writer(session, FakeClaude(), Options(workers=1)).run()
    cache = session / "notes" / ".work" / "scene-001.json"
    data = json.loads(cache.read_text(encoding="utf-8"))
    data["notes"]["fallback"] = True  # what the old code left behind
    cache.write_text(json.dumps(data), encoding="utf-8")
    fake = FakeClaude()
    Writer(session, fake, Options(workers=1)).run()
    assert [kind for kind, _ in fake.calls][0] == "scene"


def test_speakers_json_and_names_with_a_bom(session: Path) -> None:
    (session / "speakers.json").write_bytes(
        b"\xef\xbb\xbf" + json.dumps({"bo": {"character": "Vorn"}}).encode("utf-8")
    )
    (session / "names.txt").write_bytes(b"\xef\xbb\xbfMadam Eva\n")
    fake = FakeClaude()
    Writer(session, fake, Options(workers=1)).run()
    assert "Bo plays Vorn" in fake.calls[0][1]
    lines = load_timeline(session / "timeline" / "timeline.jsonl")
    assert load_roster(session, lines).names == ["Madam Eva"]


def test_status_file_records_the_outcome(session: Path) -> None:
    from session_notes.status import write_status

    path = write_status(session, "paused", "limit", scenes=1)
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["state"] == "paused" and data["scenes"] == 1 and data["at"]


def _session_cache(session: Path) -> Path:
    return session / "notes" / ".work" / "session.json"


def test_session_summary_is_not_reused_after_a_scene_changed(session: Path) -> None:
    Writer(session, FakeClaude(), Options(workers=1)).run()
    # Nothing changed: the summary comes from the cache, no Claude call at all.
    same = FakeClaude()
    Writer(session, same, Options(workers=1)).run()
    assert same.calls == []

    # A scene rewritten since (same indices): the summary is about old notes, so it is rewritten.
    cache = session / "notes" / ".work" / "scene-001.json"
    data = json.loads(cache.read_text(encoding="utf-8"))
    data["notes"]["summary_en"] = "Rewritten later."
    cache.write_text(json.dumps(data), encoding="utf-8")
    again = FakeClaude()
    Writer(session, again, Options(workers=1)).run()
    assert [kind for kind, _ in again.calls] == ["session"]

    # A cache from before the digest existed (scene indices only) is not trusted either.
    old = json.loads(_session_cache(session).read_text(encoding="utf-8"))
    del old["digest"]
    _session_cache(session).write_text(json.dumps(old), encoding="utf-8")
    third = FakeClaude()
    Writer(session, third, Options(workers=1)).run()
    assert [kind for kind, _ in third.calls] == ["session"]


def test_incomplete_notes_say_so_until_the_run_finishes(session: Path) -> None:
    notes = session / "notes"
    Writer(session, FakeClaude(fail={1: "error", 2: "error", 3: "error", 4: "error"}),
           Options(workers=1)).run()
    for lang in ("da", "en"):
        for name in ("transcript", "scenes"):
            text = (notes / f"{name}.{lang}.md").read_text(encoding="utf-8")
            assert "Ufærdige noter" in text or "Incomplete notes" in text
    assert json.loads((notes / "notes.json").read_text(encoding="utf-8"))["complete"] is False

    Writer(session, FakeClaude(), Options(workers=1)).run()
    for lang in ("da", "en"):
        for name in ("transcript", "scenes"):
            text = (notes / f"{name}.{lang}.md").read_text(encoding="utf-8")
            assert "Ufærdige noter" not in text and "Incomplete notes" not in text
    assert json.loads((notes / "notes.json").read_text(encoding="utf-8"))["complete"] is True


def test_fallback_tries_start_over_when_the_scene_changes(session: Path) -> None:
    opts = Options(workers=1, only_scene=1, fallback_gap_s=0)
    for _ in range(2):
        assert Writer(session, FakeClaude(fail=_all_fail()), opts).run().pending == 1
    marker = session / "notes" / ".work" / "scene-001.fallback.json"
    assert json.loads(marker.read_text(encoding="utf-8"))["tries"] == 2

    # A new line in scene 1 (the timeline was transcribed again): its ids differ, the count is 0.
    row = {"start": 170.0, "end": 172.0, "speaker": "anna", "player": "Anna",
           "character": "Ilvara", "text": "Vent lidt.", "words": []}
    with (session / "timeline" / "timeline.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")
    result = Writer(session, FakeClaude(fail=_all_fail()), opts).run()
    assert result.pending == 1  # the third run of the old scene would have accepted it
    assert json.loads(marker.read_text(encoding="utf-8"))["tries"] == 1


def test_a_pause_and_a_fallback_in_the_same_run(session: Path) -> None:
    # Scene 1 fails four calls and stays raw; the usage limit hits on scene 2's first call.
    fail = {1: "error", 2: "error", 3: "error", 4: "error", 5: "limit"}
    result = Writer(session, FakeClaude(fail=fail), Options(workers=1, fallback_gap_s=0)).run()
    work = session / "notes" / ".work"
    assert result.paused and result.pending == 1 and result.fallbacks == 1
    assert json.loads((work / "scene-001.fallback.json").read_text(encoding="utf-8"))["tries"] == 1
    assert not (work / "scene-001.json").exists() and not (work / "scene-002.json").exists()
    assert not _session_cache(session).exists()
    assert json.loads((session / "notes" / "notes.json").read_text(encoding="utf-8"))["session"] is None

    # The next run asks about both scenes again and finishes.
    again = FakeClaude()
    result2 = Writer(session, again, Options(workers=1, fallback_gap_s=0)).run()
    assert result2.paused is None and result2.pending == 0 and result2.fallbacks == 0
    assert [kind for kind, _ in again.calls] == ["scene", "scene", "session"]


class _CliRunner(FakeClaude):
    """What `cli.main` expects from ClaudeCli: a runner with a `records` list."""

    records: list[object] = []  # noqa: RUF012


def _run_cli(monkeypatch: pytest.MonkeyPatch, session: Path, fake: FakeClaude) -> int:
    from session_notes import cli

    runner = _CliRunner(fake.fail, fake.bad_lines)
    monkeypatch.setattr(cli, "ClaudeCli", lambda: runner)
    return cli.main(["run", str(session), "--workers", "1"])


def _status(session: Path) -> dict[str, object]:
    return json.loads((session / "notes" / "status.json").read_text(encoding="utf-8"))


def test_cli_logged_out_claude_pauses_with_login_hint(
    session: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    code = _run_cli(monkeypatch, session, FakeClaude(fail={1: "auth"}))
    assert code == 75
    status = _status(session)
    assert status["state"] == "paused" and "/login" in str(status["message"])
    assert "usage limit" not in str(status["message"])


def test_claude_cli_command_runs_without_connectors_and_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import subprocess

    seen: list[list[str]] = []

    def fake_run(cmd: list[str], **_kw: object) -> subprocess.CompletedProcess[str]:
        seen.append(cmd)
        out = {"subtype": "success", "is_error": False, "structured_output": {"a": 1}}
        return subprocess.CompletedProcess(cmd, 0, json.dumps(out), "")

    monkeypatch.setattr(subprocess, "run", fake_run)
    ClaudeCli("claude")("prompt", {}, "sonnet")
    cmd = seen[0]
    assert "--strict-mcp-config" in cmd and "--disable-slash-commands" in cmd
    assert cmd[cmd.index("--setting-sources") + 1] == ""
    assert cmd[cmd.index("--mcp-config") + 1] == '{"mcpServers":{}}'


def test_cli_exit_codes_and_status_file(
    session: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from session_notes import cli

    # 76: scene 1 stays raw, the run is incomplete and the status says so.
    code = _run_cli(monkeypatch, session, FakeClaude(fail={1: "error", 2: "error", 3: "error", 4: "error"}))
    assert code == cli.EXIT_INCOMPLETE == 76
    assert _status(session)["state"] == "incomplete" and _status(session)["pending"] == 1

    # 75: a usage limit on the first call pauses the run.
    code = _run_cli(monkeypatch, session, FakeClaude(fail={1: "limit"}))
    assert code == cli.EXIT_PAUSED == 75
    assert _status(session)["state"] == "paused"
    assert "Paused by a usage limit" in capsys.readouterr().out

    # 0: everything written.
    assert _run_cli(monkeypatch, session, FakeClaude()) == 0
    assert _status(session)["state"] == "done"


def test_cli_status_when_claude_cannot_start_or_the_run_crashes(
    session: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from session_notes import cli

    def no_claude() -> object:
        raise ClaudeError("claude not found")

    monkeypatch.setattr(cli, "ClaudeCli", no_claude)
    assert cli.main(["run", str(session)]) == 1
    assert _status(session)["state"] == "failed"
    assert "claude not found" in str(_status(session)["message"])

    class Crashing(_CliRunner):
        def __call__(self, *args: object, **kwargs: object) -> dict[str, object]:
            raise RuntimeError("disk full")

    monkeypatch.setattr(cli, "ClaudeCli", Crashing)
    monkeypatch.setattr(cli.Writer, "run", lambda self: (_ for _ in ()).throw(RuntimeError("disk full")))
    with pytest.raises(RuntimeError):
        cli.main(["run", str(session)])
    assert _status(session)["state"] == "failed" and "disk full" in str(_status(session)["message"])
