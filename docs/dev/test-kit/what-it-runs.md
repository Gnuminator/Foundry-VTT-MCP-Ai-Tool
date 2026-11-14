---
title: Running the kit
description: Commands, sizes, running it live and on the Pi, the three test servers and the kit run command.
---

# Running the kit

Part of [TEST-KIT](../TEST-KIT.md).

## Commands

```text
node scripts/test-kit/kit.mjs <command> [options]
```

| Command | What it does                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `init`  | Creates the kit world's files and its users (Kit GM, Claude, Kit Player; passwordless, kept as test data). Run it once. |
| `build` | Opens the GM session and builds the kit. Writes the manifest.                                                           |
| `run`   | Runs the scenarios against the built kit and writes a report.                                                           |
| `all`   | `build`, then `run`.                                                                                                    |
| `check` | Loads and validates every scenario against the tool catalog. Needs no Foundry.                                          |

| Option                     | Meaning                                                                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--size smoke\|full\|long` | How big the kit is and which scenarios run. Default `smoke`. See "Sizes".                                                                                                                                                                          |
| `--profile <id>`           | The content profile. Default `srd`. It also picks the kit world.                                                                                                                                                                                   |
| `--classes a,b`            | Build only these classes (identifier or name). A development filter.                                                                                                                                                                               |
| `--no-coverage`            | Skip the coverage pass (see "Pick coverage").                                                                                                                                                                                                      |
| `--coverage-cap <n>`       | The most coverage heroes one run builds. Default 40.                                                                                                                                                                                               |
| `--only a,b`               | Run only these scenario ids.                                                                                                                                                                                                                       |
| `--scenarios <dir>`        | An extra scenario folder (repeatable). The repo's own folder is always on.                                                                                                                                                                         |
| `--world <id>`             | Only a check: it must match the profile's world, or the run stops.                                                                                                                                                                                 |
| `--report-dir <dir>`       | Where the report goes. Default `<kit home>/reports/<time>-<size>`.                                                                                                                                                                                 |
| `--fake`                   | Use the in-process fake instead of Foundry (this is what CI does).                                                                                                                                                                                 |
| `--stopped-bridge`         | `run --fake` only: the negative control. Every scenario runs with the dashboard answering as if the module were not linked (GM actions still run; the GM page and browser are dead) and must fail. CI runs sizes full and long; smoke is a subset. |
| `--headed`                 | Show the GM browser window instead of running it hidden.                                                                                                                                                                                           |
| `--target local\|pi`       | Where to run. Default `local` (this PC's test server). `pi`: see "Running it on the Pi".                                                                                                                                                           |
| `--not-game-night`         | Pi target only: you confirm today is not a game night. Required.                                                                                                                                                                                   |

`npm run kit` is a short way to start it. `npm run kit:test` runs the kit's own unit tests.

### Sizes

| Size    | Heroes                                                                         | Scenarios                       |
| ------- | ------------------------------------------------------------------------------ | ------------------------------- |
| `smoke` | every class once, at level 5, with its first subclass                          | the scenarios that list `smoke` |
| `full`  | every class at 1, 5, 11 and 17, and every subclass at 20, plus coverage heroes | the scenarios that list `full`  |
| `long`  | the same heroes as `full`                                                      | scenarios that list `long`      |

The monster scenarios also read the size (`t.size`): `smoke` probes a sample of the monsters (see "The monsters"), `full` and
`long` probe every one.

The plan is `HERO_PLAN` in `lib/contract.mjs`. A class gets its subclass from the level its own
Subclass advancement says (level 3 for most classes, earlier for a few). Below that level the
hero has none.

### Running it live

The local test environment must be up with the kit world of the profile. One world at a time:
stop Foundry before you start it on the other world.

```powershell
pwsh scripts/test-env/sync-module.ps1
pwsh scripts/test-env/start.ps1 -World ai-tool-kit-srd
node scripts/test-kit/kit.mjs all --profile srd
pwsh scripts/test-env/stop.ps1
```

The `srd` profile lists the Actor Studio module under `modules`; run `kit init` once on a kit world to
enable it (the `heroes-studio` scenario fails with that advice when the module is not active).

The kit opens its own GM page first. The bridge only has a Foundry link while that page is open.
Each test server is shared: run one live job at a time on it. See the `foundry-test-env` skill.

### Running it on the Pi

`--target pi` runs the scenarios that only call bridge tools against the Orange Pi's throwaway
world `strahd-kit` (I-028: which bridge tools need a canvas that the Pi's headless GM browser, set to
Foundry's "Disable Canvas", does not have). It is a first slice: no clicking, no build.

1. **The Pi side.** A kit session must be up (docs/dev/PI-SETUP.md, "Kit session"): after a
   `dietpi-backup 1` snapshot and your OK, `kit-session.sh MODE=up` launches `strahd-kit`, makes the
   GM user `Kit GM` with a generated password, makes it the module's bridge user, and starts a
   headless browser that joins as `Kit GM` and holds the bridge link. The real Assistant GM browser
   stays stopped, so the Claude Desktop connectors see the test world until `MODE=down`.
2. **The targets file**, outside the repo, `%LOCALAPPDATA%\foundry-ai-tool\kit-targets.json`
   (`KIT_TARGETS_FILE` overrides the path). Host and ports, and the paths of two files on this PC;
   no secret is in it, and any other key is refused:

   ```json
   {
     "pi": {
       "host": "foundry-pi.your-tailnet.ts.net",
       "dashboardPort": 3000,
       "foundryPort": 30000,
       "dashboardTokenFile": "C:\\Users\\you\\AppData\\Local\\foundry-ai-tool\\dashboard-token.txt",
       "kitGmPasswordFile": "C:\\Users\\you\\AppData\\Local\\foundry-ai-tool\\kit-gm-password.txt"
     }
   }
   ```

   `host` must be the Pi's full Tailscale name (`tailscale status` on the Pi, or the address of the
   dashboard link; the Pi's is `foundry-pi.tailf949aa.ts.net`), not the short name `foundry-pi` (which is what the kit
   falls back to when `host` is missing, so always set it): the
   Pi dashboard only answers the host names in its `DASHBOARD_ALLOWED_HOSTS` and refuses any other with
   HTTP 421 (`host-not-allowed`), which the kit reports as "answered HTTP 421".

   `dashboardTokenFile` is optional. It holds the dashboard's GM token, for a dashboard that has one
   (`GM_DASHBOARD_TOKEN` set, as it will be after Part C; the kit sends it as `X-CoGM-Token`).
   Leave it out while the Pi dashboard runs in single-user mode, as it did on 2026-10-13. `kitGmPasswordFile` is the
   per-session `Kit GM` password: `pwsh scripts/pi/fetch-kit-login.ps1` copies it from the Pi with
   one read-only command, never prints it, and limits the file to your Windows user;
   `pwsh scripts/pi/fetch-kit-login.ps1 -Remove` deletes it after `MODE=down`. The kit reads both
   files only where it needs them and never prints them. This slice sends the token (when there is one) only; the
   password is for the later clicking slice (`lib/gm.mjs` can already type it into the join form of
   the kit's own throwaway `Kit GM`).

3. **The run:**

   ```powershell
   node scripts/test-kit/kit.mjs run --target pi --not-game-night --only canvas-tools-headless
   ```

   `canvas-tools-headless` calls ten read or plan tools (`list-scenes`, `get-current-scene`,
   `get-token-positions`, `measure-distance`, `get-targets`, `get-token-details`, `get-party`,
   `plan-party-change`, `plan-scene-change`, `open-in-foundry`), applies nothing, and logs one line per
   tool: `canvas-probe <tool>: ok`, `FAILED needs-canvas` (the error mentions the canvas),
   `FAILED other: <message>` or `skipped (<why>)`. A failed probe makes the run exit 1, which is the
   point; the report lists which tools failed. The same scenario also runs in a normal local kit run,
   where the canvas exists, so that report is the baseline to compare with.

4. **A player builds a character (standard array).** While the kit session is up, a headless browser
   can join as `Kit Player` and make a level 1 character in Actor Studio (the table's players then
   level it up to 3 by hand; the kit does not), the way a player at the
   table does, with the standard array arranged by the row arrows (the kit's own player flow types
   scores into manual-input fields, which a standard-array-only table setup turns off). The kit's
   sheet checks (`judgeSheet`) judge the result:

   ```powershell
   node scripts/test-kit/player-run.mjs http://<pi-host>:30000 "Kit Player" Wizard "Elf, High" Sage --out $env:TEMP\player-run
   ```

   Class, species and background are optional (those are the defaults). It refuses a GM user, the
   `curse-of-strahd` world and the live bridge ports; `result.json` and `sheet.png` go to `--out`
   (or a new temp folder), never into the repo, and the exit code is 1 when the sheet has problems.
   A Player may not delete actors, so the `Pi Test <class>` actor stays until `kit-session.sh
MODE=down` (which deletes the actors made after `up`). Unit tests cover the argument parsing,
   the arrow moves and the refusals; the live run needs a running kit session (the next Pi day) or
   the PC test world with Actor Studio set to standard array only.

### Three test servers

This PC has three test servers (C is described below) with the same Foundry install and licence
(`scripts/test-env/servers.json`). Server A (`C:\FoundryTest`, Foundry 30001, bridge 31514 and
31515, dashboard 3100) is for quick checks and `npm run live:roundtrip`. Server B
(`C:\FoundryTestB`, Foundry 30002, bridge 31524 and 31525, dashboard 3101) is for kit runs and
soak runs, so a 70-minute kit run never blocks a roundtrip. Each has its own data folder, module
copy, vault, logs and lock (`<Root>\lock.json`). Nobody plays on B.

Server C (`C:\FoundryTestC`, Foundry 30003, bridge 31534 and 31535, dashboard 3102) is B's twin
for a third parallel live check: `pwsh scripts/test-env/server-b.ps1 -Server C` sets it up from A.
B and C stay owner-only on localhost (the licence allows one instance reachable by others, and
that is the Pi). Measured 2026-10-19 with A, B and C all running `ai-tool-test` (idle, one browser
client): per server the Foundry node process is about 130 MB, the test bridge about 70 MB and the
dashboard about 63 MB (about 265 MB each, about 0.8 GB for three) on a 32 GB PC; each browser
client adds more on top.

Every test-env script takes `-Server A|B|C` (default A, or the `FOUNDRY_TEST_SERVER` environment
variable); the kit (`kit.mjs`) reads `FOUNDRY_TEST_SERVER` and talks to that server's dashboard and
Foundry. `npm run kit:run` uses B unless `--server A`. The kit home stays shared (reports,
`last-run.json`, licensed profiles); the kit manifests are per server (`<kit home>\worlds` for A,
`<kit home>\worlds-B` for B), because each server has its own copy of the kit worlds.

`pwsh scripts/test-env/server-b.ps1` sets B up from A and refreshes it: A's licence, admin login and
packages (systems, modules, assets; mirrored, so B gets A's versions), the everyday world and the
kit worlds B does not have yet, with their manifests. `-World <id>` copies one world again (after a
`kit init` or a fresh licensed import on A). It refuses while B's Foundry runs and skips a world
A's Foundry has open. Run it after a package update on A (D-098 keeps the newest versions).

```powershell
$env:FOUNDRY_TEST_SERVER = 'B'
pwsh scripts/test-env/start.ps1 -World ai-tool-kit-srd   # -Server B from the variable
node scripts/test-kit/kit.mjs all --profile srd
pwsh scripts/test-env/stop.ps1
Remove-Item Env:FOUNDRY_TEST_SERVER   # later commands in this shell go back to server A
```

### The kit run command

`npm run kit:run` does all of the above in one go, on demand or overnight (D-102 line 5), on test
server B unless `--server A` (every step below acts on that server):

1. takes the test server's lock (`scripts/test-env/lock.ps1`; with `--wait <minutes>` it queues and
   waits, otherwise a taken lock ends the run with exit code 3),
2. runs `npm run build` and copies the module into the test Foundry (`sync-module.ps1 -NoBuild`),
3. stops the test environment and starts it again on the profile's kit world, so the bridge and the
   dashboard run this checkout's code,
4. runs `kit.mjs all` (build, then the scenarios) with the report in `<kit home>/reports/`,
5. stops the test environment again and releases the lock (also after a failure; Ctrl+C,
   Ctrl+Break, a closed console or a kill signal stops the current step and cleans up the same way,
   a second Ctrl+C exits at once and may leave the lock held),
6. records the result in `<kit home>/last-run.json` (the control center's versions panel shows it)
   and as a row in the vault note `Dev/Foundry AI Tool/Test kit runs.md`, through the vault
   wrapper. Only counts, failing scenario ids and the local report folder go there.

```powershell
npm run kit:run                              # smoke, srd profile
npm run kit:run -- --size full --wait 30     # full; queue for up to 30 minutes
npm run kit:run -- --nightly                 # the overnight run: full, waits up to 2 hours
```

| Option             | Meaning                                                                               |
| ------------------ | ------------------------------------------------------------------------------------- |
| `--server A\|B\|C` | The test server (default B; A stays free for quick checks).                           |
| `--size`           | `smoke` (default), `full` or `long`.                                                  |
| `--profile <id>`   | The content profile (default `srd`); it picks the kit world.                          |
| `--wait <minutes>` | Queue for the lock and wait this long. Default 0.                                     |
| `--nightly`        | `--size full --wait 120`, a skipped run is recorded, a stale kit run lock taken over. |
| `--session <id>`   | The lock's session id. Pass your own when you already hold the lock: it stays yours.  |
| `--holder <name>`  | The name on the lock (default `kit run`).                                             |
| `--no-build`       | Skip `npm run build`; the last build is still copied into Foundry.                    |
| `--keep-up`        | Leave the test environment running afterwards.                                        |
| `--no-vault`       | Write `last-run.json` only.                                                           |

Exit codes: 0 all passed, 1 a scenario failed or a step broke (build, module copy), 2 the
environment was not ready, 3 the lock was not free. An on-demand run that found the lock taken
leaves no record. Run it from a checkout with its own `npm ci` (the main checkout for the nightly
run); it tests that checkout's code.

**Overnight:** `pwsh scripts/test-kit/register-nightly.ps1` registers the Windows scheduled task
"Foundry AI Tool kit run" (every night at 03:30, `-At 04:00` for another time, `-Remove` to take
it away, `-WhatIf` to see what it would register). It runs `kit-run.mjs --nightly` in the main
checkout with the portable Node 24 while you are logged on, in a hidden console, and appends its
output to `<kit home>\nightly.log`. A PC that is asleep, off or logged off at that time skips the
night; a missed run is not started later, so it never stops a test server you use during the day.
The task stops a run after 6 hours without warning, which leaves its lock behind: the next nightly
run takes over a kit run lock older than 7 hours, and the start alerts hook shows it until then.
