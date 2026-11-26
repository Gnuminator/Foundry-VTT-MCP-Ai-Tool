"""The table agenda: open questions carry over and later House rules settle them."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from session_notes import agenda


def line(i: str, start: float) -> SimpleNamespace:
    return SimpleNamespace(id=i, start=start)


def scene(*items: tuple[str, str, str]) -> dict:
    return {
        "table": [
            {"topic": topic, "en": en, "da": da, "cites": ["u000001"]} for topic, en, da in items
        ]
    }


S0, S1 = "2026-11-22_1906-discord", "2026-12-06_1900-discord"


def test_proposed_and_open_items_become_agenda_items(tmp_path: Path) -> None:
    notes = [
        scene(
            ("proposed", "Use the 2024 rules or house rules", "2024-regler eller husregler"),
            ("open", "Who brings snacks", "Hvem tager snacks med"),
            ("house_rules", "No permadeath", "Ingen permadeath"),
        )
    ]
    result = agenda.update(tmp_path, S0, notes, [line("u000001", 518.0)])
    assert [i["status"] for i in result["items"]] == ["open", "open"]
    assert {i["topic"] for i in result["items"]} == {"proposed", "open"}
    assert result["items"][0]["source"]["time"] == "00:08:38"
    assert json.loads((tmp_path / agenda.AGENDA_FILE).read_text(encoding="utf-8"))["items"]


def test_later_house_rule_settles_with_link(tmp_path: Path) -> None:
    s0 = [
        scene(
            ("proposed", "Fumble rule on a natural one", "Fumble-regel ved en 1'er"),
            ("proposed", "Potion cost in gold", "Pris på potions"),
            ("proposed", "Help action rule", "Help-regel"),
        )
    ]
    agenda.update(tmp_path, S0, s0, [line("u000001", 10.0)])
    s1 = [scene(("house_rules", "Fumble rule: a natural one fumbles", "Fumble-regel: en 1'er fumbler"))]
    result = agenda.update(tmp_path, S1, s1, [line("u000001", 125.0)])
    by_en = {i["en"]: i for i in result["items"]}
    settled = by_en["Fumble rule on a natural one"]
    assert settled["status"] == "settled"
    assert settled["settledBy"]["session"] == S1
    assert settled["settledBy"]["time"] == "00:02:05"
    assert len(agenda.open_items(result)) == 2


def test_same_session_house_rule_does_not_settle(tmp_path: Path) -> None:
    notes = [scene(("proposed", "Fumble rule", "x"), ("house_rules", "Fumble rule agreed", "y"))]
    result = agenda.update(tmp_path, S0, notes, [line("u000001", 1.0)])
    assert result["items"][0]["status"] == "open"


def test_rerun_keeps_hand_status_and_manual_settle(tmp_path: Path) -> None:
    notes = [scene(("open", "Who brings snacks", "snacks"))]
    result = agenda.update(tmp_path, S0, notes, [line("u000001", 1.0)])
    iid = result["items"][0]["id"]
    agenda.set_status(tmp_path, iid[:4], "dropped")
    again = agenda.update(tmp_path, S0, notes, [line("u000001", 1.0)])
    assert again["items"][0]["status"] == "dropped"
    with pytest.raises(ValueError):
        agenda.set_status(tmp_path, "zzzz", "settled")


def test_render_lists_open_first_in_both_languages(tmp_path: Path) -> None:
    notes = [scene(("proposed", "Fumble rule", "Fumble-regel"))]
    result = agenda.update(tmp_path, S0, notes, [line("u000001", 3.0)])
    assert "## Settle at the start\n\n- Fumble rule" in agenda.render(result, "en")
    assert "## Afgør ved start" in agenda.render(result, "da")
    assert "## Settled\n\nNone" in agenda.render(result, "en")
