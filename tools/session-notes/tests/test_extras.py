"""Character and worth-remembering layers (synthetic lines only)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from helpers import FakeClaude, write_session
from test_notes import ROWS

from session_notes import extras
from session_notes.model import Line, Roster
from session_notes.publish import build
from session_notes.run import Options, Writer

ROSTER = Roster(players={"Anna": "Ilvara", "Bo": "Bo", "GM": "GM"})
KNOWN = {"u000001", "u000002"}


@pytest.fixture
def session(tmp_path: Path) -> Path:
    return write_session(tmp_path, ROWS)


def opts(**kw: object) -> Options:
    return Options(workers=1, layers=True, **kw)  # type: ignore[arg-type]


def point(cites: list[str] | None = None) -> dict:
    return {"da": "Punkt", "en": "Point", "cites": cites if cites is not None else ["u000001"]}


def character(name: str = "Ilvara", **kw: list) -> dict:
    base = {"name": name, "player": "Anna", "revealed": [point()], "choices": [], "ties": [], "hooks": []}
    return {**base, **kw}


def test_schemas_require_every_property() -> None:
    for schema in (extras.CHARACTERS_SCHEMA, extras.REMEMBER_SCHEMA):
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == set(schema["properties"])
    char = extras.CHARACTER["properties"]
    assert set(char) == {"name", "player", "revealed", "choices", "ties", "hooks"}
    assert set(extras.REMEMBER_ITEM["properties"]) == {"kind", "da", "en", "cites"}


def test_player_characters_skip_the_gm() -> None:
    assert extras.player_characters(ROSTER) == [("Ilvara", "Anna"), ("Bo", "Bo")]


def test_prompts_name_the_roster_and_say_gm_only_and_both_languages() -> None:
    chunk = [{"index": 1, "title_en": "T", "summary_en": "S", "events": [], "lines": []}]
    chars = extras.characters_prompt(chunk, ROSTER)
    assert "- Ilvara (played by Anna)" in chars and "- GM (played by" not in chars
    assert "GM only" in chars and "`da` Danish" in chars and "line ids" in chars
    rem = extras.remember_prompt(chunk, ROSTER, extras.part_note(2, 3))
    assert "part 2 of 3" in rem and "agreement" in rem and "house rules" in rem
    assert extras.part_note(1, 1) == ""


def test_check_characters_flags_hard_problems() -> None:
    ok = {"characters": [character(), character("Bo", player="Bo")]}
    assert extras.check_characters(ok, ROSTER, KNOWN) == []
    assert extras.check_characters({"characters": []}, ROSTER, KNOWN)
    assert extras.check_characters({"characters": [character("Nobody")]}, ROSTER, KNOWN)
    assert extras.check_characters({"characters": [character(revealed=[point(["u9"])])]}, ROSTER, KNOWN)
    blank = {"da": "", "en": "x", "cites": ["u000001"]}
    assert extras.check_characters({"characters": [character(revealed=[blank])]}, ROSTER, KNOWN)


def test_check_remember_and_repair() -> None:
    item = {"kind": "fact", **point(["u000001", "u777777"])}
    result = {"items": [item]}
    assert extras.check_remember(result, KNOWN) == []
    assert extras.check_remember({"items": [{"kind": "fact", **point(["u9"])}]}, KNOWN)
    assert extras.check_remember({}, KNOWN) == ["no items list"]
    assert extras.repair(result, KNOWN) and item["cites"] == ["u000001"]
    chars = {"characters": [character(ties=[point(["u000002", "nope"])])]}
    extras.repair(chars, KNOWN)
    assert chars["characters"][0]["ties"][0]["cites"] == ["u000002"]


def test_chunking_and_merging() -> None:
    scenes = [
        {"index": i, "title_en": "T" * 50, "summary_en": "S" * 50, "lines": []} for i in (1, 2, 3)
    ]
    assert len(extras.chunk_scenes(scenes)) == 1
    chunks = extras.chunk_scenes(scenes, limit=300)
    assert len(chunks) > 1 and [s["index"] for c in chunks for s in c] == [1, 2, 3]
    scenes[1]["fallback"] = True
    assert [s["index"] for c in extras.chunk_scenes(scenes) for s in c] == [1, 3]
    merged = extras.merge_characters(
        [{"characters": [character(choices=[point()])]}, {"characters": [character(choices=[point()])]}]
    )
    assert len(merged["characters"]) == 1 and len(merged["characters"][0]["choices"]) == 2
    assert len(extras.merge_remember([{"items": [1]}, {"items": [2]}])["items"]) == 2


def lines() -> list[Line]:
    return [Line(id="u000001", speaker="anna", start=10.0, end=14.0, player="Anna", character="Ilvara", text="x")]


def test_render_characters_and_remember_with_cites_in_both_languages() -> None:
    result = {"characters": [character(ties=[point()], hooks=[point()])]}
    da = extras.render_characters("da", lines(), ROSTER, result)
    assert "## Ilvara (spilles af Anna)" in da and "### Bånd til andre" in da
    assert "[[transcript.da#^u000001|00:00:10]]" in da and "Kun for GM" in da
    en = extras.render_characters("en", lines(), ROSTER, result)
    assert "### Open personal hooks" in en and "- Point ([[transcript.en#^u000001" in en
    assert "Ikke skrevet" in extras.render_characters("da", lines(), ROSTER, None)
    rem = {"items": [{"kind": "promise", **point()}, {"kind": "zzz", **point()}]}
    text = extras.render_remember("en", lines(), rem)
    assert text.index("## Promises") < text.index("## Other")
    assert "Nothing noted" in extras.render_remember("en", lines(), {"items": []})


def test_run_writes_both_layers_one_call_each_and_reruns_skip_them(session: Path) -> None:
    fake = FakeClaude()
    result = Writer(session, fake, opts()).run()
    kinds = [k for k, _ in fake.calls]
    assert kinds.count("characters") == 1 and kinds.count("remember") == 1  # not per scene
    assert result.extras_missing == 0
    notes = session / "notes"
    for name in ("characters.da.md", "characters.en.md", "remember.da.md", "remember.en.md"):
        assert (notes / name).exists()
    chars = (notes / "characters.da.md").read_text(encoding="utf-8")
    assert "## Ilvara" in chars and "u999999" not in chars and "^u" not in chars.split("(")[0]
    assert "## Bo" in chars and "GM (" not in chars
    assert "## Aftaler ved bordet" in (notes / "remember.da.md").read_text(encoding="utf-8")
    # never in the player recap
    recap = (notes / "recap.player.da.md").read_text(encoding="utf-8")
    assert "Punkt" not in recap
    again = FakeClaude()
    Writer(session, again, opts()).run()
    assert [k for k, _ in again.calls if k in ("characters", "remember")] == []


def test_a_limit_during_the_layers_pauses_and_resumes(session: Path) -> None:
    # calls: 2 scenes, session, 2 depth, then characters (6) hits the limit
    fake = FakeClaude(fail={6: "limit"})
    result = Writer(session, fake, opts()).run()
    assert result.paused and result.extras_missing == 2
    data = json.loads((session / "notes" / "notes.json").read_text(encoding="utf-8"))
    assert data["layers"]["characters_complete"] is False
    assert "Ufærdige" in (session / "notes" / "index.da.md").read_text(encoding="utf-8")
    again = FakeClaude()
    result2 = Writer(session, again, opts()).run()
    assert result2.extras_missing == 0
    assert [k for k, _ in again.calls] == ["characters", "remember"]


def test_a_bad_answer_is_retried_then_left_missing(session: Path) -> None:
    class Empty(FakeClaude):
        def __call__(self, prompt, schema, model, effort="low"):  # type: ignore[no-untyped-def]
            if "items" in schema["properties"]:
                self.calls.append(("remember", prompt))
                return {"items": [{"kind": "fact", "da": "", "en": "", "cites": []}]}
            return super().__call__(prompt, schema, model, effort)

    fake = Empty()
    result = Writer(session, fake, opts()).run()
    assert result.extras_missing == 1 and not result.paused
    assert [k for k, _ in fake.calls].count("remember") == 2
    assert "Ikke skrevet" in (session / "notes" / "remember.da.md").read_text(encoding="utf-8")
    assert "rejected" in fake.calls[-1][1]


def test_layers_off_writes_neither(session: Path) -> None:
    fake = FakeClaude()
    Writer(session, fake, Options(workers=1)).run()
    assert not (session / "notes" / "characters.da.md").exists()
    assert {"characters", "remember"}.isdisjoint(k for k, _ in fake.calls)


def test_publish_carries_the_layers_on_the_gm_summary_only(session: Path) -> None:
    Writer(session, FakeClaude(), opts()).run()
    staged = build(session)
    pages = {p["key"]: p["html"] for p in staged.pages}
    assert "<h3>Personer</h3>" in pages["summary"] and "<h3>Characters</h3>" in pages["summary"]
    assert "Værd at huske" in pages["summary"] and "Ilvara" in pages["summary"]
    assert "Ilvara" not in pages["recap"] and "Worth remembering" not in pages["recap"]
    assert "Worth remembering" not in pages["scenes"]
