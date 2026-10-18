---
title: Before each session
description: A short checklist for the GM before a play session starts.
---

# Before each session

Do these in order, about 15 minutes before the players join. Each item is one action. The
dashboard runs on the table's home server (the Orange Pi), so there is nothing to start and no
terminal to open. You need two addresses from the tool admin: the game's and the dashboard's.

## Start everything

- [ ] Start **Claude Desktop**. It connects to the bridge on the Pi.
- [ ] Open Foundry in your browser, launch the world, and join as your GM user.
- [ ] Wait for the Foundry message "MCP Bridge connected successfully" (top of the screen).
- [ ] Open the dashboard address on your second screen. Cloudflare may ask for an emailed code
      first, the same as when you join the game.
- [ ] Look at the header of the page at `/`: **✈ Pre-flight** should say "ready" or "N to fix", and no
      "Connection lost" mark should show. If there is one, or Pre-flight's first line says Foundry is
      not connected, see [Troubleshooting](troubleshooting.md).

## Run the pre-flight check

- [ ] In the dashboard header, click **✈ Pre-flight**. Fix everything marked ✗ and look at each
      **!**. The rest of this page is also in the drawer's "Check by hand" list.

## Turn on what tonight needs

- [ ] In the Pre-flight panel, click **Ready for session**. One click turns on "Allow Write
      Operations", "AI Tool: Handouts (writes)", "AI Tool: Live play (writes)", "AI Tool: Party
      (writes)", "AI Tool: Tarokka (writes)" and **GM Actions**. The chips under the button show
      each switch; a message says what it turned on. **End session** turns off again what Ready
      turned on.

- [ ] Once, before session 1 (only with the module Dice So Nice): pick the table's dice, **AI
      Tool: The Veil** or **AI Tool: Neutral**, in Dice So Nice's **Configure Dice Roles**,
      **Basic** row, **Theme** column. See [Themed dice](features.md#themed-dice).

## Check what players will see

- [ ] Scenes tab (map icon), click the scene you start on, **Basics** tab: give it a **Navigation
      Name** if its real name is a spoiler. Click **Save Changes**.
- [ ] Creature names: by default Foundry hides a creature's name from players, so the player page
      shows "Unknown creature". For each creature whose name the players already know: open the
      actor (Actors tab), click **Prototype Token** in the sheet's header, **Identity** tab, set
      **Display Name** to **Hovered by Anyone**, and save. Tokens already on the map keep their old
      setting: right-click each one, click the gear (tooltip **Open Configuration**), and set it
      there too.
- [ ] Hide tokens players should not know about yet: right-click the token, click the eye button
      (tooltip **Hide**).
- [ ] Open the player page in a second tab (the dashboard address with `/player` at the end), and check the combat
      order, feed and handouts show nothing you want to keep secret.
- [ ] Handouts: check that every page in your handouts journal is set to **None** unless you
      revealed it (open the journal, right-click a page, **Configure Ownership**). The steps are in
      [Revealing a handout](dashboard.md#revealing-a-handout).
- [ ] In the Tarokka drawer (🃏 **Tarokka**), make sure **Show cards** is not ticked.

## Prepare

- [ ] In Claude Desktop, run the prompt `prep-next-session` (add a `focus` if you have one).
- [ ] In Obsidian, read last session's note (folder `Campaigns/<world id>/AI Tool/Sessions/`).
- [ ] Put Claude Desktop, the dashboard and Obsidian on the screen players cannot see, and never
      share those windows in Discord or a video call.

## When play begins

- [ ] Click **Start the session log** (in the Pre-flight panel) or **Start session** in the
      dashboard header. It should now say "Session since" and the time.

Next: [after each session](after-session.md).
