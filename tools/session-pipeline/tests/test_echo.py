from factory import mk_words

from session_pipeline.echo import EchoConfig, filter_echo, levels_from_tracks
from session_pipeline.merge import Line


def line(speaker, text, start):
    return Line(speaker, tuple(mk_words(text, start=start)))


ORIGINAL = "Jeg åbner døren og kigger ind nu."
LEVELS = levels_from_tracks({"A": -20.0, "B": -40.0, "C": -21.0})


def test_quieter_later_copy_on_another_track_is_dropped():
    kept, dropped = filter_echo([line("A", ORIGINAL, 10.0), line("B", ORIGINAL, 10.6)], level_of=LEVELS)
    assert [k.speaker for k in kept] == ["A"]
    assert dropped[0].reason == "echo" and dropped[0].speaker == "B"


def test_similar_but_not_identical_text_still_matches():
    kept, dropped = filter_echo(
        [line("A", ORIGINAL, 10.0), line("B", "Jeg åbner døren og kigger ind nu", 10.5)],
        level_of=LEVELS,
    )
    assert len(dropped) == 1


def test_the_louder_track_is_never_dropped():
    kept, dropped = filter_echo([line("B", ORIGINAL, 10.0), line("A", ORIGINAL, 10.6)], level_of=LEVELS)
    assert dropped == [] and len(kept) == 2
    assert not any(k.echo_suspect for k in kept)


def test_similar_levels_are_both_kept_unflagged():
    kept, dropped = filter_echo([line("A", ORIGINAL, 10.0), line("C", ORIGINAL, 10.6)], level_of=LEVELS)
    assert dropped == [] and not any(k.echo_suspect for k in kept)


def test_without_levels_the_later_line_is_kept_and_flagged():
    kept, dropped = filter_echo([line("A", ORIGINAL, 10.0), line("B", ORIGINAL, 10.6)])
    assert dropped == []
    assert [(k.speaker, k.echo_suspect) for k in kept] == [("A", False), ("B", True)]


def test_unknown_level_for_a_track_flags_instead_of_dropping():
    kept, dropped = filter_echo(
        [line("A", ORIGINAL, 10.0), line("Z", ORIGINAL, 10.6)], level_of=LEVELS
    )
    assert dropped == [] and kept[1].echo_suspect


def test_copy_started_more_than_the_window_later_is_not_an_echo():
    kept, dropped = filter_echo([line("A", ORIGINAL, 10.0), line("B", ORIGINAL, 12.0)], level_of=LEVELS)
    assert dropped == [] and len(kept) == 2


def test_same_speaker_repetition_is_not_an_echo():
    kept, dropped = filter_echo([line("A", ORIGINAL, 10.0), line("A", ORIGINAL, 10.6)], level_of=LEVELS)
    assert dropped == [] and len(kept) == 2


def test_different_text_is_not_an_echo():
    kept, dropped = filter_echo(
        [line("A", ORIGINAL, 10.0), line("B", "Hvad er der i rummet derinde?", 10.5)], level_of=LEVELS
    )
    assert dropped == []


def test_very_short_lines_are_ignored():
    kept, dropped = filter_echo([line("A", "Ja.", 10.0), line("B", "Ja.", 10.3)], level_of=LEVELS)
    assert dropped == [] and not any(k.echo_suspect for k in kept)


def test_config_changes_the_window():
    cfg = EchoConfig(window_s=3.0)
    kept, dropped = filter_echo([line("A", ORIGINAL, 10.0), line("B", ORIGINAL, 12.0)], cfg, LEVELS)
    assert len(dropped) == 1
