"""Auto-fix of confident near-name hits. Synthetic names only."""

import pytest

from session_pipeline.names import NameSuggester
from session_pipeline.wordlists import all_ordinary_words, ordinary_words, parse_wordlist

NAMES = ["Handell", "Morwenna Frostvale", "Vryn Talmor", "Talindor", "Brakk Stone-Oath"]


def fixer(**kw):
    return NameSuggester(NAMES, **kw)


def test_auto_fix_rewrites_a_confident_near_miss():
    text, applied, left = fixer().fix("vi møder Talindar ved døren")
    assert text == "vi møder Talindor ved døren"
    assert [(a.heard, a.replacement) for a in applied] == [("Talindar", "Talindor")]
    assert left == []


def test_handel_is_never_turned_into_a_name():
    # Regression: the Danish word "handel" (trade) looks like the name "Handell". With a loose
    # cutoff it is a hit; only the ordinary-word list keeps it from being rewritten.
    assert "handel" in ordinary_words("da")
    loose = {"cutoff": 0.8, "auto_threshold": 0.8}
    text, applied, left = NameSuggester(["Handell"], **loose).fix("der er meget handel i byen")
    assert text == "der er meget handel i byen" and applied == []
    assert [(x.heard, x.suggested, x.blocked) for x in left] == [("handel", "Handell", "ordinary_word")]
    # without the lists the same hit would be applied: the guard is what stops it
    text, applied, _ = NameSuggester(["Handell"], block_words=(), **loose).fix("der er meget handel")
    assert text == "der er meget Handell" and len(applied) == 1


def test_ordinary_word_guard_covers_danish_and_english():
    assert {"handel", "andel", "streng"} <= ordinary_words("da")
    assert {"handle", "strength"} <= ordinary_words("en")
    _, applied, left = NameSuggester(["Strengt"]).fix("strength")
    assert applied == [] and [x.blocked for x in left] == ["ordinary_word"]


def test_session_frequent_words_are_never_fixed_or_suggested():
    s = fixer(ordinary_words={"talindar"})
    assert s.fix("Talindar") == ("Talindar", [], [])


def test_below_threshold_stays_a_suggestion():
    text, applied, left = fixer(auto_threshold=0.95).fix("Talindar")
    assert text == "Talindar" and applied == []
    assert [(x.heard, x.blocked) for x in left] == [("Talindar", "below_threshold")]


def test_words_under_four_letters_are_not_fixed():
    s = NameSuggester(["Leah"], block_words=())
    assert s.fix("Lea") == ("Lea", [], [])


def test_one_part_of_a_multiword_name_is_replaced_by_that_part_only():
    text, applied, _ = fixer().fix("Morwena kommer")
    assert text == "Morwenna kommer"
    assert applied[0].suggested == "Morwenna Frostvale"


def test_multiword_hit_replaces_the_whole_phrase_and_no_neighbour():
    assert fixer().fix("mod Vrin Talmor nu")[0] == "mod Vryn Talmor nu"


def test_two_equally_close_names_are_ambiguous():
    s = NameSuggester(["Garrixon", "Garrixor"], block_words=())
    text, applied, left = s.fix("Garrixox")
    assert text == "Garrixox" and applied == []
    assert left[0].blocked == "ambiguous"


def test_trailing_s_is_kept():
    s = fixer()
    assert s.fix("Talindars plan")[0] == "Talindors plan"
    assert s.fix("Handells skjold") == ("Handells skjold", [], [])  # already right: no change, no hit
    _, applied, left = s.fix("andels")  # the ordinary word "andel" plus s
    assert applied == [] and all(x.blocked == "ordinary_word" for x in left)


def test_apply_false_changes_nothing():
    text, applied, left = fixer().fix("Talindar", apply=False)
    assert text == "Talindar" and applied == [] and [x.heard for x in left] == ["Talindar"]


def test_all_caps_stays_all_caps_and_spans_are_exact():
    text, applied, _ = fixer().fix("Nej! TALINDAR, ja.")
    assert text == "Nej! TALINDOR, ja."
    assert "Nej! TALINDAR, ja."[applied[0].start : applied[0].end] == "TALINDAR"


def test_several_fixes_in_one_line_keep_positions_right():
    text, applied, _ = fixer().fix("Talindar og Morwena og Talindar")
    assert text == "Talindor og Morwenna og Talindor"
    assert len(applied) == 3


def test_name_tokens_are_not_blocked_even_if_they_are_ordinary_words():
    s = NameSuggester(["Castle Ravenloft"], block_words={"castle"})
    assert "castle" not in s.block
    assert s.fix("Castle Ravenlofd")[0] == "Castle Ravenloft"
    t = NameSuggester(["Castle Ravenloft"], block_words={"ravenlofd"})
    assert t.fix("Ravenlofd")[2][0].blocked == "ordinary_word"


def test_blocked_reason_is_written_to_the_suggestion_dict():
    (hit,) = fixer(auto_threshold=0.95).suggest("Talindar")
    assert hit.to_dict()["blocked"] == "below_threshold"
    (ok,) = fixer().suggest("Talindar")
    assert "blocked" not in ok.to_dict()


def test_wordlists_load_and_parse():
    assert parse_wordlist("# c\nHej\n\nDag\n") == {"hej", "dag"}
    assert len(ordinary_words("da")) > 25000 and len(ordinary_words("en")) > 9000
    assert {"ikke", "handel", "strength"} <= all_ordinary_words()
    assert all(len(w) >= 4 for w in ordinary_words("da"))
    with pytest.raises(ValueError):
        ordinary_words("xx")
