"""Prompts and JSON schemas for the two kinds of call: one per scene, one for the session."""

from __future__ import annotations

import json
from typing import Any

from .model import Roster, Scene, clock, is_gm

_STR = {"type": "string"}
_IDS = {"type": "array", "items": {"type": "string"}}


def _obj(**props: Any) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": props,
        "required": list(props),
        "additionalProperties": False,
    }


def _list(item: dict[str, Any]) -> dict[str, Any]:
    return {"type": "array", "items": item}


ITEM = _obj(da=_STR, en=_STR, cites=_IDS)
NPC = _obj(
    name_da=_STR, name_en=_STR, aliases={"type": "array", "items": _STR}, da=_STR, en=_STR, cites=_IDS
)
QUOTE = _obj(id=_STR, da=_STR, en=_STR)
LINE = _obj(id=_STR, da=_STR, en=_STR, ooc={"type": "boolean"})

SCENE_SCHEMA = _obj(
    lines=_list(LINE),
    title_da=_STR,
    title_en=_STR,
    summary_da=_STR,
    summary_en=_STR,
    events=_list(ITEM),
    decisions=_list(ITEM),
    npcs=_list(NPC),
    loot=_list(ITEM),
    threads=_list(ITEM),
    dice=_list(ITEM),
    quotes=_list(QUOTE),
    gm_only=_list(ITEM),
)

SESSION_SCHEMA = _obj(
    title_da=_STR,
    title_en=_STR,
    summary_da=_STR,
    summary_en=_STR,
    changed_da=_list(_STR),
    changed_en=_list(_STR),
    recap_player_da=_STR,
    recap_player_en=_STR,
)

SCENE_RULES = """\
You get one scene of a Dungeons & Dragons session, transcribed per speaker by speech recognition.
The table speaks mostly Danish, sometimes English. Produce the JSON described by the schema.

Lines (the cleaned transcript):
- Return every input line exactly once, same id, same order. Never merge, split, drop or add lines.
- The line in its own language: fix only speech-recognition errors (misheard words, names from
  the known names list, broken punctuation). Keep the speaker's own words, fillers can go.
  Do not summarise or polish.
- The other language: a faithful translation. `da` is Danish, `en` is English; a line spoken in
  English gets its cleaned English in `en` and a Danish translation in `da`, and vice versa.
- Game terms stay English in both languages, as the table says them: attack, saving throw,
  hit points, armor class, initiative, spell slot, advantage, token, D&D, and the like. The Danish
  text is Danish sentences with these English words (for example "han klarede sit saving throw"),
  never a pure Danish translation such as "redningskast" or "angreb".
- `ooc` is true for out-of-character table talk (rules talk, snacks, tech trouble, jokes about
  the real world), false for play, narration and in-character speech.

Notes (Danish `da` and English `en` for every entry):
- Notes come from play: the GM's narration and rulings, and what the characters say and do.
  Out-of-character talk (memories of earlier sessions, jokes, opinions about the game, rules
  debates) is not an event; use it only where it settles something in the game (a ruling,
  a roll result, a choice).
- Name characters, not players, wherever the roster says who plays whom.
- Pronouns: use the pronouns the roster gives for a person. Where it gives none, use they/them
  (or the name); never guess someone's pronouns from a name or a role, and never write "she" for
  the GM unless the roster says so.
- events: what happened in the story, in order. decisions: choices the party made.
- npcs: non-player characters who appear or are talked about (not the player characters).
  Give each NPC `name_da` and `name_en`: a proper name stays as spoken in both; a title or
  description the table uses as a name is translated (Danish "Kommandøren" is "The Commander" in
  `name_en`, "Fuld soldat" is "Drunk soldier"), so English notes never carry Danish labels.
  One NPC is one entry: when speech recognition or the table spells the same name in several
  ways (Vesperholt, Vesperhult), use one entry, put the best spelling in the name fields and the
  other spellings in `aliases` (empty list when there are none).
- loot: items, money or information gained or lost. threads: open questions and hooks.
- dice: only natural 20s, natural 1s and rolls that changed the outcome dramatically.
- quotes: at most three memorable lines, by line id.
- gm_only: things players should not read in a recap: GM asides, secrets the GM says aloud to
  one player, hidden rolls, plans for later. Keep them out of the other lists.
- Every entry cites the line ids it is based on. Never invent anything; leave a list empty
  when the scene has nothing for it.
- title and summary: a short scene title and 2 to 4 sentences, in both languages.
"""

SESSION_RULES = """\
You get the notes of every scene of one Dungeons & Dragons session. Write, in Danish (`da`) and
English (`en`):
- Game terms stay English in both languages, as the table says them: attack, saving throw,
  hit points, armor class, initiative, spell slot, advantage, token, D&D, and the like. The Danish
  text is Danish sentences with these English words (for example "han klarede sit saving throw"),
  never a pure Danish translation such as "redningskast" or "angreb".
- Pronouns: use the pronouns the roster gives for a person; where it gives none, use they/them
  (or the name). Never guess from a name or a role, and never write "she" for the GM unless the
  roster says so.
- NPCs: in the English text use each NPC's `name_en` from the notes, in the Danish text
  `name_da`; never leave a Danish label in English text.
- title: a short title for the session.
- summary: up to 400 words for the GM (shorter when little happened), in story order, may include gm_only material.
- changed: up to 8 bullets on what changed in the world or for the party (none if nothing did).
- recap_player: up to 300 words for the players (a sentence or two when little happened), addressed to the party (English "you",
  Danish "I"), written as a "previously on" recap. It must not contain anything from any gm_only list, no
  hidden rolls, no GM plans, and nothing the characters could not know. Dice: only natural 20s,
  natural 1s and dramatic moments. Use character names, not player names. The GM approves it
  before any player sees it.
Use only what is in the notes. Leave out table talk that did not happen in the game.
"""


def _pron(roster: Roster, player: str) -> str:
    pr = roster.pronouns.get(player)
    return f" ({pr})" if pr else " (pronouns not given: use they/them)"


def roster_block(roster: Roster) -> str:
    rows = []
    for p, c in roster.players.items():
        if is_gm(c):
            rows.append(f"- {p} is the GM (narrates, rules, plays all NPCs){_pron(roster, p)}")
        elif c and c != p:
            rows.append(f"- {p} plays {c}{_pron(roster, p)}")
        else:
            rows.append(f"- {p} (character unknown){_pron(roster, p)}")
    names = ", ".join(roster.names) if roster.names else "(none given)"
    return "Players:\n" + "\n".join(rows) + f"\nKnown names (spell them like this): {names}\n"


def scene_prompt(scene: Scene, roster: Roster) -> str:
    body = []
    for line in scene.lines:
        who = line.player if line.character == line.player else f"{line.player} ({line.character})"
        hint = f"  [unsure: {', '.join(line.uncertain)}]" if line.uncertain else ""
        body.append(f"{line.id} [{clock(line.start)}] {who}: {line.text}{hint}")
    return (
        f"{SCENE_RULES}\n{roster_block(roster)}\n"
        f"Scene {scene.index}, {clock(scene.start)} to {clock(scene.end)}:\n" + "\n".join(body)
    )


def session_prompt(scene_notes: list[dict[str, Any]], roster: Roster) -> str:
    slim = [{k: v for k, v in n.items() if k != "lines"} for n in scene_notes]
    return (
        f"{SESSION_RULES}\n{roster_block(roster)}\nScene notes (JSON):\n"
        + json.dumps(slim, ensure_ascii=False, indent=1)
    )
