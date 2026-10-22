import pytest

from session_pipeline.names import (
    NameRules,
    NameSuggester,
    ordinary_from_frequency,
    parse_rules,
)

RULES = NameRules({"Sorvan": ["Sorva", "Sorvon"], "Dagny": ["Dag"], "Castle Greywatch": ["Castle Greywatc"]})


def fixed(text):
    return RULES.apply(text)[0]


def test_whole_word_only_dag_does_not_touch_dagstorp():
    assert fixed("Dag kom til Dagstorp") == "Dagny kom til Dagstorp"


def test_word_inside_a_longer_word_is_untouched_on_both_sides():
    assert fixed("Ydag og Dagen og Sorvaivari") == "Ydag og Dagen og Sorvaivari"


def test_hyphenated_compounds_are_one_word():
    assert fixed("Dag-og-nat og en-Dag") == "Dag-og-nat og en-Dag"


def test_possessive_and_punctuation_still_match():
    assert fixed("Sorva's slot. Sorva, hør!") == "Sorvan's slot. Sorvan, hør!"


def test_case_style_is_preserved():
    assert fixed("sorva") == "sorvan"
    assert fixed("Sorva") == "Sorvan"
    assert fixed("SORVA") == "SORVAN"


def test_multiword_wrong_spelling():
    assert fixed("ved castle   greywatc nu") == "ved castle greywatch nu"
    assert fixed("Castle Greywatc") == "Castle Greywatch"


def test_canonical_mixed_case_is_kept():
    r = NameRules({"D'Arcy": ["darcy"]})
    assert r.apply("hej darcy")[0] == "hej D'Arcy"


def test_fixes_are_reported_with_counts():
    _, fixes = RULES.apply("Sorva og Sorva og Sorvon")
    by = {(f.wrong, f.heard): f.count for f in fixes}
    assert by == {("sorva", "Sorva"): 2, ("sorvon", "Sorvon"): 1}
    assert all(f.correct == "Sorvan" for f in fixes)


def test_no_cascade_a_corrected_name_is_not_corrected_again():
    r = NameRules({"B": ["A"], "C": ["B"]})
    assert r.apply("A B")[0] == "B C"


def test_non_ascii_names_respect_boundaries():
    r = NameRules({"Åse": ["Ose"]})
    assert r.apply("Ose og Osebro")[0] == "Åse og Osebro"


def test_empty_rules_change_nothing():
    r = NameRules({})
    assert not r and r.apply("hej") == ("hej", [])


def test_rule_equal_to_its_correct_form_is_ignored():
    assert NameRules({"Sorvan": ["sorvan"]}).apply("Sorvan") == ("Sorvan", [])


def test_parse_rules_validates_shape():
    assert parse_rules({"A": ["b"]}).apply("B")[0] == "A"
    with pytest.raises(ValueError):
        parse_rules({"A": "b"})


KNOWN = ["Sorvan", "Ilvara", "Maravia", "Castle Greywatch"]
ORDINARY = {"kommer", "til", "og", "ind", "slottet"}


def test_suggester_suggests_but_never_changes_text():
    s = NameSuggester(KNOWN, ORDINARY)
    text = "Sorva kommer til Maravja"
    out = s.suggest(text)
    assert {(x.heard, x.suggested) for x in out} == {("Sorva", "Sorvan"), ("Maravja", "Maravia")}
    assert text == "Sorva kommer til Maravja"


def test_suggester_skips_ordinary_words():
    s = NameSuggester(KNOWN, ORDINARY | {"sorva"})
    assert s.suggest("Sorva kommer") == []


def test_suggester_skips_exact_known_names_and_short_words():
    s = NameSuggester(KNOWN, ORDINARY)
    assert s.suggest("Sorvan og Ilvara ind") == []


def test_suggester_respects_the_cutoff():
    s = NameSuggester(KNOWN, ORDINARY, cutoff=0.95)
    assert s.suggest("Sorva") == []


def test_suggester_matches_multiword_names():
    s = NameSuggester(KNOWN, ORDINARY)
    out = s.suggest("ved Castle Greywatcd nu")
    assert any(x.suggested == "Castle Greywatch" for x in out)


def test_suggester_matches_one_part_of_a_multiword_name():
    s = NameSuggester(KNOWN, ORDINARY)
    assert [x.suggested for x in s.suggest("Greywatcd")] == ["Castle Greywatch"]


def test_known_name_tokens_are_never_ordinary():
    s = NameSuggester(KNOWN, {"sorvan"})
    assert "sorvan" not in s.ordinary


def test_ordinary_from_frequency():
    words = ordinary_from_frequency(["vi går ind", "vi går ud", "vi går hjem", "Sorva"], min_count=3)
    assert words == {"vi", "går"}


def test_suggester_reports_a_repeated_misheard_word_once_per_text():
    s = NameSuggester(KNOWN, ORDINARY)
    assert len(s.suggest("Sorva og Sorva")) == 1


def test_short_parts_of_multiword_names_are_not_matched_alone():
    s = NameSuggester(["Mage Hand"], set())
    assert s.suggest("mange") == []


# Glued names: the recogniser writes a name and its neighbour as one word.


def glued_suggester(**kw):
    return NameSuggester(
        ["Sorvan", "Ilvara Kolyana", "Maravia", "Valmere"],
        block_words={"siger", "stille", "alting"},
        **kw,
    )


def test_glued_name_with_a_rule_spelling_is_fixed():
    s = glued_suggester(aliases={"sorf": "Sorvan"})
    text, applied, left = s.fix("og så sorfser han ud af vinduet")
    assert text == "og så Sorvan ser han ud af vinduet"
    assert [a.suggested for a in applied] == ["Sorvan"] and left == []


def test_glued_exact_name_both_orders():
    s = glued_suggester()
    assert s.fix("sorvansiger nej")[0] == "Sorvan siger nej"
    assert s.fix("ogvalmere brænder")[0] == "og Valmere brænder"
    assert s.fix("Ilvarahar ret")[0] == "Ilvara har ret"  # part of a multi-word name


def test_glued_fuzzy_name_is_only_suggested():
    s = glued_suggester()
    text, applied, left = s.fix("sorvaser er her")
    assert text == "sorvaser er her" and applied == []
    assert left[0].replacement == "Sorva ser" or left[0].suggested == "Sorvan"
    assert left[0].blocked == "glued"


def test_glued_never_splits_an_ending_or_a_real_word():
    s = glued_suggester()
    text, applied, left = s.fix("maravianer og sorvaner")
    assert text == "maravianer og sorvaner" and applied == []  # "ner" and "er": endings
    assert {h.blocked for h in left} == {"glued_affix"}
    assert s.fix("alting stille")[0] == "alting stille"  # ordinary words are never split
    assert s.fix("ogsa")[0] == "ogsa"  # too short to split


def test_glued_respects_upper_case():
    s = glued_suggester(aliases={"sorf": "Sorvan"})
    assert s.fix("SORFSER")[0] == "SORVAN SER"
