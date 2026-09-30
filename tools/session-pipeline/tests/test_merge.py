from factory import mk_segment, mk_track, mk_words, say

from session_pipeline.merge import (
    Line,
    MergeConfig,
    collapse_adjacent,
    fix_out_of_sync,
    interleave,
    merge_tracks,
    split_at_gaps,
)


def summary(lines):
    return [(ln.speaker, ln.text) for ln in lines]


def test_crosstalk_keeps_each_speakers_clause_intact():
    a = say("A", "Jeg går hen til døren og åbner den.", start=0.0)
    b = say("B", "Ja!", start=1.0)
    lines = interleave([a, b])
    assert summary(lines) == [("B", "Ja!"), ("A", "Jeg går hen til døren og åbner den.")]


def test_speaker_switch_at_terminal_punctuation():
    a = mk_track("A", mk_segment(mk_words("Først siger jeg dette.") + mk_words("Så siger jeg hint.", start=2.6)))
    b = say("B", "Okay det er fint.", start=1.0)
    lines = merge_tracks([a, b])
    assert [ln.speaker for ln in lines] == ["A", "B", "A"]
    assert lines[1].text == "Okay det er fint."


def test_word_gap_closes_a_clause_without_punctuation():
    words = mk_words("vi går ind", start=0.0) + mk_words("så ser vi noget", start=3.0)
    lines = interleave([mk_track("A", mk_segment(words))])
    assert summary(lines) == [("A", "vi går ind"), ("A", "så ser vi noget")]


def test_gap_just_under_threshold_keeps_the_clause_together():
    words = mk_words("vi går", dur=0.4, gap=0.1) + mk_words("ind nu", start=1.3)  # gap 0.4 s
    assert len(interleave([mk_track("A", mk_segment(words))])) == 1


def test_quiet_buffer_of_other_speaker_is_closed_in_time_order():
    a = say("A", "kort tanke uden punktum", start=0.0)  # ends about 2.0, no punctuation
    b = say("B", "Noget længe efter.", start=6.0)
    assert [ln.speaker for ln in interleave([a, b])] == ["A", "B"]


def test_force_close_splits_a_long_buffer_at_its_largest_gap():
    text = " ".join(f"ord{i}" for i in range(30))
    words = mk_words(text, dur=0.4, gap=0.1, gaps={15: 0.5})  # one 0.6 s pause, all others 0.1 s
    lines = interleave([mk_track("A", mk_segment(words))])
    assert len(lines) >= 2
    assert lines[0].words[-1].text == "ord14"
    assert lines[1].words[0].text == "ord15"
    assert all(ln.end - ln.start <= 9.0 + 0.5 for ln in lines)


def test_force_close_is_undone_by_collapse_when_nobody_interrupts():
    text = " ".join(f"ord{i}" for i in range(30))
    words = mk_words(text, gaps={15: 0.5})
    lines = merge_tracks([mk_track("A", mk_segment(words))])
    assert len(lines) == 1 and len(lines[0].words) == 30


def test_force_close_lets_the_other_speaker_in():
    text = " ".join(f"ord{i}" for i in range(30))
    a = mk_track("A", mk_segment(mk_words(text, gaps={15: 0.5})))
    b = say("B", "Vent lige!", start=8.2)
    order = [ln.speaker for ln in merge_tracks([a, b])]
    assert order == ["A", "B", "A"]


def test_out_of_sync_line_is_resplit_and_placed_by_time():
    late = Line("B", tuple(mk_words("Senere kommentar.", start=20.0)))
    long_a = Line(
        "A",
        tuple(mk_words("først her", start=10.0) + mk_words("så her", start=14.0)),
    )
    out = fix_out_of_sync([late, long_a])
    assert [ln.speaker for ln in out] == ["A", "A", "B"]
    assert [ln.text for ln in out[:2]] == ["først her", "så her"]


def test_line_within_five_seconds_is_not_touched():
    first = Line("B", tuple(mk_words("Kommentar.", start=13.0)))
    second = Line("A", tuple(mk_words("lang sætning", start=10.0)))
    assert fix_out_of_sync([first, second]) == [first, second]


def test_split_at_gaps_falls_back_to_largest_gap():
    line = Line("A", tuple(mk_words("a b c d", gaps={2: 0.15})))
    parts = split_at_gaps(line, gap_s=0.3)
    assert [p.text for p in parts] == ["a b", "c d"]


def test_adjacent_same_speaker_lines_are_collapsed():
    l1 = Line("A", tuple(mk_words("første del.", start=0.0)))
    l2 = Line("A", tuple(mk_words("anden del.", start=2.0)))
    assert summary(collapse_adjacent([l1, l2])) == [("A", "første del. anden del.")]


def test_four_second_gap_starts_a_new_line():
    l1 = Line("A", tuple(mk_words("første del.", start=0.0)))
    l2 = Line("A", tuple(mk_words("anden del.", start=10.0)))
    assert len(collapse_adjacent([l1, l2])) == 2


def test_interjection_between_same_speaker_lines_prevents_collapse():
    l1 = Line("A", tuple(mk_words("første del.", start=0.0)))
    mid = Line("B", tuple(mk_words("mm.", start=1.0)))
    l2 = Line("A", tuple(mk_words("anden del.", start=2.0)))
    assert len(collapse_adjacent([l1, mid, l2])) == 3


def test_thresholds_are_configurable():
    words = mk_words("vi går ind", start=0.0) + mk_words("så ser vi", start=2.2)  # 0.8 s+ gap
    cfg = MergeConfig(clause_gap_s=2.0)
    assert len(interleave([mk_track("A", mk_segment(words))], cfg)) == 1


def test_sort_is_by_start_then_speaker():
    a = say("B", "samme start.", start=1.0)
    b = say("A", "samme start.", start=1.0)
    assert [ln.speaker for ln in interleave([a, b])] == ["A", "B"]


def test_collapse_never_builds_a_line_longer_than_the_cap():
    lines = [Line("A", tuple(mk_words("ord ord ord ord.", start=i * 2.0))) for i in range(40)]
    merged = collapse_adjacent(lines, MergeConfig(max_line_s=30.0))
    assert len(merged) > 1
    assert all(ln.end - ln.start <= 30.0 for ln in merged)
    assert sum(len(ln.words) for ln in merged) == 160
