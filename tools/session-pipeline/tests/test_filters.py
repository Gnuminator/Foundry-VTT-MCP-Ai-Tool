from factory import mk_segment, mk_track, mk_words, say

from session_pipeline.filters import FilterConfig, filter_track, parse_vocab

VOCAB = ["Strahd", "Ireena", "Castle Ravenloft", "Barovia", "Vasili"]


def run(track, vocab=(), cfg=None):
    return filter_track(track, cfg, vocab)


def reasons(result):
    return [d.reason for d in result.dropped]


def texts(result):
    return [s.text for s in result.track.segments]


def test_clean_segment_passes_untouched():
    r = run(say("a", "Vi går ind i huset nu."))
    assert texts(r) == ["Vi går ind i huset nu."]
    assert r.dropped == []


def test_drops_high_no_speech_probability():
    r = run(say("a", "Noget der ikke blev sagt", no_speech_prob=0.9))
    assert texts(r) == [] and reasons(r) == ["no_speech"]


def test_no_speech_at_threshold_is_kept():
    r = run(say("a", "Grænsetilfælde her", no_speech_prob=0.85))
    assert len(r.track.segments) == 1


def test_drops_high_compression_ratio():
    r = run(say("a", "blah blah blah", compression_ratio=2.6))
    assert reasons(r) == ["compression"]


def test_stock_caption_danish_and_english():
    for phrase in ("Undertekster af Nicolai Winther", "Tekstet af Hanne", "Thanks for watching!", "Subtitles by the Amara.org community"):
        r = run(say("a", phrase))
        assert reasons(r) == ["stock_caption"], phrase


def test_stock_phrase_inside_a_long_real_sentence_is_kept():
    text = "Jeg sagde til ham at han skulle tage en tekst af bogen og læse den højt for os alle sammen nu"
    r = run(say("a", text))
    assert reasons(r) == []


def test_character_loop_inside_a_word_is_collapsed():
    r = run(say("a", "Det var sjovt hahahahahaha ja."))
    assert texts(r) == ["Det var sjovt ha ja."]
    assert "loop_chars" in reasons(r)


def test_word_loop_is_collapsed_to_one_copy():
    r = run(say("a", "Og så sagde han nej nej nej nej nej og gik."))
    assert texts(r) == ["Og så sagde han nej og gik."]
    assert "loop_words" in reasons(r)


def test_two_repeats_are_natural_and_kept():
    r = run(say("a", "Nej nej det gør vi ikke."))
    assert texts(r) == ["Nej nej det gør vi ikke."]


def test_phrase_loop_with_several_words():
    r = run(
        say("a", "Vi skal videre vi skal videre vi skal videre vi skal videre vi skal videre nu.")
    )
    assert texts(r) == ["Vi skal videre nu."]


def test_four_repeats_are_kept_because_real_speech_repeats():
    r = run(say("a", "nej nej nej nej"))
    assert texts(r) == ["nej nej nej nej"]


def test_same_sentence_three_times_in_a_row_is_collapsed():
    r = run(say("a", "Jeg er her nu. Jeg er her nu. Jeg er her nu. Så går vi."))
    assert texts(r) == ["Jeg er her nu. Så går vi."]
    assert "loop_sentence" in reasons(r)


def test_same_sentence_twice_is_kept():
    r = run(say("a", "Jeg er her nu. Jeg er her nu. Så går vi."))
    assert len(texts(r)[0].split()) == 11


def test_identical_segments_three_in_a_row_keep_the_first():
    segs = [mk_segment(mk_words("Tak for nu", start=i * 3.0)) for i in range(4)]
    r = run(mk_track("a", *segs))
    assert len(r.track.segments) == 1
    assert reasons(r).count("loop_segment") == 3


def test_identical_segments_twice_are_kept():
    segs = [mk_segment(mk_words("Tak for nu", start=i * 3.0)) for i in range(2)]
    assert len(run(mk_track("a", *segs)).track.segments) == 2


def test_recited_vocabulary_list_is_dropped():
    r = run(say("a", "Strahd, Ireena, Castle Ravenloft, Barovia."), VOCAB)
    assert reasons(r) == ["recited_vocab"]


def test_vocabulary_list_with_glue_word_is_dropped():
    r = run(say("a", "Strahd Ireena og Vasili"), VOCAB)
    assert reasons(r) == ["recited_vocab"]


def test_single_name_and_normal_sentence_with_names_are_kept():
    assert run(say("a", "Strahd."), VOCAB).dropped == []
    assert run(say("a", "Vi skal møde Strahd og Ireena i morgen."), VOCAB).dropped == []
    assert run(say("a", "Strahd Ireena"), VOCAB).dropped == []  # two terms is speech


def test_one_name_repeated_four_times_is_dropped():
    r = run(say("a", "Strahd Strahd Strahd Strahd"), VOCAB)
    assert reasons(r) == ["recited_vocab"]


def test_name_repeated_inside_a_mostly_name_segment_is_dropped():
    r = run(say("a", "Ireena Ireena Ireena Ireena hvad"), VOCAB)
    assert reasons(r) == ["recited_vocab"]


def test_no_vocabulary_means_no_recitation_rule():
    assert run(say("a", "Strahd, Ireena, Barovia, Vasili")).dropped == []


def test_short_segment_is_dropped():
    track = mk_track("a", mk_segment(mk_words("ja", dur=0.08)))
    r = run(track)
    assert reasons(r) == ["too_short"] and r.track.segments == []


def test_short_word_inside_a_longer_segment_is_dropped_but_rest_kept():
    words = mk_words("Vi går nu") + mk_words("ehm", start=2.0, dur=0.1)
    r = run(mk_track("a", mk_segment(words)), cfg=FilterConfig(min_word_s=0.2))
    assert texts(r) == ["Vi går nu"]
    assert "too_short_word" in reasons(r)


def test_short_words_are_kept_by_default_because_real_speech_has_many():
    words = mk_words("og i at", dur=0.1) + mk_words("det er fint", start=2.0)
    r = run(mk_track("a", mk_segment(words)))
    assert texts(r) == ["og i at det er fint"]


def test_low_confidence_words_go_to_the_sidecar_and_stay_in_the_text():
    words = mk_words("Vi møder Strod nu")
    words[2] = words[2].__class__(words[2].start, words[2].end, words[2].word, 0.3)
    r = run(mk_track("a", mk_segment(words)))
    assert texts(r) == ["Vi møder Strod nu"]
    assert [(w.word.strip(), w.speaker) for w in r.low_confidence] == [("Strod", "a")]
    assert r.low_confidence[0].start == words[2].start


def test_thresholds_come_from_the_config():
    cfg = FilterConfig(max_no_speech_prob=0.5)
    assert reasons(run(say("a", "Halv sikker tale", no_speech_prob=0.6), cfg=cfg)) == ["no_speech"]


def test_dropped_record_keeps_text_and_time():
    r = run(say("a", "Thanks for watching", start=12.0))
    d = r.dropped[0].to_dict()
    assert d["speaker"] == "a" and d["start"] == 12.0 and d["text"] == "Thanks for watching"


def test_parse_vocab_handles_commas_lines_headings_and_comments():
    text = "# comment\n=== NPCs ===\nStrahd, Ireena\nCastle Ravenloft\n\nStrahd\n"
    assert parse_vocab(text) == ["Strahd", "Ireena", "Castle Ravenloft"]
