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
# A quote keeps the words as spoken (`spoken`, in `spoken_lang`); `en` is the English translation
# (the spoken words again when they were English).
QUOTE = _obj(id=_STR, spoken=_STR, spoken_lang={"type": "string", "enum": ["da", "en"]}, en=_STR)
SETTINGS = ("game", "table", "mixed")
TABLE_TOPICS = ("house_rules", "proposed", "play_style", "absence", "planning", "open")
TABLE_ITEM = _obj(
    topic={"type": "string", "enum": list(TABLE_TOPICS)}, da=_STR, en=_STR, cites=_IDS
)
TABLE_NOTE = _obj(da=_STR, en=_STR)
LINE = _obj(id=_STR, da=_STR, en=_STR, ooc={"type": "boolean"})

SCENE_SCHEMA = _obj(
    lines=_list(LINE),
    title_da=_STR,
    title_en=_STR,
    summary_da=_STR,
    summary_en=_STR,
    setting={"type": "string", "enum": list(SETTINGS)},
    events=_list(ITEM),
    decisions=_list(ITEM),
    npcs=_list(NPC),
    threads=_list(ITEM),
    quotes=_list(QUOTE),
    gm_only=_list(ITEM),
    table=_list(TABLE_ITEM),
    table_note=TABLE_NOTE,
)

SESSION_SCHEMA = _obj(
    title_da=_STR,
    title_en=_STR,
    summary_da=_STR,
    summary_en=_STR,
    in_short_da=_list(_STR),
    in_short_en=_list(_STR),
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
- Every line of the scene is either in the game or at the table. In the game: the GM's narration
  and rulings, and what the characters say and do. At the table: rules talk, house rules, how the
  group plays, who can or cannot come, planning the next session, jokes, tech trouble, a
  player's wish about their own character. Never write table talk as something a character
  chose or did.
- setting: "game" when the scene is played, "table" when the whole scene is at the table
  (character creation talk, rules debates, planning), "mixed" when it has both.
- events: what happened in the story, in order, one line per beat. Items, money or information
  gained or lost, and natural 20s, natural 1s or rolls that changed the outcome dramatically, are
  events too, not lists of their own. Only in-game events.
- decisions: in-game choices a character or the party made. Empty when none.
- npcs: non-player characters who appear or are talked about (not the player characters).
  Give each NPC `name_da` and `name_en`: a proper name stays as spoken in both; a title or
  description the table uses as a name is translated (Danish "Kommandøren" is "The Commander" in
  `name_en`, "Fuld soldat" is "Drunk soldier"), so English notes never carry Danish labels.
  `da` and `en` are one line on who they are; say "only heard of here" ("kun omtalt her") when
  the NPC was talked about but not met.
  One NPC is one entry: when speech recognition or the table spells the same name in several
  ways (Vesperholt, Vesperhult), use one entry, put the best spelling in the name fields and the
  other spellings in `aliases` (empty list when there are none).
- threads: open in-game questions and hooks, each phrased as a question.
- quotes: at most three memorable in-game lines, by line id. `spoken` is the speaker's words as
  said (cleaned like the lines), `spoken_lang` the language they were said in, `en` the English
  translation (the same words again when they were said in English).
- gm_only: things players should not read in a recap: GM asides, secrets the GM says aloud to
  one player, hidden rolls, plans for later. Keep them out of the other lists.
- table: what was said at the table, one entry per point. `topic` is exactly one of:
  house_rules (a rule the table settled), proposed (suggested but not settled), play_style (how
  the group wants to play, tone, safety, what to run from), absence (who cannot come or leaves
  early), planning (dates, the next session, who brings what), open (a question the table left
  open). A player's wish about their own character goes here as play_style, naming the player.
- table_note: one short phrase on what was talked about at the table, used as a pointer line in
  the notes ("permadeath, the fumble rule and loot were settled"). Empty strings when the scene
  has nothing at the table.
- Name characters, not players, wherever the roster says who plays whom (except in table
  entries, which are about the players).
- Pronouns: use the pronouns the roster gives for a person. Where it gives none, use they/them
  (or the name); never guess someone's pronouns from a name or a role, and never write "she" for
  the GM unless the roster says so.
- Every entry cites the line ids it is based on. Never invent anything; leave a list empty
  when the scene has nothing for it. Name variants and spelling guesses are not notes.
- title: a short scene title. summary: for a "game" or "mixed" scene 2 to 3 sentences; for a "table"
  scene exactly 2 sentences saying what the table talked about and settled. Never write a
  placeholder, "n/a" or a bare label as a summary. Both languages.
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
- title: a short title for the session; start it with "Session N:" (Danish "Session N:") when the notes
  say which session number it is.
- in_short: exactly 5 one-line points, in story order, for the start page: the first about the
  session as a whole, the last ends with the date of the next session if the notes say so
  (otherwise it ends with what comes next). Counts of people or things (brothers, party members)
  only as the notes give them.
- summary: up to 400 words for the GM (shorter when little happened), in story order, may include gm_only material, written as ordinary sentences with no
  English labels in the Danish text (never "GM only:"; Danish says "Kun for GM").
- changed: up to 8 bullets on what changed in the world or for the party (none if nothing did).
- recap_player: up to 300 words for the players (a sentence or two when little happened), addressed to the party (English "you",
  Danish "I"), written as a "previously on" recap. It must not contain anything from any gm_only list, no
  hidden rolls, no GM plans, and nothing the characters could not know. Dice: only natural 20s,
  natural 1s and dramatic moments. Use character names, not player names. The GM approves it
  before any player sees it.
Use only what is in the notes. Table entries (house rules, planning) may appear in in_short and
the summary as table agreements, never as something a character did; keep them out of the recap.
"""


PRONOUN_RULE = (
    "Pronouns: use the ones the roster gives; where it gives none use they/them or the name. "
    "Never guess from a name or a role."
)


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
