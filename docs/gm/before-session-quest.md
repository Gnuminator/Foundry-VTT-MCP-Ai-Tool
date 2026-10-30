---
title: 'Quest: before a session'
description: The 15 minutes before play as a short quest, four stages with times, ending when the session log is running.
---

# Quest: before a session

This is [Before each session](before-session.md) as a list you can tick off, about 15 minutes
before the players join. The checklist page has the full steps and the fixes; this one keeps the
order and the times. The rare cases stay on the checklist page: the emailed login code, Dice So
Nice's themed dice (once, before session 1) and creature names on tokens already on the map.

:::note
Nothing to start on a PC and no terminal to open: the dashboard runs on the table's home server.
You need the game's address and the dashboard's address from the tool admin.
:::

**Progress:** four stages, ending with the session log running.

## Stage 1 of 4: Start everything (4 minutes)

- [ ] Start **Claude Desktop**.
- [ ] Open Foundry in your browser, launch the world and join as your GM user.
- [ ] Open the dashboard address on your second screen.
- [ ] Look at the header: **✈ Pre-flight** says "ready" or "N to fix", and no "Connection lost"
      mark shows.

**You are done when** the header looks calm. If it does not, see [Troubleshooting](troubleshooting.md).

## Stage 2 of 4: Pre-flight and switches (3 minutes)

- [ ] Click **✈ Pre-flight**. Fix everything marked ✗ and look at each **!**.
- [ ] In the Pre-flight panel, click **Turn on for tonight**.
- [ ] Check the [GM windows](gm-windows.md) are on: **Settings** tab, **Game Settings**, category
      **Foundry AI Tool**, **AI Tool: GM windows** ticked.

**You are done when** the chips under the button show the switches as on.

:::tip
**End session** turns off again what **Turn on for tonight** turned on, so you do not have to
remember it afterwards.
:::

## Stage 3 of 4: What players will see (6 minutes)

- [ ] The scene you start on has a **Navigation Name** if its real name is a spoiler.
- [ ] Creatures the players already know have **Display Name** set to **Hovered by Anyone**.
- [ ] Tokens the players should not know about are hidden.
- [ ] Open the player page in a second tab (the dashboard address with `/player` at the end) and
      check that nothing there is a secret.
- [ ] Every page in your handouts journal is **None** unless you revealed it.
- [ ] In the Tarokka drawer, **Show cards** is not ticked.

**You are done when** the player page shows nothing you want to keep back.

## Stage 4 of 4: Prepare and begin (2 minutes)

- [ ] In Claude Desktop, run the prompt `prep-next-session`.
- [ ] Read last session's note in Obsidian.
- [ ] Put Claude Desktop, the dashboard and Obsidian on the screen the players cannot see, and
      never share those windows in Discord or a video call.
- [ ] When play begins, click **Start session** in the dashboard header, or **Start the session
      log** in the Pre-flight panel.

**You are done when** the header says "Session since" and the time.

## Quest complete

Play. Keep the [game night runbook](game-night-runbook.md) open. Afterwards: [after each
session](after-session.md).
