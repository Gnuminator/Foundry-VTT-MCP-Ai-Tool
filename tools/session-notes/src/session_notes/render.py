"""Write the notes as Markdown (Obsidian-friendly) plus one JSON file with everything.

Per language (``da``, ``en``), in ``<session>/notes/``:

* ``transcript.<lang>.md``: L1, the cleaned transcript by scene; each line ends with its block
  anchor ``^u000123`` so notes can link to it.
* ``scenes.<lang>.md``: L2, per scene the summary, events, decisions, NPCs, loot, threads, dice,
  quotes, and a GM-only section; every entry links to the transcript lines it is based on.
* ``summary.<lang>.md``: L3 for the GM.
* ``recap.player.<lang>.md``: L3 for the players, a draft until the GM approves it.

Plus ``notes.json`` (all of it, for later steps such as the journal page for the recap).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .model import Line, Roster, clock

LANGS = ("da", "en")
HEAD = {
    "da": {
        "transcript": "Transskription",
        "scenes": "Scener",
        "summary": "Resumé",
        "recap": "Resumé til spillerne",
        "draft": "Kladde: venter på GM'ens godkendelse. Ikke til spillerne endnu.",
        "missing": "Ikke skrevet endnu (kør session-notes igen).",
        "changed": "Hvad ændrede sig",
        "fallback": "Denne scene kunne ikke behandles; transskriptionen er rå.",
        "ooc": "uden for spillet",
        "sections": {
            "events": "Hændelser",
            "decisions": "Beslutninger",
            "npcs": "NPC'er",
            "loot": "Fund og tab",
            "threads": "Åbne tråde",
            "dice": "Terninger",
            "quotes": "Citater",
            "gm_only": "Kun for GM",
        },
    },
    "en": {
        "transcript": "Transcript",
        "scenes": "Scenes",
        "summary": "Summary",
        "recap": "Recap for the players",
        "draft": "Draft: waiting for the GM's approval. Not for players yet.",
        "missing": "Not written yet (run session-notes again).",
        "changed": "What changed",
        "fallback": "This scene could not be processed; the transcript is raw.",
        "ooc": "out of character",
        "sections": {
            "events": "Events",
            "decisions": "Decisions",
            "npcs": "NPCs",
            "loot": "Loot and losses",
            "threads": "Open threads",
            "dice": "Dice",
            "quotes": "Quotes",
            "gm_only": "GM only",
        },
    },
}


def _cite(ids: list[str], lang: str, starts: dict[str, float]) -> str:
    links = [f"[[transcript.{lang}#^{i}|{clock(starts[i])}]]" for i in ids if i in starts]
    return f" ({', '.join(links)})" if links else ""


def render_transcript(lang: str, lines: list[Line], notes: list[dict[str, Any]]) -> str:
    h = HEAD[lang]
    by_id = {ln.id: ln for ln in lines}
    out = [f"# {h['transcript']}", ""]
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


def render_scenes(lang: str, lines: list[Line], notes: list[dict[str, Any]]) -> str:
    h = HEAD[lang]
    starts = {ln.id: ln.start for ln in lines}
    out = [f"# {h['scenes']}", ""]
    for scene in notes:
        out += [
            f"## {scene['index']}. {scene[f'title_{lang}']}",
            f"*{clock(scene['start'])} to {clock(scene['end'])}*",
            "",
        ]
        if scene[f"summary_{lang}"]:
            out += [scene[f"summary_{lang}"], ""]
        for key, title in h["sections"].items():
            entries = scene.get(key) or []
            if not entries:
                continue
            out += [f"### {title}", ""]
            for e in entries:
                if key == "quotes":
                    out.append(f"- \"{e[lang]}\"{_cite([e['id']], lang, starts)}")
                elif key == "npcs":
                    out.append(f"- **{e['name']}**: {e[lang]}{_cite(e['cites'], lang, starts)}")
                else:
                    out.append(f"- {e[lang]}{_cite(e['cites'], lang, starts)}")
            out.append("")
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


def render_recap(lang: str, session: dict[str, Any] | None) -> str:
    h = HEAD[lang]
    if session is None:
        return f"# {h['recap']}\n\n{h['missing']}\n"
    return (
        f"# {h['recap']}: {session[f'title_{lang}']}\n\n> {h['draft']}\n\n"
        f"{session[f'recap_player_{lang}']}\n"
    )


def write_outputs(
    notes_dir: Path,
    lines: list[Line],
    roster: Roster,
    notes: list[dict[str, Any]],
    session: dict[str, Any] | None,
) -> list[Path]:
    notes_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    def put(name: str, text: str) -> None:
        path = notes_dir / name
        path.write_text(text, encoding="utf-8", newline="\n")
        written.append(path)

    for lang in LANGS:
        put(f"transcript.{lang}.md", render_transcript(lang, lines, notes))
        put(f"scenes.{lang}.md", render_scenes(lang, lines, notes))
        put(f"summary.{lang}.md", render_summary(lang, session))
        put(f"recap.player.{lang}.md", render_recap(lang, session))
    put(
        "notes.json",
        json.dumps(
            {"roster": roster.players, "names": roster.names, "scenes": notes, "session": session},
            ensure_ascii=False,
            indent=1,
        ),
    )
    return written
