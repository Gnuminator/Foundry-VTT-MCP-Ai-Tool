---
title: 'The dashboard: views and header'
description: 'The three views and the header: connection mark, Pre-flight, theme, session buttons, GM Actions and the Advanced menu.'
---

# The dashboard: views and header

Part of [The dashboard](dashboard.md).

The dashboard is your control panel. Open it in a browser on a second screen next to
Foundry. Its address is the one the tool admin gave you (on the admin's own PC it is
`http://localhost:3000`).

Watching is always safe. Apart from the session marks and queueing a handout, nothing on the
dashboard changes the game until you turn on **GM Actions** and confirm.

> Keep the dashboard off any screen the players can see, and never share its window in Discord or
> a video call. It shows true names, exact HP, private rolls and, when you ask, Tarokka cards.

## The three views

The tabs **Before**, **During** and **After** in the header switch what the page shows. They
follow your evening, and you can click any of them at any time.

- **Before**: the Pre-flight check and the Prep panel, the **Pick your During layout** card
  (until you have picked a layout).
- **During**: the Combat order strip, the Live Feed, and Handouts, Party and Recent Changes.
- **After**: Tonight's stats and the Session notes, with Prep, Handouts and Recent Changes.

The page picks a view for you: **During** while a session is open, **After** for 12 hours after
you click **End session**, otherwise **Before**. A tab you click stays until a session starts or
ends, or you reload the page.

### Table at a glance

**Live views ▾**, then **Table at a glance**, opens a read-only page for a phone or a tablet beside
the table. Three panels: **Party** (each character's hit points and conditions), **Fight** (the
turn order, with the current turn marked) and **Scene** (the scene you are on). Every panel says
how fresh it is ("updated 12 s ago"); one older than 45 seconds says "Old". The page refreshes by
itself, about every 15 seconds for Party and Scene and at once for the fight, and needs no Claude
connector. It only reads: nothing on it changes the game.

It is for you only. It shows exact hit points, including the enemies', so keep it off any screen
the players can see. Players do not get this page: a player who types its address ends up on the
player page, which shows only what a player already sees.

## The header

### The connection mark and Pre-flight

The page at `/` has no row of status lights. Two things tell you about the connection:

- **The connection mark.** Next to the buttons, a small mark appears only when something is wrong:
  "Connection lost, reconnecting…" means this page lost its link to the dashboard program (is its
  window still open?). The page keeps trying by itself. "Connection closed: reload the page" means
  it gave up; reload the page. No mark means the link is fine.
- **✈ Pre-flight.** The button reads "✈ Pre-flight: ready" or "✈ Pre-flight: N to fix". Its first
  lines say whether Foundry is connected ("Foundry connected"). If it is not, tell the tool admin:
  the AI Tool's link to Foundry (a browser on the server) is down. Each panel also shows its own message when it cannot read the
  game.

### Theme

A **Theme** dropdown in the header (Neutral or The Veil) sets the look for this world. The players'
page and Obsidian follow it.

### Session: Start session / End session

Marks the start and the end of a play session. The tool uses these marks to write one Obsidian note
per session and to group the play log.

- **Start session** is the button in the header. It also turns on GM Actions and every
  **Turn on for tonight** switch (see "GM Actions on" below).
- Click **Start session** when play begins. The text changes to "Session since 19:30".
- Click **End session** when play ends. The text changes back to "No session". It also turns off
  again what **Turn on for tonight** turned on (see below), and GM Actions.
- Starting a session writes a line in the tool's own log and turns GM Actions on, so tools that
  change the game can run after you confirm.
- If you forget, the notes still split sessions at a gap of 3 hours without events.

The Obsidian button next to it opens your campaign's Home note in Obsidian (see "Open in Obsidian" below).

### GM Actions on

**Start session** is the only switch for GM Actions. One click turns on GM Actions and every
**Turn on for tonight** switch; **End session** turns them off again. The button in the header
shows the state and opens the list of switches. When the page cannot read the switches, the button
says so (and still says if GM Actions is off).

- **GM Actions on**: tools that change the game can run after you confirm, and Undo in
  Recent Changes works.
- **Something is off** (the button says "GM Actions off: Turn on"; hover it to see what is off): the controls that need it stay on
  the screen, greyed out, with the reason and a **Turn on** button next to them. One click turns
  everything on, the same as Start session.
- It only guards the dashboard. It does not stop Claude Desktop.
- Restarting the dashboard turns GM Actions off again.

The header has no off control. Start session turns GM Actions on; **End session** or Pre-flight's
**Turn them off again** turns it off.

### 🛠 Tool Runner (Advanced)

Under **Advanced ▾**, **Tool Runner**. Opens the Tool Runner. See "The Tool Runner" below.

### ✈ Pre-flight

In the header, next to **Advanced ▾**. Opens the pre-flight check: run it before the players join. The tool ticks what it can check by
itself (Foundry connected, module and bridge versions match, the write switches, secrets in world
settings, names players can see that give away a secret, module conflicts, Obsidian notes, the
play session, Turn on for tonight, the player page, Tarokka cards hidden). Below that are the things to
check by hand, from [before each session](before-session.md); your ticks stay in this browser until
you click **Clear ticks**. The button itself reads **Pre-flight: ready** or **Pre-flight: 2 to fix**
after each Foundry connect.

A value that looks like a secret is never shown in full, only its first four characters and its
length. If the module and bridge versions differ, a banner at the top says which to update.

#### Turn on for tonight

At the top of the Pre-flight panel. One click turns on what an evening at the table needs:

- in Foundry's module settings: "AI Tool: Allow Write Operations", "AI Tool: Handouts (writes)", "AI Tool:
  Live play (writes)", "AI Tool: Party (writes)" and "AI Tool: Tarokka (writes)";
- on the dashboard: **GM Actions**.

It turns on only what is off, and remembers that in the world. **End session** (or **Turn them off
again**) turns off exactly those, so a switch that was already on stays on. The chips under the
button show each switch (✓ on, ○ off). If Foundry did not take a change, a red toast names the
switch; check it in Foundry's module settings, where every switch stays visible.

A refusal toast ("... is switched off") offers the same click as a button, "Turn on (switch name) and the
rest for tonight": it turns on all of the above, not only the named switch.

Only the dashboard can do this, from the GM's login. Claude has no tool for it, so Claude can never
switch on its own writes. **Start the session log and GM Actions** next to it is the same as **Start session** in
the header.

### 📜 Handouts (Advanced)

Under **Advanced ▾**, Panels. Opens the handout drawer. See "The handout drawer" below.

### 📋 Prep (Advanced)

Under **Advanced ▾**, Panels (Prep is also docked in the Before and After views). Opens the prep
drawer. See "The prep drawer" below.

### 🛡 Party (Advanced)

Under **Advanced ▾**, Panels. Opens the party drawer. See "The party drawer" below.

### 🃏 Tarokka (Advanced)

Under **Advanced ▾**, Panels. Opens the Tarokka drawer. See "The Tarokka drawer" below.

### 🔗 Player links (Advanced)

Under **Advanced ▾**, Tools. Each player's private link to their own character page. See "Player
links and My character" below.

### 🩺 Module diagnostics, 📦 Versions and Version tracker (Advanced)

More entries under **Advanced ▾**, Tools:

- **🩺 Module diagnostics** shows or hides the Module Diagnostics panel (see below).
- **Version tracker: on / off** is on by default. While it is on, a **📦 Versions** entry appears
  in the same menu; turn it off to hide it and stop the online lookups. It opens a table of what is installed (Foundry, the game system and the
  modules) next to the newest release, with a status for each. It only tells you what is out of
  date; it never updates anything.

### 📝 After a paper night (Advanced)

Under **Advanced ▾**, Panels (there is also a card for it in the **After** view). For a table that
played on paper: one card per player character, filled in from the sheet in Foundry. Type the
numbers from the paper sheet; **Plan** makes one change per character, with the usual confirm and
Undo. It needs GM Actions and the module switch "AI Tool: Paper sync (writes)".

### ▦ Try the During layouts

One entry under **Advanced**, in the **During screen** group:

- **▦ Try the During layouts** starts the short layout trial again (see During layouts below).
