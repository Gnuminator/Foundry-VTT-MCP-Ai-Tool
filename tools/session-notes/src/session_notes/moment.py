"""The moment of the night (idea 2.12): Claude picks one moment from the session by itself.

No vote. One Claude call after the scene notes (subscription only, D-066) reads the scenes (their
events, decisions and quotes, never the GM-only lists) and, when the Foundry chat log was saved
next to the session, the rolls of the night. It picks the one moment the table would want to
remember (the best, the funniest, the bravest), says why in one line, and cites the transcript
lines, so the recap shows a timestamp link. The moment goes at the end of the player recap draft,
which the GM approves like the rest; nothing is sent from here.

Positive only: never a ranking of players, never a low point of someone's play.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .fmt import stamp
from .model import Line, Roster
from .prompts import _IDS, _STR, PRONOUN_RULE, _list, _obj, roster_block

MOMENT = _obj(da=_STR, en=_STR, reason_da=_STR, reason_en=_STR, cites=_IDS)
MOMENT_SCHEMA = _obj(moments=_list(MOMENT))

MAX_CHARS = 120_000
CHAT_ROWS = 60

RULES = """\
You get the scene notes of one Dungeons & Dragons session (events, decisions, quotes) and
sometimes the dice rolls from the Foundry chat log. Pick ONE moment of the night that the table
would most want to remember: the best, the funniest or the bravest. You decide alone; nobody votes.
Produce the JSON described by the schema.

- moments: exactly one entry, or an empty list when nothing in the notes stands out (a session
  of pure planning or rules talk).
- da / en: the moment in one or two sentences, in the story or at the table, told so a player who
  was there smiles. Name the character, not a ranking of people.
- reason_da / reason_en: one short line on why you picked it ("the whole table laughed", "a close
  fight turned on one roll").
- cites: 1 to 3 line ids from the notes where the moment happens, the first one at its start.
- Positive moments only. Never a mistake, a low roll played for blame, or a comparison of players.
- Use only what is in the notes. Never invent. The notes hold nothing the GM keeps secret, so
  tell nothing beyond them.
- Game terms stay English in both languages: attack, saving throw, hit points, armor class,
  initiative, spell slot, advantage, token, D&D. The Danish text is Danish sentences with these.
- Write both languages, the same content.
"""


def _slim(scene: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"scene": scene["index"], "title": scene.get("title_en")}
    for key in ("events", "decisions"):
        rows = [{"en": e.get("en"), "cites": e.get("cites", [])} for e in scene.get(key) or []]
        if rows:
            out[key] = rows
    quotes = [{"id": q.get("id"), "said": q.get("en") or q.get("spoken")} for q in scene.get("quotes") or []]
    if quotes:
        out["quotes"] = quotes
    return out


def _chat(session: Path) -> list[dict[str, Any]]:
    """Up to CHAT_ROWS rows of ``chat-log.json`` (the Foundry side, saved by the Claude session)."""
    try:
        rows = json.loads((session / "chat-log.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(rows, list):
        return []
    keep = [r for r in rows if isinstance(r, dict) and r.get("text")]
    return [{"time": r.get("time"), "who": r.get("who"), "text": str(r["text"])[:160]} for r in keep[:CHAT_ROWS]]


def scenes_body(scenes: list[dict[str, Any]]) -> str:
    slim = [_slim(s) for s in scenes if not s.get("fallback")]
    body = json.dumps(slim, ensure_ascii=False, indent=1)
    if len(body) > MAX_CHARS:  # a very long night: the first events of each scene are enough
        for s in slim:
            s.pop("decisions", None)
            s["events"] = (s.get("events") or [])[:4]
        body = json.dumps(slim, ensure_ascii=False)[:MAX_CHARS]
    return body


def prompt(scenes: list[dict[str, Any]], roster: Roster, session: Path) -> str:
    chat = _chat(session)
    log = f"\nDice rolls and chat of the night (JSON):\n{json.dumps(chat, ensure_ascii=False)}\n" if chat else ""
    return f"{RULES}\n{roster_block(roster)}\n{PRONOUN_RULE}\n{log}\nScene notes (JSON):\n{scenes_body(scenes)}"


def check(result: dict[str, Any], known: set[str]) -> list[str]:
    moments = result.get("moments")
    if not isinstance(moments, list):
        return ["no moments list"]
    if len(moments) > 1:
        return ["more than one moment: pick exactly one"]
    problems = []
    for m in moments:
        if not all(str(m.get(k, "")).strip() for k in ("da", "en", "reason_da", "reason_en")):
            problems.append("the moment lacks Danish or English text or a reason")
        if not any(c in known for c in m.get("cites", [])):
            problems.append("the moment cites no known line")
    return problems


def repair(result: dict[str, Any], known: set[str]) -> None:
    for m in result.get("moments") or []:
        m["cites"] = [c for c in m.get("cites", []) if c in known]


HEAD = {"da": "Aftenens øjeblik", "en": "Moment of the night"}


def render(lang: str, result: dict[str, Any] | None, lines: list[Line]) -> str:
    """The block appended to the player recap; empty when there is no moment."""
    moments = (result or {}).get("moments") or []
    if not moments:
        return ""
    m = moments[0]
    starts = {ln.id: ln.start for ln in lines}
    why = str(m.get(f"reason_{lang}", "")).strip()
    return f"## {HEAD[lang]}\n\n{str(m[lang]).strip()}{stamp(m.get('cites', []), lang, starts)}\n\n*{why}*\n"
