from __future__ import annotations

from narration.captions import build_cues, to_srt, to_vtt, youtube_chapters
from narration.check import cer, judge, length_problem, normalize, wer


def test_short_sentence_is_one_cue() -> None:
    cues = build_cues([(0.3, 1.5, "Velkommen tilbage.")])
    assert len(cues) == 1 and cues[0].text == "Velkommen tilbage."
    assert to_srt(cues) == "1\n00:00:00,300 --> 00:00:01,500\nVelkommen tilbage.\n"
    assert to_vtt(cues).startswith("WEBVTT\n\n00:00:00.300 --> 00:00:01.500\n")


def test_long_sentence_splits_into_cues_of_two_lines() -> None:
    text = (
        "When the party reaches the fortune teller's camp, open the Tarokka drawer in the "
        "dashboard and draw the cards one by one, slowly, so that everyone can see them."
    )
    cues = build_cues([(10.0, 20.0, text)])
    assert len(cues) >= 2
    assert cues[0].start == 10.0 and cues[-1].end == 20.0
    for a, b in zip(cues, cues[1:]):
        assert a.end == b.start
    for c in cues:
        lines = c.text.split("\n")
        assert len(lines) <= 2 and all(len(line) <= 42 for line in lines)
    assert " ".join(c.text.replace("\n", " ") for c in cues) == text


def test_hours_in_stamps_and_chapters() -> None:
    assert "01:02:03,450" in to_srt(build_cues([(3723.45, 3724.0, "x")]))
    assert youtube_chapters([(0.3, "Start"), (75.2, "Tarokka"), (3700, "End")]) == (
        "0:00 Start\n1:15 Tarokka\n1:01:40 End\n"
    )


def test_normalize_and_error_rates() -> None:
    assert normalize("Tarokka-skuffen, i DASHBOARDET!") == "tarokka skuffen i dashboardet"
    assert cer("scenekontrollerne", "scene kontrollerne") == 0.0
    assert wer("en to tre", "en to to tre") == 1 / 3
    assert cer("", "") == 0.0


def test_length_problem() -> None:
    assert length_problem("Velkommen tilbage.", 1.3) == ""
    assert "too long" in length_problem("Hej.", 9.0)
    assert "too short" in length_problem("En meget lang sætning med mange ord i sig.", 0.5)


def test_judge_uses_best_of_spoken_and_shown() -> None:
    v = judge("D og D fem e kører.", "dnd5e kører.", "dnd5e kører", 1.5)
    assert v.ok and v.cer == 0.0
    bad = judge("Åbn Foundry og indlæs verdenen.", "Åbn Foundry og indlæs verdenen.",
                "Åbn Foundry og og og og og indlæs indlæs", 2.5)
    assert not bad.ok and "CER" in bad.reason
    assert judge("Hej.", "Hej.", None, 0.6).ok  # no transcript: only the length is judged
