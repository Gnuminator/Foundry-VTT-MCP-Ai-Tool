"""Two more GM-only layers per session: character pages and worth-remembering notes.

* ``characters.<lang>.md``: one section per player character (what they revealed about
  themselves, choices made, ties to other characters and NPCs, open personal hooks).
* ``remember.<lang>.md``: facts, names, places, promises, hooks and table agreements worth
  keeping for later sessions (session 0 talk counts: house rules, ties agreed at the table).

One Claude call per layer for the whole session (subscription only, D-066), written in Danish
and English together from the scene notes. Only a session too long for one prompt is split by
scene; the chunk results are then merged. Every point cites transcript line ids like the scene
notes do. Both layers are GM only: they are never part of the player recap.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from .model import Line, Roster, clock, is_gm
from .prompts import PRONOUN_RULE, _IDS, _STR, _list, _obj, roster_block

POINT = _obj(da=_STR, en=_STR, cites=_IDS)
CHARACTER = _obj(
    name=_STR,
    player=_STR,
    revealed=_list(POINT),
    choices=_list(POINT),
    ties=_list(POINT),
    hooks=_list(POINT),
)
CHARACTERS_SCHEMA = _obj(characters=_list(CHARACTER))

LAYERS = ("characters", "remember")
KINDS = ("fact", "name", "place", "promise", "hook", "agreement")
REMEMBER_ITEM = _obj(kind=_STR, da=_STR, en=_STR, cites=_IDS)
REMEMBER_SCHEMA = _obj(items=_list(REMEMBER_ITEM))

# A prompt over this many characters of scene notes is split by scene (about 60k tokens).
MAX_CHUNK_CHARS = 180_000

GAME_TERMS = """\
- Game terms stay English in both languages, as the table says them: attack, saving throw,
  hit points, armor class, initiative, spell slot, advantage, token, D&D, and the like. The Danish
  text is Danish sentences with these English words, never "redningskast" or "angreb".
- Write both languages for every point: `da` Danish, `en` English, the same content.
- Use only what is in the notes. Never invent; leave a list empty when there is nothing.
- Every point cites 1 to 5 line ids it is based on, taken from the cites of the notes you were
  given. Never make up an id.
- GM secrets and hidden plans are allowed (this layer is GM only), worded as such.
- Numbers only as they appear in the notes; never work out a number yourself.
"""

CHARACTERS_RULES = (
    """\
You get the scene notes of one Dungeons & Dragons session (it can be a session 0 with mostly
character talk). Write one section per player character in the roster, for the
GM, who wants to see what each character is about without rereading the session. Produce the JSON
described by the schema.

- characters: one entry per player character in the roster (name = the character, player = the
  player), in roster order, also when little was said (then the lists are empty).
- revealed: what the character, or the player speaking for them, revealed about themselves:
  background, goals, fears, secrets, personality, appearance, class and abilities as stated.
- choices: decisions the character made and what they did that shows who they are.
- ties: ties to other characters and NPCs: relationships, debts, rivalries, shared history,
  including ties agreed at the table.
- hooks: open personal hooks the GM can use later: unresolved backstory, promised things,
  questions the character wants answered.
- Keep out-of-character table talk out, except where it settles something about the character
  (a background detail agreed, a tie agreed between two players).
"""
    + GAME_TERMS
)

REMEMBER_RULES = (
    """\
You get the scene notes of one Dungeons & Dragons session. Pick what is worth keeping for later
sessions and write it as a flat list for the GM. Produce the JSON described by the schema.

- items: each one a single fact worth keeping. `kind` is exactly one of: fact (something true
  about the world or the story), name (a person, creature or item and who or what it is),
  place (a location and what matters about it), promise (something promised, owed or threatened),
  hook (an open question or loose thread), agreement (a table agreement: house rules, how the
  group plays, ties agreed between characters, plans for next session).
- Session 0 style talk counts: house rules, character ties agreed at the table, expectations.
- Skip what only mattered in the moment (one roll, a joke, a snack break).
- Prefer fewer, sharper items over a copy of the scene notes: 10 to 40 items for a long session,
  a handful for a short one. Merge duplicates.
"""
    + GAME_TERMS
)


def player_characters(roster: Roster) -> list[tuple[str, str]]:
    """(character, player) for every non-GM player; the character falls back to the player."""
    return [(c or p, p) for p, c in roster.players.items() if not is_gm(c) and not is_gm(p)]


def _slim(scene: dict[str, Any]) -> dict[str, Any]:
    keep = ("events", "decisions", "npcs", "loot", "threads", "dice", "gm_only")
    out: dict[str, Any] = {
        "scene": scene["index"],
        "title": scene.get("title_en"),
        "summary": scene.get("summary_en"),
    }
    for key in keep:
        entries = scene.get(key) or []
        if entries:
            out[key] = [
                {k: v for k, v in e.items() if k in ("name", "name_da", "name_en", "aliases", "en", "cites")} for e in entries
            ]
    return out


def chunk_scenes(scenes: list[dict[str, Any]], limit: int = MAX_CHUNK_CHARS) -> list[list[dict]]:
    """Whole session in one chunk when it fits, else consecutive scenes up to ``limit`` chars."""
    chunks: list[list[dict[str, Any]]] = []
    size = 0
    for scene in scenes:
        if scene.get("fallback"):
            continue
        n = len(json.dumps(_slim(scene), ensure_ascii=False))
        if not chunks or size + n > limit:
            chunks.append([])
            size = 0
        chunks[-1].append(scene)
        size += n
    return chunks


def _body(chunk: list[dict[str, Any]]) -> str:
    return json.dumps([_slim(s) for s in chunk], ensure_ascii=False, indent=1)


def characters_prompt(chunk: list[dict[str, Any]], roster: Roster, part: str = "") -> str:
    pcs = "\n".join(f"- {c} (played by {p})" for c, p in player_characters(roster))
    return (
        f"{CHARACTERS_RULES}\n{roster_block(roster)}\n{PRONOUN_RULE}\nPlayer characters:\n{pcs}\n"
        f"{part}\nScene notes (JSON):\n{_body(chunk)}"
    )


def remember_prompt(chunk: list[dict[str, Any]], roster: Roster, part: str = "") -> str:
    return f"{REMEMBER_RULES}\n{roster_block(roster)}\n{PRONOUN_RULE}\n{part}\nScene notes (JSON):\n{_body(chunk)}"


def part_note(i: int, total: int) -> str:
    return f"This is part {i} of {total} of the session (consecutive scenes).\n" if total > 1 else ""


def known_ids(lines: list[Line]) -> set[str]:
    return {ln.id for ln in lines}


def _points(entry: dict[str, Any]) -> list[dict[str, Any]]:
    return [p for key in ("revealed", "choices", "ties", "hooks") for p in entry.get(key) or []]


def check_characters(result: dict[str, Any], roster: Roster, known: set[str]) -> list[str]:
    """Hard problems that send the call back to Claude."""
    chars = result.get("characters")
    if not isinstance(chars, list):
        return ["no characters list"]
    wanted = [c for c, _ in player_characters(roster)]
    if wanted and not chars:
        return ["no characters although the roster has player characters"]
    problems = []
    names = {str(c.get("name", "")).strip().lower() for c in chars}
    missing = [w for w in wanted if w.strip().lower() not in names]
    if missing and len(missing) == len(wanted):
        problems.append(f"none of the roster characters appear ({', '.join(missing)})")
    points = [p for c in chars for p in _points(c)]
    if any(not (str(p.get("da", "")).strip() and str(p.get("en", "")).strip()) for p in points):
        problems.append("a point lacks Danish or English text")
    if points and not any(c in known for p in points for c in p.get("cites", [])):
        problems.append("no point cites a known line")
    return problems


def check_remember(result: dict[str, Any], known: set[str]) -> list[str]:
    items = result.get("items")
    if not isinstance(items, list):
        return ["no items list"]
    problems = []
    if any(not (str(i.get("da", "")).strip() and str(i.get("en", "")).strip()) for i in items):
        problems.append("an item lacks Danish or English text")
    if items and not any(c in known for i in items for c in i.get("cites", [])):
        problems.append("no item cites a known line")
    return problems


def repair(result: dict[str, Any], known: set[str]) -> list[str]:
    """Drop citations of unknown lines in place; return a log."""
    log = []
    entries = result.get("items") or [p for c in result.get("characters", []) for p in _points(c)]
    for entry in entries:
        bad = [c for c in entry.get("cites", []) if c not in known]
        if bad:
            entry["cites"] = [c for c in entry["cites"] if c in known]
            log.append(f"dropped unknown citations {bad[:3]}")
    return log


def merge_characters(parts: list[dict[str, Any]]) -> dict[str, Any]:
    """Join chunk results: one entry per character (by name), lists appended in order."""
    merged: dict[str, dict[str, Any]] = {}
    for part in parts:
        for c in part.get("characters", []):
            key = str(c.get("name", "")).strip().lower()
            cur = merged.setdefault(
                key, {**c, "revealed": [], "choices": [], "ties": [], "hooks": []}
            )
            for field in ("revealed", "choices", "ties", "hooks"):
                cur[field] = cur[field] + list(c.get(field) or [])
    return {"characters": list(merged.values())}


def merge_remember(parts: list[dict[str, Any]]) -> dict[str, Any]:
    seen: set[tuple[str, str]] = set()
    items = []
    for part in parts:
        for i in part.get("items", []):
            ident = (str(i.get("kind")), str(i.get("en", "")).strip().lower())
            if ident not in seen:
                seen.add(ident)
                items.append(i)
    return {"items": items}


def chunk_key(kind: str, chunk: list[dict[str, Any]], roster: Roster, total: int = 1) -> str:
    rules = CHARACTERS_RULES if kind == "characters" else REMEMBER_RULES
    blob = json.dumps(
        [
            kind,
            total,
            roster.players,
            roster.pronouns,
            _body(chunk),
            hashlib.sha256(rules.encode("utf-8")).hexdigest(),
        ],
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# --- rendering ----------------------------------------------------------------------------------

HEAD = {
    "da": {
        "characters": "Personer",
        "remember": "Værd at huske",
        "note": "Kun for GM: kan indeholde hemmeligheder. Hvert punkt linker til linjerne i "
        "transskriptionen.",
        "missing": "Ikke skrevet endnu (kør session-notes igen).",
        "gave_up": "Kunne ikke skrives efter flere forsøg. Slet notes/.work/extra-*.json og kør igen.",
        "none": "Intet noteret.",
        "played_by": "spilles af",
        "sections": {
            "revealed": "Det har de afsløret om sig selv",
            "choices": "Valg",
            "ties": "Bånd til andre",
            "hooks": "Åbne personlige hooks",
        },
        "kinds": {
            "fact": "Fakta",
            "name": "Navne",
            "place": "Steder",
            "promise": "Løfter",
            "hook": "Hooks og løse tråde",
            "agreement": "Aftaler ved bordet",
            "other": "Andet",
        },
    },
    "en": {
        "characters": "Characters",
        "remember": "Worth remembering",
        "note": "GM only: may contain secrets. Each point links to the transcript lines.",
        "missing": "Not written yet (run session-notes again).",
        "gave_up": "Could not be written after several tries. Delete notes/.work/extra-*.json and run again.",
        "none": "Nothing noted.",
        "played_by": "played by",
        "sections": {
            "revealed": "What they revealed about themselves",
            "choices": "Choices",
            "ties": "Ties to others",
            "hooks": "Open personal hooks",
        },
        "kinds": {
            "fact": "Facts",
            "name": "Names",
            "place": "Places",
            "promise": "Promises",
            "hook": "Hooks and loose threads",
            "agreement": "Table agreements",
            "other": "Other",
        },
    },
}


def _cite(ids: list[str], lang: str, starts: dict[str, float]) -> str:
    links = [f"[[transcript.{lang}#^{i}|{clock(starts[i])}]]" for i in ids if i in starts]
    return f" ({', '.join(links)})" if links else ""


def _order(chars: list[dict[str, Any]], roster: Roster) -> list[dict[str, Any]]:
    rank = {c.strip().lower(): n for n, (c, _) in enumerate(player_characters(roster))}
    return sorted(chars, key=lambda c: rank.get(str(c.get("name", "")).strip().lower(), 999))


def render_characters(
    lang: str,
    lines: list[Line],
    roster: Roster,
    result: dict[str, Any] | None,
) -> str:
    h = HEAD[lang]
    out = [f"# {h['characters']}", ""]
    if result is None:
        return "\n".join(out + [f"> {h['missing']}", ""])
    if result.get("fallback"):
        return "\n".join(out + [f"> {h['gave_up']}", ""])
    starts = {ln.id: ln.start for ln in lines}
    out += [f"> {h['note']}", ""]
    for c in _order(result.get("characters", []), roster):
        who = f" ({h['played_by']} {c['player']})" if c.get("player") else ""
        out += [f"## {c['name']}{who}", ""]
        for key, title in h["sections"].items():
            pts = c.get(key) or []
            if not pts:
                continue
            out += [f"### {title}", ""]
            out += [f"- {p[lang]}{_cite(p.get('cites', []), lang, starts)}" for p in pts]
            out.append("")
    return "\n".join(out)


def render_remember(lang: str, lines: list[Line], result: dict[str, Any] | None) -> str:
    h = HEAD[lang]
    out = [f"# {h['remember']}", ""]
    if result is None:
        return "\n".join(out + [f"> {h['missing']}", ""])
    if result.get("fallback"):
        return "\n".join(out + [f"> {h['gave_up']}", ""])
    starts = {ln.id: ln.start for ln in lines}
    out += [f"> {h['note']}", ""]
    items = result.get("items") or []
    if not items:
        return "\n".join(out + [h["none"], ""])
    for kind in (*KINDS, "other"):
        group = [i for i in items if (i.get("kind") if i.get("kind") in KINDS else "other") == kind]
        if not group:
            continue
        out += [f"## {h['kinds'][kind]}", ""]
        out += [f"- {i[lang]}{_cite(i.get('cites', []), lang, starts)}" for i in group]
        out.append("")
    return "\n".join(out)
