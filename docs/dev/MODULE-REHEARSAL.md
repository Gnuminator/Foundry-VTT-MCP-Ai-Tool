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
running. Foundry itself and dnd5e are handled like a module: stage the zip, install it, rehearse.

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
differ from the pinned list, the steps, new findings and known ones. A run passes when every step
passes and no finding is new.

**Expected findings** are in `scripts/modules/expected.json`: a module, a substring of the error and
why it is known upstream behaviour. A known finding is listed but does not fail the run; an entry
the run did not see is listed as unseen, so a fixed upstream bug gets noticed and removed.

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

Written for after G0 (D-128); nothing here has run. Every Pi change needs the user's OK and a
`dietpi-backup 1` snapshot from today first (`pi-work` skill), never on a game-night day, and not
while players are online.

1. **Mirror:** copy `modules/`, `systems/`, `foundry/` and `pinned.json` from the PC archive to
   `/home/dietpi/module-archive` on the Pi (`rehearse.mjs pi-plan` prints the `scp`). Read-only for
   the Foundry service. Not `staging/` and not `rehearsals/`.
2. **Stage `17-modules.sh`** (new, in `scripts/pi/remote/`, with a container test next to the others):
   reads `pinned.json` and, for each package, checks the zip's sha256, stops with nothing changed on
   any mismatch, refuses without today's snapshot, refuses while players are online, stops Foundry,
   moves the old folder to `/var/lib/foundry-import/prev-<time>`, unpacks the pinned version, checks
   `module.json` has the pinned version, starts Foundry. It never downloads and never installs a
   version that is not pinned. `UNDO=1` puts the previous folders back. A dry run (`DRY=1`) lists
   what would change.
3. **Foundry itself** stays stage 3 (`FoundryVTT-Node-14.369.zip`, taken from `foundry/` in the
   mirror) and dnd5e 6.0.6 stage 14; the module stage runs after them.
4. **Order:** the Pi `strahd-kit` world first (stage 17, then the Pi kit run from `kit-session.sh`),
   then the real world, a snapshot before each.
5. **No auto-update on the Pi:** Foundry's own update check in the setup screen is not used; modules
   change only through this stage. The dashboard version tracker (on by default, I-127) shows what is
   newer upstream so the next rehearsal knows.
