---
title: The dashboard
description: A tour of every panel and button on the dashboard, what each does and when to use it.
---

# The dashboard

The dashboard is your control panel. Open it in a browser on a second screen next to
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
| **AI**      | `on`, `paused` | `disabled`: no Anthropic API key is set. This is normal; see "AI commentary" below.                                                                                                              |

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
- **On**: tools that change the game can run after you confirm, and Undo in Recent Changes works.
  The combat buttons need their own switch as well (see **⚔ Combat buttons** below).
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

### 🔗 Player links

Each player's private link to their own character page. See "Player links and My character"
below.

### ⚔ Combat buttons and ▦ Try the During layouts

Two entries under **Advanced**, in the **During screen** group:

- **⚔ Combat buttons: off / on** puts **Damage / Heal**, **Condition** and **Clear** in the
  turn-order strip (see Combat Tracker below). Off by default: in Foundry, the dnd5e chat cards
  already apply damage and healing, and that is the way to learn first. Your choice is kept for
  this world.
- **▦ Try the During layouts** starts the short layout trial again (see During layouts below).

### ⏸ Pause, 🩺 Diag AI, Tone, Model

These control the AI commentary panel. They only work when an Anthropic API key is set, so with
the normal setup they are greyed out or have no effect.

- **⏸ Pause / ▶ Resume**: stops and restarts automatic comments.
- **🩺 Diag AI: on / off**: whether the AI comments on module errors.
- **Tone**: **Tactical** (fight math) or **Narrative** (drama and story).
- **Model**: which Claude model writes the comments.

## The panels

### During layouts

The game happens in Foundry; the **During** screen sits next to it and keeps an eye on things.
It comes in three layouts. Pick one with **Layout** at the top of the screen:

- **Cards** (the default): the Live Feed is the big column. Recent Changes, Handouts and Party
  are cards at the side; open one and the others fold to a single line. The turn order shows
  only while a fight runs.
- **Simple/Full**: Simple shows only the Live Feed, Recent Changes and Handouts. **Show
  everything** switches to Full: the turn order and Party as well, all open. **Show less** goes
  back.
- **Auto**: follows the game. Without a fight it looks like Cards. When combat starts, the turn
  order grows and Party opens in the big column; the Live Feed folds to the side.

Click **▸** or a folded card's title to open it, **▾** to fold it. On a narrow window or a tablet
every layout becomes one column with Recent Changes near the top; on a phone the Live Feed is
folded until you tap it.

**Pick your During layout** (a card on the **Before** screen) shows the three layouts on the real
screen, one after another, with a small guide in the corner: **Use this one** keeps a layout,
**Stop** keeps what you had. In Auto it shows a sample fight (made up, nothing is sent to
Foundry). Skip it and Cards stays. For the first sessions a quiet line next to **Layout** reminds
you that the other layouts exist; **✕** hides it. The layout is kept for this world, on any
browser.

### Combat Tracker

A slim strip at the top of the **During** view. It shows the active combat: initiative, whose turn
it is (highlighted), and each combatant's HP bar and numbers. Each row is tagged **PC**, **Enemy**
or **NPC**. The top line shows the round and the number of combatants. Turns, initiative and saves
stay in Foundry's own combat tracker, and damage normally goes through dnd5e's chat cards there.

Combat in the dashboard is optional. If you want it, the strip can add damage, healing and
conditions on several combatants at once: turn on **⚔ Combat buttons** under **Advanced** (off by
default). With the combat buttons and GM Actions on (**Ready for session** turns GM Actions on),
click combatant rows to select them (click again to unselect). With one or more selected:

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

### Session notes (After)

Below tonight's stats, once the notes of a recorded session exist (the session pipeline writes them
after the session). The tool puts them into Foundry **by itself, without asking**: a GM-only
journal "Session notes" with the pages Recap, GM summary and Scenes, logged in Recent Changes with
Undo. The card says where they are:

- **Waiting**: they go in by themselves as soon as a GM is in Foundry, "Allow Write Operations" is
  on and the switch "AI Tool: Session notes (writes)" is on; the card says which one is missing.
  After an **Undo** they stay out until you click **Put in Foundry**.
- **In Foundry**: the Recap waits in the Handouts queue. Reveal it there, or click **Approve without
  revealing**. **Undo** takes the journal entry out again, but not once the players have the Recap
  or a page was edited in Foundry.
- **Approved**: revealing the Recap or approving starts the clock: the recording's audio is deleted
  14 days later. That stays so even if you take the notes out with Undo afterwards; the card then
  offers **Put in Foundry** to put them back.

**Read** shows all the pages in the side panel. The card, the GM summary and the scenes never
reach the players' page; only the Recap does, when you reveal it.

### Live Feed

What happens at the table, newest on top: damage, healing, who drops to 0 HP, conditions, spell slots, rolls,
scene changes and more. Each line shows its type and the time.

- You see each roll's full breakdown, for example "Wolf 1, Bite attack: 1d20 (15) +2 STR +2
  proficiency = 19", plus the target's AC or DC and the outcome when they are known.
- Private, blind and GM rolls appear as `gm-roll` lines. Players never see these.
- `gm-change` lines appear when a guarded change is applied or undone.

### AI commentary

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

At the top, a yellow line says when the server's storage space check has not run for over 3 hours.
Nothing is wrong yet, but nobody is watching the space: tell the person who runs the server.

### The storage space banner

The server (the Orange Pi) checks its own free disk space every hour. The dashboard shows a banner
under the header, for you only (players never see it):

- **Yellow, "Storage space is low":** under 20% free. Backups still run. Tell the person who runs the
  server; the banner names the disk and which jobs use it.
- **Red, "Storage space is critical":** under 5% free, or less than a backup needs. A backup that
  needs more space than is free will stop. Tell them now.

No banner means plenty of space, or that this dashboard runs somewhere with no space check (for
example a laptop). The same warning also arrives as a Discord message to the person who runs the
server.

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
Undo works even when the feature's switch is off; Redo needs it on. Click **↻** to reload the list.

Only guarded changes are listed here: damage, healing, conditions, resources and token moves,
edits and deletes are, while changes from other tools (rolls, new actors) are not and cannot be
undone here.

**The Everyone tab.** When the AI Tool on the server is new enough, Recent Changes has two tabs:
**AI** (the list above) and **Everyone**, which also lists what the players and you did in Foundry
over the last 7 days, such as hit points, items and tokens. Pick a person in the list above the rows
to see only their changes. Each row shows who, when, what changed and, under "N line(s)", the
details. **Undo** works on anyone's change. It first shows what it will put back, and you confirm.
If something changed on the same thing since, it says "This is not the latest change to ..." and
lists those later changes, and you choose **Just this** (keeps the later changes), **Everything
since** (puts the thing back to how it was before this change) or **Cancel**. Under **Advanced**
(in the first question, whichever it is), **Rewind the whole table to here** undoes every change at
the table since then; it shows how many changes that is and asks twice. An undone change is marked
"Undone by ...", with **Redo** to put it back when that is still possible. When it was undone
together with other changes (Everything since or a rewind), Redo says so and brings all of them
back. Undo needs GM Actions on, like everything that changes the game. The same list is in Foundry
too, as the **Changes** window (below), and, when Obsidian is set up, in your vault as one note per
day under `AI Tool/Everyone/` (to read, not to undo from).

### The same list inside Foundry

You do not need the dashboard open to see or undo what changed. In Foundry's left toolbar (the
scene controls) there is an **AI Tool** group, shown to GMs only. Click it, then click
**Changes**: a window opens with everything that changed in the last week, newest first, by
players, by you and by the AI. Each row shows the time, who did it ("by Ireena", or an **AI** tag),
what changed, and **Undo** while the change can still be undone. Click "Changes" on a row to see
the lines that changed, and **Show more** for the last 100. **Show:** at the top narrows the list
to **All**, **AI** or one person. **AI** shows only what the AI changed; a person shows what that
person changed and the undos they ran from this window.

**Undo** asks you to confirm first, listing what will be put back, and then says "Undone: ...", or
tells you why it refused (for example because the same thing was changed again since). If the
change is not the latest one on that thing (Ireena's HP was changed again afterwards, say), the
window lists the later changes and asks:

- **Just this**: undo only this change and keep the later ones.
- **Everything since**: undo this change and every later change to the same thing.
- **Cancel**: nothing changes.

Under **Advanced** there is also **Rewind the whole table to here**. It undoes every change by
everyone at the table since then, so it asks twice: first with the full list and the number of
changes, then again with a button that names that number.

A row that was undone says "undone" (and by whom, when it is known). It gets **Redo** when the undo
can itself be taken back; Redo asks you to confirm and brings the change back. The list refreshes
by itself when something changes, and **Refresh** reloads it by hand. On an older AI Tool bridge
the window shows only the AI's changes, without the filter or Redo, and Undo just undoes that one
change.

If the window says the AI Tool bridge is not connected, the browser that holds the link to the AI
Tool (the Assistant GM browser on the server) is not running; ask whoever runs the server.
If it says "Update the AI Tool bridge to use this window", the bridge on the server is older than
this module; ask whoever runs the server to update it.
Clicking the AI Tool group leaves the map as it was: it only changes which buttons the toolbar
shows, and clicking any other group (Tokens, for example) brings the usual tools back.

### Handouts inside Foundry

The same **AI Tool** group has a **Handouts** button. It opens a window with what the dashboard's
handout drawer shows, so you can reveal a handout without leaving Foundry:

- **Queue**: the pages you staged, oldest first. Each row says which scene it is for (or "any
  scene") and which players (or "all players"). **Remove** takes a page off the queue at once;
  nothing changes in Foundry.
- **Reveal next**: reveals the oldest queued page for the scene that is active now. A window shows
  exactly what will change and asks you to confirm, because a reveal cannot be taken back at the
  table. Cancel and nothing happens. Undo in **Changes** hides the page again and puts it back
  in the queue.
- **Show it now**: tick it next to **Reveal next** to also pop the page up on the screens of the
  players it is for. It is unticked whenever the window opens and goes back to unticked after each
  reveal (also after a cancel), so it is a choice you make each time. The tick stays while you are
  deciding: a refresh does not clear it. Undo cannot close the popup.
- **Who has read what**: each revealed handout, who it is for, and a tick next to the name of each
  player who has opened it on the player page (hover for the time).

The window refreshes by itself when a handout is revealed or undone, and **Refresh** reloads it by
hand. If something goes wrong (for example the handouts switch is off) the reason shows at the top
of the window. It needs the same bridge connection as the Changes window.

### Tarokka inside Foundry

The **AI Tool** group also has a **Tarokka** button (GMs only). It opens a window with the five
positions of the current reading, so you can reveal a card without leaving Foundry. The reading is
the one the dashboard's Tarokka drawer shows. The top line says where it came from, when it was
dealt or imported, and how many older readings are archived. If there is no reading yet, the window
says so: a reading is dealt or imported from the dashboard, or by asking Claude.

- **Show cards**: the card names and your notes stay hidden ("Card hidden") until you tick this.
  It is unticked whenever the window opens or closes, and a refresh does not clear it. Untick it
  before anyone looks at your screen.
- Each position shows its label, the card (once Show cards is ticked), and your note. **Open
  Journal**, **Open Scene** or **Open Actor** open the linked document on your screen (nothing
  changes); "not linked" when there is none. A position is either "hidden from players" or
  "revealed", with **Open page** for the reveal page.
- **Reveal...** (positions that are not revealed yet): opens a small form under the position. Type
  exactly what the players may read (1 to 5000 characters) and, if you like, a page title. Tick
  **Show it now** to pop the page up on the players' screens as soon as the reveal is applied; it
  is unticked every time the form opens. Then click **Reveal**: a Foundry window shows exactly what
  will change and asks you to confirm, because a reveal cannot be taken back at the table. Cancel and
  nothing happens (your text stays in the form). Undo in **Changes** takes the reveal back but
  cannot close the popup. The players get only your text, never the card name.

What you type in a form stays when the window refreshes by itself (it refreshes when a change is
recorded, and **Refresh** reloads it by hand). Linking a card and dealing or importing a reading are
not in this window: use the dashboard's Tarokka drawer, or ask Claude. Changing anything needs the
same "AI Tool: Tarokka (writes)" switch as the drawer; if it is off, the reason shows at the top of
the window.

## The confirm window

The dashboard's own buttons that make a planned change (Damage and Condition on the combatants you
selected, the party's pace and rest request, Tarokka links and imports) apply at once when you
click: your click is the confirmation. A message says what changed, with **Undo** for a few seconds; Recent
Changes keeps the full history.

The confirm window opens first for:

- **Destructive changes**: deletes, and handout and Tarokka reveals and hides (players see a reveal
  at once, so Undo cannot take it back from their eyes).
- **Plans you did not make on the dashboard**: a plan Claude made.
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
  reveal…**. The players get only your text, never the card name. Tick **Show it now** to pop the
  page up on the players' screens as soon as you apply the reveal. It is off every time unless you
  tick it, and Undo takes back the reveal but cannot close the popup.

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
  Tick **Show it now** next to it to also pop the page up on the screens of the players it is for
  (everyone when it is for every player). It is off every time unless you tick it, and Undo cannot
  close the popup.
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
- **Place the party here**: scroll Foundry's map to the spot first. The button puts every member
  without a token on the scene you are looking at next to each other on the nearest free
  squares, around the centre of your view (each token at its own size, never on top of another
  token, not behind a wall). Members already on the scene stay where they are. Undo removes the
  new tokens again, also after you moved them; if you already deleted one of them by hand, Undo
  refuses, so delete the others by hand too. Claude can also place them at a token, a map note or
  a square ("put the party at the inn door").
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

## Player links and My character (/me)

Each player can have their own character page: their sheet on a phone or laptop, read-only, and
up to date during play (HP, spell slots, conditions, resources). It opens from a private link
that you make once per player.

1. **Advanced**, **🔗 Player links**. The panel lists every player (non-GM) user in the world.
2. **Make link** next to a player. The link is copied; send it to that player in a direct
   message, not in the table chat.
3. The player opens it once. The page remembers it on that device, so it works from a bookmark
   or the home screen afterwards.

The page shows only the characters that player's Foundry user **owns** (Owner permission on the
actor). To give a player their character, set their ownership in Foundry as usual; nothing else is
needed. A player who owns no character sees "Ask your GM".

- **New link** makes a fresh link and turns the old one off (for a lost phone, or a link sent to
  the wrong person).
- **Remove** turns the link off without a new one.

The page has three views, and each player picks theirs (remembered on their device):

- **At the table**: big HP, AC and initiative, conditions, spell slots, resources, attacks and
  prepared spells. It follows the dashboard theme.
- **Paper 2024** (the default paper view) and **Paper 2014**: black on white, in the same order
  as the printed character sheet of that edition, so a player can copy it onto paper or print it
  (**Print** at the bottom).

What the page leaves out: the GM's secret sections in descriptions, the true names of
unidentified items (it shows what the player sees in Foundry), and any actor the player does not
own. Like the player page, it only answers on this PC today; how players reach it from their own
devices is set up with the Orange Pi.

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

The plugin also gives the whole vault the dashboard's look, your own notes included. Its
**Theme** setting has **Neutral**, **The Veil** and **Off**. There is one theme per world: pick
Neutral or The Veil there and the dashboard switches too, and when you pick a theme in the
dashboard, Obsidian follows within half a minute. **Off** only turns the look off in Obsidian. The
theme gives stat blocks a card, shows GM secrets with a lock so you never read one out by mistake,
and turns a session's stats into small cards.

The plugin only talks to the dashboard. When the dashboard is not running, the status bar says
"dashboard offline" and nothing else changes.
