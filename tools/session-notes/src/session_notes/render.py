"""Write the notes as Markdown (Obsidian-friendly) plus one JSON file with everything.

The layout is fixed (design "Session notes format", 2026-11-23): the same files in ``da`` and
``en``, in ``<session>/notes/``:

* ``index.<lang>.md``: the start page (title, date, GM, who plays whom, five lines, links).
* ``scenes.<lang>.md``: per scene the same headings in the same order (What happened, Decisions,
  NPCs met, Open threads, Quotes, GM only), "None" when empty; a scene wholly at the table is a
  short stub. One timestamp link per line.
* ``table.<lang>.md``: everything said at the table (house rules, play style, planning ...).
* ``characters.<lang>.md``, ``remember.<lang>.md`` (with the layers): GM only.
* ``summary.<lang>.md``: the long summary for the GM.
* ``recap.player.<lang>.md``: for the players, a draft until the GM approves it.
* ``transcript.<lang>.md`` (cleaned, each line ends with its block anchor ``^u000123``) and
  ``raw.<lang>.md`` (the recogniser's text).

Plus ``notes.json`` (all of it, for later steps such as the journal page for the recap).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
import re
from typing import Any

from . import agenda, extras, layers
from . import moment as moment_mod
from .check import PAGE as CHECK_PAGE
from .fmt import (
    AT_TABLE,
    NONE,
    SCENE_HEADINGS,
    SEE,
    SETTING_LABEL,
    TABLE_HEADINGS,
    TABLE_NAME,
    stamp,
    table_link,
)
from .model import Line, Roster, clock, is_gm
from .npcs import name as npc_name

LANGS = ("da", "en")
HEAD_CHARACTERS = {"da": "Personer", "en": "Characters"}
HEAD_REMEMBER = {"da": "Værd at huske", "en": "Worth remembering"}
DEPTH_TITLE = "Dybdegående noter"
WEEKDAYS = {
    "da": ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"],
    "en": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
}
MONTHS = {
    "da": ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september",
           "oktober", "november", "december"],
    "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September",
           "October", "November", "December"],
}
HEAD = {
    "da": {
        "index": "Sessionens noter",
        "date": "Dato",
        "character": "Karakter",
        "played_by": "Spillet af",
        "in_short": "Kort fortalt",
        "pages_title": "Sider",
        "pages": {
            "scenes": ("Scener", "hvad der skete, scene for scene"),
            "table": "husregler, aftaler og planer lavet uden for spillet",
        },
        "gm_only": "kun for GM",
        "draft_short": "kladde, venter på GM'ens godkendelse",
        "other_language": "English version",
        "transcript": "Transskription",
        "raw": "Rå transskription",
        "scenes": "Scener",
        "summary": "Resumé",
        "recap": "Resumé til spillerne",
        "draft": "Kladde: venter på GM'ens godkendelse. Ikke til spillerne endnu.",
        "missing": "Ikke skrevet endnu (kør session-notes igen).",
        "incomplete": "Ufærdige noter: nogle scener mangler eller er rå, og resuméet er ikke "
        "skrevet. Kør session-notes igen.",
        "changed": "Hvad ændrede sig",
        "fallback": "Denne scene kunne ikke behandles; transskriptionen er rå.",
        "ooc": "uden for spillet",
    },
    "en": {
        "index": "Session notes",
        "date": "Date",
        "character": "Character",
        "played_by": "Played by",
        "in_short": "In short",
        "pages_title": "Pages",
        "pages": {
            "scenes": ("Scenes", "what happened, scene by scene"),
            "table": "house rules, agreements and plans made out of character",
        },
        "gm_only": "GM only",
        "draft_short": "draft, waiting for the GM's approval",
        "other_language": "Dansk version",
        "transcript": "Transcript",
        "raw": "Raw transcript",
        "scenes": "Scenes",
        "summary": "Summary",
        "recap": "Recap for the players",
        "draft": "Draft: waiting for the GM's approval. Not for players yet.",
        "missing": "Not written yet (run session-notes again).",
        "incomplete": "Incomplete notes: some scenes are missing or raw, and the summary is "
        "not written. Run session-notes again.",
        "changed": "What changed",
        "fallback": "This scene could not be processed; the transcript is raw.",
        "ooc": "out of character",
    },
}


def _banner(h: dict[str, Any], incomplete: bool) -> list[str]:
    return [f"> **{h['incomplete']}**", ""] if incomplete else []


def render_transcript(
    lang: str, lines: list[Line], notes: list[dict[str, Any]], incomplete: bool = False
) -> str:
    h = HEAD[lang]
    by_id = {ln.id: ln for ln in lines}
    out = [f"# {h['transcript']}", "", *_banner(h, incomplete)]
    for scene in notes:
        out += [f"## {scene['index']}. {scene[f'title_{lang}']}", ""]
        if scene.get("fallback"):
            out += [f"> {h['fallback']}", ""]
        for entry in scene["lines"]:
            ln = by_id[entry["id"]]
            who = ln.player if ln.character == ln.player else f"{ln.character} ({ln.player})"
            text = entry[lang] or ln.text
            if entry.get("ooc"):
                text = f"*{text}* ({h['ooc']})"
            out += [f"**[{clock(ln.start)}] {who}:** {text} ^{ln.id}", ""]
    return "\n".join(out)


def _quote_line(e: dict[str, Any], lang: str, starts: dict[str, float]) -> str:
    """Quotes stay in the spoken language; the English file adds the translation in brackets."""
    spoken = e.get("spoken") or e.get("da") or ""
    spoken_lang = e.get("spoken_lang") or ("da" if "spoken" not in e else "en")
    text = f'"{spoken}"'
    translation = e.get("en") or ""
    if lang == "en" and spoken_lang == "da" and translation and translation != spoken:
        text += f" ({translation})"
    return f"- {text}{stamp([e['id']], lang, starts)}"


def _table_pointer(scene: dict[str, Any], lang: str, starts: dict[str, float]) -> str | None:
    """At most one pointer line from a scene to the Table page."""
    items = scene.get("table") or []
    note = (scene.get("table_note") or {}).get(lang, "").strip()
    if not items and not note:
        return None
    headings = dict(TABLE_HEADINGS[lang])
    heading = headings.get(items[0].get("topic", "open")) if items else None
    cites = items[0].get("cites", []) if items else []
    head = f"{AT_TABLE[lang]}: {note}; " if note else f"{AT_TABLE[lang]}: "
    return f"- {head}{SEE[lang]} {table_link(lang, heading)}.{stamp(cites, lang, starts)}"


def render_scenes(
    lang: str, lines: list[Line], notes: list[dict[str, Any]], incomplete: bool = False
) -> str:
    h = HEAD[lang]
    starts = {ln.id: ln.start for ln in lines}
    out = [f"# {h['scenes']}", "", *_banner(h, incomplete)]
    for scene in notes:
        setting = scene.get("setting") or "game"
        label = SETTING_LABEL[lang].get(setting, SETTING_LABEL[lang]["game"])
        out += [
            f"## {scene['index']}. {scene[f'title_{lang}']}",
            f"*{clock(scene['start'])} to {clock(scene['end'])} · {label}*",
            "",
        ]
        if scene.get("fallback"):
            out += [f"> {h['fallback']}", ""]
            # half of a split scene may have worked: its notes are still shown
            has_notes = scene[f"summary_{lang}"] or any(
                scene.get(k) for k in ("events", "decisions", "npcs", "threads", "quotes", "gm_only", "table")
            )
            if not has_notes:
                continue
        if scene[f"summary_{lang}"]:
            out += [scene[f"summary_{lang}"], ""]
        if setting == "table":
            # wholly at the table: a short stub, no empty headings
            out += [f"{table_link(lang)}", ""]
            continue
        pointer = _table_pointer(scene, lang, starts)
        for key, title in SCENE_HEADINGS[lang]:
            entries = scene.get(key) or []
            out += [f"### {title}", ""]
            body: list[str] = []
            for e in entries:
                if key == "quotes":
                    body.append(_quote_line(e, lang, starts))
                elif key == "npcs":
                    body.append(f"- **{npc_name(e, lang)}**: {e[lang]}{stamp(e['cites'], lang, starts)}")
                else:
                    body.append(f"- {e[lang]}{stamp(e['cites'], lang, starts)}")
            if key == "events" and pointer:
                body.append(pointer)
            out += (body + [""]) if body else [NONE[lang], ""]
    return "\n".join(out)


def render_table(
    lang: str,
    lines: list[Line],
    notes: list[dict[str, Any]],
    session: dict[str, Any] | None,
    incomplete: bool = False,
) -> str:
    """What was said at the table, gathered from every scene, under fixed headings."""
    h = HEAD[lang]
    starts = {ln.id: ln.start for ln in lines}
    title = f"# {TABLE_NAME[lang]}"
    if session and session.get(f"title_{lang}"):
        title += f": {session[f'title_{lang}']}"
    out = [title, "", *_banner(h, incomplete)]
    seen: set[str] = set()
    for topic, heading in TABLE_HEADINGS[lang]:
        out += [f"## {heading}", ""]
        body: list[str] = []
        for scene in notes:
            for item in scene.get("table") or []:
                text = str(item.get(lang, "")).strip()
                key = f"{topic}|{text.casefold()}"
                if item.get("topic") != topic or not text or key in seen:
                    continue
                seen.add(key)
                body.append(f"- {text}{stamp(item.get('cites', []), lang, starts)}")
        out += (body + [""]) if body else [NONE[lang], ""]
    return "\n".join(out)


def render_summary(lang: str, session: dict[str, Any] | None) -> str:
    h = HEAD[lang]
    if session is None:
        return f"# {h['summary']}\n\n{h['missing']}\n"
    changed = "\n".join(f"- {c}" for c in session[f"changed_{lang}"])
    return (
        f"# {h['summary']}: {session[f'title_{lang}']}\n\n{session[f'summary_{lang}']}\n\n"
        f"## {h['changed']}\n\n{changed}\n"
    )


def render_recap(
    lang: str,
    session: dict[str, Any] | None,
    moment: dict[str, Any] | None = None,
    lines: list[Line] | None = None,
) -> str:
    h = HEAD[lang]
    if session is None:
        return f"# {h['recap']}\n\n{h['missing']}\n"
    text = (
        f"# {h['recap']}: {session[f'title_{lang}']}\n\n> {h['draft']}\n\n"
        f"{session[f'recap_player_{lang}']}\n"
    )
    block = moment_mod.render(lang, moment, lines or [])
    return f"{text}\n{block}" if block else text


_SESSION_DIR = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:_(\d{2})(\d{2}))?(?:-(.+))?$")


def _date_line(lang: str, folder: str, lines: list[Line]) -> str | None:
    """"Sunday 22 November 2026, 19:06 to 21:09 (online, Discord)" from the folder name
    (``2026-11-22_1906-discord``) and the length of the recording."""
    m = _SESSION_DIR.match(folder)
    if not m:
        return None
    try:
        day = datetime(int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        return None
    wd, mo = WEEKDAYS[lang][day.weekday()], MONTHS[lang][day.month - 1]
    text = f"{wd} {day.day}. {mo} {day.year}" if lang == "da" else f"{wd} {day.day} {mo} {day.year}"
    if m[4] is not None and lines:
        start = day.replace(hour=int(m[4]), minute=int(m[5]))
        end = start + timedelta(seconds=lines[-1].end)
        text += f", {start:%H:%M} {'til' if lang == 'da' else 'to'} {end:%H:%M}"
    if m[6] and m[6].lower() == "discord":
        text += " (online, Discord)"
    return text


def render_index(
    lang: str,
    folder: str,
    lines: list[Line],
    roster: Roster,
    session: dict[str, Any] | None,
    pages: set[str],
    incomplete: bool,
) -> str:
    """The start page: title, date, GM, who plays whom, five lines, links to the pages and to the
    other language. ``pages`` names the optional pages that exist (characters, remember, names,
    depth)."""
    h = HEAD[lang]
    other = "en" if lang == "da" else "da"
    out = [f"# {session[f'title_{lang}'] if session else h['index']}", ""]
    date = _date_line(lang, folder, lines)
    if date:
        out.append(f"**{h['date']}:** {date}")
    gms = [p for p, c in roster.players.items() if is_gm(c)]
    if gms:
        out.append("**GM:** " + ", ".join(gms))
    out.append("")
    pcs = extras.player_characters(roster)
    if pcs:
        out += [f"| {h['character']} | {h['played_by']} |", "|---|---|"]
        out += [f"| {c} | {p} |" for c, p in pcs]
        out.append("")
    if incomplete:
        out += _banner(h, True)
    if session:
        out += [f"## {h['in_short']}", ""]
        out += [f"{n}. {t}" for n, t in enumerate(session.get(f"in_short_{lang}") or [], 1)]
        out.append("")
    out += [f"## {h['pages_title']}", ""]
    p = h["pages"]
    out += [f"- [[scenes.{lang}|{p['scenes'][0]}]]: {p['scenes'][1]}",
            f"- [[table.{lang}|{TABLE_NAME[lang]}]]: {p['table']}"]
    if "characters" in pages:
        out.append(f"- [[characters.{lang}|{HEAD_CHARACTERS[lang]}]] ({h['gm_only']})")
    if "remember" in pages:
        out.append(f"- [[remember.{lang}|{HEAD_REMEMBER[lang]}]] ({h['gm_only']})")
    out.append(f"- [[summary.{lang}|{h['summary']}]] ({h['gm_only']})")
    if "depth" in pages and lang == "da":
        out.append(f"- [[depth.da|{DEPTH_TITLE}]] ({h['gm_only']})")
    out.append(f"- [[recap.player.{lang}|{h['recap']}]] ({h['draft_short']})")
    if "names" in pages:
        out.append(f"- [[{CHECK_PAGE}.{lang}|{CHECK_PAGE}]]")
    out.append(f"- [[transcript.{lang}|{h['transcript']}]] · [[raw.{lang}|{h['raw']}]]")
    out += ["", f"[[index.{other}|{h['other_language']}]]", ""]
    return "\n".join(out)


def write_outputs(
    notes_dir: Path,
    lines: list[Line],
    roster: Roster,
    notes: list[dict[str, Any]],
    session: dict[str, Any] | None,
    depth: dict[int, dict[str, Any]] | None = None,
    extra: dict[str, dict[str, Any] | None] | None = None,
) -> list[Path]:
    """``depth`` is None unless the layers are on (I-066): then the in-depth notes, the character
    and worth-remembering pages are written too (an empty dict means no in-depth notes yet)."""
    notes_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    # No session part means the run did not finish (pending raw scenes, a pause, a failed summary):
    # the scene files say so at the top instead of reading like the final notes.
    incomplete = session is None

    def put(name: str, text: str) -> None:
        path = notes_dir / name
        path.write_text(text, encoding="utf-8", newline="\n")
        written.append(path)

    layers_info: dict[str, Any] | None = None
    optional: set[str] = set()
    if depth is not None:
        optional |= {"characters", "remember", "depth"}
    for lang in LANGS:
        put(f"transcript.{lang}.md", render_transcript(lang, lines, notes, incomplete))
        put(f"scenes.{lang}.md", render_scenes(lang, lines, notes, incomplete))
        put(f"table.{lang}.md", render_table(lang, lines, notes, session, incomplete))
        put(f"summary.{lang}.md", render_summary(lang, session))
        put(f"recap.player.{lang}.md", render_recap(lang, session, (extra or {}).get("moment"), lines))
        put(f"raw.{lang}.md", layers.render_raw(lines, notes, lang))
    if session is not None:
        # the table agenda carries open questions over from session to session (backlog table-agenda)
        carried = agenda.update(notes_dir.parent.parent, notes_dir.parent.name, notes, lines)
        for lang in LANGS:
            put(f"agenda.{lang}.md", agenda.render(carried, lang))
    if depth is not None:
        wanted = [n["index"] for n in notes if not n.get("fallback")]
        depth_complete = not incomplete and all(i in depth for i in wanted)
        put("depth.da.md", layers.render_depth(lines, notes, depth, not depth_complete))
        extra = extra or {}
        for lang in LANGS:
            chars = extra.get("characters")
            put(f"characters.{lang}.md", extras.render_characters(lang, lines, roster, chars))
            put(f"remember.{lang}.md", extras.render_remember(lang, lines, extra.get("remember")))
        chars_done = not incomplete and extra.get("characters") is not None
        remember_done = not incomplete and extra.get("remember") is not None
        layers_info = {
            "depth_complete": depth_complete,
            "characters_complete": chars_done,
            "remember_complete": remember_done,
        }
        incomplete = incomplete or not (depth_complete and chars_done and remember_done)
    for lang in LANGS:
        pages = set(optional)
        if (notes_dir / f"{CHECK_PAGE}.{lang}.md").exists():
            pages.add("names")
        put(
            f"index.{lang}.md",
            render_index(lang, notes_dir.parent.name, lines, roster, session, pages, incomplete),
        )
    put(
        "notes.json",
        json.dumps(
            {
                "roster": roster.players,
                "names": roster.names,
                "complete": session is not None,
                "scenes": notes,
                "session": session,
                "depth": {str(k): v for k, v in (depth or {}).items()} or None,
                "characters": (extra or {}).get("characters"),
                "remember": (extra or {}).get("remember"),
                "moment": (extra or {}).get("moment"),
                "layers": layers_info,
            },
            ensure_ascii=False,
            indent=1,
        ),
    )
    return written
