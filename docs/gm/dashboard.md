---
title: The co-GM dashboard
description: A tour of every panel and button on the co-GM dashboard, what each does and when to use it.
---

# The co-GM dashboard

The co-GM dashboard is your control panel. Open it in a browser on a second screen next to
Foundry. Today its address is `http://localhost:3000` (it changes when the tool moves to the
Orange Pi).

Watching is always safe. Apart from **→ Post to chat** (AI comments, which need an API key) and the
session marks, nothing on the dashboard changes the game until you turn on **GM Actions** and
confirm.

> Keep the dashboard off any screen the players can see, and never share its window in Discord or
> a video call. It shows true names, exact HP, private rolls and, when you ask, Tarokka cards.

## The header

### Status lights

Three lights at the top tell you if everything is connected:

| Light       | Good           | Other values and what they mean                                                                                                                                                                  |
| ----------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Bridge**  | `connected`    | `disconnected`: the dashboard cannot reach the bridge. Is Claude Desktop running? `reconnecting…`: this page lost its connection to the dashboard program. Is the dashboard's window still open? |
| **Foundry** | `live`         | `unreachable`: the bridge runs, but no GM's Foundry tab is connected. `unknown`: not checked yet, or the bridge is down.                                                                         |
| **AI**      | `on`, `paused` | `disabled`: no Anthropic API key is set. This is normal; see "Co-GM Commentary" below.                                                                                                           |

The line under the title shows your world, the game system and the Foundry version once Foundry is
live.

### Session: Start session / End session

Marks the start and the end of a play session. The tool uses these marks to write one Obsidian note
per session and to group the play log.

- Click **Start session** when play begins. The text changes to "Session since 19:30".
- Click **End session** when play ends. The text changes back to "No session".
- It only writes a line in the tool's own log. It never changes the game, so it works with GM
  Actions off.
- If you forget, the notes still split sessions at a gap of 3 hours without events.

The 📓 next to it opens your campaign's Home note in Obsidian (see "Open in Obsidian" below).

### ⚔ GM Actions: off / on

The master switch for changing the game from the dashboard. Click it to turn it on or off.

- **Off** (the default): you can look, read and run read-only tools. Nothing that changes the game
  runs from the dashboard.
- **On**: the combat buttons appear, and tools that change the game can run after you confirm.
- It only guards the dashboard. It does not stop Claude Desktop.
- Restarting the dashboard turns it off again.

Turn it on when you are about to act, and off again after.

### 🛠 Tools

Opens the tool runner. See "The tool runner" below.

### ✈ Pre-flight

Opens the pre-flight check: run it before the players join. The tool ticks what it can check by
itself (Foundry connected, module and bridge versions match, the write switches, secrets in world
settings, names players can see that give away a secret, module conflicts, Obsidian notes, the
play session, GM Actions off, the player page, Tarokka cards hidden). Below that are the things to
check by hand, from [before each session](before-session.md); your ticks stay in this browser until
you click **Clear ticks**. The button itself reads **Pre-flight: ready** or **Pre-flight: 2 to fix**
after each Foundry connect.

A value that looks like a secret is never shown in full, only its first four characters and its
length. If the module and bridge versions differ, a banner at the top says which to update.

### 📜 Handouts

Opens the handout drawer. See "The handout drawer" below.

### 🃏 Tarokka

Opens the Tarokka drawer. See "The Tarokka drawer" below.

### ⏸ Pause, 🩺 Diag AI, Tone, Model

These control the AI commentary panel. They only work when an Anthropic API key is set, so with
the normal setup they are greyed out or have no effect.

- **⏸ Pause / ▶ Resume**: stops and restarts automatic comments.
- **🩺 Diag AI: on / off**: whether the AI comments on module errors.
- **Tone**: **Tactical** (fight math) or **Narrative** (drama and story).
- **Model**: which Claude model writes the comments.

## The panels

### Combat Tracker

Shows the active combat: initiative, whose turn it is (highlighted), each combatant's HP bar and
numbers, conditions, and death saves for anyone at 0 HP. Each row is tagged **PC**, **Enemy** or
**NPC**. The top line shows the round and the number of combatants.

During a combat, with GM Actions on, a button row appears:

- **Init** with **NPCs**, **All** or **Missing**: roll initiative for the NPCs, for everyone, or for
  those who have none yet.
- **⏭ Advance turn**: moves to the next combatant.

With GM Actions on, click combatant rows to select them (click again to unselect). With one or
more selected:

- **Roll init**: rolls initiative for the selected.
- **Damage / Heal**: opens the tool runner with those names filled in, so you enter the amount.
- **Roll save**: opens the tool runner to roll a saving throw for them.
- **Clear**: unselects all.

Nothing changes until you confirm in the confirm window.

**👑 Boss prompts** (in the panel's top line, only while a creature with legendary actions or a lair
is in the fight; off until you turn it on, and remembered in this browser). Turn it on before the
first boss fight. It shows:

- **Legendary** and **Resist** pips on each boss row: filled for uses left this round, as dnd5e
  counts them (a creature in its lair can have one more). Spend them on the creature's sheet in
  Foundry; the pips follow within a few seconds.
- **🏰 Lair action** reminder when the turn order passes initiative 20 (or the lair's own count),
  for a creature whose "in lair" box is ticked on its sheet.
- **⚡ legendary actions left** for each boss that is not taking its own turn.
- An **R** button on every row: click it when that creature uses its reaction. The marks clear at
  the next round. These marks stay on the dashboard; nothing changes in Foundry.

The player page never shows any of this.

### Live Feed

What happens at the table, newest on top: damage, healing, deaths, conditions, spell slots, rolls,
scene changes and more. Each line shows its type and the time.

- You see each roll's full breakdown, for example "Wolf 1, Bite attack: 1d20 (15) +2 STR +2
  proficiency = 19", plus the target's AC or DC and the outcome when they are known.
- Private, blind and GM rolls appear as `gm-roll` lines. Players never see these.
- `gm-change` lines appear when a guarded change is applied or undone.

### Co-GM Commentary

Optional AI comments on the fight and an **Ask** box ("who's in trouble?").

It needs an Anthropic API key on the dashboard. That is the paid Anthropic API, billed per use and
separate from a Claude subscription. The normal setup has no key, so this panel stays empty and the
AI light says `disabled`. Use Claude Desktop instead (see [Asking Claude](asking-claude.md)).

With a key, each comment has **→ Post to chat**, which whispers it to the GM users in Foundry. If
the text names a secret (a dealt Tarokka card), the dashboard asks first: a whisper's text reaches
every player's browser, only its display is hidden.

### Module Diagnostics

Errors and warnings from Foundry modules, caught in the GM's browser. Hover a line for details.
Useful when something in Foundry misbehaves mid-session. Old entries can stay listed after a
reload.

### Recent Changes

Every guarded change that was applied, newest first, up to 20. Each row shows:

- a summary, and **Undo** when the change can still be undone;
- its state: `applied`, `destructive` (an applied change of the destructive kind: a delete, a
  reveal or a hide), `undone`, or `undo` (the undo itself);
- the feature (for example `tarokka` or `handouts`), what it changed, and when;
- "N line(s)": click to see the full list of what changed;
- 📓: opens that month's change history in Obsidian.

**Undo** asks for the second confirmation and needs GM Actions on. It puts back the values from
before the change. It refuses, and writes nothing, if the same thing was changed again since.
Undo works even when the feature's switch is off. Click **↻** to reload the list.

Only guarded changes are listed here. Changes from other tools (damage, token moves, new actors)
are not, and cannot be undone here.

## The confirm window

Everything that changes the game from the dashboard opens a confirm window first.

- For a planned change it shows the plan's summary and the list of what will change. Read it.
- For other tools it shows the tool's name and the values it will run with.
- **Cancel** (or Escape, or a click outside) runs nothing.
- **Destructive action**: deletes, reveals and hides, and every Undo, need a second step. Tick
  "I understand this changes the live game and may be hard to undo.", then click **Run destructive
  action**.

## The tool runner (🛠 Tools)

A drawer on the side with every tool the bridge has, the same tools Claude uses. Use it when you
want to do one exact thing yourself, or to apply a plan Claude made.

1. Type in **Search tools…** or scroll. Tools are grouped by category (Combat, Tokens & Scene,
   Actors, Journals & Quests, Guarded changes, and more). Each shows a tag: `read`, `write` or
   `destructive`.
2. Click a tool. You see its description and a form. Fields marked **\*** are required.
3. Fill in the form and click **Run** (a read) or **Run…** (a change, which opens the confirm
   window).
4. The answer shows under the form as **Result** or **Error**. **‹ All tools** goes back.

When GM Actions are off, a warning bar at the top says so, with an **Enable GM Actions** button.
Reads still work.

### Pick… buttons

Every field that names something (an actor, a token, a scene, a journal page, a combatant, a
compendium entry, a plan, a change) has a **Pick…** button. It lists what exists right now; click
one to fill the field. You can still type by hand.

- The list has a filter box. For compendium entries and documents, type at least 2 letters to
  search.
- "hidden" next to a token means players cannot see it.
- A red "same name ×N" means several things share that name and the tool picks by name. Rename one
  in Foundry first, or you may hit the wrong one.
- "More exist: type to narrow the list." means the list was cut short.
- For a field that takes several values, click several entries; each is ticked.

### Applying a plan Claude made

When Claude plans a change in Claude Desktop, you can apply it from the dashboard:

1. Turn on **GM Actions**.
2. Open **🛠 Tools**, search for `apply-planned-change`.
3. Click **Pick…** next to `planId` and choose the plan.
4. Click **Run…**. The confirm window shows the plan's summary and what will change.
5. Confirm. The change appears in **Recent Changes** with **Undo**.

`get-planned-change` without a `planId` lists every plan still waiting. Plans expire after 15
minutes, and restarting the bridge drops them. If a plan expired, ask Claude to plan it again.

## The Tarokka drawer (🃏 Tarokka)

GM only. The reading lives in the bridge vault, outside Foundry, so players' browsers never
receive it. Changing anything needs the switch "AI Tool: Tarokka (writes)" (Game Settings,
category **Foundry AI Tool**) and GM Actions on.

Top row:

- **↻ Refresh**: reloads the reading.
- **Import from tarokka-reading**: takes the reading you dealt in the `tarokka-reading` module.
  When you deal there with the switch on, Foundry first asks "Offer this reading to the AI Tool?";
  answer yes, then import it here.
- **New reading (built-in roll)**: deals a new reading with the tool's own roll. The previous
  reading is kept in an archive.
- **📓 Obsidian**: opens the current reading's note in Obsidian.
- **Show cards**: card names stay blurred until you tick this. Untick it before anyone looks at
  your screen.

Each of the five positions shows:

- the position and its card (blurred unless **Show cards** is ticked), and your note when cards
  are shown;
- links: **Open Journal**, **Open Scene** or **Open Actor** open the linked document on your
  Foundry screen (nothing changes); "not linked" when there is none;
- "hidden from players" or "revealed" (with **Open page** for the reveal page);
- **Link…**: search your world's journals, pages, scenes and actors, then click **Link** on the
  right one;
- **Reveal…**: type an optional page title and exactly what the players may read, then **Plan
  reveal…**. The players get only your text, never the card name.

Import, new reading, link and reveal each make a plan and open the confirm window with the list of
what will change. A reveal is destructive (the second step), because the table cannot unsee it.
Every one of them shows up in Recent Changes and can be undone there.

## The handout drawer (📜 Handouts)

Queue handouts during prep, then reveal each with one click at the table. The drawer shows:

- **Queue**: the pages you staged, oldest first, with their scene and who they are for.
  **Remove** takes one off the queue. Queueing changes nothing in Foundry.
- **Reveal next: <title>**: plans the reveal of the next queued page for the scene that is active
  now (or a page queued for any scene). The confirm window shows the change; applying it also takes
  the page off the queue. Undo in Recent Changes hides it again and puts it back in the queue.
- **+ Queue a page**: opens the tool runner on `plan-page-reveal` with `action` queue. Pick the page,
  optionally a scene and the players it is for, and run it.
- **Revealed**: each handout, who it is for, and a tick for each player who has opened it on the
  player page (hover for the time).

A handout for chosen players is readable in Foundry only by them, and the player page shows it only
to a player who picked that name ("Playing as ...") at the top of the page.

## The player page (/player)

The page players look at: `http://localhost:3000/player` today. Open it yourself before a session
to check what they see. Its parts:

- **Combat order**: initiative and names as players know them. PCs have an HP bar; enemies and NPCs
  have no HP numbers. Only standard conditions show. Hidden creatures are left out, and a creature
  whose name players cannot see is "Unknown creature".
- **Session feed**: public rolls and what players could see happen, with creatures named the way
  players know them. Private, blind and GM rolls never show. Damage and healing amounts show for
  PCs only (others just "was hit").
- **Handouts**: pages you revealed, with secret sections, inline rolls and links to unrevealed
  pages removed.

The header shows the world, the scene's **Navigation Name** (else "Current scene", never the real
name) and a status: `live`, `foundry offline`, `disconnected` or `connecting…`.

Today the dashboard only answers on this PC, so players on other computers cannot open the page
yet. How players reach it is set up with the Orange Pi.

### Revealing a handout

In Foundry, pages inherit their journal's ownership. If you give players Observer on a journal
first, every page in it is readable at once, before any reveal. So do it in this order:

1. **Make one journal just for handouts.** Journal tab (book icon), **Create Journal Entry**, name
   it, for example "Handouts". Put only handout pages in it.
2. **Set every page in it to None.** Open the journal. In its page list, right-click a page,
   **Configure Ownership**, set **All Players** to **None** (not Inherit), **Save Changes**. Do
   this for every page, and for each page you add later.
3. **Only then raise the journal.** In the Journal tab, right-click the journal, **Configure
   Ownership**, set **All Players** to **Observer**, **Save Changes**. Players can now open the
   journal, but no page in it.
4. **Switch the feature on.** Game Settings, category **Foundry AI Tool**, tick "AI Tool:
   Handouts (writes)", **Save Changes**.
5. **Plan and apply the reveal.** Ask Claude with the `reveal-handout` prompt, or run the tool
   `plan-page-reveal` with `action` reveal and apply the plan. The confirm window lists what will
   change. To reveal it to some players only, fill in `players`. To prepare reveals ahead of the
   session, queue them instead (see "The handout drawer").

The page shows on the player page within a few seconds, and players can open it in Foundry.
`plan-page-reveal` with `action` hide takes it back. Before a session, open the player page and
check that the Handouts list shows only what you revealed.

## Open in Obsidian (📓)

The 📓 links open notes in Obsidian: the campaign Home note (header), a month's change history
(each Recent Changes row) and the current Tarokka reading (Tarokka drawer). They only appear on
the GM page, and only when the dashboard knows your Obsidian vault's name (the setting
`OBSIDIAN_VAULT_NAME` or `FOUNDRY_AI_OBSIDIAN_DIR` in the dashboard's own `.env` file; whoever set
up the tool adds it).

The other way round, notes of the Foundry mirror in Obsidian have **Open in Foundry** links. They
open a small dashboard page that asks you to click **Open**; the document then opens on your
Foundry screen, and nothing in the world changes.
