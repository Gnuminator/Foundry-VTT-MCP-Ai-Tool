---
name: foundry-test-env
description: Start, use and stop the personal local Foundry VTT test environment for this repo (Foundry 14 on localhost:30001 with the dnd5e world "ai-tool-test", a test bridge on ports 31514-31516, the co-GM dashboard on 3100, a separate vault), join as the passwordless "Claude" GM or "Player" in the browser pane, sync the module after code changes, install packages or create worlds on the test server, inspect installed modules/systems, and troubleshoot. Use before any live check in Foundry. Testing the AI Tool itself (tools, dashboard, smoke checklist) is the foundry-ai-tool skill; Foundry's own UI is foundry-core-ui. Never touches the live campaign or the live bridge ports 31414-31416.
---

# Foundry test environment

A personal-only test server (the Foundry licence allows a second instance for the licence
owner's own testing). Everything is separate from the live campaign, which runs on a
hosting service and is driven by Claude Desktop's bridge on 31414-31416.

| Part        | Where                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------- |
| Foundry 14  | `http://localhost:30001`, app `C:\FoundryTest\app`, data `C:\FoundryTest\data`                |
| Test world  | id `ai-tool-test`, title "AI Tool Test", dnd5e 6.0.5, Modern Rules (2024)                     |
| Users       | `Claude` (Gamemaster, no password), `Player` (Player, no password), `Gamemaster` (the GM's)   |
| Test bridge | control `31514`, Foundry link `31515`, WebRTC signaling `31516`                               |
| Dashboard   | `http://localhost:3100`                                                                       |
| Vault       | `C:\FoundryTest\vault`                                                                        |
| Obsidian    | `C:\FoundryTest\obsidian` (throwaway vault the test bridge renders notes into; `ObsidianDir`) |
| Logs, PIDs  | `C:\FoundryTest\logs` (`<service>.out.log`, `.err.log`, `pids.json`)                          |

Paths and ports come from `scripts/test-env/config.ps1`; `scripts/test-env/local.json`
(gitignored) overrides them. The scripts need PowerShell 7 (`pwsh`, the PowerShell tool).
Foundry runs on the Node its `app\package.json` requires (14.368: >=24.13.1 <25, the
global Node 24); the bridge and dashboard use the repo's portable Node 22.

## Rules

- Never use 31414, 31415 or 31416, never call `mcp__foundry-mcp__*` tools, never repoint
  Claude Desktop. The scripts refuse test ports that collide with the live ones.
- In Foundry, join as `Claude` (or `Player` for player-view checks). Never type the GM's
  own passwords, licence key or foundryvtt.com credentials anywhere.
- Setup-screen tasks (install packages, create worlds) need the test server's admin login.
  Use it only from `scripts/test-env/local.json` (`AdminUser`, `AdminPassword`, read with
  `Get-TestAdminCredential` in `config.ps1`), only on `http://localhost:30001`, and never
  print, log or commit it. If it is not there, ask the GM to add it (a password used for
  nothing else) or to log in once in the browser pane.
- Test world only: no players, no licensed adventure content copied into the repo.
- Don't edit files under `C:\FoundryTest\data` while Foundry runs (worlds are LevelDB);
  reading is fine. Leave a world with **Return to Setup** before stopping Foundry.
- Firewall: the GM chose not to block port 30001 (it may matter on the Orange Pi later).
  Never change firewall or other system settings; `status.ps1` shows the optional rule.
- Stop what you started when done (`stop.ps1`).

## Daily loop

```
pwsh scripts/test-env/status.ps1     # what runs; also shows (read-only) whether the live bridge is up
pwsh scripts/test-env/start.ps1      # Foundry (into ai-tool-test) + test bridge + dashboard
pwsh scripts/test-env/stop.ps1       # stop them (only what start.ps1 started)
```

`start.ps1` returns once each service listens and prints the URLs; it skips a service
whose port is taken, and waits for Foundry's data-folder lock to go stale after a recent
stop. `-Only foundry|bridge|dashboard` for one service; `-NoWorld` starts Foundry at the
setup screen.

1. Open Foundry in the browser pane: `preview_start` with name `foundry-test`.
2. Join: go to `http://localhost:30001/join`. The v14 join form has a **text field for the
   user name** (not a dropdown), a password field and "Join Game Session"; below it are the
   administrator login fields. The page can look empty in a screenshot while it animates:
   use `read_page` (filter interactive), `form_input` the name `Claude`, leave the password
   empty, click "Join Game Session". The pane keeps the session; one session = one user per
   origin (a second user joins on `http://127.0.0.1:30001`).
3. Expect the notification **"MCP Bridge connected successfully"** (bottom-left shows
   `Claude [GM]`). The module dials `ws://localhost:31515` because the test copy's
   `module.json` has `flags.foundry-mcp-bridge.defaultServerPort = 31515`.
4. Test (see Next steps). Before stopping Foundry: Settings tab, scroll down, **Return to
   Setup** (a dialog asks to disconnect other connected users: **Yes**).

After changing code:

- Module: `pwsh scripts/test-env/sync-module.ps1` (builds and copies), then reload
  `http://localhost:30001/game` in the pane (the session stays logged in).
- Backend or dashboard: `npm run build`, then `stop.ps1 -Only bridge` / `-Only dashboard`
  and `start.ps1 -Only ...` again.

## Next steps

- Testing the AI Tool (calling tools, guarded writes, dashboard, pickers, vault, the M0+M1 smoke
  checklist): the `foundry-ai-tool` skill.
- Foundry's own screens (setup, join, sidebar, controls, sheets, settings, chat, combat, dnd5e
  sheets): the `foundry-core-ui` skill and its verified reference pages.
- Browser pane gotchas that bite here: the pane is smaller than Foundry's minimum (resize the tab
  to 1440×900); a tab that loads while hidden renders at 0×0 and its canvas fails (reload it in
  front); opening a second tab with `preview_start` can reload the first (use `tabs_create` +
  `navigate`); a second user needs a second origin (`http://127.0.0.1:30001` for `Player`).
- Setup screen (`/setup`, admin): three tabs, **Game Worlds**, **Game Systems**, **Add-on
  Modules**; install a package with **Install System** / **Install Module** (search, **Install**);
  create a world with **Create World** (title, data path, system `dnd5e`, **Continue**; Foundry
  opens the new world on a first-run **User Management** page). Details in `foundry-core-ui`.

## Inspecting modules, systems and worlds

Read the data folder directly (read-only):

- `C:\FoundryTest\data\Data\modules\*\module.json`, `...\systems\*\system.json`: installed
  packages and versions.
- `C:\FoundryTest\data\Data\worlds\*\world.json`: worlds, their system and core version.
- `C:\FoundryTest\data\Config\options.json` (settings; `admin.txt` holds the hashed admin
  password, never touch it), `C:\FoundryTest\data\Logs\`, `C:\FoundryTest\logs\*.log`.
- In the world: `get-modules`, `get-module-errors`, `get-world-info` via the dashboard API.

## Troubleshooting

- "Foundry VTT cannot start in this directory which is already locked": a Foundry process
  still runs, or the lock of a just-stopped one is fresh. `status.ps1`; wait ~15 s and
  start again (start.ps1 already waits for a stale lock).
- "port N is already in use": `status.ps1`; never kill a process you did not start.
- Foundry does not start: `C:\FoundryTest\logs\foundry.err.log` (Node version, lock).
- Module does not connect: module enabled in Module Management? The copy's `module.json`
  has the 31515 flag (`sync-module.ps1`)? Bridge running (`status.ps1`)? `read_console_messages`.
- Later (before the new campaign) everything moves to an Orange Pi 5 Pro; the scripts are
  PowerShell 7 and handle Linux paths, but the Pi setup is its own task.
