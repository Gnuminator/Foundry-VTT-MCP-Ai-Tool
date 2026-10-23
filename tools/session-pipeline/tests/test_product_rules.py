"""The shipped fixes for the tool's own names (2026-10-23 David recording mis-hearings)."""

from session_pipeline.names import merge_rules, parse_rules, product_rules


def fix(text: str, session: dict[str, list[str]] | None = None) -> str:
    rules = parse_rules(merge_rules(session or {}, product_rules()))
    return rules.apply(text)[0]


def test_heard_product_names_are_corrected() -> None:
    assert fix("Jeg er inde i KGM nu") == "Jeg er inde i co-GM nu"
    assert fix("Cursive Strut, campaign") == "Cursive Strahd, campaign"
    assert fix("det er lavet til Danny") == "det er lavet til Danni"
    assert fix("det er som at have Poundry åben") == "det er som at have Foundry åben"
    assert fix("KGM'et logger alt") == "co-GM'et logger alt"


def test_other_words_and_host_names_are_left_alone() -> None:
    assert fix("Strutter og Dannys bil") == "Strutter og Dannys bil"
    assert fix("på kgm.example.com") == "på kgm.example.com"


def test_all_caps_and_host_name_guards_in_the_rule_matcher() -> None:
    assert parse_rules({"Sorvan": ["sorva"]}).apply("SORVA ser")[0] == "SORVAN ser"
    assert parse_rules({"D'Arcy": ["darcy"]}).apply("DARCY og darcy")[0] == "D'Arcy og D'Arcy"
    assert parse_rules({"Sorvan": ["sorva"]}).apply("sorva.example.com")[0] == "sorva.example.com"


def test_a_session_rule_wins_over_the_shipped_one() -> None:
    assert fix("Danny kommer", {"Dannie": ["Danny"]}) == "Dannie kommer"
