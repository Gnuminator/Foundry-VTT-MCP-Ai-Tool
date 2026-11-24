"""outbox: the notes that go out to players, per medium, only after approval."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from session_notes import outbox

CHARS_EN = """# Characters

> GM only: may contain secrets.

## Ebbe, played by Christian

### In the story

#### Revealed

- Ebbe buried three people. ([[transcript.en#^u1|00:11:44]])

#### Choices

- Ebbe signs the list. ([[transcript.en#^u2|00:12:00]])

#### Ties

- None

#### Hooks

- The book of names. ([[transcript.en#^u3|00:13:00]])

### Player wishes

- Christian wants permadeath. ([[transcript.en#^u4|00:14:00]])

### GM only

- SECRET aside. ([[transcript.en#^u5|00:15:00]])

## Barnon, played by David

### In the story

#### Revealed

- Barnon gambles.

#### Choices

#### Ties

#### Hooks

### GM only

None
"""

TABLE_EN = """# Table: Session 0

## Planning

- Christian and Danni will confirm the date next week. ([[transcript.en#^u9|01:52:50]])
- Danni wants to run the introduction. ([[transcript.en#^u8|00:48:27]])

## Open at the table

- David has sound trouble.
"""

RECAP_EN = "# Recap for the players: Session 0\n\n> Draft: waiting for approval.\n\nPreviously: they met.\n"


def make_session(tmp: Path) -> Path:
    session = tmp / "2026-11-22_1906-discord"
    (session / "notes").mkdir(parents=True)
    (session / "raw").mkdir()
    (session / "notes" / "characters.en.md").write_text(CHARS_EN, encoding="utf-8")
    (session / "notes" / "table.en.md").write_text(TABLE_EN, encoding="utf-8")
    (session / "notes" / "recap.player.en.md").write_text(RECAP_EN, encoding="utf-8")
    tracks = {
        "tracks": [
            {"file": "1-x.rec", "userId": "111", "displayName": "Ebbe (Christian)"},
            {"file": "2-y.rec", "userId": "222", "displayName": "Barnon (David)"},
        ]
    }
    (session / "raw" / "session.json").write_text(json.dumps(tracks), encoding="utf-8")
    return session


def test_plain_drops_links_stamps_and_heading_marks() -> None:
    text = "## Head\n\n- Did a thing. ([[transcript.en#^u1|00:11:44]])\n- See [[table.en|Table]].\n> banner"
    out = outbox.plain(text)
    assert "[[" not in out and "00:11" not in out and "#" not in out and "banner" not in out
    assert out.startswith("**Head**") and "See Table." in out


def test_split_stays_under_limit_and_keeps_all_text() -> None:
    text = "\n\n".join(f"Paragraph {i} " + "word " * 60 for i in range(30))
    parts = outbox.split_discord(text)
    assert len(parts) > 1 and all(len(p) <= outbox.DISCORD_SAFE for p in parts)
    assert " ".join(parts).split() == text.split()
    tagged = outbox.discord_parts(text)
    assert all(len(p) < outbox.DISCORD_LIMIT for p in tagged) and tagged[0].endswith(f"(1/{len(tagged)})")


def test_one_long_line_is_split() -> None:
    parts = outbox.split_discord("word " * 1000)
    assert all(len(p) <= outbox.DISCORD_SAFE for p in parts)


def test_pc_note_has_story_and_todos_but_never_gm_only_or_wishes(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    data = outbox.build(session)
    ebbe = outbox.find(data, "pc-ebbe-en")
    text = ebbe["text"]
    assert "buried three people" in text and "book of names" in text
    assert "SECRET" not in text and "permadeath" not in text
    assert "Christian and Danni will confirm the date" in text
    assert "Danni wants to run" not in text  # not the player's own to-do
    assert ebbe["to"]["discordId"] == "111"
    assert "[[" not in ebbe["discord"][0] and "00:" not in ebbe["discord"][0]
    barnon = outbox.find(data, "pc-barnon-en")
    assert "Nothing new here." in barnon["text"]


def test_every_item_has_all_three_mediums(tmp_path: Path) -> None:
    data = outbox.build(make_session(tmp_path))
    for item in data["items"]:
        assert item["discord"] and item["foundry"].startswith("<") and item["obsidian"].startswith("---")
        assert "obsidian" in item["channels"]
    recap = outbox.find(data, "recap-en")
    assert "foundry-recap" in recap["channels"] and "Draft" not in recap["text"].split("\n\n", 1)[1][:0]
    assert "banner" not in recap["discord"][0]


def test_nothing_is_approved_by_default_and_preview_sends_nothing(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    data = outbox.build(session)
    assert all(i["status"] == "draft" for i in data["items"])
    assert "draft, will NOT go" in outbox.preview(session)
    assert outbox.foundry_payload(session, "en") == {"session": session.name, "lang": "en", "diaries": [], "pages": []}
    assert outbox.write_obsidian(session, tmp_path / "vault") == []


def test_approve_edit_and_rebuild_keep_the_approvers_work(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    outbox.build(session)
    outbox.approve(session, ["pc-ebbe-en"])
    payload = outbox.foundry_payload(session, "en")
    assert [d["actor"] for d in payload["diaries"]] == ["Ebbe"]
    outbox.edit(session, "pc-ebbe-en", "# My note\n\n- Edited by the approver.")
    assert outbox.find(outbox.load(session), "pc-ebbe-en")["status"] == "draft"  # an edit needs a new OK
    outbox.approve(session, ["pc-ebbe-en"])
    data = outbox.build(session)  # rebuild from the same source
    item = outbox.find(data, "pc-ebbe-en")
    assert item["status"] == "approved" and "Edited by the approver" in item["text"]


def test_review_answers_apply_and_a_too_long_note_cannot_be_approved(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    outbox.build(session)
    result = outbox.apply_review(session, {"recap-en": {"status": "approved"}, "table-en": {"status": "draft"}})
    assert "approved" in result["recap-en"]
    long_text = "# Too long\n\n" + "- word " * 600
    result = outbox.apply_review(session, {"pc-ebbe-en": {"status": "approved", "text": long_text}})
    assert result["pc-ebbe-en"].startswith("not approved")
    with pytest.raises(ValueError):
        outbox.approve(session, ["pc-ebbe-en"])


def test_ai_todos_come_from_the_runner_and_are_cached(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    calls: list[str] = []

    def runner(prompt: str, schema: dict, model: str, effort: str = "low") -> dict:
        calls.append(prompt)
        return {"da": ["Bekræft datoen med Danni."], "en": ["Confirm the date with Danni."]}

    data = outbox.build(session, runner=runner)
    assert "Confirm the date with Danni." in outbox.find(data, "pc-ebbe-en")["text"]
    assert "Foundry will not be used" not in outbox.find(data, "pc-ebbe-en")["text"]
    n = len(calls)
    outbox.build(session, runner=runner)
    assert len(calls) == n  # cached by input


def test_obsidian_page_has_tags_and_links(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    (session / "notes" / "notes.json").write_text(
        json.dumps({"names": ["Ebbe", "Vesperhold", "Christian"], "roster": {"Ebbe (Christian)": {}}}), encoding="utf-8"
    )
    data = outbox.build(session)
    page = outbox.find(data, "pc-ebbe-en")["obsidian"]
    assert "pc/ebbe" in page and "player/christian" in page and "session/2026-11-22" in page
    assert "[[table.en|" in page and "[[Ebbe]]" in page and "[[Christian]]" not in page


def test_obsidian_pages_are_written_once_for_approved_notes(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    outbox.build(session)
    outbox.approve(session, ["recap-en"])
    vault = tmp_path / "vault"
    written = outbox.write_obsidian(session, vault)
    assert len(written) == 1 and written[0].read_text(encoding="utf-8").startswith("---")
    assert outbox.write_obsidian(session, vault) == []


def test_rebuild_keeps_the_sent_record_even_when_the_source_changed(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    outbox.build(session)
    outbox.mark_sent(session, "pc-ebbe-en", "discordDm")
    data = outbox.load(session)
    outbox.find(data, "pc-ebbe-en")["text"] = "# Old source text"  # the source text now differs
    outbox.write(session, data)
    rebuilt = outbox.build(session)
    assert outbox.find(rebuilt, "pc-ebbe-en")["sent"]["discordDm"]["done"] is True


def test_two_players_with_one_discord_id_cannot_be_built(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    chars = session / "notes" / "characters.en.md"
    chars.write_text(chars.read_text(encoding="utf-8").replace("played by David", "played by Christian"), encoding="utf-8")
    with pytest.raises(ValueError):
        outbox.build(session)
