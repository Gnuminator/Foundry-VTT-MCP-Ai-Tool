---
title: Cookbook
description: Ready-to-use requests and clicks for the GM, grouped by the moment you need them (before, during and after a session), with what happens and one tip each.
---

# Cookbook

Short recipes for things you will want to do. Each one says what to type (in a Claude Desktop chat)
or click (on the dashboard), what happens, and one tip. Copy the words in quotes and change the
names to yours.

The recipes use the Claude Desktop chat with **core** and **prep** switched on (see
[Asking Claude](asking-claude.md#tool-sets-which-switches-to-turn-on)). A recipe that needs another
set says so.

## Four habits that make every request better

1. **Name the exact thing.** "Wolf 2", "the page 'Old letter' in the journal 'Handouts'", "Ireena
   Kolyana". Several tokens can share a name; Foundry's names are what Claude searches for.
2. **Say what you want back.** "A list of three", "one paragraph I can read aloud", "a table with
   HP and AC".
3. **Ask for a plan before changes.** "Show me the plan first and wait for my OK." Guarded changes
   always wait; this makes the direct ones wait too.
4. **For rules, say which books.** "Use only the books in my Foundry compendiums, and tell me where
   you found it."

## Before the session

### Get ready for next session

- **Click:** **📋 Prep** in the dashboard header for the facts without AI: last session (scenes,
  fights, deaths, what happened), open quests and campaign parts, your notes, the handouts you
  queued, the bosses on your scenes and the pre-flight result.
- **Or say:** use the ready-made prompt `prep-next-session` (in the message box's **+** menu). Add a
  focus if you have one, for example "the Vallaki festival".
- **What happens:** Claude reads the same facts in one go (`get-prep-digest`) and helps you plan
  the next session.
- **Tip:** keep your prep notes in a journal named "Next session" that only you can see. The Prep
  drawer and Claude both read it. Ask for a short list of loose threads at the end: "End with the
  five open threads, one line each."

### Check that everything is ready

- **Click:** **✈ Pre-flight** in the dashboard header, or **say:** "Run the pre-flight check and
  tell me what to fix, most important first."
- **What happens:** the tool checks the Foundry link, the versions, the switches, secrets in world
  settings, names players can see and module conflicts (`get-preflight`). The dashboard also checks
  GM Actions, the player page and the Tarokka cards.
- **Tip:** the dashboard's drawer has the hand checks too; tick them as you go.

### Check an encounter

- **Say:** use the prompt `encounter-check`, or "Is the fight on the scene 'Old Bonegrinder' fair
  for the party? Suggest one change if it is too hard."
- **What happens:** Claude compares the creatures with the party (`suggest-balanced-encounter`).
- **Tip:** say what kind of fight you want: "short and scary", "a real threat", "a warm-up".

### Find monsters for a scene

- **Say:** "Find three undead of CR 1 to 3 in my compendiums for four level 3 characters. A table
  with name, CR and why it fits."
- **What happens:** Claude searches your compendiums (`search-compendium`, `list-creatures-by-criteria`
  in the **build** set).
- **Tip:** to put one in the world, switch **build** on and ask: "Add a Ghoul from the compendium
  to the world. Show me first."

### A quick NPC card

- **Say:** use the prompt `npc-improv` with the NPC's name.
- **What happens:** a short card: voice, mannerism, want, secret.
- **Tip:** it contains secrets. Keep it off shared screens.

### Describe a scene from the adventure

- **Say:** "Find the journal page about Old Bonegrinder and read it. Describe what the party sees
  as they arrive at dusk: three sentences I can read aloud, in the same tone, and nothing they
  cannot see yet."
- **What happens:** Claude finds the page (`search-journals`), reads it (`list-journals`) and writes
  the description in the chat. Nothing changes in Foundry.
- **Tip:** Claude reads the journals in your world, so the adventure has to be imported there (its
  journals in the Journal sidebar, for example from the official module or DDB-Importer). Your own
  pages work the same way, so your own quests and places get the same help. Name the mood you want:
  "eerie and quiet", "rushed", "sad".

### Draft a letter or an invitation from a villain

- **Say:** "Draft a letter from Strahd to the party, in his voice, from these points: invites them
  to dinner, mentions Ireena by name, polite but threatening. Around 120 words. Plain text."
- **What happens:** Claude writes the draft in the chat. Nothing changes in Foundry.
- **Tip:** paste the final text into a page in a GM-only journal, then reveal it as a handout (next
  recipe). Before that, ask: "Check this text for secret terms" (`check-secret-terms`).

### Stage handouts for the session

- **Say:** "Queue the page 'Letter from Strahd' in the journal 'Handouts' for the scene 'Barovia
  Village'." Add "only for Anna" to reveal it to one player.
- **What happens:** the page goes into the handout queue (`plan-page-reveal` with the action queue).
  Nothing changes in Foundry and players see nothing yet.
- **Tip:** open **📜 Handouts** on the dashboard to see the queue in order. **Remove** takes one
  off.

### Deal the Tarokka reading

- **Say:** "Deal a new Tarokka reading with the built-in roll. Show me the plan first."
- **What happens:** a plan (`plan-tarokka-import`); applied after your yes, then in **🃏 Tarokka**.
- **Tip:** keep **Show cards** unticked on the dashboard while players can see your screen.

## During the session

### Answer a rules question

- **Say:** use the prompt `rules-question`, or "How does grappling work in the 2024 rules? Use only
  my Foundry books and tell me where you found it."
- **What happens:** Claude searches your compendiums and journals and names the page it used.
- **Tip:** read the page it names if the answer matters for a big moment.

### Who is in trouble?

- **Say:** "Which PCs are below half HP, and who still has spell slots?"
- **What happens:** Claude reads the characters and the combat (`get-combat-state`,
  `list-characters`).
- **Tip:** the dashboard's combat tracker shows HP bars without asking.

### Run a boss fight

- **Click:** **👑 Boss prompts** in the combat tracker's top line (it shows when a creature with
  legendary actions or a lair is in the fight).
- **What happens:** pips for legendary actions and resistances, a reminder when the lair acts, and
  an **R** mark per creature for its reaction this round.
- **Tip:** tick "in lair" on the creature's sheet in Foundry, so the lair reminder and the extra
  legendary use count.

### Reveal the next handout

- **Click:** **Reveal next** in **📜 Handouts**, or **say:** "Reveal the next queued handout for
  this scene."
- **What happens:** the confirm window shows the plan; after your OK the page reaches the player
  page and Foundry. The drawer ticks each player who has opened it.
- **Tip:** a mistake is one click to fix: **Undo** in **Recent Changes** hides it again and puts it
  back in the queue.

### Let Claude handle rolls and damage

These need the **play** set switched on, and they happen right away (no undo).

- **Say:** "Roll a Dexterity save DC 14 for Wolf 1, Wolf 2 and Wolf 3." (`roll-saving-throws`)
- **Say:** "Apply 12 fire damage to Wolf 2." (`apply-damage-and-healing`)
- **Say:** "Roll initiative for the NPCs." (`roll-initiative-for-npcs`)
- **Tip:** add "Tell me what you will do, then wait for my OK" until you trust the names.

### Record the session in Discord

- **Type** in the Discord text channel: `/record start` when play begins, `/record stop` when it
  ends.
- **What happens:** the recording bot records each speaker. For now the builder starts the bot
  before the session.
- **Tip:** tell the players at the start that the session is recorded.

## After the session

### A recap

- **Say:** use the prompt `session-recap`. Pick **players** for a spoiler-free recap to share, or
  **gm** for your own notes.
- **What happens:** Claude writes the recap from the play log.
- **Tip:** read a players recap yourself before you send it on.

### Stats per character

- **Say:** "Who dealt the most damage last session, and who went down?"
- **What happens:** Claude reads the play stats (`get-play-stats`).
- **Tip:** the same numbers are in your Obsidian session note.

### Who has seen which handout

- **Click:** **📜 Handouts** on the dashboard, or **say:** "Which revealed handouts has nobody
  opened yet?" (`list-revealed-pages`)
- **What happens:** each handout with a tick per player who opened it on the player page.
- **Tip:** a handout nobody opened is a good hook to mention next session.

### Session notes and the player recap

- **Do:** nothing. After `/record stop` the recording is turned into text on the table's PC and
  Claude writes the notes. For now the builder starts this; from the first campaign session it
  runs by itself every hour. In Claude Code, `/session-notes` does it by hand.
- **What happens:** in the session's folder, under `notes`, in Danish and English: the cleaned
  transcript, notes per scene (what happened, NPCs, loot, open threads, a "GM only" part), a
  summary for you and a draft recap for the players.
- **Tip:** read the players' recap before anyone else does; it is a draft until you say it is
  fine. Approving it also starts the clock that deletes the recorded audio 14 days later. Getting
  the notes into your Obsidian vault and the recap into the handout queue comes next.

## When a recipe goes wrong

- **"Switch on the play set"** (or another set): Claude needs a tool that is off. Switch it on in
  the **Search and tools** menu and ask again.
- **Claude picks the wrong token:** name it exactly ("Wolf 2") or pick it in the tool runner.
- **A plan is refused:** its feature switch is off, the plan is older than 15 minutes, or the thing
  changed in Foundry since. Ask for a new plan.
- **Anything else:** [Troubleshooting](troubleshooting.md).
