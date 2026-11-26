"""A session summary that fails: its own exit and status text, counted runs, no Claude calls once given up."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from helpers import FakeClaude, write_session
from test_notes import ROWS, _CliRunner, _status

from session_notes import cli
from session_notes import run as run_mod
from session_notes.claude_runner import ClaudeError
from session_notes.run import Options, Writer


@pytest.fixture
def session(tmp_path: Path) -> Path:
    return write_session(tmp_path, ROWS)


def _run_cli(monkeypatch: pytest.MonkeyPatch, session: Path, fake: FakeClaude, *extra: str) -> int:
    runner = _CliRunner(fake.fail, fake.bad_lines)
    monkeypatch.setattr(cli, "ClaudeCli", lambda: runner)
    monkeypatch.setattr(cli, "Writer", _fast_writer)
    fake.calls = runner.calls  # the CLI runs its own copy: show its calls through the fake
    return cli.main(["run", str(session), "--workers", "1", *extra])


def _fast_writer(session: Path, runner: object, opts: Options) -> Writer:
    opts.fallback_gap_s = 0  # every pass in the test counts as its own run
    return Writer(session, runner, opts)  # type: ignore[arg-type]


def test_a_failed_summary_has_its_own_exit_and_status(
    session: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    code = _run_cli(monkeypatch, session, FakeClaude(fail={3: "error", 4: "error"}))
    assert code == cli.EXIT_SUMMARY_FAILED == 78
    status = _status(session)
    assert status["state"] == "failed" and status["reason"] == "summary"
    assert "summary" in str(status["message"]) and "run 1 of 3" in str(status["message"])
    assert (session / "notes" / "scenes.en.md").exists()  # the scene notes are still written


def test_a_failed_summary_with_layers_is_not_reported_as_missing_depth(
    session: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    code = _run_cli(monkeypatch, session, FakeClaude(fail={3: "error", 4: "error"}), "--layers")
    assert code == 78
    assert "in-depth" not in str(_status(session)["message"])


def test_failed_summary_runs_are_counted_then_the_calls_stop(
    session: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert _run_cli(monkeypatch, session, FakeClaude(fail={3: "error", 4: "error"})) == 78
    for run_no in (2, 3):
        fake = FakeClaude(fail={1: "error", 2: "error"})  # scenes are cached; only the summary runs
        assert _run_cli(monkeypatch, session, fake) == 78
        assert [k for k, _ in fake.calls] == ["session", "session"]
        if run_no == 2:
            assert "run 2 of 3" in str(_status(session)["message"])
    assert "after 3 runs" in str(_status(session)["message"])
    # Given up: no more calls, still its own exit, until the notes change.
    quiet = FakeClaude()
    assert _run_cli(monkeypatch, session, quiet) == 78
    assert quiet.calls == []


def test_quick_summary_reruns_do_not_use_up_the_runs(session: Path) -> None:
    Writer(session, FakeClaude(fail={3: "error", 4: "error"}), Options(workers=1)).run()
    for _ in range(3):
        result = Writer(session, FakeClaude(fail={1: "error", 2: "error"}), Options(workers=1)).run()
        assert result.summary_failed and result.summary_tries == 1 and not result.summary_given_up


def test_the_plain_run_has_no_summary_failure(session: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert _run_cli(monkeypatch, session, FakeClaude()) == 0
    assert _status(session)["state"] == "done"
    assert not (session / "notes" / ".work" / "session.fail.json").exists()
    data = json.loads((session / "notes" / "notes.json").read_text(encoding="utf-8"))
    assert data["session"] is not None


def test_a_summary_that_works_again_clears_the_count(session: Path) -> None:
    Writer(session, FakeClaude(fail={3: "error", 4: "error"}), Options(workers=1)).run()
    assert (session / "notes" / ".work" / "session.fail.json").exists()
    result = Writer(session, FakeClaude(), Options(workers=1)).run()
    assert not result.summary_failed
    assert not (session / "notes" / ".work" / "session.fail.json").exists()


def test_a_pause_at_the_summary_is_not_a_summary_failure(
    session: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert _run_cli(monkeypatch, session, FakeClaude(fail={3: "limit"})) == cli.EXIT_PAUSED
    assert _status(session)["state"] == "paused"


class _SummaryDown(FakeClaude):
    """Every summary call fails; scene calls still work."""

    def __call__(self, prompt: str, schema: dict, model: str, effort: str = "low") -> dict:
        if "lines" not in schema["properties"] and "in_short_da" in schema["properties"]:
            self.calls.append(("session", prompt))
            raise ClaudeError("boom")
        return super().__call__(prompt, schema, model, effort)


def _clock(monkeypatch: pytest.MonkeyPatch, start: float = 1_000_000.0) -> list[float]:
    now = [start]
    monkeypatch.setattr(run_mod.time, "time", lambda: now[0])
    return now


def test_a_real_gap_counts_the_next_run_and_a_short_one_does_not(
    session: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = _clock(monkeypatch)
    assert Writer(session, _SummaryDown(), Options(workers=1)).run().summary_tries == 1
    now[0] += 60  # a quick re-run: same run
    assert Writer(session, _SummaryDown(), Options(workers=1)).run().summary_tries == 1
    now[0] += 1800  # past the 30 minute gap: a new counted run
    result = Writer(session, _SummaryDown(), Options(workers=1)).run()
    assert result.summary_tries == 2 and not result.summary_given_up


def test_changed_notes_reset_the_count_after_the_runs_are_given_up(
    session: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = _clock(monkeypatch)
    for _ in range(3):
        result = Writer(session, _SummaryDown(), Options(workers=1)).run()
        now[0] += 1801
    assert result.summary_given_up
    quiet = _SummaryDown()
    assert Writer(session, quiet, Options(workers=1)).run().summary_given_up
    assert [k for k, _ in quiet.calls if k == "session"] == []  # no calls while given up
    # The transcript changes, so the scene notes (and the digest) change: the count starts over.
    with (session / "timeline" / "timeline.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(
            json.dumps(
                {"start": 700.0, "end": 704.0, "speaker": "anna", "player": "Anna",
                 "character": "Ilvara", "text": "En ny linje.", "words": [{"word": "En", "probability": 0.9}]}
            )
            + "\n"
        )
    again = Writer(session, _SummaryDown(), Options(workers=1)).run()
    assert again.summary_tries == 1 and not again.summary_given_up
