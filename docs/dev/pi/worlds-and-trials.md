---
title: Characters, trials, the kit session and GM scripts
description: Player character creation, the system trial, switching the running world, the kit session, GM scripts and the first load after an update.
---

# Characters, trials, the kit session and GM scripts

Part of [PI-SETUP](../PI-SETUP.md).

## Player character creation (stage 13)

For session 0 the players make their own characters in Actor Studio (D-112, D-113): built at
level 1, then levelled up twice to the table's starting level 3 (the sheet's Level Up button needs
Actor Studio's Milestone Levelling, set by the GM; stage 13 does not set it). Two
things have to be true in the Strahd world on the Pi: the Actor Studio build is our fork, and the
world lets players do it. Stage 13 does both, after a `dietpi-backup 1` snapshot and your OK (Foundry stops for a few minutes). It needs
stages 5 and 11 first (the tool's build for Chromium, and the GM login in
`/etc/foundry-ai-tool/world-<id>.env`). From the repo folder on this PC, in Git Bash (or Claude's
Bash tool), not PowerShell: PowerShell's `cat` takes one file and adds Windows line endings, so the
pipe would send the Pi nothing, or a script bash rejects:

```bash
scp scripts/pi/remote/player-creation-settings.mjs foundry-pi:/root/ && cat scripts/pi/remote/lib.sh scripts/pi/remote/lib-gm-passwords.sh scripts/pi/remote/13-player-creation.sh | ssh foundry-pi 'bash -s'
```

The `scp` is the in-browser part: the stage cannot read a second file from the stream the other
stages come in on, so the file goes over first (the way `assistant-gm.mjs` does for stage 5). The stage
installs it into `/opt/foundry-ai-tool/gm-browser/` and removes the upload; run again without a new
`scp` and it uses the installed copy. Environment variables go in front of `bash`, for example
`ssh foundry-pi 'KIT_WORLD= bash -s'`.

Stages 11 and 13 end with the read-only GM password check (the extra `lib-gm-passwords.sh` in the pipe,
the same check as `gm-passwords.sh`): it warns when Foundry has no administrator password or a world has a
Gamemaster or Assistant GM without one, so a world or GM user added after stage 12 is noticed. It changes
nothing and does not fail the stage. Without the extra file the stage warns that the check was skipped.

- **A. The build.** `STUDIO_VERSION` and `STUDIO_SHA256` are pinned in the script
  (`PINNED_VERSION`, `PINNED_SHA256`). The zip comes from
  `github.com/Gnuminator/foundryvtt-actor-studio/releases/download/<version>/module.zip` and must match
  the checksum. Before anything is extracted the stage lists it: no absolute paths, no `..`, no
  backslashes, no links or other special entries, a `module.json` at the top, a size limit and enough
  free space. Then `module.json` must say id `foundryvtt-actor-studio` and the pinned version. If that
  version is already installed, part A is skipped and nothing is downloaded. A newer installed build
  (Foundry's own Update follows the fork's latest release) stops the stage unless
  `ALLOW_DOWNGRADE=1`. Otherwise the services
  stop, the old module folder moves to `/var/lib/foundry-import/prev-<time>/modules/` (never deleted;
  put back by itself if the swap fails) and the new one takes its place, owned by `foundry`.
  The pinned build is the fork's `2.10.5-aitool.12` release. It adds the edition filter (the species, subclass, feat and spell pickers hide a 2014 entry when a 2024 version is offered) over `aitool.11`, which adds the Wisdom default for the spell ability, starting armor and shield equipped, the gold-tile Equipment cue and the cosmetics from fork PR 4 (no "Level 1 -> 2" header at level 1, no welcome window on every join, "7 GP" instead of "7 Award", no raw `@abilities.wis.mod` in text) over `aitool.10`; `aitool.10` is `aitool.9` plus the Equipment tab fix, and `aitool.9` carries the `aitool.8` review fixes (one native event for Take Average, a tidier spell ability carry-over, a leftover debug log removed). The zip is built by hand (the fork runs no release workflow, see its `FORK-SYNC.md`) and uses forward-slash paths, which the stage requires; its `module.zip` checksum is in the
  script. `npm run studio:pin-check` downloads that release and compares its sha256 with the pin before the Pi run (read-only; CI runs it as the `studio-pin` job when stage 13 or the check changes). A pinned checksum of `PENDING-RELEASE` (for a newer build whose release does not exist
  yet) makes the stage refuse to run unless it is given `STUDIO_ZIP` (a `.zip` under `/var/lib/foundry-import/`) and
  `STUDIO_SHA256` (and `STUDIO_VERSION` when the zip is not the pinned version). `STUDIO_VERSION` and
  `STUDIO_SHA256` together, without a zip, download that release instead (both or neither).
- **B. The settings, in `WORLD` (default `curse-of-strahd`) and `KIT_WORLD` (default `strahd-kit`;
  empty skips it).** For each world, Foundry runs that world (`options.json` is changed for the
  run) and a headless Chromium joins as the world's GM, with the login from `world-<id>.env`
  (never printed, passed in the environment and not on a command line). It sets
  `core.permissions` so `ACTOR_CREATE` includes Player and Trusted Player (roles already there stay),
  and Actor Studio's world settings `enableEquipmentSelection` = true and `compendiumSources` with
  `equipment` = `["dnd-players-handbook.equipment"]` (the other sources keep their values), the ability
  score methods `allowStandardArray` and `allowPointBuy` on and `allowManualInput` and `allowRolling` off
  (our table uses the standard array and point buy), and
  turns Actor Studio's per-user `usage-tracking` off for every user who has it saved as on. It prints
  the values before and after, reloads the world and reads them back, and the stage stops with an
  error on any mismatch, if Actor Studio is not switched on in the world, or if that pack is not in
  the world. A second run changes nothing.
- **Before anything stops** the Assistant GM browser stops and Foundry's `/api/status` must answer
  and count nobody online; otherwise the stage stops (`FORCE=1` stops Foundry anyway).
- **Afterwards** `options.json` launches the world it launched before the run, Foundry and the
  Assistant GM browser start again if they ran before, and the stage waits for "joined world". If the
  run fails after Foundry was stopped, `options.json`, Foundry and the Assistant GM browser are put
  back as they were. Free
  space is checked first (the 20 % rule). Without systemd (a test container) part B is skipped with a
  warning. **Run it after stage 11, every time:** stage 11 always swaps in the PC's copy of each
  module, `foundryvtt-actor-studio` included, and resets `strahd-kit` from the bundle, so the fork
  build and the kit copy's settings are gone after it (the campaign world keeps its settings).

Tested on 2026-10-08 in an ARM64 Debian 13 container: the download and checksum of the published
`2.10.5-aitool.3`, a second run that skips, a wrong checksum, zips with `..`, an absolute path, a
backslash and a symlink, a wrong id and version, a failed swap that puts the old folder back, and the
settings loop with a faked systemd and a stand-in for the browser script. The browser script itself
(`player-creation-settings.mjs`) was only syntax-checked there; on 2026-10-09 it ran twice against the
PC test server's licensed kit world. The same day the container installed the pinned
`2.10.5-aitool.4` release (download, checksum, swap of an older folder), skipped it on a second
run, refused a wrong checksum and still refused a `PENDING-RELEASE` pin.

These checks are now in the repo: `node --test scripts/pi/player-creation.test.mjs` runs the browser
script against a fake `game` (the three settings, usage-tracking off for every user, a second run
that changes nothing), and with `PI_STAGE13_CONTAINER=1` it also runs the stage in an ARM64 Debian 13
container with stand-ins for systemd (`scripts/pi/container-test/stage13-scenarios.sh`; Docker
needed, about 30 minutes under emulation on a PC, about 30 seconds on the ARM runner; it refuses to
run outside a container): the downgrade guard, an unreadable `/api/status`, people online, the setup
screen, an install from a local zip, services that were off staying off, and a failed Assistant GM
browser start that restarts Foundry only once. CI runs both, the container part on the ARM runner
(the `pi-container` matrix), where a missing Docker fails the step instead of skipping it. A pull
request runs the container part only when `pi-changes` sees a Pi input change; main and manual runs
always do.

## System trial (stage 14)

dnd5e is one folder on the Pi (`/var/lib/foundry/Data/systems/dnd5e`), shared by every world:
curse-of-strahd, strahd-kit, frostmaiden-training and pi-check all run on the version installed
there. A world migrates its data the first time it is launched on a new version, and a migrated
world does not go back. So a new dnd5e version (D-098, never on a game-night day) goes to the kit
world first, the test kit runs there, and only then does the campaign get it. The version on trial
is pinned in the script (`PIN_VERSION`, `PIN_URL` and `PIN_SHA256`, the release asset's digest on
GitHub); the first one is 6.0.6 (the Pi runs 6.0.5). A new version is a new reviewed change to those
lines.

Each mode except `status` stops Foundry for a minute or two: a `dietpi-backup 1` snapshot and your
OK first, every time. The stage checks it: a snapshot from today, and for `MODE=switch` one taken after
the trial began (the nightly one from before it does not count). From the clean main checkout on this PC, with the mode in front of `bash`:

```powershell
cat scripts/pi/remote/lib.sh scripts/pi/remote/14-system-trial.sh | ssh foundry-pi 'MODE=status bash -s'
```

- **`MODE=trial`** downloads the pinned zip (or takes `ZIP`, a `.zip` under
  `/var/lib/foundry-import/`) and checks its sha256, that its `system.json` is dnd5e at the pinned
  version and that it fits this Foundry (`compatibility.minimum` and `.maximum`). It keeps the
  installed version in `/var/lib/foundry-import/system-trial/dnd5e-<version>`, copies every world
  folder there as it is now, installs the new version and launches only `strahd-kit`. Then run the
  test kit on `strahd-kit`. **Until `switch` or `rollback`, launch no other world**, not the
  training world either: it would migrate. Stages 5-check-world, 11 and 13 refuse to run while a
  trial is open (stage 13 only for `WORLD=strahd-kit KIT_WORLD=`), and stage 5's check world never
  replaces an installed dnd5e, so a rerun after a switch keeps the new version. The Claude Desktop
  connectors see `strahd-kit` (the Assistant GM browser holds the bridge link there) until `switch`
  or `rollback`; the Kit GM takes the link while a kit session is up.
- **The test kit during a trial:** `kit-session.sh MODE=up` accepts `strahd-kit` as the launched
  world while a trial is open (phase `trial`) and records it as the world to put back, so
  `MODE=down` leaves Foundry on the kit; with any other original world `MODE=down` is refused during
  a trial. The other way round, stage 14 (every mode but `status`) refuses while a kit session is up
  (`/var/lib/foundry-ai-tool/kit-session.env` exists): run `MODE=down` first.
- **`MODE=switch`** (its own snapshot and OK) launches curse-of-strahd on the new version, which
  migrates the campaign. The training world and pi-check migrate when they are next launched. After a
  switch the stage has no roll back: going back means restoring the snapshot from before it.
- **The dnd5e migration runs in the first GM client**, here the Assistant GM browser, not when the
  server launches a world. When the new version's `flags.needsMigrationVersion` is newer than the
  launched world's `dnd5e.systemMigrationVersion` setting (or that setting is empty), `trial` and
  `switch` wait until the setting reaches the new version (read from a copy of the world's settings
  database) before they report success; a migration that does not end in `MIGRATION_WAIT` seconds
  (default 1800) counts as a failure and is put back. 6.0.6 asks for none (its
  `needsMigrationVersion` is 6.0.0), and the stage says so. When the setting cannot be read, the stage
  warns: wait until the Assistant GM browser shows no migration notice before stopping Foundry or
  taking a snapshot.
- **`MODE=rollback`** puts the old version back, resets `strahd-kit` from the trial's copy (its run
  on the new version is dropped) and launches the world Foundry ran before the trial (curse-of-strahd
  when it ran none). A world other
  than the kit that was launched during the trial (a file newer than the trial's start) is refused,
  because it may be migrated; `RESTORE_MIGRATED=1` puts it back from the copy too, losing its changes
  since. A rollback that stops halfway says so and saves where it was: run `MODE=rollback` again.

**The order on the Pi for the update to the newest (D-128; the user decides the order, and each step
is a snapshot, the user's OK and a read of the output first):**

1. `dietpi-backup 1` snapshot, then stage 14 `MODE=trial` (dnd5e 6.0.6 on `strahd-kit`).
2. Snapshot, then stage 3 with `FOUNDRY_EXPECT_VERSION=14.369` and the zip in place. The trial is
   open, so Foundry restarts on `strahd-kit`: the new Foundry meets the kit first, not the campaign.
3. `5-tool.sh` with `TOOL_REF=v0.23.0` (the tool release). `5-check-world.sh` refuses while the trial
   is open, which is expected here.
4. The test kit on `strahd-kit`: `kit-session.sh MODE=up`, `npm run kit:run -- --target pi
--not-game-night`, `MODE=down`.
5. Snapshot, then stage 14 `MODE=switch` (the campaign migrates).

A rollback after step 2 puts dnd5e 6.0.5 back under Foundry 14.369, which 6.0.5 supports.

- **`MODE=status`** is read-only: the trial's phase, the installed version, and each world's system
  version and whether it was launched since the trial began.
- **Before anything stops** the request and the trial's state are checked (a second trial, a switch
  without a trial and a rollback after a switch are refused), the zip is checked as above, the
  copies must fit (their bytes by `du -sb` against `df`: under 5 % of the disk left over stops, under
  20 % warns), and nobody may be online (the Assistant GM browser stops and `/api/status` must count
  nobody; `FORCE=1` stops Foundry anyway). One run at a time (a lock in `/var/lib/foundry-import`).
- **A failed trial or switch** puts back what ran before it (the old version, `strahd-kit` or
  curse-of-strahd from the copy, `options.json`) and starts Foundry and the Assistant GM browser as
  they were, but launches a world again only when the dnd5e folder holds the version that world runs
  on. If it does not, `options.json` launches no world, Foundry stays stopped and the stage says what
  to put back by hand. Nothing is deleted: replaced folders go to
  `/var/lib/foundry-import/prev-<time>-*`, and removing those or the trial folder needs your OK.
- **Every run is logged** in `/var/lib/foundry-import/system-trial.log`, and a dropped SSH connection
  does not stop it halfway (the stage ignores hang-up and broken-pipe signals). If a run still ends
  with the phase at `installing` or `switching` (`MODE=status`; no mode accepts those), read the log
  and restore the snapshot from before the run.

Not run on the Pi yet. With `PI_SYSTEM_TRIAL_CONTAINER=1`, `node --test scripts/pi/system-trial.test.mjs`
runs the stage in ARM64 Debian 13 containers with stand-ins for systemd and a fake Foundry that writes
into the world it opens and migrates its `world.json`
(`scripts/pi/container-test/system-trial-scenarios.sh`; Docker needed, four containers side by side,
about 20 minutes under emulation on a PC): a trial from the download and from `ZIP`, a wrong sha256, a
zip that does not fit this Foundry or holds another version, the version installed already, a second
trial, a trial that fails after the stop and undoes itself, a rollback (also one that refuses a world
launched during the trial and one with `RESTORE_MIGRATED=1`), a rollback that stops halfway and a rerun
that finishes it, the switch and a failed switch, a rollback after a switch, `status`, and people
online with and without `FORCE=1`, a trial that fails while the migration or the world start is
still running (Foundry stops before any world folder moves), and a kit session that is up
(trial, switch and rollback refused, `status` works). `kit-session-scenarios.sh` adds the kit
session during a trial. CI runs it on the ARM runner, where a missing Docker fails the step.

## Switching the running world

One command moves the world the Pi's Foundry runs between `curse-of-strahd`, `frostmaiden-training` and `strahd-kit`, so a
test needs no second Foundry and no prep (decided 2026-11-02): `.\scripts\pi\switch-world.ps1 -World <id>` (add `-DryRun` to
see what runs now and what would change). Each use needs the user's OK first (pi-work); never on a game-night day.

- **What it does** (`scripts/pi/remote/switch-world.sh`): sets `world` in `options.json` (a reboot keeps the choice), stops and
  starts Foundry and the Assistant GM browser, waits for `joined world <id>` and prints the world before and after. The
  bridge and the dashboard follow, because the Assistant GM browser carries the bridge link. It never edits world data.
- **Refuses** while players are online or a Discord recording runs (`-Force` goes on anyway), during an open dnd5e system trial
  (except a switch to `strahd-kit` in the trial phase) and during a kit session. Like every stage it needs a `dietpi-backup`
  snapshot from today (`NO_SNAPSHOT=1` overrides): a world that launches after a Foundry or dnd5e update is migrated by Foundry,
  and that has no undo. `-DryRun` also prints who is online and whether a snapshot from today exists.
- **Failure:** if the new world does not come up, `options.json` goes back to the old world and both services start again. If
  only the browser does not join, the switch stays and the run exits 1 (the Assistant GM user must exist in that world).
- Tests: `scripts/pi/switch-world.test.mjs` (stand-ins for systemctl, curl and journalctl). **Not run on the Pi yet.**

## Kit session (strahd-kit test run)

Before session 0 it is worth watching a real player make a character (level 1, then two level-ups to 3), as a player, on the
Pi itself. The kit session does that in the throwaway world `strahd-kit` (never
`curse-of-strahd`) and puts everything back afterwards. It is a pair of runs of one script,
`kit-session.sh`, and it needs stages 5, 11 and 13 first (the tool's build for Chromium, the GM
login in `/etc/foundry-ai-tool/world-strahd-kit.env`, and the Actor Studio fork). Take a
`dietpi-backup 1` snapshot and get your OK first: Foundry stops for a few minutes. The world
(`strahd-kit`) and the player (`Kit Player`) are fixed in the script; no variable can change them.
The in-browser part goes over first, the same way as for stage 13 (Git Bash, not PowerShell; see
there):

```bash
scp scripts/pi/remote/kit-session.mjs foundry-pi:/root/ && cat scripts/pi/remote/lib.sh scripts/pi/remote/kit-session.sh | ssh foundry-pi 'MODE=up bash -s'
```

- **`MODE=up`** checks everything before it stops anything: the world and its GM login are there, the
  tool is built, no kit session is up already, Foundry does not launch `strahd-kit` already, and
  space is fine (the 20 % rule). Then the Assistant GM browser stops, `/api/status` must answer and
  count nobody online (`FORCE=1` goes on anyway), and Foundry stops. What ran before is written to
  `/var/lib/foundry-ai-tool/kit-session.env` (mode 600) before `options.json` changes, and
  `strahd-kit`'s settings, users and actors are copied to
  `/var/lib/foundry-import/prev-<time>/worlds/strahd-kit/` (kept, never deleted). Foundry starts on
  `strahd-kit` and a headless Chromium joins as the world's GM and runs `kit-session.mjs` with
  `ACTION=setup`. It makes sure players may create actors (Player and Trusted Player are added to
  `ACTOR_CREATE`, roles already there stay), points Actor Studio at the Player's Handbook packs
  (origins for species, features and backgrounds; classes for classes and subclasses; spells, feats
  and equipment each from their own pack; the item source is left alone), turns on the standard
  array, point buy, spell selection and equipment selection and turns off manual input and rolling,
  turns usage tracking off, and creates the user `Kit Player` with no password if it is missing. An
  existing `Kit Player` must be a Player who really joins without a password (the script tries it),
  otherwise nothing is changed. Values are printed before and after, read back after a reload, and a
  second run changes nothing. When it works, Foundry stays on `strahd-kit` and the Assistant GM
  browser stays **stopped**: it would join `strahd-kit` and move the bridge link (and with it the
  Claude Desktop connectors) to the test world. The stage prints the join address
  (`http://foundry-pi:30000/join`) and the user name. If anything fails after the services stopped,
  `options.json`, Foundry and the Assistant GM browser are put back as they were and the state file
  is removed, even when the ssh session drops in the middle of the run. A run that fails after the
  world was started may leave `Kit Player` and `Kit GM` in `strahd-kit`; the stage says so, and
  `MODE=up` followed by `MODE=down` removes them.
- **The Kit GM (for the test kit's Pi target, `docs/dev/TEST-KIT.md`, "Running it on the Pi").**
  `MODE=up` also gives the kit a GM of its own, so the kit can call bridge tools against
  `strahd-kit` without anyone's login:
  - Before anything stops it also checks that stage 5's `assistant-gm.mjs`, the bridge service and
    `systemd-run` are there. A leftover password file, browser profile or running Kit GM browser from
    a cut-off run (no state file) is removed, and the stage prints what it removed.
  - The password is 16 random bytes as 32 hex characters, made on the Pi, written to
    `/etc/foundry-ai-tool/kit-gm.env` (one line `ASSISTANT_GM_PASSWORD=...`, root only, mode 600,
    through a temp file in `/etc/foundry-ai-tool` and a rename, so root never writes through a folder the
    foundry user owns) before the driver runs. It is never printed and never on a
    command line: the driver gets it in its environment, and the browser unit reads the file.
  - `ACTION=setup` also enables the `foundry-mcp-bridge` module in `strahd-kit` when it is off
    (the module stays enabled there afterwards, like the Actor Studio settings; `strahd-kit` is a
    throwaway copy), creates `Kit GM` as a Gamemaster with that password (an existing `Kit GM` is
    ours: its role and password are reset), sets it as the module's **AI Tool: Which GM connects**, reloads and reads
    it all back, and checks that a throwaway browser can really join as `Kit GM` with the password.
  - Then a transient unit `foundry-ai-tool-kit-gm-browser` (`systemd-run`, with the hardening and
    priority properties of the Assistant GM unit: low priority, no new privileges, its own profile
    folder `/var/lib/foundry-ai-tool/kit-gm-browser`, made as the foundry user) runs `assistant-gm.mjs run` as `Kit GM` with the
    canvas off, exactly like the real Assistant GM. The stage waits for "joined world strahd-kit as
    Kit GM" and then looks for the bridge link on port 31415 (a warning only). A reboot drops the
    unit and nothing starts it again. If the browser does not join, the run is rolled back like any
    other failure.
  - The state file gets a line `KIT_GM_BROWSER=1` and a line `ORIG_BRIDGE_USER=<id or empty>`, the
    "AI Tool: Which GM connects" setting the world had before (stage 11 sets the Assistant GM there). `MODE=down` puts that
    user back when it still exists and is a GM, else "Any GM". A state file from before this change
    (no such lines) is still accepted by `MODE=down` and resets to "Any GM".
  - The PC reads the password with `pwsh scripts/pi/fetch-kit-login.ps1` (one read-only ssh command,
    nothing printed, a file limited to your Windows user). Delete it again after `MODE=down` with
    `pwsh scripts/pi/fetch-kit-login.ps1 -Remove`.
  - What the bridge writes while `strahd-kit` is connected goes to the bridge vault's own folder for
    that world (`<vault>/strahd-kit/`), not to the campaign's.
- **The player plays.** They join as `Kit Player` and make their character in Actor Studio. When they
  have left the game:

  ```bash
  cat scripts/pi/remote/lib.sh scripts/pi/remote/kit-session.sh | ssh foundry-pi 'MODE=down bash -s'
  ```

- **`MODE=down`** needs the state file, `strahd-kit` running and nobody online (`FORCE=1` goes on
  anyway). It stops the Kit GM browser first (it would count as online) and the Assistant GM browser
  too, because a reboot during the session starts that one on `strahd-kit`, where it would count as
  a user. With `strahd-kit` still running it runs `kit-session.mjs` with `ACTION=teardown`: the
  actors that `Kit Player` owns and that were made after `up` (the state file's `STAMP_EPOCH`, passed on as
  `SINCE_EPOCH`, so a DST change or a timezone change cannot move the cutoff; an older state file without it
  falls back to `STAMP` as `SINCE_STAMP`) are listed by name and id and deleted, then the user; then the
  "AI Tool: Which GM connects" goes back to "Any GM" if it is `Kit GM`, and `Kit GM` is deleted. An owned actor from
  before `up` (or one with no creation time) is kept and listed as kept. At most 5
  actors are deleted; more than that stops the run (`MAX_DELETE=<n>` raises the limit after you have
  looked at them), and nothing else is deleted and no setting is touched. Any actor created for
  `Kit Player` during the session is deleted too; the copy from before the session is in
  `prev-<time>`. If the teardown fails,
  nothing else changes: Foundry stays on `strahd-kit`, the state file and the Kit GM password file
  stay and the Kit GM browser stays stopped, so `MODE=down` can run again. Otherwise the password
  file and the Kit GM browser profile are removed, Foundry stops, `options.json` launches the world
  it launched before, the state file is removed, Foundry starts, and the Assistant GM browser starts
  again if it ran before (the stage waits for "joined world").
- **Anything else as `MODE`** stops with a usage line before anything changes.

Tested the same way as stage 13: `node --test scripts/pi/kit-session.test.mjs` runs the browser
script against a fake `game` (every decision of the setup and the teardown), and with
`PI_KIT_SESSION_CONTAINER=1` it runs the stage in an ARM64 Debian 13 container with stand-ins for
systemd (`scripts/pi/container-test/kit-session-scenarios.sh`; Docker needed): up and down, the
refusals (a session already up, already on `strahd-kit`, people online, a bad `MODE`), a failing
script putting everything back, and services that were off staying off. For the Kit GM it covers the
password file (mode, form, never in the output or in any recorded call), the `systemd-run` call, a
browser that does not join, a dropped ssh session at each new step, the stop order in `MODE=down`, a
failed teardown and the old state file format; each of those scenarios is proven to fail on the
stage without the change. The first live kit session on the Pi (2026-10-13) worked: real systemd
ran the transient unit (`EnvironmentFile` of the root-only file, `ProtectSystem=full` with the
Chromium profile), Foundry took the "AI Tool: Which GM connects" setting for the user made seconds before, the Kit GM
browser joined and held the bridge link, and `MODE=down` put `curse-of-strahd`, the GM setting and
the Assistant GM browser back (about 6 minutes up, 2 down; stopping the Assistant GM browser alone
takes about 40 seconds).

`1-health.sh` (stage 1, read-only apart from its own folders) ends with a "kit session" line: a
warning "kit session up since `<STAMP>`" while `kit-session.env` exists, so a session nobody took
down (Foundry would launch `strahd-kit` on game night) shows up in the next health check.
The nightly restic backup (stage 6) leaves out the Kit GM browser profile like the Assistant GM's.

## GM scripts

Some world changes need a GM in the browser (a module's own import, a script that places map pins),
and on the Pi nobody types the Gamemaster's password. `gm-script.sh` runs one GM script in the running
world as the Assistant GM instead:

- The script is a local file on the Pi (copy it with `scp` first). It is the body of an async
  function that gets `args` (`args.dryRun`, `args.log(text)`) and returns something JSON can hold.
  Nothing over the network can start a script: no endpoint, no port, and the bridge and the
  dashboard cannot trigger it.
- **Dry run first** (`DRY_RUN=1`): only known reads go through (an allow list: document and
  compendium reads, folder listings, template loads, the server's clock and status, GET and HEAD
  requests); every other write or event is held back and listed in the log, also ones the list
  does not know. The page's guard checks the list, the script's browser checks it again on
  Foundry's socket, and the browser holds back every HTTP request that is not GET or HEAD (the one
  rule that runs outside the page). Reads work, so the script can report what it would change. A
  script should still check `args.dryRun` itself. The dry run guards against a script's mistakes;
  it is not a sandbox for a script that sets out to get around it, so read a script before you run
  it.
- **A real run needs a passed dry run of the same file** (the same sha256): `gm-script.sh` looks
  for the marker a passed dry run leaves in `/var/lib/foundry-ai-tool/gm-scripts`, or for its end
  line in the journal, and refuses otherwise. The hash is taken from the kept copy, which is the
  file that runs. A passed dry run does not expire and does not record `ENABLE_MODULES`: dry-run
  again after a long gap or with other modules. In an emergency `NO_DRY_RUN_REASON="why"` skips
  the check; the reason goes to the journal.
- `ENABLE_MODULES="id ..."` enables installed modules in the world before the script runs (a dry
  run only reports it).
- Every run is logged to the journal: the file, its sha256, dry run or not, the script's log lines
  and its result. A copy of each script stays in `/var/lib/foundry-ai-tool/gm-scripts`, named by
  time and sha256 (`<time>-<sha12>.js`, `<time>-<sha12>-dry-run.js` and, after a passed dry run,
  `<time>-<sha12>-dry-run.ok`). `journalctl -t foundry-ai-tool-gm-script` lists the runs.
- While the script runs, the Assistant GM service is stopped (one Chromium on the Pi) and **the
  bridge link is down**: the script's browser closes every WebSocket that does not go to Foundry,
  so the foundry-mcp-bridge module cannot open its link there. No AI tool call reaches the world
  during the run (the bridge has no Foundry link), and nothing the bridge sends can mix with the
  script's writes. The service starts again afterwards, also after a failure, and the link comes
  back with it.
- A run that is not a dry run changes the campaign world: a `dietpi-backup 1` snapshot and the
  user's OK come first (CLAUDE.md, the Pi rule).

```bash
scp my-script.js foundry-pi:/root/
cat scripts/pi/remote/lib.sh scripts/pi/remote/gm-script.sh | ssh foundry-pi 'GM_SCRIPT=/root/my-script.js DRY_RUN=1 bash -s'
cat scripts/pi/remote/lib.sh scripts/pi/remote/gm-script.sh | ssh foundry-pi 'GM_SCRIPT=/root/my-script.js bash -s'
```

Scripts that hold book or campaign text (room names, pin lists) stay on the PC and the Pi, never in
this repository.

## The first load after an update

After a dnd5e or Foundry update, the world migrates in the first GM browser that opens it. On the Pi
this takes several minutes for a big world, and a reload restarts it. Open the world once as GM,
wait for "Migration completed", then let the players in.
