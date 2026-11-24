"""``session-notes outbox``: the notes that go out to players after a session, one item per note.

Built from the finished notes files (``characters``, ``table``, ``recap.player``, both languages),
no Claude call. Every item stays ``draft`` until the approver says yes to *that* note; nothing is
sent from here (the bot's ``send-notes.mjs`` and the Foundry plans read ``outbox/outbox.json`` and
only touch ``approved`` items).

Items:

- ``pc-note``: "Your character" for one player character, per language: that character's *In the
  story* part (never *GM only*, never *Player wishes*) and the player's own to-dos from the Table
  page. Goes as a Discord DM to the player and as a Foundry journal page the player owns.
- ``recap``: the player recap. Goes to the group channel and is revealed in the live world.
- ``table``: the Table page. Goes to the group channel.

Discord text has no wiki links, no timestamps and no heading marks, and is split under 2000
characters at line breaks.

The folder lives in the session's ``notes`` folder on the PC (never in the repo).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import roster

OUTBOX_DIR = "outbox"
OUTBOX_FILE = "outbox.json"
DISCORD_LIMIT = 2000
DISCORD_SAFE = 1900  # room for a "(2/3)" tag
FOUNDRY_DIARY_MAX = 2000  # plan-character-diaries refuses longer text
LANGS = ("da", "en")

# Fixed headings of the notes format (Design/Session notes format 2026-11-23).
STORY = {"da": ["Afsløret", "Valg", "Bånd", "Hooks"], "en": ["Revealed", "Choices", "Ties", "Hooks"]}
TODO_SECTIONS = {"da": ("Planlægning", "Åbent ved bordet"), "en": ("Planning", "Open at the table")}
STORY_HEAD = {"da": "I historien", "en": "In the story"}
WISH_HEAD = {"da": "Spillerønsker", "en": "Player wishes"}
GM_HEAD = {"da": "Kun for GM", "en": "GM only"}
LABELS = {
    "da": {
        "title": "Din karakter",
        "todos": "Dine ting at huske",
        "none": "Intet nyt her.",
        "intro": "Her er sessionens historie om {name}, som Søren har samlet. Den er kun til dig.",
    },
    "en": {
        "title": "Your character",
        "todos": "Things for you to remember",
        "none": "Nothing new here.",
        "intro": "Here is the story of {name} from the session, put together by Søren. It is only for you.",
    },
}

# A to-do names the player and something still to do (a draft for the approver to cut or edit).
TODO_WORDS = {
    "en": re.compile(r"\b(will|needs? to|still needs|must|should|send|confirm|bring|make)\b"),
    "da": re.compile(r"\b(skal|vil|mangler|sender|bekræft\w*|medbring\w*|lave)\b"),
}

LINK_WITH_LABEL = re.compile(r"\[\[[^\]|]*\|([^\]]*)\]\]")
LINK_BARE = re.compile(r"\[\[([^\]|]*)\]\]")
STAMP = re.compile(r"\s*\(\s*(?:\[\[[^\]]*\]\]|\d{1,2}:\d{2}(?::\d{2})?)\s*\)")
HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


# ---------------------------------------------------------------------------
# Plain text for Discord
def plain(text: str) -> str:
    """Drop timestamp links and wiki links, turn headings into bold lines, tidy blank lines."""
    out: list[str] = []
    for raw in text.splitlines():
        line = STAMP.sub("", raw)
        line = LINK_WITH_LABEL.sub(r"\1", line)
        line = LINK_BARE.sub(r"\1", line)
        m = HEADING.match(line)
        if m:
            line = f"**{m.group(2).strip()}**"
        if line.startswith(">"):  # draft banners and quote marks are not for players
            continue
        out.append(line.rstrip())
    joined = "\n".join(out)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def split_discord(text: str, limit: int = DISCORD_SAFE) -> list[str]:
    """Split under ``limit`` characters at blank lines, then line breaks, then spaces."""
    text = text.strip()
    if len(text) <= limit:
        return [text] if text else []
    parts: list[str] = []
    current = ""

    def flush() -> None:
        nonlocal current
        if current.strip():
            parts.append(current.strip())
        current = ""

    for block in re.split(r"\n\n+", text):
        pieces = [block] if len(block) <= limit else _hard_split(block, limit)
        for piece in pieces:
            if current and len(current) + 2 + len(piece) > limit:
                flush()
            current = f"{current}\n\n{piece}" if current else piece
    flush()
    return parts


def _hard_split(block: str, limit: int) -> list[str]:
    out: list[str] = []
    cur = ""
    for line in block.split("\n"):
        while len(line) > limit:
            cut = line.rfind(" ", 0, limit)
            cut = cut if cut > 0 else limit
            head, line = line[:cut], line[cut:].lstrip()
            if cur:
                out.append(cur)
                cur = ""
            out.append(head)
        if cur and len(cur) + 1 + len(line) > limit:
            out.append(cur)
            cur = ""
        cur = f"{cur}\n{line}" if cur else line
    if cur:
        out.append(cur)
    return out


def discord_parts(text: str) -> list[str]:
    """The messages for a note: split, with a (n/N) tag on each when there is more than one."""
    parts = split_discord(plain(text))
    if len(parts) > 1:
        parts = [f"{p}\n({i}/{len(parts)})" for i, p in enumerate(parts, 1)]
    return parts


# ---------------------------------------------------------------------------
# Reading the notes files
def _sections(md: str, level: int) -> dict[str, list[str]]:
    """Heading text at ``level`` -> its lines (until the next heading of that level or higher)."""
    out: dict[str, list[str]] = {}
    key: str | None = None
    for line in md.splitlines():
        m = HEADING.match(line)
        if m and len(m.group(1)) <= level:
            key = m.group(2).strip() if len(m.group(1)) == level else None
            if key is not None:
                out[key] = []
            continue
        if key is not None:
            out[key].append(line)
    return out


def _bullets(lines: list[str]) -> list[str]:
    return [STAMP.sub("", l[2:]).strip() for l in lines if l.startswith("- ")]


@dataclass
class Character:
    name: str
    player: str
    story: dict[str, list[str]]  # heading -> bullets (links and stamps already gone)


def parse_characters(md: str, lang: str) -> list[Character]:
    out: list[Character] = []
    by = "spillet af" if lang == "da" else "played by"
    for head, lines in _sections(md, 2).items():
        if f", {by} " not in head:
            continue
        name, player = head.split(f", {by} ", 1)
        body = "\n".join(lines)
        story_lines = _sections(body, 3).get(STORY_HEAD[lang], [])
        sub = _sections("\n".join(story_lines), 4)
        story = {h: _bullets(sub.get(h, [])) for h in STORY[lang]}
        out.append(Character(name.strip(), player.strip(), story))
    return out


def todos_for(table_md: str, lang: str, names: list[str]) -> list[str]:
    """Lines of the Table's planning and open-question sections that start with this player or character and say something to do."""
    secs = _sections(table_md, 2)
    wanted = [n.lower() for n in names if n]
    out: list[str] = []
    for head in TODO_SECTIONS[lang]:
        for line in _bullets(secs.get(head, [])):
            low = line.lower()
            starts = any(re.match(rf"{re.escape(n)}\b", low) for n in wanted)
            if starts and TODO_WORDS[lang].search(low):
                out.append(line)
    return out


def pc_note(lang: str, ch: Character, todos: list[str]) -> str:
    """The note; to-dos are dropped from the end until it fits the Foundry page."""
    while True:
        text = _pc_note(lang, ch, todos)
        if len(plain(text)) <= FOUNDRY_DIARY_MAX or not todos:
            return text
        todos = todos[:-1]


def _pc_note(lang: str, ch: Character, todos: list[str]) -> str:
    lab = LABELS[lang]
    lines = [f"# {lab['title']}: {ch.name}", "", lab["intro"].format(name=ch.name), ""]
    for head in STORY[lang]:
        items = ch.story.get(head, [])
        if items:
            lines += [f"#### {head}", *[f"- {i}" for i in items], ""]
    lines += [f"#### {lab['todos']}"]
    lines += [f"- {t}" for t in todos] if todos else [lab["none"]]
    return "\n".join(lines).strip()


# ---------------------------------------------------------------------------
# Building the outbox
def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def outbox_path(session: Path) -> Path:
    return session / "notes" / OUTBOX_DIR / OUTBOX_FILE


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _discord_ids(session: Path) -> dict[str, str]:
    """Player first name (from "Character (Player)") -> Discord user id, from the recording's tracks."""
    ids: dict[str, str] = {}
    for t in roster.tracks(session):
        m = re.search(r"\(([^)]+)\)\s*$", str(t.get("displayName", "")))
        if m and t.get("userId"):
            ids[m.group(1).strip().lower()] = str(t["userId"])
    return ids


def _item(
    session_name: str,
    kind: str,
    lang: str,
    key: str,
    title: str,
    text: str,
    to: dict[str, Any],
    channels: list[str],
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": f"{key}-{lang}",
        "session": session_name,
        "kind": kind,
        "lang": lang,
        "title": title,
        "to": to,
        "channels": channels,
        "text": text,
        "status": "draft",
        "approvedAt": None,
        "sent": {},
    }
    refresh(item)
    return item


def foundry_html(text: str) -> str:
    """The note as a Foundry journal page: plain HTML, no links, no timestamps."""
    import html as _h

    def inline(t: str) -> str:
        return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", _h.escape(t))

    out: list[str] = []
    in_list = False
    for line in plain_keep_headings(text).splitlines():
        m = HEADING.match(line)
        if line.startswith("- "):
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{inline(line[2:])}</li>")
            continue
        if in_list:
            out.append("</ul>")
            in_list = False
        if m:
            level = min(len(m.group(1)) + 1, 4)
            out.append(f"<h{level}>{inline(m.group(2))}</h{level}>")
        elif line.strip():
            out.append(f"<p>{inline(line)}</p>")
    if in_list:
        out.append("</ul>")
    return "".join(out)


def plain_keep_headings(text: str) -> str:
    """Like ``plain`` but headings stay headings (Foundry and Obsidian render them)."""
    out = []
    for raw in text.splitlines():
        if raw.startswith(">"):
            continue
        line = STAMP.sub("", raw)
        line = LINK_WITH_LABEL.sub(r"\1", line)
        out.append(LINK_BARE.sub(r"\1", line).rstrip())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def obsidian_md(item: dict[str, Any]) -> str:
    """The note as a vault page: front matter, headings, a link back to the session start page."""
    to = item["to"]
    who = to.get("player") or "group"
    lang = item["lang"]
    slug = lambda t: re.sub(r"[^a-z0-9]+", "-", str(t).lower()).strip("-")  # noqa: E731
    tags = ["session-notes", f"session-notes/{item['kind']}", f"session/{item['session'][:10]}", f"lang/{lang}"]
    if to.get("character"):
        tags += [f"pc/{slug(to['character'])}", f"player/{slug(to['player'])}"]
    related = [f"[[index.{lang}|Session start page]]"]
    if item["kind"] != "table":
        related.append(f"[[table.{lang}|Table: house rules and plans]]")
    if item["kind"] != "recap":
        related.append(f"[[recap.player.{lang}|Recap for the players]]")
    front = [
        "---",
        f"type: session-note-{item['kind']}",
        f"session: {item['session']}",
        f"lang: {lang}",
        f"for: {who}",
        *([f"character: {to['character']}"] if to.get("character") else []),
        "tags: [" + ", ".join(tags) + "]",
        "related: [" + ", ".join(f'"{r}"' for r in related) + "]",
        "---",
    ]
    other = "en" if lang == "da" else "da"
    body = link_names(plain_keep_headings(item["text"]), item.get("linkNames", []))
    foot = "**" + ("Se også" if lang == "da" else "See also") + "**: " + " · ".join(related)
    return "\n".join(front) + "\n\n" + body + f"\n\n{foot} · [[index.{other}|{other}]]\n"


def link_names(text: str, names: list[str]) -> str:
    """Wiki-link the first mention of each name (NPCs, places) so the vault can follow it."""
    for name in sorted(set(names), key=len, reverse=True):
        text = re.sub(rf"(?<![\[\w|]){re.escape(name)}(?![\w\]|])", f"[[{name}]]", text, count=1)
    return text


def refresh(item: dict[str, Any]) -> None:
    """Recompute what depends on ``text``: what goes out in each medium and the Foundry fit."""
    item["discord"] = discord_parts(item["text"])
    item["foundry"] = foundry_html(item["text"])
    item["obsidian"] = obsidian_md(item)
    # Only the player's own note goes through the diary tool, which refuses text over 2000 characters.
    item["foundryChars"] = len(plain(item["text"])) if item["kind"] == "pc-note" else None
    item["warnings"] = []
    if item["foundryChars"] and item["foundryChars"] > FOUNDRY_DIARY_MAX:
        item["warnings"].append(
            f"Too long for the Foundry page ({item['foundryChars']} of {FOUNDRY_DIARY_MAX} characters): shorten it."
        )
    if any(len(p) > DISCORD_LIMIT for p in item["discord"]):
        item["warnings"].append("A Discord message is over 2000 characters.")


TODO_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["da", "en"],
    "properties": {
        "da": {"type": "array", "items": {"type": "string"}},
        "en": {"type": "array", "items": {"type": "string"}},
    },
}

TODO_PROMPT = """\
Below is the Table page of a Dungeons & Dragons session 0 (house rules, plans, open questions).
Write the to-dos for ONE player: {player}, who plays {character}.

A to-do is something this player must do, decide, bring or confirm before the next session. Each
is one self-contained sentence that says WHAT, with the concrete detail (date, time, place, who
it is with, what exactly to confirm), so it makes sense without the Table page. Examples of the
right level: "Confirm with Danni whether the first live session is on 19 December at 12 at
Christian's place." "Send David the brief for the journeyman's test."
Leave out: observations of what someone said or noted, technical talk about screens and sound,
things that are the GM's or another player's job, and anything that is only table chatter. Use at
most 5. An empty list is fine. Use only what the page says; never invent.
Write the same to-dos in Danish (`da`) and English (`en`). Game terms stay English in the Danish
text. Never use em dashes.

TABLE PAGE:
{table}
"""


def ai_todos(
    session: Path, runner: Any, model: str, table_en: str, player: str, character: str
) -> dict[str, list[str]]:
    """To-dos for one player written by Claude from the Table page; cached by input so a rebuild
    does not call again."""
    import hashlib

    prompt = TODO_PROMPT.format(player=player, character=character, table=table_en)
    key = hashlib.sha256(f"{model}\n{prompt}".encode()).hexdigest()[:16]
    cache_path = session / "notes" / OUTBOX_DIR / "todos.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    if key not in cache:
        got = runner(prompt, TODO_SCHEMA, model, "medium")
        cache[key] = {
            "da": [str(x).strip() for x in got.get("da", []) if str(x).strip()],
            "en": [str(x).strip() for x in got.get("en", []) if str(x).strip()],
        }
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    return cache[key]


def build(session: Path, runner: Any = None, model: str = "sonnet") -> dict[str, Any]:
    """Make ``outbox.json``. Items already approved or sent keep their status and text when the
    source is unchanged; an item whose text changed in the notes goes back to draft. With a
    ``runner`` (Claude) the to-dos are written from the Table page; without one they are the
    Table lines that start with the player and say something to do."""
    notes = session / "notes"
    ids = _discord_ids(session)
    items: list[dict[str, Any]] = []
    try:
        meta = json.loads((notes / "notes.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        meta = {}
    names = meta.get("names", [])
    people = {"danni", "bassi"}  # the players and the GM are people, not pages to link
    for key in meta.get("roster", {}):
        people.update(p.strip().lower() for p in re.findall(r"\(([^)]+)\)", str(key)))
    link_list = [n for n in names if isinstance(n, str) and n.lower() not in people]
    table_en = _read(notes / "table.en.md")
    for lang in LANGS:
        chars = parse_characters(_read(notes / f"characters.{lang}.md"), lang)
        table = _read(notes / f"table.{lang}.md")
        for ch in chars:
            player = re.sub(r"\s+", " ", ch.player).strip()
            first = player.split(" ")[0]
            to = {
                "type": "player",
                "player": player,
                "character": ch.name,
                "discordId": ids.get(first.lower()),
            }
            if runner is not None and table_en:
                todos = ai_todos(session, runner, model, table_en, first, ch.name)[lang]
            else:
                todos = todos_for(table, lang, [first, ch.name])
            slug = re.sub(r"[^a-z0-9]+", "-", ch.name.lower()).strip("-")
            items.append(
                _item(session.name, "pc-note", lang, f"pc-{slug}", f"{LABELS[lang]['title']}: {ch.name}",
                      pc_note(lang, ch, todos), to, ["discord-dm", "foundry-page", "obsidian"])
            )
        recap = _read(notes / f"recap.player.{lang}.md")
        if recap:
            items.append(_item(session.name, "recap", lang, "recap", recap.splitlines()[0].lstrip("# ").strip(),
                               "\n".join(recap.splitlines()), {"type": "group"},
                               ["discord-group", "foundry-recap", "obsidian"]))
        if table:
            items.append(_item(session.name, "table", lang, "table", table.splitlines()[0].lstrip("# ").strip(),
                               table, {"type": "group"}, ["discord-group", "foundry-page", "obsidian"]))
    for item in items:
        item["linkNames"] = link_list
        refresh(item)
    old = load(session)
    if old:
        prev = {i["id"]: i for i in old.get("items", [])}
        for item in items:
            was = prev.get(item["id"])
            if was is None:
                continue
            if was["text"] == item["text"] or was.get("edited"):
                # Same source, or the approver's own edit: keep it and its status.
                item.update({k: was[k] for k in ("text", "status", "approvedAt", "sent", "edited") if k in was})
                refresh(item)
    data = {"session": session.name, "built": _now(), "items": items}
    write(session, data)
    return data


def load(session: Path) -> dict[str, Any] | None:
    path = outbox_path(session)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write(session: Path, data: dict[str, Any]) -> Path:
    path = outbox_path(session)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def find(data: dict[str, Any], item_id: str) -> dict[str, Any]:
    for item in data["items"]:
        if item["id"] == item_id:
            return item
    raise KeyError(f"No outbox item {item_id!r}. Items: {', '.join(i['id'] for i in data['items'])}")


def approve(session: Path, ids: list[str], by: str = "the approver") -> list[str]:
    data = load(session) or build(session)
    done: list[str] = []
    for item_id in ids:
        item = find(data, item_id)
        if item["warnings"]:
            raise ValueError(f"{item_id}: {' '.join(item['warnings'])}")
        item["status"] = "approved"
        item["approvedAt"] = _now()
        item["approvedBy"] = by
        done.append(item_id)
    write(session, data)
    return done


def edit(session: Path, item_id: str, text: str) -> dict[str, Any]:
    """Replace a note's text with the approver's edit; the note goes back to draft."""
    data = load(session) or build(session)
    item = find(data, item_id)
    item["text"] = text.strip()
    item["edited"] = True
    item["status"] = "draft"
    item["approvedAt"] = None
    refresh(item)
    write(session, data)
    return item


def apply_review(session: Path, review: dict[str, Any], by: str = "Christian") -> dict[str, str]:
    """Apply what the review page recorded: ``{id: {"status": "approved"|"draft", "text": "..."}}``.
    Text that differs from the outbox is an edit. Returns id -> what happened."""
    data = load(session) or build(session)
    result: dict[str, str] = {}
    for item_id, entry in review.items():
        item = find(data, item_id)
        text = str(entry.get("text", item["text"])).strip()
        if text and text != item["text"]:
            item["text"] = text
            item["edited"] = True
            refresh(item)
            result[item_id] = "edited"
        if entry.get("status") == "approved":
            if item["warnings"]:
                result[item_id] = "not approved: " + " ".join(item["warnings"])
                item["status"] = "draft"
                continue
            item["status"] = "approved"
            item["approvedAt"] = _now()
            item["approvedBy"] = by
            result[item_id] = result.get(item_id, "") + (" and approved" if item_id in result else "approved")
        else:
            item["status"] = "draft"
            item["approvedAt"] = None
    write(session, data)
    return result


# ---------------------------------------------------------------------------
# Preview (dry run: sends nothing)
def preview(session: Path) -> str:
    """Per recipient, exactly what would go out for the items as they stand now."""
    data = load(session) or build(session)
    by_player: dict[str, list[dict[str, Any]]] = {}
    group: list[dict[str, Any]] = []
    for item in data["items"]:
        (group if item["to"]["type"] == "group" else by_player.setdefault(item["to"]["player"], [])).append(item)
    lines = [f"Outbox preview for {data['session']} (dry run, nothing is sent)", ""]

    def show(item: dict[str, Any], where: str) -> None:
        mark = "APPROVED" if item["status"] == "approved" else "draft, will NOT go"
        sent = item.get("sent", {})
        done = ", ".join(sorted(sent)) or "nothing sent yet"
        parts = item["discord"]
        lines.append(f"  [{mark}] {item['id']} ({item['lang']}) -> {where}; {len(parts)} message(s), already: {done}")
        for w in item["warnings"]:
            lines.append(f"      WARNING: {w}")

    for player, items in by_player.items():
        did = items[0]["to"].get("discordId") or "NO DISCORD ID"
        lines.append(f"{player} as {items[0]['to']['character']} (Discord {did}):")
        for i in items:
            show(i, "Discord DM from Søren, a Foundry journal page owned by this player, and an Obsidian page")
        lines.append("")
    lines.append("The group (Discord session notes channel; the live world):")
    for i in group:
        where = "Discord group channel, " + ("revealed in the live world (/recap, Previously on)" if "foundry-recap" in i["channels"] else "a Foundry journal page everyone can read") + ", and an Obsidian page"
        show(i, where)
    lines += ["", "Danni (GM): nothing to approve for session 0 (the approver is the user); he reads the group posts like everyone."]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Obsidian and Foundry hand-over (approved items only)
def write_obsidian(session: Path, folder: Path) -> list[Path]:
    """Write each approved item's vault page into ``folder`` once (a page already there is kept)."""
    data = load(session) or build(session)
    written: list[Path] = []
    for item in data["items"]:
        if item["status"] != "approved" or "obsidian" not in item["channels"]:
            continue
        who = item["to"].get("character") or item["kind"]
        name = re.sub(r"[^\w .-]+", "", f"{item['kind']} {who} {item['lang']}").strip().replace(" ", "-")
        path = folder / f"{name}.md"
        if item.get("sent", {}).get("obsidian", {}).get("done") and path.exists():
            continue
        folder.mkdir(parents=True, exist_ok=True)
        path.write_text(item["obsidian"], encoding="utf-8")
        item.setdefault("sent", {})["obsidian"] = {"done": True, "at": _now(), "path": str(path)}
        written.append(path)
    write(session, data)
    return written


def foundry_payload(session: Path, lang: str) -> dict[str, Any]:
    """What the Foundry step takes for approved notes of one language: ``diaries`` for
    ``plan-character-diaries`` (one per player character, text as the approver left it) and
    ``pages`` (recap and Table as HTML) for the journal reveal."""
    data = load(session) or build(session)
    diaries, pages = [], []
    for item in data["items"]:
        if item["status"] != "approved" or item["lang"] != lang:
            continue
        if item["kind"] == "pc-note":
            diaries.append({"actor": item["to"]["character"], "text": plain(item["text"]), "id": item["id"]})
        else:
            pages.append({"kind": item["kind"], "title": item["title"], "html": item["foundry"], "id": item["id"]})
    return {"session": data["session"], "lang": lang, "diaries": diaries, "pages": pages}


def mark_sent(session: Path, item_id: str, medium: str, detail: str = "") -> None:
    data = load(session) or build(session)
    find(data, item_id).setdefault("sent", {})[medium] = {"done": True, "at": _now(), "detail": detail}
    write(session, data)
