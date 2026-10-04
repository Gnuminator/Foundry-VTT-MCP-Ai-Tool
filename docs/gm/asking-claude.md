---
title: Asking Claude
description: How to use Claude Desktop with the tool, good requests, the ready-made prompts, how Claude's changes are approved, and what Claude cannot do.
---

# Asking Claude

Claude Desktop is where you talk to Claude about your game. Through the bridge, Claude can read your
Foundry world and, when you ask, change it. It works with your Claude subscription; no API key is
needed.

## Before you ask

- Claude Desktop is running. Today it also starts the bridge.
- Foundry is open in your browser and you are logged in as the GM. Without a GM in Foundry, Claude
  cannot reach the game.
- The dashboard shows **Bridge: connected** and **Foundry: live**.

Claude does not watch the game on its own. It reads what it needs at the moment you ask.

## What Claude can reach

- Characters and NPCs: sheets, HP, spell slots, items, effects, conditions.
- The combat tracker, the current scene, tokens and their positions.
- Journals in your world (it can search their text) and compendium entries such as monsters,
  spells and items (it finds them by name).
- Chat, the session log and the play stats (per PC: damage, healing, downs, rolls, spells,
  resources, loot, XP).
- The Tarokka reading and the list of revealed handouts (GM only).

It can also act: roll for NPCs, apply damage or healing, move tokens, set conditions, add NPCs from
compendiums, write journals, send chat messages, and more. The dashboard's tool runner shows every
tool Claude has.

## Good requests

Say exactly what you want, name things the way Foundry names them, and say whether Claude should
only suggest or also act.

- "Which PCs are below half HP, and who has spell slots left?"
- "What happened last session? Use the session log and the play stats."
- "Find three undead of CR 1 to 3 in my compendiums for a party of four level 3 characters."
- "How does grappling work in the 2024 rules? Tell me where in my Foundry books you found it."
- "Roll initiative for the NPCs in the current combat."
- "Deal a new Tarokka reading with the built-in roll. Show me the plan first."
- "Plan revealing the page 'Old letter' in the journal 'Handouts' to the players."

More ready-to-use requests, sorted by before, during and after a session:
[Cookbook](cookbook.md).

Requests that go wrong:

- "Kill the wolf." Which wolf? Several tokens can share a name. Say "Wolf 2" or pick the token.
- "Make the next fight cooler." Too vague. Say what you want: tougher, shorter, more terrain.
- "Fix everything from last night." Claude cannot undo direct actions; see below.

## Tool sets: which switches to turn on

Claude Desktop shows the tool as five entries, one per tool set, each with its own switch in the
**Search and tools** menu under the message box (the exact place can move between Claude Desktop
versions). Claude reads every tool that is switched on at the start of a chat, so fewer switches
means more room for your conversation and fewer wrong picks. The switches stay as you left them for
new chats.

| Entry               | Set   | Turn it on when you want to                                              |
| ------------------- | ----- | ------------------------------------------------------------------------ |
| `foundry-mcp`       | core  | Always. Look things up, and see, apply or undo Claude's planned changes. |
| `foundry-mcp-prep`  | prep  | Prepare a session, write a recap, work on quests, Tarokka or handouts.   |
| `foundry-mcp-build` | build | Make or change NPCs, monsters and items.                                 |
| `foundry-mcp-play`  | play  | Let Claude run things at the table: tokens, combat, rolls, damage, chat. |
| `foundry-mcp-admin` | admin | Check modules and errors, change who owns an actor, the Obsidian mirror. |

A good default: core and prep on, the rest off. If you ask for something that needs a set that is
off, Claude says which one to switch on.

## Ready-made prompts

The tool comes with prompts for common jobs. Claude Desktop lists a connected server's prompts in
its message box (look for the tool's entries, such as `foundry-mcp` and `foundry-mcp-prep`, under
the message box's **+** menu; the exact place can move between Claude Desktop versions). Pick one,
fill in its fields, send. A prompt shows up only while its set is switched on: `rules-question` and
`npc-improv` are in core, the other four in prep.

| Prompt              | Fields                                                             | What it is for                                                                                                                       |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `prep-next-session` | `focus` (optional)                                                 | Gathers what happened last session and what is still open, and helps you prepare the next one.                                       |
| `rules-question`    | `question` (required)                                              | Answers a rules question from the books in your Foundry compendiums and journals, says where the answer came from, 2024 rules first. |
| `session-recap`     | `audience` (`gm` or `players`, default `gm`), `session` (optional) | A recap from the play log. The players version uses only player-safe data.                                                           |
| `npc-improv`        | `npc` (required)                                                   | A quick GM-only improv card for an NPC: voice, mannerism, want, secret.                                                              |
| `encounter-check`   | `scene` (optional)                                                 | Checks an encounter's balance against the party.                                                                                     |
| `reveal-handout`    | `page` (required)                                                  | Plans revealing a journal page to players, shows you the plan, and applies it only after you confirm.                                |

The `npc-improv` card contains secrets. Keep it off shared screens. Read a players recap yourself
before you send it on.

## How Claude's changes are approved

There are two kinds of changes.

**Guarded changes** (damage, healing, conditions, spell slots and other resources, moving,
changing and deleting tokens, who owns an actor, the party panel, the Tarokka reading, handouts,
the Obsidian mirror settings):

1. Claude makes a plan. Nothing changes yet.
2. Claude shows you the plan: a summary and the list of what will change.
3. You say yes in the chat, or apply the plan yourself in the dashboard (see
   [Applying a plan Claude made](dashboard.md#applying-a-plan-claude-made)). Claude is told to wait
   for your yes before it applies a plan. Saying "go ahead" in the request ("Apply 12 fire damage
   to Wolf 2, go ahead") is that yes, so Claude plans and applies in one go.
4. The change is recorded. It shows in the dashboard's **Recent Changes**, where you can undo it.

A guarded change is refused, and nothing is written, if its feature switch is off, if the plan is
older than 15 minutes, or if the same thing changed in Foundry since the plan was made. Deletes,
reveals and hides count as destructive and need your explicit yes for that too.

In a long fight the confirm step gets tiring. The setting **AI Tool: Live play, apply without
confirming** (Game Settings, category **Foundry AI Tool**; off by default) skips it for damage,
healing, conditions and resources that Claude plans. Each change still lands in Recent Changes with
**Undo**. The dashboard's own buttons never need it: they apply at once with an **Undo** message
(see [the dashboard guide](dashboard.md#the-confirm-window)).

### Feature switches

All in **Game Settings**, category **Foundry AI Tool**. They stop the dashboard's changes as well
as Claude's.

| Setting                                      | Default | Lets Claude and the dashboard                                                                         |
| -------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| Allow Write Operations                       | On      | Change anything at all. Off makes the whole tool read-only (see below).                               |
| AI Tool: Live play (writes)                  | On      | Apply damage, healing, temporary hit points, conditions and resources; move, change or delete tokens. |
| AI Tool: Live play, apply without confirming | Off     | Skip the confirm step for damage, healing, conditions and resources that Claude plans.                |
| AI Tool: Ownership (writes)                  | On      | Change which players own or can see an actor.                                                         |
| AI Tool: Party (writes)                      | Off     | Change the party's travel pace, place the party on the map, add it to combat, post a rest request.    |
| AI Tool: Handouts (writes)                   | Off     | Reveal or hide journal pages for the players.                                                         |
| AI Tool: Tarokka (writes)                    | Off     | Save the Tarokka reading, link cards to journals, publish reveal pages.                               |
| AI Tool: Obsidian mirror (writes)            | Off     | Change which Foundry documents are mirrored into your Obsidian vault.                                 |
| AI Tool: Session notes (writes)              | Off     | Put the notes of a recorded session into a GM-only journal by itself, without asking (see below).     |

**Session notes go in without asking.** With "AI Tool: Session notes (writes)" on, the bridge puts
the notes of a recorded session (pages Recap, GM summary and Scenes, Danish first and English
below) into a GM-only journal in the folder "Session notes" as soon as Foundry is open with
writes on. It does not ask first. Each one is listed in Recent Changes with an Undo, which refuses
once the Recap was revealed or you edited a page. Players see only the Recap, and only when you
reveal it: it waits in the reveal queue. "Ready for session" does not turn this switch on.

**Direct actions** (rolls, new NPCs, journals, chat messages and others) happen as
soon as Claude uses the tool. They are not listed
in Recent Changes, and the tool cannot undo them; you fix them by hand in Foundry. So:

- Ask Claude to tell you what it will do before it does it: "Tell me the plan, then wait for my
  OK."
- Depending on its settings, Claude Desktop asks for your OK before Claude uses a tool. Keep that
  asking on for tools that change the game, and for `apply-planned-change`: then nothing is
  applied without your click. "Always allow" is fine for tools that only read (their names start
  with `get-`, `list-` or `search-`).
- When Claude uses an item or a spell, Foundry opens the usage dialog on your screen, and you
  finish it there.

The setting "Allow Write Operations" (Game Settings, category **Foundry AI Tool**; on by default)
is the tool's read-only switch. Turned off, the tool changes nothing: no new actors or items, no
token, scene, combat, damage or condition changes, no ownership changes, no journal writes, no chat
or roll messages, no guarded changes (also those that only touch the tool's own storage, such as a
Tarokka reading or the Obsidian mirror settings) and no Undo. Reading still works. It stops the
dashboard's actions too, not only Claude.

The dashboard's **GM Actions** switch only guards the dashboard. It does not stop Claude Desktop.

## What Claude cannot do

- **Work without a GM in Foundry.** The module runs in a GM's Foundry browser tab, and the bridge
  reaches the game only through it.
- **See the screen.** It reads game data, not the picture of the map.
- **Get past a feature switch.** With a feature switched off, no plan for it can be applied.
- **Undo direct actions.** Only guarded changes have Undo.
- **Read books you do not have in Foundry.** The tool contains no book or adventure text. Claude
  reads the rules and the adventure from the compendiums and journals in your world, at the moment
  you ask. If a book is not installed in Foundry, Claude cannot quote it.
- **Follow the game between your messages.** It reads when you ask. For the story so far, ask it
  to read the session log, the play stats or a journal.
- **Be always right.** Check rules answers against the page it names, and read every plan before
  you approve it.

## Spoilers and privacy

Claude sees everything a GM sees: true names, hidden tokens, GM notes, the Tarokka cards. Keep
Claude Desktop off any screen players can see, and never share its window in Discord or a video
call. What Claude reads goes to Anthropic under your
Claude account when you ask; see the [player page](../player/README.md) for what that means for
the players.
