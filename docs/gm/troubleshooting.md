---
title: Troubleshooting
description: Symptom, likely cause and fix for the problems a GM is most likely to meet with Foundry AI Tool.
---

# Troubleshooting

Find your symptom, then try the causes from the top. Addresses and file paths are today's Windows
setup; they change when the tool moves to the Orange Pi.

## The bridge does not connect

**You see:** no "MCP Bridge connected successfully" message in Foundry, or the warning "MCP Server
not found". The dashboard says **Foundry: unreachable** or **Bridge: disconnected**.

| Likely cause                                                                          | Fix                                                                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Claude Desktop is not running (it starts the bridge).                                 | Start Claude Desktop and wait a few seconds. The module retries by itself; if not, reload Foundry (F5). |
| You are not logged in to Foundry as a GM.                                             | Join as your GM user. The bridge only runs in a GM's browser tab.                                       |
| The module is off in this world.                                                      | Settings tab (gear icon), **Module Management**, tick **Foundry AI Tool**, **Save Module Settings**.    |
| The bridge is switched off in the module settings.                                    | **Game Settings**, category **Foundry AI Tool**, tick **Enable MCP Bridge**, **Save Changes**.          |
| Your Foundry tab runs on another computer than the bridge.                            | Today they must be on the same PC. Log in to Foundry from the PC that runs Claude Desktop.              |
| Something else uses the bridge's ports (31414 to 31416), for example a second bridge. | Close the other program, then quit and restart Claude Desktop.                                          |

When it works, the hint under **Enable MCP Bridge** in Game Settings ends with "Status: ✅
Connected". If nothing helps, the bridge writes a log to
`%TEMP%\foundry-mcp-server\wrapper.log`; send it to whoever set up the tool.

## A tool refuses to change something

The refusal says why. Nothing was written.

| Message (or part of it)                                                                           | Fix                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| GM Actions are off                                                                                | Click **⚔ GM Actions: off** in the dashboard header. A dashboard restart turns it off again.                                                         |
| `The "tarokka" feature is switched off in the module settings` (or `handouts`, `obsidian-mirror`) | **Game Settings**, category **Foundry AI Tool**, tick "AI Tool: Tarokka (writes)" (or Handouts, Obsidian mirror), **Save Changes**, then apply again. |
| `Write operations are disabled in the module settings`, or `… is disabled in module settings`     | Same place: tick **Allow Write Operations**.                                                                                                          |
| `No pending plan … (plans expire after 15 minutes)`                                               | The plan expired, or the bridge restarted. Make the plan again (ask Claude, or run the `plan-` tool again).                                           |
| `Conflict, nothing was written: …`                                                                | Something changed the same thing after the plan was made. Check it in Foundry, then plan again.                                                       |
| `That page is already revealed to players`                                                        | Nothing to do.                                                                                                                                        |
| `Players cannot open the journal that holds …`                                                    | Put the page in a journal the players can open (Observer) whose other pages are set to None, then plan again.                                         |
| `was already undone` or `An undo cannot be undone`                                                | Nothing to undo. To change it again, make a new plan.                                                                                                 |

An **Undo** that reports a conflict means the thing was changed again after the change you want to
undo. Fix it by hand in Foundry.

## The dashboard does not load

| You see                                                  | Likely cause and fix                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The browser cannot connect to `http://localhost:3000`.   | The dashboard is not running. Start it (today: `npm run dev:cogm` in the tool's folder).                                              |
| A short error with `host-not-allowed`.                   | You opened it under another name. Use `http://localhost:3000`, or add that name to `DASHBOARD_ALLOWED_HOSTS`.                         |
| The page loads, but **Bridge: disconnected**.            | The bridge is not running. Start Claude Desktop.                                                                                      |
| **Foundry: unreachable**.                                | See "The bridge does not connect" above.                                                                                              |
| The tool runner says "Couldn't load tools".              | The bridge is not connected, or this browser is not signed in as the GM (see the next row).                                           |
| GM buttons are refused although everything is connected. | The setup uses a GM token. Open the dashboard once with the address you were given (it ends in `?token=…`); the browser remembers it. |
| **AI: disabled**.                                        | Normal. The AI commentary panel needs an API key, which the normal setup does not use.                                                |
| GM Actions turned itself off.                            | The dashboard restarted. Turn it on again when you need it.                                                                           |

## Claude Desktop does not see the tools

| Likely cause                                                     | Fix                                                                                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tool is not in Claude Desktop's configuration.               | `%APPDATA%\Claude\claude_desktop_config.json` needs the `foundry-mcp` entry (see the [README](../../README.md#installation)).                                                     |
| Claude Desktop was not restarted after the change.               | Quit it fully (also from the icon in the system tray), then start it again.                                                                                                       |
| The bridge failed to start. Claude then gets an empty tool list. | Claude Desktop's settings list local MCP servers and their status (in current versions under **Settings**, **Developer**). Check the log `%TEMP%\foundry-mcp-server\wrapper.log`. |
| The tools are there, but every call fails.                       | Foundry is not connected. See "The bridge does not connect" above.                                                                                                                |

## The player page is empty

| You see                                                 | Likely cause and fix                                                                                                                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status `disconnected`.                                  | The bridge is not running. Start Claude Desktop.                                                                                                                                                    |
| Status `foundry offline`.                               | No GM is connected in Foundry. Join as the GM; see "The bridge does not connect".                                                                                                                   |
| "No active combat." while you fight.                    | The combat has not started. In Foundry's Combat Encounters tab, click **Start Combat**.                                                                                                             |
| A creature is missing from the combat order.            | Its token or combatant is hidden, or it is not on the scene the players see. This is on purpose.                                                                                                    |
| A creature shows as "Unknown creature".                 | Its token's **Display Name** hides the name from players. This is on purpose.                                                                                                                       |
| The feed shows little.                                  | Only public rolls and what players could see happen are shown. Private, blind and GM rolls, and events about creatures players cannot name, are left out.                                           |
| "Nothing revealed yet." under Handouts.                 | The reveal was not applied, or players can no longer open the page or its journal. Run `list-revealed-pages` in the tool runner: it shows each revealed page and whether players can still open it. |
| Players on other computers cannot open the page at all. | Today the dashboard only answers on the PC it runs on. Access for players comes with the Orange Pi setup.                                                                                           |

## Obsidian notes do not update

| You see                                                          | Likely cause and fix                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No notes at all.                                                 | The bridge does not know your vault folder (`FOUNDRY_AI_OBSIDIAN_DIR`). Whoever set up the tool adds it; then restart Claude Desktop.                                                                                |
| One note stopped updating.                                       | It was edited in Obsidian, so the tool leaves it alone. It is listed in `AI Tool/_status.md`. Move your text to your own note and delete the generated one to get updates again.                                     |
| No notes under `AI Tool/Foundry/` (PCs, NPCs, scenes, journals). | The Foundry mirror is off. Tick "AI Tool: Obsidian mirror (writes)", then turn the mirror on with `plan-obsidian-mirror` (ask Claude, or the tool runner) and apply the plan. `get-obsidian-mirror` shows its state. |
| A journal's note has no page text.                               | Only journals or journal folders you opted in get their page text.                                                                                                                                                   |
| A deleted document's note is still there.                        | Deletes arrive at the next full check, every 10 minutes, or about 20 seconds after you reload Foundry. It then moves to the vault's `.trash`.                                                                        |
| A renamed document kept its old file name.                       | On purpose: the file name stays, the note's title and `name` change.                                                                                                                                                 |
| The newest session note lags behind.                             | Session notes update a few seconds after events (at most about 30 seconds apart during play). Foundry notes every 10 seconds.                                                                                        |
| No 📓 links in the dashboard.                                    | The dashboard does not know the vault's name (`OBSIDIAN_VAULT_NAME`, or `FOUNDRY_AI_OBSIDIAN_DIR` on the dashboard).                                                                                                 |
| An **Open in Foundry** link in a note fails.                     | The dashboard is not running, runs at another address than the link expects (`FOUNDRY_AI_OPEN_BASE`), or Foundry is not connected.                                                                                   |
