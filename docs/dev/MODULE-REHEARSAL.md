# Module update rehearsal and the version archive

Every module, the dnd5e system and Foundry are tested on a PC test server before the live server
gets them (I-117, D-128). The rehearsal script finds what is newer, installs it on a test server,
runs the checks and writes a report. A version that passes goes into a local archive and the pinned
list. The Pi installs only from that archive and never updates anything by itself.

```text
node scripts/modules/rehearse.mjs status  --server B     installed vs pinned list (offline)
node scripts/modules/rehearse.mjs check   --server B     also asks each manifest for its newest version
node scripts/modules/rehearse.mjs stage   --server B     download newer zips to staging (public manifests)
node scripts/modules/rehearse.mjs install --server B     staged zips into the stopped server (old folders to a rollback folder)
node scripts/modules/rehearse.mjs run     --server B     checks and a report
node scripts/modules/rehearse.mjs archive --server B --from-report <dir>
node scripts/modules/rehearse.mjs pi-plan                the Pi mirror commands, printed and never run
```

Take the server's lock first (`scripts/test-env/lock.ps1`); `install` refuses while the server is
running, while nobody holds the lock, or while the lock is held by another session (set
`REHEARSE_LOCK_SESSION` to the session id that holds it; `run` hands the same id to the kit).
Downloads must stay on https after redirects, land in a `.part` file first, and an installed zip must
carry the package id it was staged for. Modules and the dnd5e system are staged and installed this
way; Foundry itself is unpacked by hand (next section).

## Foundry itself

The three test servers share server A's Foundry app folder, so a new Foundry version is never
unpacked over it while another lane runs B or C. Unpack the zip into its own folder (first run:
`C:\FoundryTest\app-14.369`), point server A at it with `AppDir` in `scripts/test-env/local.json`,
and pin B and C to the folder they use with `AppDir` in `local.B.json` and `local.C.json` (all
three files are gitignored). B and C move when a lane that holds them chooses to. Foundry's zip goes
into the archive under `foundry/` and into `pinned.json` once a rehearsal on it has passed.

## What a run checks

1. **Load:** every module on the Strahd list (`scripts/modules/strahd-modules.json`) is installed and
   active, and the bridge's `get-module-errors` shows nothing that is not on the expected list.
2. **Kit:** `npm run kit:run -- --profile modules-all`, the SRD kit world with all the Strahd
   modules switched on (`scripts/test-kit/data/profiles/modules-all.json`). Its known findings are
   the SRD list plus the module list below. A test keeps the profile and the Strahd list equal.
3. **`live:roundtrip` and `live:sweep`** when the server is A (both talk to the dashboard on 3100).
4. **`npm run green`** with `--with-green`.

The report is `<archive>/rehearsals/<time>-<server>/report.md` and `report.json`: the packages that
differ from the pinned list, the steps and the findings sections. A run passes when every step
passes; `archive` also needs a passing kit step in one of its reports, and a report from the same
server and an unchanged version list (`archive` compares each report's package versions with the
server as it is now). The module load check is the kit scenario `module-load`; the rehearsal report
lists the module errors it saw as known and new findings (read from the kit report of that run).

Per-module kit scenarios run in the same kit step and skip when their module is not in the profile:
`module-ac5e-roll-mode` (full size) poisons a hero and a monster and compares the roll mode of
`request-ability-check`, `request-attack-roll` and `roll-saving-throws` with the same creatures
unpoisoned. All three roll through dnd5e (the two request buttons since the roll-buttons fix; the
scenario clicks them as the GM), so a poisoned creature gets disadvantage from Automated Conditions 5e.

**Expected findings** are in `scripts/modules/expected.json`: a module, a substring of the error and
why it is known upstream behaviour, with a `max` on the broad ones. `splitFindings` applies them to
the findings a report carries.

## The archive

A PC folder, `C:\FoundryAI\module-archive` (or `$MODULE_ARCHIVE`), never inside a repo or the vault:

```text
pinned.json                       what the Pi may install: version, zip, sha256, licensed, tested on, report
modules/<id>/<version>/           <id>-<version>.zip and its module.json
systems/dnd5e/<version>/
foundry/FoundryVTT-Node-<version>.zip
staging/<id>/<version>/           downloaded, not yet tested
rehearsals/<time>-<server>/       the reports
```

Licensed and Patreon packages (the PHB module, JB2A premium, the paid ddb-importer parts, our private
content module) go in the archive like the rest, zipped from the tested install, and are marked
`licensed` in `pinned.json`. They never go in the repo or the vault. A module we must patch is forked
(Actor Studio is the first candidate, I-116) and the fork's build is what gets pinned; the other
modules are not forked.

## Pi: install from the archive (plan only)

The stage is written and tested in a container (decided 2026-11-04, so Pi sitting 2 can install Danni's final list); it has not
run on the Pi. Every Pi change needs the user's OK and a
`dietpi-backup 1` snapshot from today first (`pi-work` skill), never on a game-night day, and not
while players are online.

1. **Mirror:** copy `modules/`, `systems/`, `foundry/` and `pinned.json` from the PC archive to
   `/home/dietpi/module-archive` on the Pi (`rehearse.mjs pi-plan` prints the `scp`). Read-only for
   the Foundry service. Not `staging/` and not `rehearsals/`.
2. **Stage 25, `scripts/pi/remote/25-modules.sh`** (container test `scripts/pi/container-test/stage25-scenarios.sh`,
   run by `scripts/pi/modules-stage.test.mjs`; the number follows stages 23 and 24 of the Docker stack, stage 17 is the
   runner). Run it piped with `lib.sh`, as the header shows. It installs the `modules` of `pinned.json` only: dnd5e is
   stage 14's, Foundry stage 3's, the bridge stage 5's and `aitool-content` stage 11's (a pin for either is skipped with a
   line). Installing is not activating: switching the modules on in the world is a separate step after it.
   - **Checks first, nothing changed:** the pin's id and version are safe names and `file` is exactly
     `modules/<id>/<version>/<id>-<version>.zip`; the zip (a copy) matches the pinned sha256; its entry names have no
     absolute path or `..` and no link; it unpacks to a `module.json` whose id and version are the pin's; the disk has
     room (the 5% and 20% rule of stage 10, checked once before anything is unpacked: all zips unpacked at once plus the
     largest zip); a link is found even in a zip of thousands of entries. A refusal names the module and changes nothing. The same checks are the
     dry run (no `APPLY`): it lists `id: old -> new` and stops. A module already at its pinned version is skipped, so a
     rerun changes nothing.
   - **Real run (`APPLY=1`):** needs today's `dietpi-backup` snapshot, nobody online and no recording
     (`require_quiet`), no kit session and no open dnd5e trial; refuses on Foundry 14.369 or newer when the installed
     `assistant-gm.mjs` has no `selectOption` (the join select of 14.369: the Assistant GM browser could not rejoin).
     Writes the **state file** `/var/lib/foundry-import/modules-stage.state` (stamp, where the old folders go, one
     `module=<id>|<old or NONE>|<new>` line each) before the first move, stops the Assistant GM browser and Foundry,
     moves each old folder to `prev-<time>-modules/<id>`, moves the unpacked one in (owned by the foundry user), starts
     Foundry and the browser, and **reads back**: the world answers, the browser has joined the world in its current run
     (`browser_joined` in `lib.sh`, matched on the systemd invocation id, so a line from before the restart does not
     count), every `module.json` shows the pinned version and the foundry user as owner, and the journal since the
     start has no module error line (a warning). Foundry has to be running with a world before the run starts.
     Every line of a real run or UNDO also goes to `/var/lib/foundry-import/modules-stage.log`.
   - **A run that did not finish** (killed, power cut) leaves `phase=installing` in the state file; a new `APPLY=1` is
     refused until `UNDO=1` has put the folders back (the dry run warns).
   - **If it fails after Foundry stopped,** the **EXIT trap** puts the old folders back from the state file (a module that
     had no old folder is moved aside to `failed-<time>-modules`, never deleted) and starts Foundry and the browser as they
     were. `rm -rf` only ever targets the stage's own work folder, written `${work:?}`.
   - **`UNDO=1`** does the same for the last run (it reads the state file, snapshot and quiet checks apply), starts
     Foundry and the browser again and reads back: the world answers, the browser joined, and every module shows its old
     version (a module that had no old folder must be absent). It reaches only the last run. Unlike `APPLY=1` it does not
     need Foundry running first: after a killed run Foundry may be down, and `UNDO=1` starts it (and the browser).
   - It never downloads and never installs a version that is not pinned.
   - **Order in sitting 2:** stages 3, 14, 5 and 13 as in step 3, then this stage, then the Docker cutover; the cutover
     guard (`refuse_when_cut_over`, Backlog item on the stages that restart `foundry.service`) must list stage 25 too.
     The stage installs into the modules folder every Pi world shares, so it applies to all worlds at once and Foundry
     restarts into whichever world is launched; it refuses while a kit session is up. Test the versions on the PC test
     server and kit first (step 4), not on the Pi's strahd-kit world. Stage 22 (seven books) runs after this stage when content modules changed.
3. **Foundry itself** stays stage 3 (`FoundryVTT-Node-14.369.zip`, taken from `foundry/` in the
   mirror) and dnd5e 6.0.6 stage 14; the module stage runs after them. **Before stage 3 installs
   14.369**, run stage 5 and stage 13 again (snapshot first) so the Pi's installed login drivers
   (`assistant-gm.mjs`, the stage 13 driver) know 14.369's user select; the old copies only type the name.
4. **Order:** the PC test server and kit first; on the Pi, stage 25 once (a snapshot before), then the Pi kit run from
   `kit-session.sh` on `strahd-kit` to see the new versions load, then switching the modules on in the real world.
5. **No auto-update on the Pi:** Foundry's own update check in the setup screen is not used; modules
   change only through this stage. The dashboard version tracker (on by default, I-127) shows what is
   newer upstream so the next rehearsal knows.
