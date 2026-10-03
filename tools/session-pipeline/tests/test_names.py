import pytest

from session_pipeline.names import (
    NameRules,
    NameSuggester,
    ordinary_from_frequency,
    parse_rules,
)

RULES = NameRules({"Strahd": ["Strad", "Strod"], "Dagny": ["Dag"], "Castle Ravenloft": ["Castle Ravenlof"]})


def fixed(text):
    return RULES.apply(text)[0]


def test_whole_word_only_dag_does_not_touch_dagstorp():
    assert fixed("Dag kom til Dagstorp") == "Dagny kom til Dagstorp"


def test_word_inside_a_longer_word_is_untouched_on_both_sides():
    assert fixed("Ydag og Dagen og Stradivari") == "Ydag og Dagen og Stradivari"


def test_hyphenated_compounds_are_one_word():
    assert fixed("Dag-og-nat og en-Dag") == "Dag-og-nat og en-Dag"


def test_possessive_and_punctuation_still_match():
    assert fixed("Strad's slot. Strad, hør!") == "Strahd's slot. Strahd, hør!"


def test_case_style_is_preserved():
    assert fixed("strad") == "strahd"
    assert fixed("Strad") == "Strahd"
    assert fixed("STRAD") == "STRAHD"


def test_multiword_wrong_spelling():
    assert fixed("ved castle   ravenlof nu") == "ved castle ravenloft nu"
    assert fixed("Castle Ravenlof") == "Castle Ravenloft"


def test_canonical_mixed_case_is_kept():
    r = NameRules({"D'Arcy": ["darcy"]})
    assert r.apply("hej darcy")[0] == "hej D'Arcy"


def test_fixes_are_reported_with_counts():
    _, fixes = RULES.apply("Strad og Strad og Strod")
    by = {(f.wrong, f.heard): f.count for f in fixes}
    assert by == {("strad", "Strad"): 2, ("strod", "Strod"): 1}
    assert all(f.correct == "Strahd" for f in fixes)


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
    assert NameRules({"Strahd": ["strahd"]}).apply("Strahd") == ("Strahd", [])


def test_parse_rules_validates_shape():
    assert parse_rules({"A": ["b"]}).apply("B")[0] == "A"
    with pytest.raises(ValueError):
        parse_rules({"A": "b"})


KNOWN = ["Strahd", "Ireena", "Barovia", "Castle Ravenloft"]
ORDINARY = {"kommer", "til", "og", "ind", "slottet"}


def test_suggester_suggests_but_never_changes_text():
    s = NameSuggester(KNOWN, ORDINARY)
    text = "Strad kommer til Barovja"
    out = s.suggest(text)
    assert {(x.heard, x.suggested) for x in out} == {("Strad", "Strahd"), ("Barovja", "Barovia")}
    assert text == "Strad kommer til Barovja"


def test_suggester_skips_ordinary_words():
    s = NameSuggester(KNOWN, ORDINARY | {"strad"})
    assert s.suggest("Strad kommer") == []


def test_suggester_skips_exact_known_names_and_short_words():
    s = NameSuggester(KNOWN, ORDINARY)
    assert s.suggest("Strahd og Ireena ind") == []


def test_suggester_respects_the_cutoff():
    s = NameSuggester(KNOWN, ORDINARY, cutoff=0.95)
    assert s.suggest("Strad") == []


def test_suggester_matches_multiword_names():
    s = NameSuggester(KNOWN, ORDINARY)
    out = s.suggest("ved Castle Ravenlofd nu")
    assert any(x.suggested == "Castle Ravenloft" for x in out)


def test_suggester_matches_one_part_of_a_multiword_name():
    s = NameSuggester(KNOWN, ORDINARY)
    assert [x.suggested for x in s.suggest("Ravenlofd")] == ["Castle Ravenloft"]


def test_known_name_tokens_are_never_ordinary():
    s = NameSuggester(KNOWN, {"strahd"})
    assert "strahd" not in s.ordinary


def test_ordinary_from_frequency():
    words = ordinary_from_frequency(["vi går ind", "vi går ud", "vi går hjem", "Strad"], min_count=3)
    assert words == {"vi", "går"}


def test_suggester_reports_a_repeated_misheard_word_once_per_text():
    s = NameSuggester(KNOWN, ORDINARY)
    assert len(s.suggest("Strad og Strad")) == 1


def test_short_parts_of_multiword_names_are_not_matched_alone():
    s = NameSuggester(["Mage Hand"], set())
    assert s.suggest("mange") == []


# Glued names: the recogniser writes a name and its neighbour as one word.


def glued_suggester(**kw):
    return NameSuggester(
        ["Strahd", "Ireena Kolyana", "Barovia", "Vallaki"],
        block_words={"siger", "stille", "alting"},
        **kw,
    )


def test_glued_name_with_a_rule_spelling_is_fixed():
    s = glued_suggester(aliases={"strat": "Strahd"})
    text, applied, left = s.fix("og så stratser han ud af vinduet")
    assert text == "og så Strahd ser han ud af vinduet"
    assert [a.suggested for a in applied] == ["Strahd"] and left == []


def test_glued_exact_name_both_orders():
    s = glued_suggester()
    assert s.fix("strahdsiger nej")[0] == "Strahd siger nej"
    assert s.fix("ogvallaki brænder")[0] == "og Vallaki brænder"
    assert s.fix("Ireenahar ret")[0] == "Ireena har ret"  # part of a multi-word name


def test_glued_fuzzy_name_is_only_suggested():
    s = glued_suggester()
    text, applied, left = s.fix("stradser er her")
    assert text == "stradser er her" and applied == []
    assert left[0].replacement == "Strad ser" or left[0].suggested == "Strahd"
    assert left[0].blocked == "glued"


def test_glued_never_splits_an_ending_or_a_real_word():
    s = glued_suggester()
    text, applied, left = s.fix("barovianer og strahder")
    assert text == "barovianer og strahder" and applied == []  # "ner" and "er": endings
    assert {h.blocked for h in left} == {"glued_affix"}
    assert s.fix("alting stille")[0] == "alting stille"  # ordinary words are never split
    assert s.fix("ogsa")[0] == "ogsa"  # too short to split


def test_glued_respects_upper_case():
    s = glued_suggester(aliases={"strat": "Strahd"})
    assert s.fix("STRATSER")[0] == "STRAHD SER"
