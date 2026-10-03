from __future__ import annotations

from pathlib import Path

import pytest

from narration.script import apply_lexicon, load_lexicon, parse_script, split_sentences


def parse(text: str, name: str = "demo.da.md", lexicon: dict[str, str] | None = None):
    return parse_script(Path(name), lexicon, text=text)


def test_split_keeps_abbreviations_and_initials() -> None:
    text = "Tag f.eks. en token. Spørg J. Smith om det! Er det nu? Ja... Godt."
    assert split_sentences(text) == [
        "Tag f.eks. en token.",
        "Spørg J. Smith om det!",
        "Er det nu?",
        "Ja...",
        "Godt.",
    ]


def test_split_allows_lower_case_start() -> None:
    assert split_sentences("Klik her. dnd5e ruller for dig.") == ["Klik her.", "dnd5e ruller for dig."]


def test_lang_from_front_matter_or_file_name() -> None:
    assert parse("---\nlang: en\n---\nHello.", name="x.md").lang == "en"
    assert parse("Hej.", name="intro.da.md").lang == "da"
    with pytest.raises(ValueError, match="lang"):
        parse("Hej.", name="intro.md")


def test_front_matter_voice_speed_and_gaps() -> None:
    s = parse("---\nvoice: nic\nspeed: 0.9\nsentence_gap: 0.4\n---\nEn. To.")
    assert (s.voice, s.speed) == ("nic", 0.9)
    assert s.sentences[0].gap_after == 0.4
    assert s.sentences[-1].gap_after == s.gaps["tail"]


def test_override_changes_spoken_form_only() -> None:
    s = parse("Åbn {Foundry|Faundri} nu.")
    assert s.sentences[0].shown == "Åbn Foundry nu."
    assert s.sentences[0].spoken == "Åbn Faundri nu."


def test_lexicon_whole_words_and_case() -> None:
    lex = {"dnd5e": "D og D fem e", "AI": "A I"}
    assert apply_lexicon("DND5E-systemet og AI'en, ikke MAIL", lex) == "D og D fem e systemet og A I'en, ikke MAIL"
    assert apply_lexicon("AI- og dnd5e-", lex) == "A I- og D og D fem e-"  # no word after: kept
    s = parse("Brug dnd5e.", lexicon=lex)
    assert s.sentences[0].shown == "Brug dnd5e."
    assert s.sentences[0].spoken == "Brug D og D fem e."


def test_lexicon_does_not_touch_overrides() -> None:
    s = parse("Se {AI|kunstig intelligens} og AI.", lexicon={"AI": "A I"})
    assert s.sentences[0].spoken == "Se kunstig intelligens og A I."


def test_load_lexicon(tmp_path: Path) -> None:
    f = tmp_path / "da.txt"
    f.write_text("# comment\ndnd5e = D og D fem e  # trailing\n\nD&D = D og D\n", encoding="utf-8")
    assert load_lexicon(f) == {"dnd5e": "D og D fem e", "D&D": "D og D"}
    f.write_text("broken line\n", encoding="utf-8")
    with pytest.raises(ValueError, match="term = spoken"):
        load_lexicon(f)
    assert load_lexicon(tmp_path / "missing.txt") == {}


def test_paragraphs_headings_pauses_and_chapters() -> None:
    text = (
        "# Start\n\nEn. To.\n\nTre.\n\n# Midt\n\n[pause 1.5]\nFire.\n<!-- not read -->\n"
        "- Punkt et\n- Punkt to\n"
    )
    s = parse(text)
    assert [x.shown for x in s.sentences] == ["En.", "To.", "Tre.", "Fire.", "Punkt et", "Punkt to"]
    gaps = [x.gap_after for x in s.sentences]
    assert gaps[0] == s.gaps["sentence_gap"]
    assert gaps[1] == s.gaps["paragraph_gap"]
    assert gaps[2] == s.gaps["heading_gap"] + 1.5
    assert gaps[3] == s.gaps["paragraph_gap"]
    assert s.chapters == [(1, "Start"), (4, "Midt")]
    assert s.sentences[3].heading == "Midt"


def test_leading_pause_and_markdown_cleanup() -> None:
    s = parse("[pause 2]\nSe **dashboardet** og [guiden](https://x.y) nu.")
    assert s.lead_in == pytest.approx(s.gaps["lead_in"] + 2)
    assert s.sentences[0].shown == "Se dashboardet og guiden nu."


def test_long_sentence_warns() -> None:
    s = parse("Ord " * 80 + "slut.")
    assert any("250" in w for w in s.warnings)


def test_examples_parse() -> None:
    root = Path(__file__).resolve().parents[1] / "examples"
    for path in root.glob("*.md"):
        s = parse_script(path)
        assert s.sentences and not s.warnings, path.name
