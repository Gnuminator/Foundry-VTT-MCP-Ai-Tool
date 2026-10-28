---
name: foundry-test-env
description: Start, use and stop the personal local Foundry VTT test environment for this repo (Foundry 14 on localhost:30001 with the dnd5e world "ai-tool-test", a test bridge on ports 31514 and 31515, the co-GM dashboard on 3100, a separate vault), join as the passwordless "Claude" GM or "Player" in the browser pane, sync the module after code changes, install packages or create worlds on the test server, inspect installed modules/systems, and troubleshoot. Use before any live check in Foundry. Testing the AI Tool itself (tools, dashboard, smoke checklist) is the foundry-ai-tool skill; Foundry's own UI is foundry-core-ui. Never touches the live campaign or the live bridge ports 31414-31416.
---

# Foundry test environment

A personal-only test server (the Foundry licence allows a second instance for the licence
owner's own testing). Everything is separate from the live campaign, which runs on a
hosting service and is driven by Claude Desktop's bridge on 31414-31416.

| Part        | Where                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundry 14  | `http://localhost:30001`, app `C:\FoundryTest\app`, data `C:\FoundryTest\data`                                                                                                                                                                                  |
| Test world  | id `ai-tool-test`, title "AI Tool Test", dnd5e 6.0.5, Modern Rules (2024)                                                                                                                                                                                       |
| Users       | `Claude` (Gamemaster, no password), `Player` (Player, no password), `Gamemaster` (the GM's)                                                                                                                                                                     |
| Test data   | PC `Test Hero` (level 3 Fighter, max HP 28 set by hand); world actor `Wolf` with unlinked tokens `Wolf 1`-`Wolf 3`, scene "Test Arena"; `Test Cleric` and `Test Wizard` (level 1 casters, spell save DC 13, attack +5; kept for caster checks; DESKTOP-I4QNKRH) |
| Test bridge | control `31514`, Foundry link `31515`                                                                                                                                                                                                                           |
| Dashboard   | `http://localhost:3100`                                                                                                                                                                                                                                         |
| Vault       | `C:\FoundryTest\vault`                                                                                                                                                                                                                                          |
| Obsidian    | `C:\FoundryTest\obsidian` (throwaway vault the test bridge renders notes into; `ObsidianDir`)                                                                                                                                                                   |
| Logs, PIDs  | `C:\FoundryTest\logs` (`<service>.out.log`, `.err.log`, `pids.json`)                                                                                                                                                                                            |

### Three test servers (A, B and C)

The table above is **server A**, the default: quick checks, `live:roundtrip`, manual tests in the
browser pane. **B** and **C** are the same thing on other ports (same `ai-tool-test` world,
same system and module versions, copied from A); B also runs kit runs and soak runs
(`npm run kit:run` defaults to B), so a long kit run never blocks A:

| Part      | Server B                                              | Server C                                              |
| --------- | ----------------------------------------------------- | ----------------------------------------------------- |
| Foundry   | `http://localhost:30002`, data `C:\FoundryTestB\data` | `http://localhost:30003`, data `C:\FoundryTestC\data` |
| Bridge    | control `31524`, Foundry link `31525`                 | control `31534`, Foundry link `31535`                 |
| Dashboard | `http://localhost:3101`                               | `http://localhost:3102`                               |
| Rest      | vault, obsidian, logs, lock under the root            | the same under `C:\FoundryTestC`                      |

All use one Foundry app folder, chosen machine-wide in `C:\FoundryTest\appdir.txt` (next to A's
`lock.json`, not in git; first line = the folder, now `C:\FoundryTest\app-14.369`). It wins over an
`AppDir` in any worktree's `local.json` (status warns if they differ), so every checkout starts the
same Foundry version; with no file the default is `<Root>\app`. `status.ps1` prints the version it
will start (`Foundry ver:`); change the choice with
`pwsh scripts/test-env/status.ps1 -SetAppDir <folder>` (take the lock and restart the servers
afterwards; a running server keeps its old version until then). Ports live in `scripts/test-env/servers.json`
(read by the scripts and the kit). Every script takes `-Server A|B|C` (default A, or the
`FOUNDRY_TEST_SERVER` environment variable), and each server has its own lock.

**Picking a server:** a lane needing a live check runs `lock.ps1 status -Server A`, then B, then C
and takes the first free one (`lock.ps1 take -Server B ...`), starting with A if free. Then every
call carries `-Server X` (start, stop, status, sync-module, lock) and the lane uses that server's
bridge and dashboard ports. Never stop or start a server whose lock another lane holds. Queue
(`lock.ps1 queue`) only when all three are taken.

`pwsh scripts/test-env/server-b.ps1 [-Server B|C]` creates or refreshes B or C from A (licence and
admin login files, packages mirrored, the everyday and kit worlds it lacks; `-World <id>` copies
one again; it skips a world A has open, so stop A or copy from a quiet moment). Overrides go in
`scripts/test-env/local.B.json` / `local.C.json`. Nobody plays on B or C; the browser pane opens
them at `http://localhost:30002` / `30003` (join as `Claude` or `Kit GM`, passwordless).
**Licence:** only one instance may be reachable by users other than the licence owner at a time
(the Pi is that one), so B and C are owner-only on localhost. RAM for three servers running:
see `docs/dev/TEST-KIT.md`, "Three test servers".

This environment is per PC: the Foundry licence is per owner, so each PC gets its own copy set up
separately with the GM. World data, users and test data are not shared between machines, even
though the scripts and skills are in git.

Paths and ports come from `scripts/test-env/config.ps1` (`Get-NodeExe` there picks the newest
portable Node 22 folder, `%LOCALAPPDATA%\node22\node-v22.*-win-x64`); `scripts/test-env/local.json`
(gitignored) overrides paths and ports. The scripts need PowerShell 7 (`pwsh`, the PowerShell tool).
Foundry runs on the Node its `app\package.json` requires (14.368 and 14.369: >=24.13.1 <25, the
global Node 24); the bridge and dashboard use the repo's portable Node 22.

## Rules

- Never use 31414, 31415 or 31416, never call `mcp__foundry-mcp__*` tools, never repoint
  Claude Desktop. The scripts refuse test ports that collide with the live ones.
- In Foundry, join as `Claude` (or `Player` for player-view checks). Never type the GM's
  own passwords, licence key or foundryvtt.com credentials anywhere.
- Setup-screen tasks (install packages, create worlds) need the test server's admin login
  (v14's admin login form asks for both a user name and a password). Use it only from
  `scripts/test-env/local.json` (`AdminUser`, `AdminPassword`, read with
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
- Module, sync on save: `pwsh scripts/test-env/sync-module.ps1 -Watch -Session <local_id>` (start
  it with `run_in_background`). It runs the module's TypeScript build in watch mode and copies the
  module after every build change, but only while that session holds the test server lock; without
  the lock it prints who holds it and copies the waiting change once you hold it. It never takes
  the lock. A save with type errors builds nothing and is not copied (the log shows the tsc
  errors). `-NoBuild` watches a build you run yourself. Stop it when your test is done.
- Backend or dashboard: `npm run build`, then `stop.ps1 -Only bridge` / `-Only dashboard`
  and `start.ps1 -Only ...` again.

## Test server lock

Several sessions share this one test server. Before any live test (starting services, joining the
world, changing test data) take the lock, and release it when done; if somebody holds it, queue
instead of testing in parallel. `status.ps1` shows it on the `Lock:` line, and the project
dashboard shows it too. Use your session title as `-Holder` and your session id as `-Session`.

```
pwsh scripts/test-env/lock.ps1 status
pwsh scripts/test-env/lock.ps1 take -Holder "<session title>" -Session <local_id> -Purpose "<text>"
pwsh scripts/test-env/lock.ps1 release -Session <local_id>     # -Force only for a lock whose holder is gone
pwsh scripts/test-env/lock.ps1 queue -Holder "<session title>" -Session <local_id> -Purpose "<text>"
pwsh scripts/test-env/lock.ps1 leave -Session <local_id>       # drop out of the queue
```

`take` exits 1 and says who holds it when it is taken; the queue head gets the next `take`.
A crashed session's lock or queue entry (status and the dashboard flag entries older than 4 hours):
`take -Force` takes over from the holder and skips the queue head, `leave -Session <their id>`
drops a dead queue entry. A `lock.json` that cannot be read is refused until `take -Force` or
`release -Force` starts a fresh lock; check with the other sessions first.

Every `take`, `release`, `queue` and `leave` also writes that server's state (free or held, the
holder's title, since when, queue length) to the vault note `Test servers.md` for the PM board
(`lock.ps1 publish` writes it again). A vault problem prints a WARNING line and never fails the
lock. The board warns on Today when a lock is older than 6 hours: release when you are done.

Each server has its own lock (`<Root>\lock.json`); add `-Server B` to every `lock.ps1` call for
server B. A whole test kit run with B's lock taken and released for you: `npm run kit:run`
(options and exit codes in `docs/dev/TEST-KIT.md`, "The kit run command"; `--server A` runs it on
A). It restarts that server's test environment on the kit world and stops it afterwards.

## Kit worlds

The test kit builds in its own worlds (`KIT_WORLDS` in `scripts/test-kit/lib/contract.mjs`),
never in `ai-tool-test`. Start Foundry on one with `start.ps1 -World <id>`.

| World id               | What it is                                                         |
| ---------------------- | ------------------------------------------------------------------ |
| `ai-tool-kit-srd`      | srd profile (SRD content only)                                     |
| `ai-tool-kit-licensed` | licensed profile (PHB 2024 and the other bought packs, local only) |
| `strahd-kit`           | strahd profile: a throwaway copy of `curse-of-strahd`, made again  |

`kit init` gives each one three passwordless users and keeps them as test data: `Kit GM`
(Gamemaster; the kit's builder and runs join as it, and it is the bridge user), `Claude`
(Gamemaster; for sessions in the browser pane, so you can look around without taking the kit's
user) and `Kit Player` (Player; owns the kit's first playable hero). Init also turns off Actor
Studio's usage tracking for all three. A kit world made before `Claude` was added gets it from
`kit init` again (Foundry running on that world; init changes nothing else that is already
there). Never touch `ai-tool-kit` (the hand-made licensed import world) or `curse-of-strahd`.

## Next steps

- Testing the AI Tool (calling tools, guarded writes, dashboard, pickers, vault, the M0+M1 smoke
  checklist): the `foundry-ai-tool` skill.
- Foundry's own screens (setup, join, sidebar, controls, sheets, settings, chat, combat, dnd5e
  sheets): the `foundry-core-ui` skill and its verified reference pages.
- Browser pane gotchas that bite here: the pane is smaller than Foundry's minimum (resize the tab
  to 1440×900); a tab that loads while hidden renders at 0×0 and its canvas fails (reload it in
  front); opening a second tab with `preview_start` can reload the first (use `tabs_create` +
  `navigate`); a second user needs a second origin (`http://127.0.0.1:30001` for `Player`).
- Foundry v14 gotchas seen live: `combat.endCombat()` opens a confirm dialog (click Yes in the
  pane; a script that awaits it will hang); a user's first join opens a "User Configuration"
  dialog; `game.user.updateTokenTargets` no longer exists (use
  `token.object.setTarget(true, { releaseOthers: true })`, and `setTarget(false, ...)` on
  `game.user.targets` to clear).
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
  "Failed to resolve module specifier "@gnuminator/shared"" means the module did not load at
  all: a module file imports a runtime value from a workspace package (only `import type` works
  in the browser; `browser-imports.test.ts` guards this).
- Later (before the new campaign) everything moves to an Orange Pi 5 Pro; the scripts are
  PowerShell 7 and handle Linux paths, but the Pi setup is its own task.
