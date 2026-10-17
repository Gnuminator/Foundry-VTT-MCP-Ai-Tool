---
title: The TV at the table
description: Show the map on a TV at an in-person session. The TV signs in once as a player called Table and stays signed in.
---

# The TV at the table

For a session where everyone sits in the same room: a TV (or a second screen) shows the map to the
whole table. It joins the game as its own player called **Table**. It is not a GM, it owns no
characters and it sees only what a player without a character sees: the scene you show, with the
fog and hidden things working as for any player. Nothing from the dashboard or from your notes is
on it.

You set it up once. After that the TV opens on the map by itself, also after a restart.

## One time: make the Table player

1. Open Claude with the **Admin** tools on (Search and tools menu, switch on **Admin**).
2. Ask: "Plan a Table user for the TV." Claude shows a plan: one new player named Table, no
   password.
3. Read it, then confirm. It shows in **Recent Changes**, with an **Undo** if you change your mind.

If a player called Table already exists, Claude says so and plans nothing.

## One time: sign the TV in

You need a keyboard on the TV's computer for this step only. Ask the tool admin for the TV's
email address first: the code that proves "this is the TV" is sent there.

1. On the TV's computer, open PowerShell in the tool's folder and run (use the game's address):

   ```powershell
   pwsh scripts\tv\start-table-viewer.ps1 -Url https://your-game-address -Setup
   ```

2. A normal browser window opens. Type the TV's email address, then the code that arrives there.
3. On Foundry's join page pick **Table** and click **Join Game**. The map appears.
4. Close the window.

## Every time after

Run the same line without `-Setup`:

```powershell
pwsh scripts\tv\start-table-viewer.ps1 -Url https://your-game-address
```

The browser opens full screen on the map, already signed in. To make that happen when the TV's
computer starts, put a shortcut to that line in the Windows Startup folder (press **Win + R**,
type `shell:startup`).

## During the session

- Show the players the scene you want on the TV with **Activate** on that scene. The TV follows
  the active scene.
- To leave full screen, press **Alt + F4** on the TV's keyboard.
- If the TV shows a sign-in page again, the saved sign-in ran out: do "sign the TV in" above once
  more.

## What the TV can never show

- The dashboard, your notes, the chat of the GM, or any GM-only page. The Table player is a
  plain player; it cannot open them.
- Anything hidden on the map. If you do not want the table to see something, keep it hidden in
  Foundry as you would for any player.

To take the TV out of the game, delete the Table player in Foundry (**Esc**, **User Management**)
or ask Claude to undo the plan in Recent Changes, and delete the TV's profile folder
(`%LOCALAPPDATA%\FoundryAiTool\table-viewer-profile`).
