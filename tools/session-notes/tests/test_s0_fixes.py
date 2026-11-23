"""Fixes from the session 0 notes: pronouns from the roster, English NPC labels, merged spellings."""

from __future__ import annotations

import json
from pathlib import Path

from session_notes.model import Line, Roster, apply_speakers, load_roster
from session_notes.npcs import canonicalize, label, merge_scene_npcs
from session_notes.prompts import NPC, SCENE_RULES, SESSION_RULES, roster_block


def _npc(da: str, en: str, aliases: list[str] | None = None, cite: str = "u000001") -> dict:
    return {
        "name_da": da,
        "name_en": en,
        "aliases": aliases or [],
        "da": f"{da} beskrivelse",
        "en": f"{en} description",
        "cites": [cite],
    }


def _line(player: str, character: str) -> Line:
    return Line("u000001", 0, 1, "x", player, character, "hej")


def test_roster_gives_pronouns_and_defaults_to_they_them(tmp_path: Path) -> None:
    (tmp_path / "speakers.json").write_text(
        json.dumps(
            {
                "danni_d": {"player": "GM (Danni)", "character": "GM", "pronouns": "he/him"},
                "x": {"player": "Ebbe (Christian)"},
            }
        ),
        encoding="utf-8",
    )
    lines = apply_speakers([_line("?", "?")], tmp_path)
    roster = load_roster(tmp_path, [_line("GM (Danni)", "GM"), _line("Ebbe (Christian)", "Ebbe")])
    assert lines
    assert roster.pronouns == {"GM (Danni)": "he/him"}
    block = roster_block(roster)
    assert "GM (Danni) is the GM (narrates, rules, plays all NPCs) (he/him)" in block
    assert "Ebbe (Christian) plays Ebbe (pronouns not given: use they/them)" in block


def test_prompts_forbid_guessing_pronouns() -> None:
    for rules in (SCENE_RULES, SESSION_RULES):
        assert "they/them" in rules
        assert "never guess" in rules.lower()


def test_npc_schema_has_english_name_and_aliases() -> None:
    assert {"name_da", "name_en", "aliases"} <= set(NPC["properties"])
    assert "Kommandøren" in SCENE_RULES and "name_en" in SCENE_RULES


def test_label_uses_the_language_and_lists_variants() -> None:
    npc = _npc("Kommandøren", "The Commander", ["Vesperhult"])
    assert label(npc, "en") == "The Commander (also heard as: Vesperhult)"
    assert label(npc, "da") == "Kommandøren (også hørt som: Vesperhult)"
    assert label({"name": "Madam Eva"}, "en") == "Madam Eva"  # notes from before the change


def test_spellings_in_one_scene_merge() -> None:
    out = merge_scene_npcs(
        [
            _npc("Vesperholt", "Vesperholt", cite="u000001"),
            _npc("Vesperhult", "Vesperhult", cite="u000002"),
            _npc("Wagner", "Wagner", cite="u000003"),
        ]
    )
    assert [n["name_en"] for n in out] == ["Vesperholt", "Wagner"]
    assert out[0]["aliases"] == ["Vesperhult"]
    assert out[0]["cites"] == ["u000001", "u000002"]


def test_short_names_do_not_merge_by_similarity() -> None:
    assert len(merge_scene_npcs([_npc("Ula", "Ula"), _npc("Ulf", "Ulf")])) == 2


def test_spellings_across_scenes_take_the_first_name() -> None:
    notes = [
        {"npcs": [_npc("Vesperholt", "Vesperholt")]},
        {"npcs": [_npc("Tvivleren", "The Doubter")]},
        {"npcs": [_npc("Vesperhult", "Vesperhult"), _npc("Tvivleren", "The Doubter")]},
    ]
    assert canonicalize(notes) == 1
    third = notes[2]["npcs"]
    assert third[0]["name_en"] == "Vesperholt"
    assert third[0]["aliases"] == ["Vesperhult"]
    assert third[1]["name_en"] == "The Doubter"
    assert Roster().pronouns == {}


def test_numbered_npcs_stay_apart() -> None:
    assert len(merge_scene_npcs([_npc("Soldat 1", "Soldier 1"), _npc("Soldat 2", "Soldier 2")])) == 2


def test_pronouns_change_the_cache_keys() -> None:
    from session_notes.extras import chunk_key
    from session_notes.layers import scene_key

    scene = {"index": 1, "lines": [], "title_da": "", "summary_da": ""}
    assert scene_key(scene, "{}") != scene_key(scene, '{"GM": "he/him"}')
    a = Roster(players={"GM": "GM"})
    b = Roster(players={"GM": "GM"}, pronouns={"GM": "he/him"})
    assert chunk_key("remember", [], a) != chunk_key("remember", [], b)
