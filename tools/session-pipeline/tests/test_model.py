import json

import pytest

from session_pipeline.model import (
    InputError,
    load_track,
    parse_track,
    synthesize_words,
    track_id_from_name,
)


def seg(start, end, text, **kw):
    return {"start": start, "end": end, "text": text, "no_speech_prob": 0.1, **kw}


def test_flat_words_are_attached_by_time_and_p_key_is_read():
    data = {
        "segments": [seg(0.0, 2.0, " Hej med dig."), seg(5.0, 7.0, " Godt at se dig.")],
        "words": [
            {"start": 0.0, "end": 0.5, "word": " Hej", "p": 0.9},
            {"start": 0.6, "end": 1.0, "word": " med", "p": 0.8},
            {"start": 1.1, "end": 1.9, "word": " dig.", "p": 0.7},
            {"start": 5.1, "end": 5.5, "word": " Godt", "p": 0.6},
            {"start": 5.6, "end": 6.0, "word": " at", "p": 0.6},
        ],
    }
    t = parse_track(data, "anna")
    assert [len(s.words) for s in t.segments] == [3, 2]
    assert t.segments[0].words[0].probability == 0.9
    assert t.segments[0].text == "Hej med dig."


def test_nested_words_with_probability_key():
    data = {
        "segments": [
            {**seg(0, 1, "Ja"), "words": [{"start": 0, "end": 0.4, "word": " Ja", "probability": 0.5}]}
        ]
    }
    t = parse_track(data, "x")
    assert t.segments[0].words[0].probability == 0.5
    assert not t.segments[0].synthetic_words


def test_word_in_a_gap_goes_to_the_nearest_segment():
    data = {
        "segments": [seg(0.0, 1.0, "a"), seg(10.0, 11.0, "b")],
        "words": [
            {"start": 1.5, "end": 1.7, "word": " a", "p": 1},
            {"start": 9.0, "end": 9.4, "word": " b", "p": 1},
        ],
    }
    t = parse_track(data, "x")
    assert [len(s.words) for s in t.segments] == [1, 1]


def test_missing_words_are_synthesised_across_the_segment():
    data = {"segments": [seg(10.0, 12.0, " ett to tre")]}
    t = parse_track(data, "x")
    s = t.segments[0]
    assert s.synthetic_words
    assert s.words[0].start == 10.0 and s.words[-1].end == 12.0
    assert [w.text for w in s.words] == ["ett", "to", "tre"]


def test_synthesize_empty_text():
    assert synthesize_words(0, 1, "   ") == ()


def test_missing_segments_is_an_error():
    with pytest.raises(InputError):
        parse_track({"words": []}, "x")


def test_speaker_is_required():
    with pytest.raises(InputError):
        parse_track({"segments": []})


def test_bad_number_is_an_error():
    with pytest.raises(InputError):
        parse_track({"segments": [{"start": "abc", "end": 1, "text": "x"}]}, "x")


def test_track_id_from_name():
    assert track_id_from_name("S1__gnuminator.json") == "gnuminator"
    assert track_id_from_name("anna.json") == "anna"


def test_load_track_reads_a_file(tmp_path):
    p = tmp_path / "S1__anna.json"
    p.write_text(json.dumps({"segments": [seg(0, 1, "Hej")], "words": []}), encoding="utf-8")
    assert load_track(p).speaker == "anna"


def test_load_track_reports_bad_json_with_file_name(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{nope", encoding="utf-8")
    with pytest.raises(InputError, match="bad.json"):
        load_track(p)
