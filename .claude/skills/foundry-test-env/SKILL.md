---
name: foundry-test-env
description: Start, use and stop the personal local Foundry VTT test environment for this repo (Foundry 14 on localhost:30001 with a fresh dnd5e world "ai-tool-test", a test bridge on ports 31514-31516, the co-GM dashboard on 3100, a separate vault), log in as the passwordless "Claude" GM user in the browser pane, and test AI Tool features end to end. Use before claiming a feature works in Foundry, to learn the Foundry UI, to check the player view, or to inspect installed modules/systems. Never touches the live campaign or the live bridge ports 31414-31416.
---

# Foundry test environment

A personal-only test server (the Foundry license allows a second instance as long as
nobody else can get past its login screen). Everything is separate from the live campaign,
which runs on a hosting service and is driven by Claude Desktop's bridge on 31414-31416.

| Part        | Where                                                                          |
| ----------- | ------------------------------------------------------------------------------ |
| Foundry 14  | `http://localhost:30001`, app `C:\FoundryTest\app`, data `C:\FoundryTest\data` |
| Test world  | id `ai-tool-test` (fresh dnd5e, no adventure content)                          |
| Test bridge | control `31514`, Foundry link `31515`, WebRTC signaling `31516`                |
| Dashboard   | `http://localhost:3100`                                                        |
| Vault       | `C:\FoundryTest\vault`                                                         |
| Logs, PIDs  | `C:\FoundryTest\logs` (`<service>.out.log`, `.err.log`, `pids.json`)           |

Paths and ports come from `scripts/test-env/config.ps1`; `scripts/test-env/local.json`
(gitignored) overrides them. The scripts need PowerShell 7 (`pwsh`, the PowerShell tool).

## Rules

- Never use 31414, 31415 or 31416, never call `mcp__foundry-mcp__*` tools, never repoint
  Claude Desktop. The scripts refuse test ports that collide with the live ones.
- Log in only as the passwordless test users ("Claude", "Player"). Never type a password
  anywhere; the admin password and the GM's own user stay with the GM. If something needs
  the setup screen or a password, stop and ask the GM.
- This world is for testing only: never invite players, never open its port to the network
  (the license condition), never copy licensed adventure content into the repo.
- Do not edit files under `C:\FoundryTest\data` while Foundry runs (worlds are LevelDB).
  Reading them is fine.
- Stop what you started when done (`stop.ps1`).

## One-time setup (the GM does the parts marked GM)

1. GM: download the **Foundry VTT 14 Node.js build** from their foundryvtt.com account and
   extract it into `C:\FoundryTest\app` (so `app\main.js` exists; older layouts with
   `app\resources\app\main.js` also work).
2. Claude: `pwsh scripts/test-env/setup.ps1` (creates folders, builds, copies the module
   with its bridge port set to 31515), then `pwsh scripts/test-env/start.ps1 -Only foundry -NoWorld`.
   On the first start Windows may ask about the firewall for Node: the GM answers
   **Cancel / do not allow** so only this PC can reach it.
3. GM, at `http://localhost:30001`: accept the licence agreement, enter the licence key,
   set an admin password (keep it), install the **dnd5e** system, create a world with the id
   **`ai-tool-test`**, launch it, log in as Gamemaster, and in the world:
   - Manage Modules: enable **Foundry AI Tool** (the local copy from `sync-module.ps1`).
   - User Management: add **Claude** (role Gamemaster, empty password) and **Player**
     (role Player, empty password).
4. Claude: `pwsh scripts/test-env/stop.ps1 -Only foundry`. From now on `start.ps1` launches
   the world directly (`--world=ai-tool-test`), so the setup screen is never needed.

## Daily loop

```
pwsh scripts/test-env/status.ps1     # what runs; also shows (read-only) whether the live bridge is up
pwsh scripts/test-env/start.ps1      # Foundry + test bridge + dashboard, in the background
pwsh scripts/test-env/stop.ps1       # stop them (only what start.ps1 started)
```

`start.ps1` returns once each service listens and prints the URLs; it skips a service
whose port is already taken. `-Only foundry|bridge|dashboard` for one service.

1. Open Foundry in the browser pane: `preview_start` with name `foundry-test` (attaches to
   `http://localhost:30001`, see `.claude/launch.json`).
2. On the join screen pick user **Claude**, leave the password empty, click Join. The
   browser pane keeps the session; one browser session is one Foundry user at a time.
3. Check the bridge connected: the dashboard (`preview_start` name `dashboard-test`) shows
   "Foundry: live", or `status.ps1` plus the bridge log `C:\FoundryTest\logs\bridge.err.log`.
   The module dials `ws://localhost:31515` because the test copy's `module.json` carries
   `flags.foundry-mcp-bridge.defaultServerPort = 31515`.
4. Test (below), then `stop.ps1`.

After changing code:

- Module: `pwsh scripts/test-env/sync-module.ps1` (builds and copies), then reload the
  Foundry page (F5) in the browser pane.
- Backend or dashboard: `npm run build`, then `stop.ps1 -Only bridge` / `-Only dashboard`
  and `start.ps1 -Only ...` again.

## Calling tools

Through the test dashboard's REST API (GM role; no token in local mode). From the
PowerShell tool (curl.exe argument quoting breaks JSON there):

```
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/tool -ContentType 'application/json' `
  -Body (@{ name = 'get-world-info'; args = @{} } | ConvertTo-Json -Depth 10)
```

From Bash: `curl -s -X POST http://127.0.0.1:3100/api/tool -H "Content-Type: application/json" -d '{"name":"get-world-info"}'`.
A tool error comes back as HTTP 422 with `{ok:false, error}`; PowerShell throws, so read
the message it prints.

Reads (`get-/list-/search-/measure-/plan-/suggest-`) need nothing else. Writes need GM
Actions on (`POST /api/control {"action":"set-gm-actions","value":true}`) and the body
flags `"confirm": true` (plus `"confirmDestructive": true` for destructive tools). For
`apply-planned-change` the flags come from the body only, never from `args`.

In the world, write features also need their switches: Game Settings, Configure
Settings, Foundry AI Tool: "Allow Write Operations" and e.g. "AI Tool: Tarokka (writes)".

## Smoke checklist (M0 + M1)

- Bridge connects; `get-world-info` returns world `ai-tool-test`.
- Query lockdown: as Player, in the browser console,
  `await game.users.activeGM.query('foundry-mcp-bridge.getWorldInfo', {})` fails.
- Guarded write: plan a Tarokka import (`plan-tarokka-import` `{"source":"builtin-roll"}`),
  `get-planned-change`, apply with confirm, `list-recent-changes`, `undo-change`; check the
  files in `C:\FoundryTest\vault\ai-tool-test\gm\`.
- Feature switch off: apply is refused. Conflict: change the target between plan and apply.
- Reveal: `plan-tarokka-reveal` then apply (destructive); as Player the "Tarokka reading"
  journal shows only the typed text; the dashboard `/player` page shows no card data.
- Dashboard: Recent Changes pane and 🃏 Tarokka drawer work; undo from the pane.
- Session log: events appear in `C:\FoundryTest\vault\ai-tool-test\sessions\<date>.jsonl`.

Report what you checked and what you did not, with evidence (screenshots, tool output).

## Learning the Foundry UI

Work from what is on screen: take a screenshot or `read_page` before clicking, and prefer
`find`/`read_page` refs over coordinates. Foundry keeps most navigation in the right-hand
sidebar (chat, combat, scenes, actors, items, journal, tables, cards, playlists,
compendiums, settings) and the scene controls on the left of the canvas; confirm the
exact v14 layout on screen rather than assuming. The browser console (`javascript_tool`)
can read `game.*` for inspection, but make changes through the UI or the AI Tool so the
test covers the real path.

## Inspecting modules, systems and worlds ("root" view without the admin password)

Read the data folder directly, read-only:

- `C:\FoundryTest\data\Data\modules\*\module.json`, `...\systems\*\system.json`: installed
  packages and versions.
- `C:\FoundryTest\data\Data\worlds\*\world.json`: worlds, their system and core version.
- `C:\FoundryTest\data\Logs\` and `C:\FoundryTest\logs\foundry.err.log`: server logs.
- In the world: `get-modules`, `get-module-errors`, `get-world-info` via the dashboard API.

## Troubleshooting

- "port N is already in use": `status.ps1`; something else holds it (never kill a process
  you did not start; ask the GM).
- Foundry does not start: `C:\FoundryTest\logs\foundry.err.log`; Foundry 14 needs a recent
  Node (the portable Node 22 is used when present).
- Module does not connect: module enabled in the world? `C:\FoundryTest\data\Data\modules\foundry-mcp-bridge\module.json`
  has the 31515 flag? Bridge running? Browser console messages from `foundry-mcp-bridge`.
- Later (before the new campaign) everything moves to an Orange Pi 5 Pro; the scripts are
  PowerShell 7 and handle Linux paths, but the Pi setup is its own task.
