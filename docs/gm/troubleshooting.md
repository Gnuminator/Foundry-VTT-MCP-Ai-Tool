---
title: Troubleshooting
description: Symptom, likely cause and fix for the problems a GM is most likely to meet with Foundry AI Tool.
---

# Troubleshooting

Find your symptom, then try the causes from the top. Foundry, the tool and the dashboard run on the
home server (the Orange Pi), so most "it does not work" problems are on the server or in the
connection to it, not on your PC. When a row says to tell the tool admin, do that.

## The bridge does not connect

**You see:** Claude says it cannot reach the bridge or Foundry, the warning "MCP Server not found"
shows in Foundry, or the dashboard's **✈ Pre-flight** says Foundry is not connected or shows
"Connection lost, reconnecting…".

The bridge is the small program on the server that links Foundry, Claude Desktop and the dashboard.
A browser on the server (the Assistant GM) holds its link to Foundry, so your own browser never
needs to connect to it.

| Likely cause                                                         | Fix                                                                                                                                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Desktop says the bridge is not reachable.                     | The tunnel client on your PC is stopped. Restart your PC (it starts at every sign-in), or run the status line you were given. See [Connect Claude Desktop](connect-claude-desktop.md). |
| Pre-flight says Foundry is not connected, but the game itself loads. | The server's own Foundry browser (the Assistant GM) is down or logged out. Tell the tool admin.                                                                                        |
| The module is off in this world.                                     | Settings tab (gear icon), **Module Management**, tick **Foundry AI Tool**, **Save Module Settings**.                                                                                   |
| The bridge is switched off in the module settings.                   | **Game Settings**, category **Foundry AI Tool**, tick **Enable MCP Bridge**, **Save Changes**.                                                                                         |

When it works, the hint under **Enable MCP Bridge** in Game Settings ends with "Status: ✅
Connected". If nothing helps, the tunnel client on your PC writes a log to
`%TEMP%\foundry-mcp-server\wrapper.log`; send it to the tool admin.

## A tool refuses to change something

The refusal says why. Nothing was written.

| Message (or part of it)                                                                                        | Fix                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GM Actions are off                                                                                             | Click **⚔ GM Actions: off** in the dashboard header. A dashboard restart turns it off again.                                                                    |
| `The "tarokka" feature is switched off in the module settings` (or `handouts`, `obsidian-mirror`, `live-play`) | **Game Settings**, category **Foundry AI Tool**, tick "AI Tool: Tarokka (writes)" (or Handouts, Obsidian mirror, Live play), **Save Changes**, then apply again. |
| `Write operations are disabled in the module settings`, or `… is disabled in module settings`                  | Same place: tick **Allow Write Operations**.                                                                                                                     |
| `No pending plan … (plans expire after 15 minutes)`                                                            | The plan expired, or the bridge restarted. Make the plan again (ask Claude, or run the `plan-` tool again).                                                      |
| `Conflict, nothing was written: …`                                                                             | Something changed the same thing after the plan was made. Check it in Foundry, then plan again.                                                                  |
| `That page is already revealed to players`                                                                     | Nothing to do.                                                                                                                                                   |
| `Players cannot open the journal that holds …`                                                                 | Set the journal's other pages to None first, then raise the journal to Observer; see [Revealing a handout](dashboard.md#revealing-a-handout). Plan again.        |
| `was already undone` or `An undo cannot be undone`                                                             | Nothing to undo. To change it again, make a new plan.                                                                                                            |

An **Undo** that reports a conflict means the thing was changed again after the change you want to
undo. Fix it by hand in Foundry.

## The dashboard does not load

| You see                                                                   | Likely cause and fix                                                                                                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare shows a page asking for your email.                            | Type your email address, then the code Cloudflare sends you. If no code arrives, your address is not on the access list; tell the tool admin. |
| The browser cannot connect to the dashboard address.                      | The dashboard is not running. Tell the tool admin (on the admin's own PC: `npm run dev:cogm`).                                                |
| "Connection lost, reconnecting…" or "Connection closed: reload the page". | The page lost the dashboard program, for example while it restarted. Wait a moment, then reload the page. Still no luck: tell the tool admin. |
| A short error with `host-not-allowed`.                                    | You opened it under another name. Use the address the admin gave you.                                                                         |
| The page loads, but Pre-flight and the panels cannot read the game.       | The bridge or the server's Foundry browser is down. Tell the tool admin.                                                                      |
| Pre-flight's "Foundry connected" line is marked as failing.               | See "The bridge does not connect" above.                                                                                                      |
| The tool runner says "Couldn't load tools".                               | The bridge is not connected, or this browser is not signed in as the GM (see the next row).                                                   |
| GM buttons are refused although everything is connected.                  | The setup uses a GM token. Open the dashboard once with the address you were given (it ends in `?token=…`); the browser remembers it.         |
| No AI commentary on the page.                                             | Normal. The AI commentary is only on the old dashboard (`/legacy/`) and needs an API key, which the normal setup does not use.                |
| GM Actions turned itself off.                                             | The dashboard restarted. Turn it on again when you need it.                                                                                   |

## Claude Desktop does not see the tools

| Likely cause                                                     | Fix                                                                                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The five Foundry connectors are missing.                         | Quit Claude Desktop from the tray icon and run the installer again; see [Connect Claude Desktop](connect-claude-desktop.md).                                                      |
| The tool set is switched off.                                    | Claude says which set a request needs. Switch that entry on under **+**, **Connectors** (see [Asking Claude](asking-claude.md#tool-sets-which-switches-to-turn-on)).              |
| Claude Desktop was not restarted after the change.               | Quit it fully (also from the icon in the system tray), then start it again.                                                                                                       |
| The bridge failed to start. Claude then gets an empty tool list. | Claude Desktop's settings list local MCP servers and their status (in current versions under **Settings**, **Developer**). Check the log `%TEMP%\foundry-mcp-server\wrapper.log`. |
| The tools are there, but every call fails.                       | Foundry is not connected. See "The bridge does not connect" above.                                                                                                                |

## The player page is empty

| You see                                      | Likely cause and fix                                                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status `disconnected`.                       | The page lost the dashboard. Reload it; if it stays, tell the tool admin.                                                                                                                                                     |
| Status `foundry offline`.                    | The AI Tool's link to Foundry is down. Tell the tool admin; see "The bridge does not connect".                                                                                                                                |
| "No active combat." while you fight.         | The combat has not started. In Foundry's Combat Encounters tab, click **Start Combat**, or use **Start combat** in the dashboard's Combat Tracker.                                                                            |
| A creature is missing from the combat order. | Its token or combatant is hidden, or it is not on the scene the players see. This is on purpose.                                                                                                                              |
| A creature shows as "Unknown creature".      | Its token's **Display Name** hides the name from players (Foundry's default). To show it: token's gear (**Open Configuration**) or the actor's **Prototype Token**, **Identity** tab, **Display Name** **Hovered by Anyone**. |
| The feed shows little.                       | Only public rolls and what players could see happen are shown. Private, blind and GM rolls, and events about creatures players cannot name, are left out.                                                                     |
| "Nothing revealed yet." under Handouts.      | The reveal was not applied, or players can no longer open the page or its journal. Run `list-revealed-pages` in the tool runner: it shows each revealed page and whether players can still open it.                           |
| A player cannot open the page at all.        | First open the player page yourself on your own device. If it works for you, send the player [Join the game](../player/join.md); if it fails for you too, tell the tool admin.                                                |

## Obsidian notes do not update

| You see                                                          | Likely cause and fix                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No notes at all.                                                 | The bridge does not know your vault folder (`FOUNDRY_AI_OBSIDIAN_DIR`). Whoever set up the tool adds it; then restart Claude Desktop.                                                                                                                          |
| One note stopped updating.                                       | It was edited in Obsidian, so the tool leaves it alone. It is listed in `AI Tool/_status.md` (session notes) or `AI Tool/Foundry/_status.md` (PCs, NPCs, scenes, journals). Move your text to your own note and delete the generated one to get updates again. |
| No notes under `AI Tool/Foundry/` (PCs, NPCs, scenes, journals). | The Foundry mirror is off. Tick "AI Tool: Obsidian mirror (writes)", then turn the mirror on with `plan-obsidian-mirror` (ask Claude, or the tool runner) and apply the plan. `get-obsidian-mirror` shows its state.                                           |
| A note is still in an old folder after an update.                | You edited it, so the tool does not move it. `_status.md` lists it as "kept at its old path because it was edited". Move your text to your own note and delete the old one; the tool then writes a fresh note in the right folder.                             |
| A journal's note has no page text.                               | Only journals or journal folders you opted in get their page text.                                                                                                                                                                                             |
| A note says the stat block, text or picture was left out.        | Your vault is inside a git repository that does not ignore the mirror folder, so the tool keeps licensed text out of it. `AI Tool/Foundry/_status.md` says what to add to `.gitignore`, or move the vault out of the repository.                               |
| No `AI Tool/Library/` folder.                                    | No compendiums are picked. Ask Claude to add packs with `plan-obsidian-mirror` (`libraryPacks`) and apply the plan. `get-obsidian-mirror` lists the packs and any that were not found.                                                                         |
| Pictures show as `[image: ...]` or are missing.                  | The bridge could not fetch them from Foundry. `get-obsidian-mirror` lists failed pictures. If the bridge runs on another computer, set `FOUNDRY_AI_FOUNDRY_URL`.                                                                                               |
| A deleted document's note is still there.                        | Deletes arrive at the next full check, every 10 minutes, or about 20 seconds after you reload Foundry. It then moves to the vault's `.trash`.                                                                                                                  |
| A renamed document kept its old file name.                       | On purpose: the file name stays, the note's title and `name` change.                                                                                                                                                                                           |
| The newest session note lags behind.                             | Session notes update a few seconds after events (at most about 30 seconds apart during play). Foundry notes every 10 seconds.                                                                                                                                  |
| No 📓 links in the dashboard.                                    | The dashboard does not know the vault's name. Set `OBSIDIAN_VAULT_NAME` (or `FOUNDRY_AI_OBSIDIAN_DIR`) in `packages/cogm-dashboard/.env`, then restart the dashboard.                                                                                          |
| An **Open in Foundry** link in a note fails.                     | The dashboard is not running, runs at another address than the link expects (`FOUNDRY_AI_OPEN_BASE`), or Foundry is not connected.                                                                                                                             |

## Players and characters in Foundry

These come from Foundry, dnd5e or DDB Importer, not from the tool, but they show up at the table.

| You see                                                                                                                                        | Likely cause and fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A player cannot put a spell or feature's effect (Mage Armor, Innate Sorcery) on their own character; only you can.                             | dnd5e's **Allow Player Effect Application** is off (its default). As the GM: **Game Settings**, the **Dungeons & Dragons Fifth Edition** settings, tick **Allow Player Effect Application**, **Save Changes**. Then the player applies it from the effect tray on the chat card: for a feature that only works on themselves (Innate Sorcery), they click their own token to select it and press **Apply**; for a spell cast on themselves (Mage Armor), they **target** their own token before casting (hover it and press **T**, or right-click it and click **Target**), then press **Apply**. With only a selected token, dnd5e shows players no tray for such a spell. |
| A character carried over from an older world has a feature that does nothing (for example Innate Sorcery without its +1 to the spell save DC). | The feature's effect was empty or broken in the old world already. Delete the feature from the character sheet and add it again from the compendium, or import the character again from D&D Beyond.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A character imported from D&D Beyond arrives as an empty actor named "New Actor", with no error message.                                       | The character has no species on D&D Beyond, and DDB Importer stops without saying so (the error is only in the browser console, F12). Pick a species for the character on D&D Beyond, delete the empty "New Actor", and import again.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
