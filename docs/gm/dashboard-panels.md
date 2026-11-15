---
title: 'The dashboard: the panels'
description: "During layouts, the Combat Tracker, Tonight's stats, Session notes, Live Feed, Module Diagnostics and Recent Changes."
---

# The dashboard: the panels

Part of [The dashboard](dashboard.md).

## The panels

### During layouts

The game happens in Foundry; the **During** screen sits next to it and keeps an eye on things.
It comes in three layouts. Pick one with **Layout** at the top of the screen:

- **Cards**: the Live Feed is the big column. Recent Changes, Handouts and Party
  are cards at the side; open any of them, also together. The Combat order shows only while a
  fight runs.
- **Simple/Full**: Simple shows only the Live Feed, Recent Changes and Handouts. **Show
  everything** switches to Full: the Combat order and Party as well, all open. **Show less** goes
  back.
- **Auto** (the default): follows the game. Without a fight it looks like Cards. When combat starts, the Combat
  order grows and Party opens in the big column; the Live Feed folds to the side.

The **Try layouts** button next to **Layout** starts the trial any time, with a sample fight so
you can see what Auto does. Until a fight starts, Auto looks the same as Cards, and the line next to
**Layout** says so.

Click **▸** or a folded card's title to open it, **▾** to fold it. On a narrow window or a tablet
every layout becomes one column with Recent Changes near the top; on a phone the Live Feed is
folded until you tap it.

**Pick your During layout** (a card on the **Before** screen) shows the three layouts on the real
screen, one after another, with a small guide in the corner (**Try the layouts** starts it):
**Use this one** keeps a layout, **Stop** keeps what you had. In Auto it shows a sample fight (made up, nothing is sent to
Foundry). Skip it and Cards stays. For the first sessions a quiet line next to **Layout** reminds
you that the other layouts exist; **✕** hides it. The layout is kept for this world, on any
browser.

### Combat Tracker

A slim strip at the top of the **During** view. It shows the active combat: initiative, whose turn
it is (highlighted), and each combatant's HP bar and numbers. Each row is tagged **PC**, **Enemy**
or **NPC**. The top line shows the round and the number of combatants. Turns, initiative and saves
stay in Foundry's own combat tracker, and damage normally goes through dnd5e's chat cards there.

Above the rows is the **initiative ribbon**: one strip in combat order, starting with whoever is up.
That creature is large with their name; the next two are clear, and the rest fade out towards the
right. Each has a ring in the colour of its side (PC, Enemy or NPC), its token portrait (its
initials when it has none), its initiative, a small HP bar and its first two conditions, with
**Concentrating** first. Click a portrait to move the GM's Foundry view to that token (it switches
to the token's scene first if needed; with two GMs logged in it shows an error instead). Portraits
need the dashboard to know Foundry's address: set `DASHBOARD_FOUNDRY_URL` to the one your browser
uses, otherwise the initials show (the same setting decides who may show the dashboard's live strip in a Foundry window, so it must match the address you type for Foundry exactly). A **Round** marker shows where the order wraps into the next
round, and a **Lair** marker shows where a lair action falls when a boss in the fight has one.
Defeated creatures are dimmed and never count as next. The ribbon never changes the game; the click
only moves that screen's view.

Combat in the dashboard is optional. If you want it, the strip can add damage, healing and
conditions on several combatants at once. While a fight runs and GM Actions is on (**Start session**
turns it on), click combatant rows to select them (click again to unselect). With one or more selected:

- **Damage / Heal**: opens a small form: Damage or Heal, one amount, and damage type chips (so
  dnd5e counts resistances, vulnerabilities and immunities). One button, named for what it does
  ("Deal 8 fire damage to ... in Foundry"), applies it at once to every picked token; each takes
  the full amount. The toast has **Undo** and Recent Changes keeps the change. There is no
  confirm window for this form.
- **Condition**: opens a row of condition chips under the strip. Click one (say **prone**); one
  plain question asks "Set prone on ...?", and **Set prone** puts it on every picked token. The
  toast has **Undo** and Recent Changes keeps the change. To take a condition off, use the chip on
  the live strip or the **Conditions** panel.
- **Clear**: unselects all (and closes the Damage / Heal form or the condition chips).
- **Ask for a roll** (under the strip, with GM Actions on): pick a check, save or skill, a DC and
  private or public, then **Ask the party**, or **Ask** for the picked player characters. The
  request goes to each player's chat and the play log at once, with no confirm window and no
  Undo (it only posts a roll card).

After a Damage / Heal or Condition change, a message lists each target's result ("Wolf 2: HP 11 to
5") with **Undo** for a few seconds; one click puts it back. Later, use **Undo** in Recent
Changes.

**Scene mood** (a button on the During bar, with GM Actions, AI Tool: Allow Write Operations and Foundry's
"AI Tool: Scene mood and music (writes)" switch on): one button for each mood preset saved on the
scene you are viewing. A click asks once, with the plan's own summary ("Apply mood ... on ..."),
then sets the darkness, light, weather and music. **Undo** is on the message and in Recent
Changes. A switch that is off keeps the buttons grey and says which one (**Turn on** is next to
it for the first two). Presets are saved by asking Claude to save the scene's look as a preset; if
you switch scene while the panel is open, the next click reloads the list instead of applying.

**Conditions** (a button on the During bar, with GM Actions on; it works in a fight and
out of one): tick tokens on the scene you are viewing, pick a condition, then **Add** or **Remove**.
It applies at once, with **Undo**, and there is no confirm window. For Exhaustion, Add raises one
level and Remove clears them all. A **rules** link by each condition opens dnd5e's own page for it
in Foundry.

**Start combat** and **End combat**: with no fight running and GM Actions on, the Combat Tracker
offers **Start combat** (in most During layouts, a small **Start combat** button on the During bar
opens the same thing). It lists the tokens on the scene you are viewing, with player characters and
Hostile tokens ticked. Change the ticks and click **Start combat with N**. The fight starts at
round 1, with **Undo**. A ticked box, **Ask the player characters to roll initiative**, sends each
ticked player character a public roll request; when they roll it, the number fills their place in
the tracker. Undo removes the fight but leaves the request cards in chat. Whoever is up shows an
**Up now** label. Changing an initiative later (the tool **set-initiative**) re-orders the fight but
does not move the turn. **End combat** plans ending the fight and asks one plain
question; you confirm it, and Undo (on the toast and in Recent Changes) brings it back.

**👑 Boss prompts** (in the panel's top line, only while a creature with legendary actions or a lair
is in the fight; off until you turn it on, and remembered in this browser). Turn it on before the
first boss fight. It shows:

- **Legendary** and **Resist** pips on each boss row: filled for uses left this round, as dnd5e
  counts them (a creature in its lair can have one more). Spend them on the creature's sheet in
  Foundry; the pips follow within a few seconds.
- **🏰 Lair action** reminder when initiative passes 20 (or the lair's own count),
  for a creature whose "in lair" box is ticked on its sheet.
- **⚡ legendary actions left** for each boss that is not taking its own turn.
- An **R** button on each boss that is still up: click it when that creature uses its reaction. The marks clear at
  the next round. These marks stay on the dashboard; nothing changes in Foundry.

The player page never shows any of this.

### Help: the "?" on each panel

Most panels have a small **?** next to their title. It opens this guide at that panel's section, in a
side panel over the dashboard; links inside it open the other guide pages there too. **📖 GM
guides** in the **Advanced** menu opens the list of guides. The help is built into the dashboard,
so it works without internet and always matches the installed version. The side panel has a link
at the top, **Open this page on the wiki**. It opens the same page on the website (needs
internet), which is easier to read on a second screen and has search.

### Tonight's stats (After)

The top of the **After** view, for the session that just ended:

- **Rolls**: how many, with the natural 20s and natural 1s.
- **Most damage**: the hero who dealt the most, and over how many fights.
- **Highest roll**: the highest d20 roll by a hero (attacks, saves, checks, initiative; damage does
  not count), who rolled it and what it was. It may be a private or blind roll, so it stays on your
  screen.
- **Went down**: which heroes dropped to 0 HP, and how often.

Below them: the session's length, **Open the session note** (in Obsidian, when it is set up) and
**Copy the stats for Discord**, which copies the public roll counts, most damage and who went down
for the players' channel, without the highest roll. The roll counts leave out private and blind
rolls, so they can be lower than the numbers on your screen (an older bridge sends no public counts,
and then the rolls line is left out). **↻ Refresh** loads them again. The numbers come from
the tool's play log, the same as the Stats section of the Obsidian session note.

### Session notes (After)

Below tonight's stats, once the notes of a recorded session exist (the session pipeline writes them
after the session). The tool puts them into Foundry **by itself, without asking**: a GM-only
journal in the folder "Session notes" (named with the date and title) with the pages Recap, GM summary and Scenes, logged in Recent Changes with
Undo. The card says where they are:

- **Waiting**: they go in by themselves as soon as a GM is in Foundry, "AI Tool: Allow Write Operations" is
  on and the switch "AI Tool: Session notes (writes)" is on; the card says which one is missing.
  After an **Undo** they stay out until you click **Put in Foundry**.
- **In Foundry**: the Recap waits in the Handouts queue. Reveal it there, or click **Approve without
  revealing**. **Undo** takes the journal entry out again, but not once the players have the Recap
  or a page was edited in Foundry.
- **Approved**: revealing the Recap or approving marks the session approved. The recording's audio
  is kept either way (D-097). The approval stays even if you take the notes out with Undo
  afterwards; the card then offers **Put in Foundry** to put them back.

**Read** shows all the pages in the side panel. The card, the GM summary and the scenes never
reach the players' page; only the Recap does, when you reveal it.

### Live Feed

What happens at the table, newest on top: damage, healing, who drops to 0 HP, conditions, spell slots, rolls,
scene changes and more. Each line shows its type and the time.

- You see each roll's full breakdown, for example "Wolf 1, Bite attack: 1d20 (15) +2 STR +2
  proficiency = 19", plus the target's AC or DC and the outcome when they are known.
- Private and blind rolls show a **private roll** chip. Players never see these. Roll requests
  show as **roll request**, and someone dropping to 0 HP shows **down**.
- A line starting "Applied:" or "Undid:" appears when a guarded change is applied or undone. Its
  chip names what made it, such as **actor change** or **page reveal**.

### Module Diagnostics

Errors and warnings from Foundry modules, caught in the GM's browser. Hover a line for details.
Useful when something in Foundry misbehaves mid-session. Old entries can stay listed after a
reload.

At the top, a yellow line says when the server's storage space check has not run for over 3 hours.
Nothing is wrong yet, but nobody is watching the space: tell the person who runs the server.

The server (the Orange Pi) checks its own free disk space every hour: under 20% free is low, under
5% (or less than a backup needs) is critical and a backup will stop. That warning also arrives as a
Discord message to the person who runs the server.

### Recent Changes

Every guarded change that was applied, newest first, up to 20. Each row shows:

- a summary, and **Undo** when the change can still be undone;
- its state: `applied`, `destructive` (an applied change of the destructive kind: a delete, a
  reveal or a hide), `undone`, or `undo` (the undo itself);
- the feature (for example `tarokka` or `handouts`), what it changed, and when;
- "N line(s)": click to see the full list of what changed;
- 📓 Obsidian: opens that month's change history in Obsidian.

**Undo** asks for the second confirmation and needs GM Actions on. It puts back the values from
before the change. It refuses, and writes nothing, if the same thing was changed again since.
Undo works even when the feature's switch is off; Redo needs it on. Click **↻** to reload the list.

Only guarded changes are listed here: damage, healing, conditions, resources and token moves,
edits and deletes are, while changes from other tools (rolls, new actors) are not and cannot be
undone here.

**The three tabs.** When the AI Tool on the server is new enough, Recent Changes has three tabs:
**Tool** (the list above: the guarded changes made through the AI Tool, that is Claude and the
dashboard buttons, with Undo where it can still be done), **Game** (what the players and you did directly in Foundry over the last 7
days, such as hit points, items and tokens) and **Everything** (both together, newest first). Hover
a tab to see this. Dashboard changes such as "Poisoned on Randal ... by GM (dashboard)" are in
Tool. On Game and Everything, pick a person in the list above the rows to see only their changes
(Everything also has **Tool** in that list). The dashboard keeps the tab you picked for next time. Each row shows who, when, what changed and, under "N line(s)", the
details. A run of moves of the same token by the same person is one row ("moved 6 times"); its
**Undo** takes back only the latest move, and Foundry's Changes window still lists each move.
**Undo** works on anyone's change. It first shows what it will put back, and you confirm.
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
scene controls) there is an **AI Tool** group, shown to GMs only. It is the **wand icon** (sparkles)
at the very bottom of the column, under Tokens, Tiles, Drawings, Walls, Lights, Sounds, Regions and
Journal Notes; hover it to see "AI Tool". Click it, then click **Changes**: a window opens with everything that changed in the last week, newest first, by
players, by you and by the AI. Each row shows the time, who did it ("by Thorin", or an **AI** tag),
what changed, and **Undo** while the change can still be undone. Click "Changes" on a row to see
the lines that changed, and **Show more** for the last 100. **Show:** at the top narrows the list
to **All**, **AI** or one person. **AI** shows only what the AI changed; a person shows what that
person changed and the undos they ran from this window.

**Undo** asks you to confirm first, listing what will be put back, and then says "Undone: ...", or
tells you why it refused (for example because the same thing was changed again since). If the
change is not the latest one on that thing (Thorin's HP was changed again afterwards, say), the
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
