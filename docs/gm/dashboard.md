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
- Click **End session** when play ends. The text changes back to "No session". It also turns off
  again what **Ready for session** turned on (see below), and GM Actions.
- Starting a session only writes a line in the tool's own log. It never changes the game, so it
  works with GM Actions off.
- If you forget, the notes still split sessions at a gap of 3 hours without events.

The 📓 next to it opens your campaign's Home note in Obsidian (see "Open in Obsidian" below).

### ⚔ GM Actions: off / on

The master switch for changing the game from the dashboard. Click it to turn it on or off.

- **Off** (the default): you can look, read and run read-only tools. Nothing that changes the game
  runs from the dashboard.
- **On**: the combat buttons appear, and tools that change the game can run after you confirm.
- It only guards the dashboard. It does not stop Claude Desktop.
- Restarting the dashboard turns it off again.

Turn it on when you are about to act, and off again after. **Ready for session** turns it on
for you, together with the module switches.

### 🛠 Tools

Opens the tool runner. See "The tool runner" below.

### ✈ Pre-flight

Opens the pre-flight check: run it before the players join. The tool ticks what it can check by
itself (Foundry connected, module and bridge versions match, the write switches, secrets in world
settings, names players can see that give away a secret, module conflicts, Obsidian notes, the
play session, Ready for session, the player page, Tarokka cards hidden). Below that are the things to
check by hand, from [before each session](before-session.md); your ticks stay in this browser until
you click **Clear ticks**. The button itself reads **Pre-flight: ready** or **Pre-flight: 2 to fix**
after each Foundry connect.

A value that looks like a secret is never shown in full, only its first four characters and its
length. If the module and bridge versions differ, a banner at the top says which to update.

#### Ready for session

At the top of the Pre-flight panel. One click turns on what an evening at the table needs:

- in Foundry's module settings: "Allow Write Operations", "AI Tool: Handouts (writes)", "AI Tool:
  Live play (writes)", "AI Tool: Party (writes)" and "AI Tool: Tarokka (writes)";
- on the dashboard: **GM Actions**.

It turns on only what is off, and remembers that in the world. **End session** (or **Turn them off
again**) turns off exactly those, so a switch that was already on stays on. The chips under the
button show each switch (✓ on, ○ off). If Foundry did not take a change, a red toast names the
switch; check it in Foundry's module settings, where every switch stays visible.

Only the dashboard can do this, from the GM's login. Claude has no tool for it, so Claude can never
switch on its own writes. **Start the session log** next to it is the same as **Start session** in
the header.

### 📜 Handouts

Opens the handout drawer. See "The handout drawer" below.

### 📋 Prep

Opens the prep drawer. See "The prep drawer" below.

### 🛡 Party

Opens the party drawer. See "The party drawer" below.

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

A slim strip at the top of the **During** view. It shows the active combat: initiative, whose turn
it is (highlighted), and each combatant's HP bar and numbers. Each row is tagged **PC**, **Enemy**
or **NPC**. The top line shows the round and the number of combatants. Turns, initiative and saves
stay in Foundry's own combat tracker.

What the strip adds is damage, healing and conditions on several combatants at once. With GM
Actions on (**Ready for session** turns them on), click combatant rows to select them (click again
to unselect). With one or more selected:

- **Damage / Heal**: opens the tool runner (`plan-actor-change`) with those names filled in. Pick
  damage, healing or temp-hp and enter the amount (and the damage type, so dnd5e counts
  resistances, vulnerabilities and immunities).
- **Condition**: the same, for a condition: pick it, and untick **active** to remove it.
- **Clear**: unselects all.

Fill in the amount and click the run button: it applies at once, because the targets are the rows
you selected and your click is the confirmation. A message lists each target's result ("Wolf 2: HP
11 to 5") with **Undo** for a few seconds; one click puts it back. Later, use **Undo** in Recent
Changes. If you change the targets in the form by hand, the confirm window shows them first.

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

### Features (Before)

At the bottom of the **Before** view: one card per feature, the ones still off first. Each card says
what the feature does, whether it is on, and **when to turn it on** (for example Boss prompts:
"before the first boss fight"). **Read more** opens its section of
[Features and when to turn them on](features.md). The cards only show; you switch features in
Foundry's module settings, or all at once with **Ready for session**.

### Help: the "?" on each panel

Every panel has a small **?** next to its title. It opens this guide at that panel's section, in a
side panel over the dashboard; links inside it open the other guide pages there too. **📖 GM
guides** in the **Advanced** menu opens the list of guides. The help is built into the dashboard,
so it works without internet and always matches the installed version.

### Tonight's stats (After)

The top of the **After** view, for the session that just ended:

- **Rolls**: how many, with the natural 20s and natural 1s.
- **Most damage**: the hero who dealt the most, and over how many fights.
- **Highest roll**: the highest d20 roll by a hero (attacks, saves, checks, initiative; damage does
  not count), who rolled it and what it was. It may be a private or blind roll, so it stays on your
  screen.
- **Went down**: which heroes dropped to 0 HP, and how often.

Below them: the session's length, **Open the session note** (in Obsidian, when it is set up) and
**Copy the stats for Discord**, which copies the rolls, most damage and who went down for the
players' channel, without the highest roll. **↻ Refresh** loads them again. The numbers come from
the tool's play log, the same as the Stats section of the Obsidian session note.

### Live Feed

What happens at the table, newest on top: damage, healing, who drops to 0 HP, conditions, spell slots, rolls,
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

Only guarded changes are listed here: damage, healing, conditions, resources and token moves,
edits and deletes are, while changes from other tools (rolls, new actors) are not and cannot be
undone here.

## The confirm window

The dashboard's own buttons that make a planned change (Damage and Condition on the combatants you
selected, the party's pace and rest request, Tarokka links and imports) apply at once when you
click: your click is the confirmation. A message says what changed, with **Undo** for a few seconds; Recent
Changes keeps the full history.

The confirm window opens first for:

- **Destructive changes**: deletes, and handout and Tarokka reveals and hides (players see a reveal
  at once, so Undo cannot take it back from their eyes).
- **Plans you did not make on the dashboard**: a plan Claude made, or a pending change from Obsidian.
  Plan, confirm and undo stay for every AI change.
- **Plans you type by hand in the tool runner** (Advanced), so you see which targets they hit before
  they apply.
- **Older tools without a plan** (from the tool runner), which have no Undo.

In the confirm window:

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

Import, new reading and link apply in one click, with an **Undo** message. A reveal opens the
confirm window with the list of what will change and the destructive step, because the table
cannot unsee it. Every one of them shows up in Recent Changes and can be undone there.

## The handout drawer (📜 Handouts)

Queue handouts during prep, then reveal each with one click at the table. The drawer shows:

- **Queue**: the pages you staged, oldest first, with their scene and who they are for.
  **Remove** takes one off the queue. Queueing changes nothing in Foundry.
- **Reveal next: `<title>`**: plans the reveal of the next queued page for the scene that is active
  now (or a page queued for any scene). The confirm window shows the change; applying it also takes
  the page off the queue. Undo in Recent Changes hides it again and puts it back in the queue.
- **+ Queue a page**: opens the tool runner on `plan-page-reveal` with `action` queue. Pick the page,
  optionally a scene and the players it is for, and run it.
- **Revealed**: each handout, who it is for, and a tick for each player who has opened it on the
  player page (hover for the time).

A handout for chosen players is readable in Foundry only by them, and the player page shows it only
to a player who picked that name ("Playing as ...") at the top of the page.

## The prep drawer (📋 Prep)

The facts for preparing your next session, in one place and without AI. **Refresh** reloads them.

- **Last session**: its date and length, the scenes in the order you visited them, fights and
  rounds, the player characters and the NPCs who went down to 0 HP (not who died: the tool never
  knows that), the handouts you revealed (and who has opened them), and **Beats**, a
  short list of what happened. **All beats** loads the full list when the short one is cut.
- **Open threads**: quests whose Status is not done, and campaign parts not completed or skipped.
  **Open** shows the journal in Foundry.
- **Next session notes**: the text of your journal named "Next session". Keep it GM only; the
  drawer warns you if players can see it. Without that journal the drawer tells you how to make
  one.
- **Ready**: the handout queue by scene, the bosses on your scenes (legendary actions, legendary
  resistances, lair) and the pre-flight result, with a button to the pre-flight drawer.
- **Recent changes**: how many guarded changes were made, and the latest ones.

Claude reads the same facts with `get-prep-digest`, which the prompt `prep-next-session` uses
first. Without Foundry connected, the drawer still shows last session and says what is missing.

## The party drawer (🛡 Party)

The party at a glance, from the dnd5e Group actor. It needs a party in Foundry: in the Actors
tab, create an Actor of type **Group**, drag the characters onto it, then right-click it and
choose **Set as Primary Party**. With more than one group, a list at the top picks which one.

- **Members**: each character's HP, AC, passive Perception, hit dice left, conditions and
  exhaustion, death saves at 0 HP, and whether the token is on the scene and in the encounter.
  **Open** shows the character sheet in Foundry.
- **Travel pace**: Slow, Normal or Fast. If a member is slowed, the drawer says the party moves
  at slow pace anyway.
- **Combat**: adds the party's tokens on the current scene to the encounter, or starts an
  encounter with them when there is none.
- **Rest**: posts dnd5e's short or long rest card to chat. Each player clicks it to rest their
  own character, the same card Foundry's party sheet posts.

Each button applies in one click, with an **Undo** message. The actions need GM Actions on and
the module setting **AI Tool: Party (writes)** switched on. Every change lands in Recent Changes
with Undo; a rest card can only be undone while nobody has rested from it (after that, delete the
card in Foundry's chat). Claude uses the same actions with `get-party` and `plan-party-change`.

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

### The Obsidian plugin (optional)

A small plugin for Obsidian on your PC makes this one step and shows handout status on the note
itself. Whoever set up the tool installs it with `scripts/install-obsidian-plugin.ps1` (or unzips
`foundry-ai-tool-obsidian.zip` from a release into the vault's `.obsidian/plugins` folder); then
turn on **Foundry AI Tool** under Settings, Community plugins. In its settings, the dashboard
address is the one you open in your browser, for example `http://localhost:3000`.

On a note from the Foundry mirror:

- **Open in Foundry**: from the command palette (Ctrl+P), the note's **...** menu, or a click on
  the Foundry line in the status bar at the bottom. It opens right away, no extra page.
- **Handout status**: on a journal page note, the status bar says whether players can see the page
  (not revealed, queued, revealed, revealed as a copy) and how many have opened it.
- **Reveal to players** and **Hide from players** (command palette): the plugin makes the plan and
  opens the dashboard, which shows the usual confirm window. Nothing changes until you confirm
  there, and the change gets **Undo** in Recent Changes like any other.
- **Add to the handout reveal queue**: puts the page in the handout drawer's queue, so you can
  reveal it with **Reveal next** during the session. Players see nothing yet.

The plugin only talks to the dashboard. When the dashboard is not running, the status bar says
"dashboard offline" and nothing else changes.
