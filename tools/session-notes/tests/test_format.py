"""The fixed notes format (design "Session notes format", 2026-11-23), with synthetic data only."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from helpers import SESSION_ANSWER, FakeClaude, write_session

from session_notes.run import Options, Writer
from test_notes import ROWS

SCENE_HEADINGS = {
    "en": ["What happened", "Decisions", "NPCs met", "Open threads", "Quotes", "GM only"],
    "da": ["Hvad der skete", "Beslutninger", "NPC'er mødt", "Åbne tråde", "Citater", "Kun for GM"],
}
FILES = ("index", "scenes", "table", "summary", "recap.player", "transcript", "raw")


class FormatClaude(FakeClaude):
    """Scene 1 is played, with table talk in it; scene 2 is wholly at the table."""

    def __init__(self, **kw: Any) -> None:
        super().__init__(**kw)
        self.session_overrides: dict[str, Any] = {}
        self.scene_summary: dict[int, str] = {}  # call number -> summary to give

    def __call__(self, prompt: str, schema: dict[str, Any], model: str, effort: str = "low") -> Any:
        out = super().__call__(prompt, schema, model, effort)
        kind = self.calls[-1][0]
        n = len(self.calls)
        if kind == "scene":
            ids = re.findall(r"^(u\d{6}) \[", prompt, re.M)
            if "Scene 1," in prompt:
                out.update(
                    setting="mixed",
                    events=[
                        {
                            "da": "De går mod Maravia",
                            "en": "They walk to Maravia",
                            "cites": [ids[2], ids[0], ids[1]],  # three cites: one link must show
                        }
                    ],
                    decisions=[],
                    npcs=[
                        {
                            "name_da": "Madam Eva",
                            "name_en": "Madam Eva",
                            "aliases": ["Madame Eve"],
                            "da": "Spåkone, kun omtalt her",
                            "en": "Fortune teller, only heard of here",
                            "cites": [ids[0]],
                        }
                    ],
                    quotes=[
                        {"id": ids[1], "spoken": "Jeg tjekker døren", "spoken_lang": "da", "en": "I check the door"},
                        {"id": ids[0], "spoken": "We go", "spoken_lang": "en", "en": "We go"},
                    ],
                    table=[
                        {"topic": "house_rules", "da": "Permadeath gælder", "en": "Permadeath applies", "cites": [ids[3]]},
                        {"topic": "planning", "da": "Næste gang 19. dec", "en": "Next time 19 Dec", "cites": [ids[4]]},
                    ],
                    table_note={"da": "permadeath og dato", "en": "permadeath and the date"},
                )
            else:
                out.update(
                    setting="table",
                    title_da="Ved bordet",
                    title_en="At the table",
                    summary_da="Bordet taler om noter. De aftaler ingenting nyt.",
                    summary_en="The table talks about notes. They agree nothing new.",
                    events=[],
                    npcs=[],
                    quotes=[],
                    gm_only=[],
                    table=[
                        {"topic": "house_rules", "da": "Permadeath gælder", "en": "Permadeath applies", "cites": [ids[0]]},
                        {"topic": "weird", "da": "Noget", "en": "Something", "cites": [ids[1]]},
                    ],
                    table_note={"da": "noter", "en": "notes"},
                )
            if n in self.scene_summary:
                out["summary_en"] = self.scene_summary[n]
        if kind == "session":
            out.update(self.session_overrides)
        return out


@pytest.fixture
def session(tmp_path: Path) -> Path:
    folder = tmp_path / "2026-11-22_1906-discord"
    s = write_session(folder, ROWS)
    return s


def run(session: Path, fake: FakeClaude | None = None, layers: bool = False) -> Path:
    Writer(session, fake or FormatClaude(), Options(workers=1, layers=layers)).run()
    return session / "notes"


def read(notes: Path, name: str) -> str:
    return (notes / name).read_text(encoding="utf-8")


def scene_block(text: str, n: int) -> str:
    parts = re.split(r"^## ", text, flags=re.M)
    return next(p for p in parts if p.startswith(f"{n}. "))


def test_same_files_in_both_languages(session: Path) -> None:
    notes = run(session, layers=True)
    for lang in ("da", "en"):
        for base in (*FILES, "characters", "remember"):
            assert (notes / f"{base}.{lang}.md").exists(), f"{base}.{lang}"
    assert not (notes / "summary.xx.md").exists()


def test_in_game_scene_has_fixed_headings_in_order(session: Path) -> None:
    notes = run(session)
    for lang in ("en", "da"):
        block = scene_block(read(notes, f"scenes.{lang}.md"), 1)
        heads = re.findall(r"^### (.+)$", block, re.M)
        assert heads == SCENE_HEADINGS[lang]
        # an empty heading says None / Ingen
        none = "None" if lang == "en" else "Ingen"
        assert re.search(rf"### {SCENE_HEADINGS[lang][1]}\n\n{none}\n", block)


def test_one_timestamp_link_per_line(session: Path) -> None:
    notes = run(session)
    for lang in ("en", "da"):
        for line in read(notes, f"scenes.{lang}.md").splitlines():
            if line.startswith("- "):
                assert len(re.findall(r"\[\[transcript\.", line)) <= 1, line
    block = scene_block(read(notes, "scenes.en.md"), 1)
    # three cites, the earliest line (u000001, 00:00:10) wins
    assert "- They walk to Maravia ([[transcript.en#^u000001|00:00:10]])" in block


def test_table_only_scene_is_a_stub_without_empty_headings(session: Path) -> None:
    notes = run(session)
    block = scene_block(read(notes, "scenes.en.md"), 2)
    assert "###" not in block and "None" not in block
    assert "at the table*" in block and "[[table.en|Table]]" in block
    assert "The table talks about notes. They agree nothing new." in block
    da = scene_block(read(notes, "scenes.da.md"), 2)
    assert "###" not in da and "ved bordet*" in da and "[[table.da|Bordet]]" in da


def test_mixed_scene_points_to_the_table_page_once(session: Path) -> None:
    notes = run(session)
    block = scene_block(read(notes, "scenes.en.md"), 1)
    pointers = [ln for ln in block.splitlines() if ln.startswith("- At the table:")]
    assert len(pointers) == 1
    assert "[[table.en#House rules|Table, House rules]]" in pointers[0]
    assert "in the game, then at the table*" in block
    # table talk is not an in-game decision or event
    assert "Permadeath" not in block
    da = scene_block(read(notes, "scenes.da.md"), 1)
    assert "- Ved bordet: permadeath og dato; se [[table.da#Husregler|Bordet, Husregler]]" in da


def test_table_page_collects_the_table_talk_under_fixed_headings(session: Path) -> None:
    notes = run(session)
    en = read(notes, "table.en.md")
    heads = re.findall(r"^## (.+)$", en, re.M)
    assert heads == [
        "House rules",
        "Proposed, not settled",
        "Play style",
        "Absence",
        "Planning",
        "Open at the table",
    ]
    assert en.count("Permadeath applies") == 1  # said in two scenes, written once
    assert "Next time 19 Dec" in en
    assert "Something" in en.split("## Open at the table")[1]  # an unknown topic lands in Open
    assert re.search(r"## Absence\n\nNone\n", en)
    da = read(notes, "table.da.md")
    assert re.findall(r"^## (.+)$", da, re.M)[1] == "Foreslået, ikke afgjort"
    assert re.search(r"## Fravær\n\nIngen\n", da)


def test_quotes_keep_the_spoken_language_and_english_adds_a_translation(session: Path) -> None:
    notes = run(session)
    en = scene_block(read(notes, "scenes.en.md"), 1)
    assert '- "Jeg tjekker døren" (I check the door) ([[transcript.en#^u000002|00:00:40]])' in en
    assert '- "We go" ([[transcript.en#^u000001|00:00:10]])' in en  # spoken English: no brackets
    da = scene_block(read(notes, "scenes.da.md"), 1)
    assert '- "Jeg tjekker døren" ([[transcript.da#^u000002|00:00:40]])' in da
    assert "I check the door" not in da


def test_name_variants_are_not_in_the_notes(session: Path) -> None:
    notes = run(session)
    for lang in ("en", "da"):
        text = read(notes, f"scenes.{lang}.md")
        assert "Madame Eve" not in text and "also heard as" not in text and "også hørt" not in text
        assert "**Madam Eva**: " in text
    data = json.loads(read(notes, "notes.json"))
    assert data["scenes"][0]["npcs"][0]["aliases"] == ["Madame Eve"]  # kept as data


def test_index_page(session: Path) -> None:
    notes = run(session)
    en = read(notes, "index.en.md")
    assert en.startswith("# Session\n")
    assert "**Date:** Sunday 22 November 2026, 19:06 to 19:15 (online, Discord)" in en
    assert "**GM:** GM" in en
    assert "| Character | Played by |" in en and "| Ilvara | Anna |" in en
    assert "## In short" in en and "1. One" in en and "5. Five" in en
    for page in ("scenes", "table", "summary", "recap.player", "transcript", "raw"):
        assert f"[[{page}.en|" in en
    assert "[[characters.en" not in en  # layers are off
    assert en.rstrip().endswith("[[index.da|Dansk version]]")
    da = read(notes, "index.da.md")
    assert "**Dato:** søndag 22. november 2026, 19:06 til 19:15 (online, Discord)" in da
    assert "| Karakter | Spillet af |" in da and "## Kort fortalt" in da
    assert da.rstrip().endswith("[[index.en|English version]]")


def test_index_links_layer_pages_when_they_exist(session: Path) -> None:
    notes = run(session, layers=True)
    en = read(notes, "index.en.md")
    assert "[[characters.en|Characters]]" in en and "[[remember.en|Worth remembering]]" in en
    assert "depth" not in en  # the in-depth notes are Danish only
    assert "[[depth.da|" in read(notes, "index.da.md")


def test_character_pages_have_one_title_form_and_no_gm(session: Path) -> None:
    notes = run(session, layers=True)
    en = read(notes, "characters.en.md")
    assert "## Ilvara, played by Anna" in en
    assert "(Anna)" not in en and "GM" not in en.replace("### GM only", "").replace("GM only:", "")
    block = en.split("## Ilvara, played by Anna")[1].split("\n## ")[0]
    assert re.findall(r"^#{3,4} (.+)$", block, re.M) == [
        "In the story", "Revealed", "Choices", "Ties", "Hooks", "Player wishes", "GM only",
    ]
    assert re.search(r"#### Choices\n\nNone\n", block)
    da = read(notes, "characters.da.md")
    assert "## Ilvara, spillet af Anna" in da and "### Spillerønsker" in da and "Ingen" in da


def test_raw_transcript_exists_in_both_languages(session: Path) -> None:
    notes = run(session)
    assert "[Sær?]" in read(notes, "raw.en.md") and read(notes, "raw.en.md").startswith("# Raw transcript")
    assert read(notes, "raw.da.md").startswith("# Rå transskription")


def test_placeholder_scene_summary_is_asked_again(session: Path) -> None:
    fake = FormatClaude()
    fake.scene_summary = {1: "placeholder"}
    notes = run(session, fake)
    kinds = [k for k, _ in fake.calls]
    assert kinds.count("scene") == 3  # scene 1 twice, scene 2 once
    assert "placeholder" not in read(notes, "scenes.en.md").lower()


def test_english_gm_label_in_danish_text_is_replaced(session: Path) -> None:
    fake = FormatClaude()
    fake.session_overrides = {"summary_da": "Noget skete. GM only: hemmeligheden er stor."}
    notes = run(session, fake)
    assert "GM only" not in read(notes, "summary.da.md")
    assert "Kun for GM: hemmeligheden er stor." in read(notes, "summary.da.md")


def test_session_with_wrong_number_of_lines_is_asked_again(session: Path) -> None:
    fake = FormatClaude()
    fake.session_overrides = {"in_short_en": ["only one"]}
    notes = run(session, fake)
    assert [k for k, _ in fake.calls].count("session") == 2
    # still wrote the pages from the second answer (the fake gives the same bad one again)
    assert (notes / "index.en.md").exists()
    assert "rejected" in fake.calls[-1][1]
    assert SESSION_ANSWER["in_short_da"][0] in read(notes, "index.da.md")
    # a bad answer is shown but not cached: the next run asks again
    assert not (notes / ".work" / "session.json").exists()
    again = FormatClaude()
    run(session, again)
    assert [k for k, _ in again.calls].count("session") == 1


def test_scene_repairs(session: Path) -> None:
    from session_notes.validate import repair
    from session_notes.model import Scene, load_timeline

    lines = load_timeline(session / "timeline" / "timeline.jsonl")
    scene = Scene(1, lines[:2])
    result = {
        "lines": [{"id": ln.id, "da": ln.text, "en": ln.text} for ln in scene.lines],
        "title_da": "Titel",
        "summary_da": "GM only: noget",
        "setting": "table",
        "events": [{"da": "Noget (GM only)", "en": "x", "cites": []}],
        "decisions": [], "npcs": [], "threads": [], "gm_only": [], "quotes": [], "table": [],
    }
    log = repair(result, scene)
    assert result["summary_da"] == "Kun for GM: noget"
    assert result["events"][0]["da"] == "Noget (Kun for GM)"
    assert result["setting"] == "mixed" and any("mixed" in x for x in log)


def test_split_scene_with_a_raw_half_keeps_the_good_half(session: Path) -> None:
    from session_notes.render import render_scenes

    scene = {
        "index": 1, "start": 0.0, "end": 5.0, "fallback": True, "setting": "game",
        "title_en": "T", "summary_en": "Good half.", "events": [{"en": "It happened", "cites": []}],
        "decisions": [], "npcs": [], "threads": [], "quotes": [], "gm_only": [], "table": [],
    }
    text = render_scenes("en", [], [scene])
    assert "could not be processed" in text and "It happened" in text and "Good half." in text
