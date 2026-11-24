"""The campaign merge plan: the ownership table applied to what Claude proposes."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from helpers import write_session
from session_notes import campaign, check
from session_notes.claude_runner import ClaudeError, UsageLimitError

ROWS = [
    (0.0, 5.0, "Anna", "Jeg hedder Ilvara og jeg møder Madam Eva."),
    (65.0, 70.0, "Anna", "Raffne tager min arm."),
    (3700.0, 3705.0, "Anna", "Vi aftaler at ingen dør uden terningkast."),
    (3710.0, 3715.0, "Anna", "Ilvara er niveau fem, siger jeg."),
]


def make_session(tmp: Path, names: str = "Ilvara\nMadam Eva\n") -> Path:
    session = write_session(tmp / "2026-11-08 session 0", ROWS)
    (session / "names.txt").write_text(names, encoding="utf-8")
    notes = session / "notes"
    notes.mkdir()
    remember = {
        "items": [
            {"kind": "name", "da": "Madam Eva", "en": "Madam Eva", "cites": ["u000001"]},
            {"kind": "agreement", "da": "Regel", "en": "Rule", "cites": ["u000003"]},
        ]
    }
    (notes / "notes.json").write_text(
        json.dumps({"complete": True, "scenes": [], "session": {}, "remember": remember}),
        encoding="utf-8",
    )
    return session


def answer() -> dict[str, Any]:
    def row(da: str, en: str, *cites: str) -> dict[str, Any]:
        return {"da": da, "en": en, "cites": list(cites)}

    return {
        "entries": [
            {
                "kind": "npcs",
                "name": "Madam Eva",
                "summary_da": "Spåkone.",
                "summary_en": "Fortune teller.",
                "relations": [{"to": "Ilvara", "da": "mødte hende", "en": "met her"}],
                "timeline": [
                    row("Mødte Ilvara", "Met Ilvara", "u000001", "u999999"),
                    row("Ingen kilde", "No source", "u999999"),
                ],
            },
            {
                "kind": "npcs",
                "name": "Raffne",
                "summary_da": "",
                "summary_en": "",
                "relations": [],
                "timeline": [row("Tog hendes arm", "Took her arm", "u000002")],
            },
            {
                "kind": "table",
                "name": "House rules",
                "summary_da": "",
                "summary_en": "",
                "relations": [],
                "timeline": [row("Ingen dør uden terningkast", "Nobody dies without a roll", "u000003")],
            },
            {
                "kind": "threads",
                "name": "The chat thread",
                "summary_da": "",
                "summary_en": "",
                "relations": [],
                "timeline": [row("Sagt i chatten", "Said in chat", "c0001")],
            },
            {"kind": "locations", "name": "Empty", "summary_da": "", "summary_en": "", "relations": [], "timeline": []},
        ],
        "claims": [
            {"about": "Ilvara", "field": "level", "value": "5", "cites": ["u000004"]},
            {"about": "Madam Eva", "field": "items", "value": "a crystal ball", "cites": []},
        ],
    }


class Runner:
    def __init__(self, result: dict[str, Any] | Exception) -> None:
        self.result = result
        self.prompts: list[str] = []

    def __call__(self, prompt: str, schema: dict[str, Any], model: str, effort: str = "low") -> dict[str, Any]:
        self.prompts.append(prompt)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def plan_for(session: Path, **kw: Any) -> dict[str, Any]:
    done = campaign.run(session, Runner(answer()), **kw)
    return done.plan


def entry(plan: dict[str, Any], name: str) -> dict[str, Any]:
    return next(e for e in plan["entries"] if e["name"] == name)


def test_known_name_is_added_with_transcript_links(tmp_path: Path) -> None:
    plan = plan_for(make_session(tmp_path))
    eva = entry(plan, "Madam Eva")
    assert eva["nameConfirmed"] is True
    assert eva["summary"] == {"da": "Spåkone.", "en": "Fortune teller."}
    assert eva["relations"][0]["to"] == "Ilvara"
    (line,) = eva["timeline"]  # the line citing nothing real is dropped
    assert line["session"] == "Session 00"
    assert line["ref"] == "transcript.en#^u000001"
    assert line["time"] == "00:00"
    # a chat id with no chat log behind it is dropped too
    assert plan["dropped_timeline_lines"] == ["No source", "Said in chat"]


def test_unconfirmed_name_is_held_and_goes_to_the_check_page(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    plan = plan_for(session)
    assert [h["name"] for h in plan["held"]] == ["Raffne"]
    assert all(e["name"] != "Raffne" for e in plan["entries"])
    page = check.page_path(session, "en").read_text(encoding="utf-8")
    assert "### Raffne" in page
    assert "transcript.en#^u000002" in page


def test_answering_the_name_releases_the_page_on_the_next_plan(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    plan_for(session)
    page = check.page_path(session, "en")
    page.write_text(_answer(page, "Raffne", "Raffne"), encoding="utf-8")
    check.sync(session)
    plan = plan_for(session)
    assert plan["held"] == []
    assert entry(plan, "Raffne")["timeline"][0]["ref"] == "transcript.en#^u000002"


def _answer(page: Path, key: str, text: str) -> str:
    out = []
    inside = False
    for line in page.read_text(encoding="utf-8").splitlines():
        if line.startswith("### "):
            inside = line[4:].strip() == key
        if inside and line.startswith("Answer:"):
            line = f"Answer: {text}"
        out.append(line)
    return "\n".join(out) + "\n"


def test_table_entries_are_only_proposed(tmp_path: Path) -> None:
    plan = plan_for(make_session(tmp_path))
    rules = entry(plan, "House rules")
    assert rules["timeline"][0]["en"].startswith("Proposed (Danni confirms): ")
    assert rules["timeline"][0]["da"].startswith("Foreslået (Danni bekræfter): ")


def test_chat_log_line_gets_a_time_and_no_transcript_link(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    (session / "chat-log.json").write_text(
        json.dumps([{"time": "01:42", "who": "Ilvara", "text": "Ilvara casts Spare the Dying"}]),
        encoding="utf-8",
    )
    runner = Runner(answer())
    plan = campaign.run(session, runner).plan
    line = entry(plan, "The chat thread")["timeline"][0]
    assert line["time"] == "01:42" and "ref" not in line
    assert "c0001 [01:42] Ilvara: Ilvara casts Spare the Dying" in runner.prompts[0]


def test_foundry_owns_stats_claims_become_hints_without_foundry_data(tmp_path: Path) -> None:
    plan = plan_for(make_session(tmp_path))
    assert {(h["about"], h["field"]) for h in plan["hints"]} == {("Ilvara", "level"), ("Madam Eva", "items")}
    assert not any("level" in json.dumps(e) for e in plan["entries"])
    assert plan["checks"]["facts"] == []


def test_disagreement_with_foundry_goes_to_the_check_page(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    (session / "foundry-facts.json").write_text(
        json.dumps({"Ilvara": {"level": "4"}, "Madam Eva": {"items": ["A crystal ball"]}}), encoding="utf-8"
    )
    plan = plan_for(session)
    assert [f["key"] for f in plan["checks"]["facts"]] == ["Ilvara: level (campaign merge)"]
    assert plan["hints"] == []  # the item claim agrees with Foundry: nothing to report
    page = check.page_path(session, "en").read_text(encoding="utf-8")
    assert "### Ilvara: level (campaign merge)" in page
    assert "keeps Foundry's version" in page


def test_the_plan_only_adds(tmp_path: Path) -> None:
    plan = plan_for(make_session(tmp_path))
    assert all("replaceSummary" not in e and "statBlock" not in e for e in plan["entries"])
    assert all(e["kind"] != "locations" for e in plan["entries"])  # nothing to add: no entry


def test_files_are_written_and_the_switch_is_recorded(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    plan = plan_for(session, switch=True)
    saved = json.loads((session / "notes" / "campaign-merge.json").read_text(encoding="utf-8"))
    assert saved["switch"] is True and saved["entries"] == plan["entries"]
    text = (session / "notes" / "Campaign merge plan.en.md").read_text(encoding="utf-8")
    assert "apply at once" in text and "Raffne" in text


def test_a_second_run_reuses_the_call(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    first = Runner(answer())
    campaign.run(session, first)
    second = Runner(ClaudeError("must not be called"))
    assert campaign.run(session, second).plan["entries"]
    assert second.prompts == []


def test_usage_limit_pauses_without_a_plan(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    done = campaign.run(session, Runner(UsageLimitError("limit")))
    assert done.paused == "limit"
    assert not (session / "notes" / "campaign-merge.json").exists()


def test_needs_finished_notes(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    (session / "notes" / "notes.json").write_text(json.dumps({"complete": False}), encoding="utf-8")
    with pytest.raises(FileNotFoundError):
        campaign.run(session, Runner(answer()))


@pytest.mark.parametrize(
    ("name", "known", "expected"),
    [
        ("Barnon", {"barnon vesperholt"}, True),
        ("Barnon Vesperholt", {"barnon vesperholt"}, True),
        ("Barnon Haften", {"barnon vesperholt"}, False),
        ("Raffne", {"ilvara"}, False),
    ],
)
def test_is_confirmed(name: str, known: set[str], expected: bool) -> None:
    assert campaign.is_confirmed(name, known) is expected


def test_session_label() -> None:
    assert campaign.session_label(Path("2026-11-08_Session 0")) == "Session 00"
    assert campaign.session_label(Path("x/session-12")) == "Session 12"
