"""The three Danish layers of a session (I-066): raw, in-depth and summary.

* raw (``raw.da.md``): the speech recogniser's text exactly as it came, by clock time, with the
  words it was unsure about marked ``[word?]``. No Claude call, so it exists even when a run
  stops early. The word timestamps and confidences stay in ``timeline/timeline.jsonl``.
* in-depth (``depth.da.md``): per scene, a detailed Danish account in beats (who said and did
  what, rulings, names, numbers said aloud), each beat linked to the cleaned transcript lines.
  One extra Claude call per scene on the subscription (D-066), written for the GM.
* summary: ``summary.da.md``, written by the existing session call.

``index.da.md`` links the layers (and the cleaned transcript and scene notes between them).
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .model import Line, clock
from .prompts import _IDS, _STR, _list, _obj

BEAT = _obj(heading=_STR, text=_STR, cites=_IDS)
DEPTH_SCHEMA = _obj(beats=_list(BEAT))

MIN_WORDS_PER_LONG_SCENE = 60  # a scene of 20+ lines with less than this is too thin
LONG_SCENE_LINES = 20

DEPTH_RULES = """\
You get one scene of a Dungeons & Dragons session as cleaned Danish lines (speech recognition
fixed, out-of-character talk marked "ooc"), plus the short notes already written for the scene.
Write the in-depth notes of the scene in Danish for the GM, who wants to look things up later
without listening to the recording. Produce the JSON described by the schema.

- beats: the scene in order, as a few beats. Aim for one beat per 10 to 20 lines, at least one.
  Each beat has a short heading and a text of 2 to 6 sentences (more when much is decided).
- Say who said or did what, by character name where the roster gives one, else by player name.
  Keep rulings, choices, reasons given, names of people, places and items, and open questions.
- Numbers (damage, rolls, gold, distances) only as they were said aloud; speech recognition
  mishears numbers, so write "omkring" or "efter sigende" when a number is uncertain, and never
  work out a number yourself.
- Game terms stay English as the table says them: attack, saving throw, hit points, armor class,
  initiative, spell slot, advantage, token, D&D, and the like. Danish sentences with these
  English words (for example "han klarede sit saving throw"), never "redningskast" or "angreb".
- Out-of-character talk is covered too, as table talk: what was discussed and decided (for
  example rules rulings, plans for the next session, tool trouble), in its own beats, not mixed
  into the story. A scene that is only table talk gets beats about the topics.
- GM secrets and hidden plans are allowed here (this layer is GM only), clearly worded as such.
- Use only what is in the lines. Never invent; when it is unclear what happened, say so.
- Every beat cites 1 to 5 line ids it is based on, chosen from the lines you were given.
"""


def depth_prompt(
    scene: dict[str, Any], roster_block: str, starts: dict[str, float], who: dict[str, str]
) -> str:
    body = []
    for entry in scene["lines"]:
        tag = " [ooc]" if entry.get("ooc") else ""
        name = who.get(entry["id"], "?")
        body.append(f"{entry['id']} [{clock(starts[entry['id']])}] {name}{tag}: {entry['da']}")
    short = {
        "title": scene["title_da"],
        "summary": scene["summary_da"],
        "events": [e["da"] for e in scene.get("events", [])],
        "decisions": [e["da"] for e in scene.get("decisions", [])],
    }
    return (
        f"{DEPTH_RULES}\n{roster_block}\n"
        f"Scene {scene['index']}, {clock(scene['start'])} to {clock(scene['end'])}.\n"
        f"Notes already written (for orientation only):\n"
        f"{json.dumps(short, ensure_ascii=False, indent=1)}\n\nLines:\n" + "\n".join(body)
    )


def _words(text: str) -> int:
    return len(re.findall(r"\w+", text))


def check_depth(result: dict[str, Any], scene: dict[str, Any]) -> list[str]:
    """Hard problems that send the call back to Claude."""
    beats = result.get("beats") or []
    if not beats:
        return ["no beats"]
    known = {e["id"] for e in scene["lines"]}
    problems = []
    if any(not str(b.get("text", "")).strip() for b in beats):
        problems.append("an empty beat")
    if not any(c in known for b in beats for c in b.get("cites", [])):
        problems.append("no beat cites a line of the scene")
    total = sum(_words(b.get("text", "")) for b in beats)
    if len(scene["lines"]) >= LONG_SCENE_LINES and total < MIN_WORDS_PER_LONG_SCENE:
        problems.append(f"too thin ({total} words for {len(scene['lines'])} lines)")
    return problems


def repair_depth(result: dict[str, Any], scene: dict[str, Any]) -> list[str]:
    """Drop citations of unknown lines in place; return a log of what was dropped."""
    known = {e["id"] for e in scene["lines"]}
    log = []
    for beat in result["beats"]:
        bad = [c for c in beat.get("cites", []) if c not in known]
        if bad:
            beat["cites"] = [c for c in beat["cites"] if c in known]
            log.append(f"dropped unknown citations {bad[:3]}")
    return log


def scene_key(scene: dict[str, Any]) -> str:
    """Cache key: the in-depth notes are about exactly these cleaned lines and notes."""
    blob = json.dumps(
        [
            scene["index"],
            scene["lines"],
            scene["title_da"],
            scene["summary_da"],
            scene.get("events"),
            scene.get("decisions"),
            hashlib.sha256(DEPTH_RULES.encode("utf-8")).hexdigest(),  # new rules, new notes
        ],
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def prompt_context(lines: list[Line]) -> dict[str, str]:
    """line id -> who speaks (character, with the player when they differ)."""
    return {
        ln.id: ln.player if ln.character == ln.player else f"{ln.player} ({ln.character})"
        for ln in lines
    }


# --- rendering ----------------------------------------------------------------------------------

HEAD = {
    "raw": "Rå transskription",
    "raw_note": (
        "Sproggenkendelsens tekst, som den kom: ikke rettet, ikke oversat, med fejl. Ord, den var "
        "i tvivl om, står som [ord?]. Ord for ord med tider ligger i timeline/timeline.jsonl."
    ),
    "depth": "Dybdegående noter",
    "depth_note": "Kun for GM: kan indeholde hemmeligheder. Hvert afsnit linker til linjerne i "
    "transskriptionen.",
    "depth_missing": "Scenen mangler dybdegående noter (kør session-notes igen).",
    "depth_fallback": "Scenen kunne ikke behandles, så der er ingen dybdegående noter.",
    "incomplete": "Ufærdige noter: nogle scener mangler. Kør session-notes igen.",
    "index": "Sessionens noter",
}


def mark_uncertain(line: Line) -> str:
    if not line.uncertain:
        return line.text
    punct = ".,;:!?\"'()"
    unsure = {w.strip(punct).lower() for w in line.uncertain}
    out = []
    for token in line.text.split():
        core = token.strip(punct)
        if core and core.lower() in unsure:
            head = token[: len(token) - len(token.lstrip(punct))]
            tail = token[len(head) + len(core) :]
            out.append(f"{head}[{core}?]{tail}")
        else:
            out.append(token)
    return " ".join(out)


def render_raw(lines: list[Line], scenes: list[dict[str, Any]]) -> str:
    out = [f"# {HEAD['raw']}", "", f"> {HEAD['raw_note']}", ""]
    scene_of: dict[str, int] = {}
    for sc in scenes:
        for entry in sc["lines"]:
            scene_of[entry["id"]] = sc["index"]
    current = None
    for ln in lines:
        idx = scene_of.get(ln.id)
        if idx != current:
            current = idx
            if idx is not None:
                out += [f"## Scene {idx}", ""]
        who = ln.player if ln.character == ln.player else f"{ln.character} ({ln.player})"
        out += [f"**[{clock(ln.start)}] {who}:** {mark_uncertain(ln)} ^{ln.id}", ""]
    return "\n".join(out)


def _cite(ids: list[str], starts: dict[str, float]) -> str:
    links = [f"[[transcript.da#^{i}|{clock(starts[i])}]]" for i in ids if i in starts]
    return f" ({', '.join(links)})" if links else ""


def render_depth(
    lines: list[Line],
    scenes: list[dict[str, Any]],
    depth: dict[int, dict[str, Any]],
    incomplete: bool,
) -> str:
    starts = {ln.id: ln.start for ln in lines}
    out = [f"# {HEAD['depth']}", "", f"> {HEAD['depth_note']}", ""]
    if incomplete:
        out += [f"> **{HEAD['incomplete']}**", ""]
    for sc in scenes:
        out += [
            f"## {sc['index']}. {sc['title_da']}",
            f"*{clock(sc['start'])} to {clock(sc['end'])}*",
            "",
        ]
        notes = depth.get(sc["index"])
        if sc.get("fallback") or (notes is not None and notes.get("fallback")):
            out += [f"> {HEAD['depth_fallback']}", ""]
            continue
        if notes is None:
            out += [f"> {HEAD['depth_missing']}", ""]
            continue
        for beat in notes.get("beats", []):
            cites = _cite(beat.get("cites", []), starts)
            out += [f"### {beat.get('heading', '')}", "", f"{beat.get('text', '')}{cites}", ""]
    return "\n".join(out)


def render_index(session: dict[str, Any] | None, depth_complete: bool) -> str:
    title = session["title_da"] if session else HEAD["index"]
    rows = [
        ("Resumé (kort, til GM)", "summary.da"),
        ("Resumé til spillerne (kladde)", "recap.player.da"),
        (HEAD["depth"] + " (kun GM)", "depth.da"),
        ("Scener (kortfattet pr. scene)", "scenes.da"),
        ("Rettet transskription", "transcript.da"),
        (HEAD["raw"], "raw.da"),
    ]
    out = [f"# {title}", "", "Tre lag, fra kort til ordret:", ""]
    out += [f"- [[{target}|{label}]]" for label, target in rows]
    if not depth_complete:
        out += ["", f"> {HEAD['incomplete']}"]
    return "\n".join(out) + "\n"
