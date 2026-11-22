"""The names and facts to check page: list builder, answer parser and the rewrite."""

from __future__ import annotations

import json
from pathlib import Path

from helpers import FakeClaude
from session_notes import check
from session_notes.model import Line
from session_notes.run import Options, Writer


def _timeline(tmp: Path, rows: list[list[tuple[str, float]]]) -> Path:
    """rows: per line a list of (word, probability). Speaker 'anna'."""
    tl = tmp / "timeline"
    tl.mkdir(parents=True)
    with (tl / "timeline.jsonl").open("w", encoding="utf-8") as fh:
        for i, words in enumerate(rows):
            fh.write(
                json.dumps(
                    {
                        "start": i * 10.0,
                        "end": i * 10.0 + 5,
                        "speaker": "anna",
                        "player": "Ilvara (Anna)",
                        "character": "Ilvara (Anna)",
                        "text": " ".join(w for w, _ in words),
                        "words": [
                            {"start": i * 10.0 + k, "end": i * 10.0 + k + 1, "word": w, "probability": p}
                            for k, (w, p) in enumerate(words)
                        ],
                    }
                )
                + "\n"
            )
    return tmp


ROWS = [
    [("Vi", 0.9), ("mødte", 0.9), ("Botte", 0.3), ("i", 0.9), ("går.", 0.9)],
    [("Så", 0.9), ("sagde", 0.9), ("Bote,", 0.2), ("det", 0.4), ("Botte", 0.4)],
    [("Det", 0.3), ("er", 0.9), ("Vesperhult", 0.1), ("nu.", 0.9)],
    [("Jeg", 0.2), ("tror", 0.9), ("Vesperholt", 0.45), ("kommer.", 0.9)],
    [("Hej", 0.9), ("Barnon", 0.2)],  # a confirmed name: nothing to check
]


def _session(tmp_path: Path) -> Path:
    session = _timeline(tmp_path, ROWS)
    (session / "names.txt").write_text("Barnon\nVesperholt\n", encoding="utf-8")
    return session


def _answer(session: Path, lang: str, heading: str, text: str) -> None:
    """Fill in the first `Answer:` (or `Svar:`) after a heading, as a person would."""
    path = check.page_path(session, lang)
    out, inside, done = [], False, False
    label = "Answer:" if lang == "en" else "Svar:"
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("### "):
            inside = line == f"### {heading}"
        if inside and not done and line.rstrip() == label:
            line, done = f"{label} {text}", True
        out.append(line)
    assert done, f"no empty answer under {heading}"
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


def test_list_merges_variants_and_skips_ordinary_words_and_known_names(tmp_path: Path) -> None:
    session = _session(tmp_path)
    entries = check.merge_heard(check.raw_heard(session))
    keys = [e.key for e in entries]
    assert keys == ["Botte", "Vesperhult"]
    botte = entries[0]
    assert botte.count == 3 and set(botte.variants) == {"Botte", "Bote"}
    assert "Det" not in keys and "Jeg" not in keys and "Barnon" not in keys


def test_page_has_links_counts_and_a_suggestion_from_names(tmp_path: Path) -> None:
    session = _session(tmp_path)
    report = check.sync(session)
    page = check.page_path(session, "en").read_text(encoding="utf-8")
    assert report.entries == 2
    assert "### Vesperhult" in page and "Suggestion: Vesperholt" in page
    assert "Heard 3 time(s), also as: Bote" in page
    assert "[[transcript.en#^u000001|00:00:02]]" in page
    assert "[[transcript.da#^u000001|00:00:02]]" in check.page_path(session, "da").read_text(encoding="utf-8")


def test_parse_answer_forms() -> None:
    entry = check.Entry(kind="name", key="Botte", variants=["Botte", "Bote"], wrongs=["Botte", "Bote"])
    assert check.parse_answer("", entry) is None
    assert check.parse_answer("  ", entry) is None
    assert check.parse_answer("not a name", entry).kind == "not-name"
    assert check.parse_answer("Ikke et navn", entry).kind == "not-name"
    same = check.parse_answer("same as [[Barnon]]", entry)
    assert (same.kind, same.correct, same.wrongs) == ("same", "Barnon", ["Botte", "Bote"])
    assert check.parse_answer("samme som Barnon", entry).correct == "Barnon"
    spelled = check.parse_answer("**Barnon**", entry)
    assert (spelled.kind, spelled.correct) == ("spelling", "Barnon")
    assert check.parse_answer("ok", entry).correct == "Botte"  # the heard spelling is right


def test_parse_page_reads_answers_by_heading() -> None:
    text = "## Names\n<!-- names -->\n### Botte\nHeard 3\nAnswer: Barnon\n\n### Vesperhult\nAnswer:\n\n### Fact\nSvar: ok\n"
    assert check.parse_page(text) == {"Botte": "Barnon", "Fact": "ok"}


def test_answers_feed_names_rules_and_the_text(tmp_path: Path) -> None:
    session = _session(tmp_path)
    check.sync(session)
    _answer(session, "en", "Botte", "Brannick")
    report = check.sync(session)
    assert report.new_answers == 1 and report.answered == 1
    assert (session / "names.txt").read_text(encoding="utf-8").startswith("Brannick\n")
    rules = json.loads((session / "rules.json").read_text(encoding="utf-8"))
    assert set(rules["Brannick"]) == {"Botte", "Bote"}
    lines = [Line("u000001", 0, 1, "anna", "Anna", "Ilvara", "Vi mødte botte og Bote.", ("Botte",))]
    out, changed = check.apply_answers(session, lines)
    assert out[0].text == "Vi mødte Brannick og Brannick." and out[0].uncertain == ()
    assert changed == {"u000001"}
    # the filled page stays filled and says what happened
    assert "Status: applied in the notes" in check.page_path(session, "en").read_text(encoding="utf-8")


def test_first_answer_wins_and_an_english_conflict_is_named(tmp_path: Path) -> None:
    session = _session(tmp_path)
    check.sync(session)
    _answer(session, "da", "Vesperhult", "Vesperholt")
    check.sync(session)
    _answer(session, "en", "Botte", "Brannick")
    # the Danish page still shows the first answer; someone types another one over it
    da = check.page_path(session, "da")
    da.write_text(da.read_text(encoding="utf-8").replace("Svar: Vesperholt", "Svar: Noget andet"), encoding="utf-8")
    report = check.sync(session)
    answers = json.loads((session / "name-answers.json").read_text(encoding="utf-8"))["answers"]
    assert answers["Vesperhult"]["correct"] == "Vesperholt"
    assert answers["Botte"]["correct"] == "Brannick"
    assert report.new_answers == 1


def test_not_a_name_is_kept_and_changes_nothing(tmp_path: Path) -> None:
    session = _session(tmp_path)
    check.sync(session)
    _answer(session, "en", "Botte", "not a name")
    report = check.sync(session)
    assert report.new_answers == 1
    assert not (session / "rules.json").exists()
    assert "marked as not a name" in check.page_path(session, "en").read_text(encoding="utf-8")
    lines = [Line("u000001", 0, 1, "a", "A", "A", "Botte", ())]
    assert check.apply_answers(session, lines)[1] == set()


def test_roster_fact_when_speakers_json_changed_the_character(tmp_path: Path) -> None:
    session = _session(tmp_path)
    (session / "speakers.json").write_text(json.dumps({"anna": {"player": "Ilvaris (Anna)"}}), encoding="utf-8")
    check.sync(session)
    page = check.page_path(session, "en").read_text(encoding="utf-8")
    assert "### Ilvaris (Anna): character name" in page
    assert 'The transcript was made with "Ilvara (Anna)"' in page
    _answer(session, "en", "Ilvaris (Anna): character name", "ok")
    check.sync(session)
    assert "kept as it is" in check.page_path(session, "en").read_text(encoding="utf-8")


def test_character_not_in_world_names(tmp_path: Path) -> None:
    session = _session(tmp_path)
    check.sync(session)
    assert "not in the world's names" in check.page_path(session, "en").read_text(encoding="utf-8")


def test_a_run_rewrites_only_the_scenes_an_answer_touched(tmp_path: Path) -> None:
    rows = [
        [("Vi", 0.9), ("mødte", 0.9), ("Botte", 0.3), ("i", 0.9), ("går", 0.9)],
        [("Hej", 0.9), ("alle", 0.9)],
    ]
    session = _timeline(tmp_path, rows)
    tl = session / "timeline" / "timeline.jsonl"
    data = [json.loads(x) for x in tl.read_text(encoding="utf-8").splitlines()]
    data[1]["start"], data[1]["end"] = 1000.0, 1005.0  # a second scene
    tl.write_text("\n".join(json.dumps(d) for d in data) + "\n", encoding="utf-8")
    first = FakeClaude()
    Writer(session, first, Options(scene_gap=90, fallback_gap_s=0)).run()
    assert sum(1 for k, _ in first.calls if k == "scene") == 2
    _answer(session, "en", "Botte", "Brannick")
    second = FakeClaude()
    Writer(session, second, Options(scene_gap=90, fallback_gap_s=0)).run()
    prompts = [p for k, p in second.calls if k == "scene"]
    assert len(prompts) == 1 and "Brannick" in prompts[0] and "Botte" not in prompts[0]
