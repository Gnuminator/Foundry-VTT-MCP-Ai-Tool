---
title: The TV at the table
description: Show the map on a TV at an in-person session. The TV signs in once as a player called Table and stays signed in.
---

# The TV at the table

For a session where everyone sits in the same room: a TV (or a second screen) shows the map to the
whole table. It joins the game as its own player called **Table**. It is not a GM and it owns no
characters. It sees the scene you show, with hidden things working as for any player. Nothing from
the dashboard or from your notes is on it.

You set it up once. After that the TV opens on the map by itself, also after a restart.

**What you need:** a Windows PC at the TV with PowerShell 7 (`pwsh`), Edge or Chrome, and a copy
of the tool's folder (it holds the `scripts\tv` files). Ask the tool admin to set that up.

## One time: make the Table player

1. Open Claude with the **Admin** tools on (the **+** in the chat box, **Connectors**, switch on **foundry-mcp-admin**).
2. Ask: "Plan a Table user for the TV." Claude shows a plan: one new player named Table, no
   password.
3. Read it, then confirm. It shows in **Recent Changes**, with an **Undo** if you change your mind.

If a user called Table already exists (a player or a GM), or Claude cannot read the list of users,
it says so and plans nothing. (A Table player made before this change is not marked: undo its plan
in Recent Changes and plan it again, or the handout receipts and the player count keep counting
it.) The Table player is marked as the TV, so the handout receipts, the
player count and the session attendance leave it out.

**If the map is dark on the TV:** on a scene with token vision on, a player only sees what their
own characters can see, and Table has none. Give Table the same view as the party: ask Claude
"Give Table Observer on the party characters." (Claude plans it with the ownership tool, you
confirm.) Check this once on your real map before the session, with the TV connected.

## One time: sign the TV in

You need a keyboard on the TV's computer for this step only. Ask the tool admin for the TV's
email address first: the code that proves "this is the TV" is sent there.

1. On the TV's computer, open PowerShell in the tool's folder and run (use the game's address):

   ```powershell
   pwsh scripts\tv\start-table-viewer.ps1 -Url https://your-game-address -Setup
   ```

2. A normal browser window opens. Type the TV's email address, then the code that arrives there.
3. Foundry's join page follows and the script joins as **Table** for you. The map appears.
4. Close the window.

## Every time after

Run the same line without `-Setup`:

```powershell
pwsh scripts\tv\start-table-viewer.ps1 -Url https://your-game-address
```

The browser opens full screen on the map. Foundry's own sign-in lasts only 24 hours, so on a
new day the script sees Foundry's join page and joins as Table again by itself. It does this only
on the join page of your game, never on another page. Leave the script's window open (it can be
minimised); closing the TV's browser ends it. To make all of this happen when the TV's computer
starts, put a shortcut in the Windows Startup folder (press **Win + R**, type `shell:startup`)
whose target is `pwsh -NoExit -WindowStyle Minimized -File "C:\full\path\to\scripts\tv\start-table-viewer.ps1" -Url https://your-game-address`.
The `-NoExit` keeps the window open after a warning, so you can read it. If it says the TV browser
is already running, close that browser (for example the window from the setup step) and run it
again.

If your game sits behind a reverse proxy at a sub-path, such as `https://host/foundry`, give that
address (`-Url https://host/foundry`); the script then looks for the join page at
`https://host/foundry/join`.

While the TV runs, the browser opens a control port that only this computer can reach. Anyone
signed in to this Windows account could use it, so use a TV PC that only the table uses.

The email code from Cloudflare is only asked for again after the Access session ends (weeks).
When the TV shows Cloudflare's sign-in page, do "sign the TV in" above once more.

## During the session

- Show the players the scene you want on the TV with **Activate** on that scene. The TV follows
  the active scene.
- To leave full screen, press **Alt + F4** on the TV's keyboard.

## What the TV can never show

- The dashboard, your notes, the chat of the GM, or any GM-only page. The Table player is a
  plain player; it cannot open them.
- Anything hidden on the map. If you do not want the table to see something, keep it hidden in
  Foundry as you would for any player.

To take the TV out of the game, delete the Table player in Foundry (**Esc**, **User Management**)
or ask Claude to undo the plan in Recent Changes, and delete the TV's profile folder
(`%LOCALAPPDATA%\FoundryAiTool\table-viewer-profile`).
