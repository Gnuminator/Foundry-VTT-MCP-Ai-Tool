---
title: 'One-time setup: the TV at the table'
description: Make the Table player and sign the TV's computer in, once. Only for in-person sessions.
---

# One-time setup: the TV at the table

Only if you play in the same room and want the map on a TV. The TV joins the game as its own player
called **Table**. After this setup it opens on the map by itself. How it behaves during play is in
[The TV at the table](tv-table-viewer.md). About 15 minutes, once.

**You need:** a Windows PC at the TV with PowerShell 7 (`pwsh`), Edge or Chrome and a copy of the
tool's folder (it holds `scripts\tv`), a keyboard on that PC, the game's address, and the email
address Cloudflare uses for the TV. The tool admin sets up the PC and the folder.

## 1. Make the Table player

1. In Claude Desktop click the **+** in the chat box, **Connectors**, and switch on
   **foundry-mcp-admin**.
2. Ask: _Plan a Table user for the TV._ Claude shows a plan: one new player named Table, no password.
3. Read it, then confirm. It shows in **Recent Changes** with an **Undo**.

## 2. Sign the TV in

1. On the TV's computer open PowerShell in the tool's folder and run (use the game's address):

   ```powershell
   pwsh scripts\tv\start-table-viewer.ps1 -Url https://your-game-address -Setup
   ```

2. A browser window opens. Type the TV's email address, then the code that arrives there.
3. Foundry's join page follows and the script joins as **Table** for you. The map appears.
4. Close the window.

## Done when it looks like this

Run the same line without `-Setup`. The browser opens full screen on the map. When you click
**Activate** on a scene in Foundry, the TV follows it. Press **Alt + F4** to leave full screen.

## If it does not work

- **Claude says a user called Table already exists, or it cannot read the users:** it plans nothing.
  Delete the old Table in Foundry (**Esc**, **User Management**) or ask the person who built the tool.
- **The map is dark on the TV:** Table owns no characters, so token vision shows nothing. Ask Claude
  _Give Table Observer on the party characters_ and confirm the plan.
- **Check the map once before the first session:** with the TV connected, look at your real map. Token
  vision may leave it dark even if the test scene looked fine.
- **The TV counts as a player:** the Table player is marked as the TV, so handout receipts, the
  player count and attendance leave it out. A Table made with an older version is not marked: undo its
  plan in Recent Changes and plan it again.
- **The TV shows Cloudflare's sign-in page:** do step 2 again.
- **"The TV browser is already running":** close that browser (for example the setup window) and run
  the line again.
