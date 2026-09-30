import json

from factory import mk_segment, mk_words

from session_pipeline.cli import main
from session_pipeline.timeline import run_pipeline
from session_pipeline.model import Track
from session_pipeline.names import NameRules


def dump_track(folder, name, speaker, segments):
    """Write a flat-format JSON the way the benchmark does (words at top level, key ``p``)."""
    segs = [
        {
            "start": s.start,
            "end": s.end,
            "text": " " + s.text,
            "no_speech_prob": s.no_speech_prob,
            "avg_logprob": s.avg_logprob,
            "compression_ratio": s.compression_ratio,
        }
        for s in segments
    ]
    words = [{"start": w.start, "end": w.end, "word": w.word, "p": w.probability} for s in segments for w in s.words]
    (folder / name).write_text(
        json.dumps({"speaker": speaker, "segments": segs, "words": words}, ensure_ascii=False),
        encoding="utf-8",
    )


def setup_session(tmp_path):
    src = tmp_path / "in"
    src.mkdir()
    dump_track(src, "S1__anna.json", "anna", [
        mk_segment(mk_words("Vi ser Strad ved døren.", start=3725.0)),
        mk_segment(mk_words("Thanks for watching", start=3800.0)),
    ])
    dump_track(src, "S1__bo.json", "bo", [mk_segment(mk_words("Okay, jeg er med.", start=3727.0))])
    (tmp_path / "speakers.json").write_text(
        json.dumps({"anna": {"player": "PlayerOne", "character": "Vera"}, "bo": {"player": "PlayerTwo", "character": "Gus"}}),
        encoding="utf-8",
    )
    (tmp_path / "vocab.txt").write_text("Strahd, Ireena\n", encoding="utf-8")
    (tmp_path / "rules.json").write_text(json.dumps({"Strahd": ["Strad"]}), encoding="utf-8")
    return src


def test_cli_writes_all_five_files(tmp_path, capsys):
    src = setup_session(tmp_path)
    out = tmp_path / "out"
    code = main(["merge", str(src), "--out", str(out), "--speakers", str(tmp_path / "speakers.json"),
                 "--vocab", str(tmp_path / "vocab.txt"), "--rules", str(tmp_path / "rules.json")])
    assert code == 0
    for name in ("timeline.jsonl", "timeline.md", "low_confidence.jsonl", "fixes.json", "dropped.jsonl"):
        assert (out / name).exists(), name
    md = (out / "timeline.md").read_text(encoding="utf-8").splitlines()
    assert md == [
        "[01:02:05] Vera [PlayerOne]: Vi ser Strahd ved døren.",
        "[01:02:07] Gus [PlayerTwo]: Okay, jeg er med.",
    ]
    rows = [json.loads(x) for x in (out / "timeline.jsonl").read_text(encoding="utf-8").splitlines()]
    assert rows[0]["speaker"] == "anna" and rows[0]["character"] == "Vera"
    assert {"start", "end", "speaker", "text", "words"} <= rows[0].keys()
    assert rows[0]["words"][0]["word"] == "Vi"
    dropped = [json.loads(x) for x in (out / "dropped.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [d["reason"] for d in dropped] == ["stock_caption"]
    fixes = json.loads((out / "fixes.json").read_text(encoding="utf-8"))
    assert fixes["applied"][0]["correct"] == "Strahd"
    assert "dropped: stock_caption 1" in capsys.readouterr().out


def test_cli_no_auto_fix_only_suggests(tmp_path):
    src = setup_session(tmp_path)
    out = tmp_path / "out"
    assert main(["merge", str(src), "--out", str(out), "--vocab", str(tmp_path / "vocab.txt"),
                 "--ordinary-min-count", "0", "--no-auto-fix"]) == 0
    text = (out / "timeline.md").read_text(encoding="utf-8")
    assert "Strad" in text and "Strahd" not in text
    fixes = json.loads((out / "fixes.json").read_text(encoding="utf-8"))
    assert fixes["applied"] == []
    assert [(s["heard"], s["suggested"]) for s in fixes["suggestions"]] == [("Strad", "Strahd")]
    assert "[01:02:05] anna [anna]:" in text  # no speakers.json: the track id stands in


def test_cli_glob_limits_the_files(tmp_path):
    src = setup_session(tmp_path)
    out = tmp_path / "out"
    assert main(["merge", str(src), "--out", str(out), "--glob", "S1__bo.json"]) == 0
    assert len((out / "timeline.md").read_text(encoding="utf-8").splitlines()) == 1


def test_cli_reports_missing_files(tmp_path, capsys):
    (tmp_path / "empty").mkdir()
    assert main(["merge", str(tmp_path / "empty"), "--out", str(tmp_path / "o")]) == 2
    assert "no files match" in capsys.readouterr().err


def test_low_confidence_sidecar_is_written(tmp_path):
    src = tmp_path / "in"
    src.mkdir()
    words = mk_words("Vi ser Strod nu.")
    words[2] = words[2].__class__(words[2].start, words[2].end, words[2].word, 0.2)
    dump_track(src, "x.json", "x", [mk_segment(words)])
    out = tmp_path / "out"
    assert main(["merge", str(src), "--out", str(out)]) == 0
    rows = [json.loads(x) for x in (out / "low_confidence.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [(r["speaker"], r["word"]) for r in rows] == [("x", "Strod")]


def test_run_pipeline_end_to_end_in_memory():
    a = Track("a", [mk_segment(mk_words("Strad står der.", start=1.0))])
    res = run_pipeline([a], rules=NameRules({"Strahd": ["Strad"]}))
    assert res.entries[0].text == "Strahd står der."
    assert res.entries[0].words[0].text == "Strad"  # words stay as heard


def test_cli_auto_fix_is_on_by_default_and_logged(tmp_path, capsys):
    src = setup_session(tmp_path)
    out = tmp_path / "out"
    assert main(["merge", str(src), "--out", str(out), "--vocab", str(tmp_path / "vocab.txt"),
                 "--speakers", str(tmp_path / "speakers.json"), "--ordinary-min-count", "0"]) == 0
    text = (out / "timeline.md").read_text(encoding="utf-8")
    assert "Vi ser Strahd ved døren." in text
    fixes = json.loads((out / "fixes.json").read_text(encoding="utf-8"))
    assert fixes["suggestions"] == []
    (fix,) = fixes["applied"]
    assert (fix["kind"], fix["before"], fix["after"], fix["speaker"], fix["time"]) == (
        "auto", "Strad", "Strahd", "anna", "01:02:05")
    assert fix["score"] >= 0.88 and fix["start"] == 3725.0
    assert fixes["summary"]["auto"] == 1
    assert "(1 automatic)" in capsys.readouterr().out


def test_cli_auto_fix_threshold_option(tmp_path):
    src = setup_session(tmp_path)
    out = tmp_path / "out"
    assert main(["merge", str(src), "--out", str(out), "--vocab", str(tmp_path / "vocab.txt"),
                 "--ordinary-min-count", "0", "--auto-fix-threshold", "0.95"]) == 0
    fixes = json.loads((out / "fixes.json").read_text(encoding="utf-8"))
    assert fixes["applied"] == []
    assert [(s["heard"], s["blocked"]) for s in fixes["suggestions"]] == [("Strad", "below_threshold")]
