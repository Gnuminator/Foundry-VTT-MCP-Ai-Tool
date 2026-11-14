---
title: Licensed content and the training world
description: The books and Curse of Strahd, the training world, world switches, the seven-book trim and pinned modules.
---

# Licensed content and the training world

Part of [PI-SETUP](../PI-SETUP.md).

## Licensed content (the books and Curse of Strahd)

D&D Beyond imports stay a job for this PC: DDB Importer calls its proxy from the GM's browser, and the
proxy holds your D&D Beyond login cookie, so it must never be reachable through Cloudflare or from
another machine. Import on the PC (the proxy and Adventure Muncher against the PC's Foundry). Then two
scripts move the result to the Pi, in two steps so that you can look in between:

1. **On this PC, with the world stopped in Foundry** (its database files are in use while it runs):

   ```powershell
   .\scripts\pi\push-world.ps1 -World curse-of-strahd
   ```

   It scans the world and the compendium packs of the modules for every image and sound path
   (`scripts/pi/world-refs.mjs`, which reads copies of the databases and never touches a running
   Foundry), and stops when anything is wrong: a missing file or one whose letter case differs from
   the real name (Windows ignores case, the Pi does not), a module that is not in the bundle, a module
   that is switched on in the world but not shipped (turn it off in the world first, as ddb-importer
   must be), a setting that looks like a secret, or a GM user that has a password (the hash Foundry 14
   stores for a user with no password does not count). Then it checks the
   free space on this PC and on the Pi (below 20 % free it warns, below 5 % it stops), builds one
   `.tar` with a checksum for every file, and uploads it to `/var/lib/foundry-import/` on the Pi. It
   never runs stage 11. `-NoUpload` builds and checks only.

2. **Stage 11 on the Pi**, after a `dietpi-backup 1` snapshot and your OK. `push-world.ps1` prints
   the exact command at the end (`BUNDLE=...`).

What is copied:

- the world (`Data/worlds/<id>`);
- the private modules (default `aitool-content`, `dnd-players-handbook`, `foundryvtt-actor-studio`;
  the content module holds the imported book images, D-084);
- the `Data/ddb-images/` and `Data/tokenizer/` folders the world uses (without them, scenes and
  tokens show broken images). The adventure archives in `Data/ddb-adventure/` are not copied: they
  are only needed to import again, which stays a job for this PC.

What never leaves this PC: **ddb-importer** (its settings can hold the D&D Beyond cookie) and the
bridge module (stage 5 installs it from the release), and any env file, proxy file or Adventure
Muncher file. `push-world.ps1` refuses them, and stage 11 checks the tar again before it extracts
anything. World settings whose names look like a secret (a cookie, a token, a key) stop the push; the
names are shown, never the values. A `ddb-importer.*` setting that you reviewed and that is only a
setting (a folder name, a compendium name) can be let through with a narrow pattern, for example
`-AllowSettingKeys 'ddb-importer.entity-*'`. A setting whose own name (after the module id) has
cobalt, cookie, patreon, secret, password, credential, bearer, an API key or a private key in it, or
that is or ends in token or key (`discordToken`, `refresh-token`, `privateKey`), is always a problem,
whatever the list says. Module names do not count (vtta-tokenizer, Token Action HUD); a harmless
setting that ends in token goes on the short safe list in `world-refs.mjs` (today `core.defaultToken`).

Images that the books point at but that are not on this PC stop the push too. When you have looked
at them and they are known gaps (a book image the importer never fetched), list them with
`-AllowMissing 'ddb-images/adventures/Curse_of_Strahd/gone.webp','modules/dnd-players-handbook/missing/*'` (an exact path or a
prefix ending in `*` that names a root and a folder before it, so `modules/*` is refused; no `..`, no
leading slash). A matching path that is really missing on disk is then no problem and is listed in
the run. A wrong-case path stays a problem, and so does a path outside the bundle that exists on disk
(a file under `Data/assets/`, say), because push-world would not copy it. The list goes into `MANIFEST.txt` (`allow-missing:`). `world-refs.mjs` also leaves
out the D&D Beyond importer's own metadata under `flags.ddb` (Foundry never loads it) and treats
`nue/defaultscene/` as one of Foundry's own files.

What stage 11 does with it:

- **The campaign world is never replaced** unless you run it with `REPLACE_WORLD=1`. If the world is
  already on the Pi, it stays as it is and only the modules and images are updated.
- **The modules are always replaced**, even when the campaign world is kept. A run in the middle of the
  campaign therefore swaps in the PC's copy of each module, and edits made on the Pi inside a module's
  own compendiums (the content module's packs, say) are not in it. The old module folder is in
  `prev-<time>/modules/<id>`: stop Foundry and copy the pack back from there (or ask Claude to). Edits
  in the world itself (actors, journals, scenes) are not touched.
- **A test copy, `strahd-kit`** ("Curse of Strahd (test copy for kit runs)"), is made from the bundle
  every time and replaced on every run. The test kit runs there, so a test never touches the
  campaign. `KIT_WORLD=` (empty) skips it. `LAUNCH=strahd-kit` starts Foundry on the copy instead.
- **Old copies are moved, not deleted**, to `/var/lib/foundry-import/prev-<time>/`; remove them later
  only with your OK. The images are merged into the existing folders, so nothing is deleted there,
  and an existing image with the same name but other content is copied to `prev-<time>/` first.
- **Free space** is checked first (the 20 % rule: a warning below 20 %, a stop below 5 %, and a stop
  when there is less room than twice the bundle). If a run fails after Foundry was stopped, the
  `options.json` world is put back to what it was and Foundry and the Assistant GM browser start again.
- **Each new world gets a generated GM password**, kept only in `/etc/foundry-ai-tool/world-<id>.env`
  (root only, never printed). The GM reads it with `ssh foundry-pi cat
/etc/foundry-ai-tool/world-curse-of-strahd.env` and then changes it in Foundry if he likes. The
  Assistant GM and the bridge are set up in each world like in stage 5, and the Assistant GM browser
  restarts on the campaign world.
- The world's GM user is `Gamemaster` (`GM_USER=` for another name) and must have no password on the
  PC when you push, because stage 11 joins as that user once to set the new password.
- **The `strahd-kit` default is only for `curse-of-strahd`.** Any other `WORLD` must say
  `KIT_WORLD=` (no test copy) or `KIT_WORLD=<id> KIT_TITLE=<title>`, or the run stops before
  anything changes, so another bundle can never reset `strahd-kit`.
- **A kit world is only reset if it is a kit copy of the same `WORLD`.** Every reset writes
  `flags["foundry-ai-tool"].kitOf = <WORLD>` into the kit world's `world.json`. If a world with the
  `KIT_WORLD` id is already installed and has no such marker for this `WORLD`, the run stops before
  anything changes, so a campaign run can never overwrite an installed training world from the Strahd
  bundle. The Pi's older `strahd-kit` counts for `curse-of-strahd` and gets the marker on its next
  reset. Run with `REPLACE_KIT=1` only when replacing that world is meant; it never lifts the refusal
  to use `curse-of-strahd`, `strahd-kit` or the `LAUNCH` world as the kit world of another `WORLD`.

### Training world (D-118)

Danni's Frostmaiden training world goes in next to the campaign, while Foundry keeps launching
`curse-of-strahd`. It is a copy of the PC's kit world trimmed to Frostmaiden, pushed with
`push-world.ps1 -World frostmaiden-training -Modules '' -PiModules aitool-content,dnd-players-handbook,foundryvtt-actor-studio`
(`-Modules ''` means no modules; from a shell `-Modules @()` does not work with `pwsh -File`, which drops the
empty array. The three active modules are already on the Pi from the campaign bundle, and stage 11
replaces the Pi's module folders with the bundle's, so shipping them again could swap out the Pi's
own copies; `-PiModules` writes each one with the version of the PC's copy into the bundle's
`MANIFEST.txt` (`pi-modules: aitool-content@1.2.0, ...`), and stage 11 stops before anything changes
if one is not installed on the Pi, or if the Pi's copy is older than the PC's: update it on the Pi
first (the campaign bundle, or stage 13 for actor-studio). Versions compare as numbers; with the same
numbers, two suffixes like `2.10.5-aitool.4` and `2.10.5-aitool.5` compare their counter, and any other
suffix mix, like `1.2.0` and `1.2.0-rc1`, cannot be compared and only warns). The command push-world prints at the
end for this world has `KIT_WORLD= LAUNCH=curse-of-strahd`; add `EXTRA_GM_USER=Claude` to it by hand
(push-world only hints at it). The settings are:

```bash
WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd EXTRA_GM_USER=Claude
```

- `LAUNCH` may name any world that is already installed, so the new world is provisioned and
  Foundry goes back to the campaign. For any `WORLD` other than `curse-of-strahd` it must be set
  and not empty (like `KIT_WORLD`), so a forgotten or empty `LAUNCH` can never switch the Pi to the
  new world. For such a world `KIT_WORLD` may not be `curse-of-strahd`, `strahd-kit` (the campaign's
  test copy) or the `LAUNCH` world either: every run resets the kit world from the bundle.
- A bundle for any world other than `curse-of-strahd` that ships a module is refused before anything
  stops, because the campaign owns the modules: use `-PiModules` as above, or run with
  `SHIP_MODULES=1` only when replacing the Pi's modules is meant. The campaign's own bundle ships its
  modules as always, also with `LAUNCH=strahd-kit`.
- `EXTRA_GM_USER=Claude` makes a second full GM with its own generated password. Both logins are in
  `/etc/foundry-ai-tool/world-frostmaiden-training.env` (`GM_USER`, `GM_PASSWORD`, `EXTRA_GM_USER`,
  `EXTRA_GM_PASSWORD`; root only, never printed). The extra GM is added to the file once; a run
  again keeps both passwords. A file that already names another extra GM stops the run before
  anything changes, and so does an extra GM named like the world's GM or the Assistant GM (case
  does not matter) or with a space at either end. `EXTRA_GM_USER` needs the Assistant GM driver
  from stage 5 at or after #294 (an older driver ignores the extra GM), and stage 11 refuses an older
  one before anything changes: run stage 5 again first.
- If provisioning fails, run the same command again: a `world-<id>.pending` marker in
  `/etc/foundry-ai-tool/` is written for every world of the run before the first is provisioned and
  stays until that world's provisioning has worked, so a plain rerun provisions the kept
  world again with the passwords already in its file (no `REPLACE_WORLD=1` needed). On any failure
  Foundry comes back on the world it launched before the run (the campaign, unless it was switched to
  the training world; see "Switching Foundry to the training world and back").
- Only the GM user is checked on the PC (push-world stops unless `Gamemaster` has no password).
  Other users in the copy, such as the test server's passwordless `Player`, go to the Pi as they are,
  so delete them in the copy first, or give them a password in Foundry on the Pi afterwards.
- Then stage 13 with `WORLD=frostmaiden-training KIT_WORLD=` turns Actor Studio's usage tracking off
  there too. Like stage 11, stage 13 only defaults `KIT_WORLD` to `strahd-kit` for
  `curse-of-strahd`: any other world must set it, so a training run cannot change strahd-kit.

#### Switching Foundry to the training world and back

Who: Claude, when the user asks for it, never the GM and never by hand on the Pi (decision D-118). The user says when the training call is, a session does the switch under the `pi-work`
rules, and after the call the same session switches back to `curse-of-strahd`. Do not leave the Pi on
the training world: the players and Danni's real game open whatever world Foundry launches.

How: there is no stage that only switches worlds. The switch is stage 11 (`11-world.sh`) run with a
training bundle and `LAUNCH` set to the world Foundry should start. Both directions use the same bundle
command, and the installed training world is kept, with its passwords, because `REPLACE_WORLD` stays 0:

1. Check that nobody is online (Foundry stops for a few minutes) and take a `dietpi-backup 1` snapshot.
   Get the user's OK for this run.
2. On this PC build a fresh bundle with the `push-world.ps1` command above. Stage 11 deletes the bundle
   after a successful run, so each switch needs its own.
3. Switch to the training world: run stage 11 with
   `WORLD=frostmaiden-training KIT_WORLD= LAUNCH=frostmaiden-training EXTRA_GM_USER=Claude`
   (after `scp scripts/pi/remote/world-switches.mjs foundry-pi:/root/`; add `WORLD_SWITCHES=1` when the
   training world is kept and its switches must be set again, see "World switches" below).
4. After the call, do steps 1 and 2 again (a snapshot taken for step 3 on an earlier day does not
   count: stage 11 wants one from today), then run stage 11 with
   `WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd EXTRA_GM_USER=Claude`. Check on the Pi
   that `options.json` launches `curse-of-strahd` and that `/api/status` shows the campaign world.

If step 4 fails, Foundry stays on the training world, because a failed run puts back whatever world it
launched before the run. Run step 4 again until it works, and do not end the session before it has.
Build each bundle while the PC's Foundry does not have the world open; the bundle is still fully
checked even though the kept world is not replaced from it.

Because the world is kept, anything changed in it during a call stays for the next one. To start over,
add `REPLACE_WORLD=1` to the command of step 3.

If a proxy ever has to run elsewhere, it is our patched copy (it reads the cookie from a file and
keeps it out of its logs), bound to `127.0.0.1`, never the upstream one (which logs the cookie).

### World switches (frostmaiden-training and curse-of-strahd)

A world that is reset from the PC copy starts with whatever its settings database held on the PC,
which is mostly Foundry's defaults, and a test then starts with the AI Tool's switches off (the
training world on 2026-10-29). Stage 11 sets the list below, so a test starts with them on. The
user chose this list on 2026-10-30: both worlds get the same values, and the nightly ones (Handouts,
writes) are **standing values**. Start session still turns on whatever is off, and End session
turns off only what Start session turned on, so a standing value stays on after End session. One
exception: a world copied while a night was still "ready" keeps that record, and its first End
session then turns off what the record names; press Start and End once to clear it.

| Setting (`namespace.key`)                         | Value | Why                                                                                                                  |
| ------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `foundry-mcp-bridge.allowWriteOperations`         | on    | The master switch for every AI write; nothing below works with it off.                                               |
| `foundry-mcp-bridge.gmWindows`                    | on    | The Combat, Party, Session, Scene and Loot windows; a world that stored "off" would hide them.                       |
| `foundry-mcp-bridge.feature.handouts.enabled`     | on    | Reveal next and the dashboard's player page; Danni's test found it off after a reset.                                |
| `foundry-mcp-bridge.feature.party.enabled`        | on    | The Party drawer's travel pace, add party to combat and rest request.                                                |
| `foundry-mcp-bridge.feature.tarokka.enabled`      | on    | Saving the Tarokka reading and publishing reveal pages (the Tarokka table).                                          |
| `foundry-mcp-bridge.feature.live-play.enabled`    | on    | Damage, healing, conditions, resources, tokens; on by default, written so a stored "off" cannot hide it.             |
| `foundry-mcp-bridge.feature.ownership.enabled`    | on    | Who owns which actor; on by default, written for the same reason.                                                    |
| `foundry-mcp-bridge.feature.table-viewer.enabled` | on    | The TV's Table user; on by default, written for the same reason.                                                     |
| `foundry-mcp-bridge.feature.change-undo.enabled`  | on    | Undo for everything from the Changes list; on by default, written for the same reason.                               |
| `foundry-mcp-bridge.feature.who-notices.enabled`  | on    | Read-only: the passive Perception row in the Party drawer. It changes nothing, so it is safe to leave on.            |
| `foundry-mcp-bridge.feature.rules-check.enabled`  | on    | Read-only: "does this attack look legal now"; on by default, written so a stored "off" cannot hide it.               |
| `dnd5e.autoApplyDowned`                           | `all` | Unconscious and Dead land on monsters and characters at 0 hit points (W51: passed in David's combat test).           |
| `item-piles.enableTrading`                        | on    | Players can use Request Trade. Item Piles is not active in every world: a world without it gets a warning, no error. |

Left as they are (the module default, which is off): Obsidian mirror and import, Session notes, Scene
restore, Room setup, Scene mood and music, NPC turn assistant, Paper sync, and "Live play, apply
without confirming". Each is a deliberate opt-in with its own Undo; turn one on in Game Settings,
Configure Settings, AI Tool when a night needs it.

How it runs: `world-switches.mjs` (the table above as data; `world-switches.test.mjs` fails when
the table and the data differ) joins the world as its GM with the login in
`/etc/foundry-ai-tool/world-<id>.env`, sets only what differs, reloads and reads every value back.

- **A new or reset world** (the kit world, and the training or campaign world when it is replaced):
  stage 11 does it by itself, right after the world is provisioned.
- **A push-back** (Plan B) never gets it: its settings come back from the PC as they were played.
- **A kept world** is left alone. To set the list in it, run stage 11 with `WORLD_SWITCHES=1`
  (the world's settings are copied to `prev-<time>` first). That is the checklist line for the next
  test of a training world that was not reset: add `WORLD_SWITCHES=1` to the command of step 3 under
  "Training world". It runs the world's provisioning again too (the GM login from the env file, the
  bridge, the Assistant GM), and the copy in `prev` holds only `data/settings`. To put the settings
  back: stop Foundry, replace the world's `data/settings` with that copy, start Foundry. Do not use
  it on the real campaign after Danni has changed switches on purpose; it overwrites the values above.
- **A new or reset world under auto overwrites the bundle's own values** for these settings. Use
  `WORLD_SWITCHES=0` when the PC copy's values are deliberate.
- **Owed switches:** before a world gets the switches, the stage writes the marker
  `/etc/foundry-ai-tool/world-<id>.switches-pending`, and removes it once the driver has set and read back
  every value. A run that stops in between (the driver failed, the run was killed) leaves the marker,
  and a plain rerun (auto) sets the switches in that world again, even a kept one. The run's own message
  says which command to repeat; for the kit world it is the same command, never `WORLD_SWITCHES=1`.
- **Giving the switches up:** `WORLD_SWITCHES=0` clears a leftover marker (the line "an old owed-switches
  marker is cleared" in the output), and so does a run that gives that world no switches anyway, such as a
  Plan B push-back that replaces it. A later plain run then no longer sets switches you gave up on.
- **Push-back:** `WORLD_SWITCHES=1` together with a Plan B push-back is refused before anything stops
  ("does not go with a Plan B push-back ... Nothing was changed"); leave `WORLD_SWITCHES` out or use `0`.
- **Not wanted:** `WORLD_SWITCHES=0`. The stage needs `world-switches.mjs` uploaded first:
  `scp scripts/pi/remote/world-switches.mjs foundry-pi:/root/`, and removes the upload.
- **The run's log:** like stages 14 and 19, stage 11 writes the lines it prints itself (from the bundle check on), with a time, to
  `/var/lib/foundry-import/world-run-<time>.log` (root only; the output names it). It holds the stage's own
  lines, not what the tools it runs print (the driver's and the GM password check's lines show only on the screen). The stage
  ignores a dropped SSH connection while Foundry is stopped, so after a drop `tail` that file to see how far
  it got. Read the log, not the old output, before running the stage again.

The Pi has not run it yet; the first run is a later Pi day with the user's OK, after a
`dietpi-backup 1` snapshot, like any stage 11 run.

## Seven-book trim (stage 22)

The player-facing content is cut to the seven kept books (PHB 2024, DMG 2024, CoS, CoSCO, TCoE, XGtE, MotM). Stage 22
(`scripts/pi/remote/22-seven-books.sh`) is the checks in front of `gm-script.sh`; the work is two GM scripts in the same folder.

- **What it does:** `seven-books-trim.js` moves every `aitool-content` entry from another book into the GM-only pack
  `world.legacy-other-books` (same ids, tagged with the pack they came from), keeps entries that kept ones link to, copies the SRD
  items and creatures that kept entries link to into `world.linked-srd-items` and `world.linked-srd-creatures` (player-visible)
  and re-points the links, hides the dnd5e Item and Actor packs from Player and Trusted (a pack that kept entries link to stays
  visible and is named in the log; one that was hidden already is opened), and locks the module packs again at the end. A second run changes nothing. A rerun replaces
  the legacy copy of an entry that came back into `aitool-content` (the dry run prints `REPLACE stale legacy copies`; a GM edit of
  the legacy copy is lost).
  `seven-books-delete-legacy.js` deletes the legacy pack for good (`MODE=delete`).
- **Where it runs:** the module packs are shared by every world on this Foundry, so the trim runs in the one world that holds the
  legacy pack, `curse-of-strahd`, which must be the running world. In the other worlds (strahd-kit, the
  training world) the moved entries are gone from the shared packs (they are kept only in this world's legacy pack), the
  re-pointed PHB 2024 links are dead, and the dnd5e packs stay visible because hiding is per world, so the strahd-kit test
  kit does not show the trimmed view. A real run asks for `OTHER_WORLDS_OK=1` while other worlds exist.
- **Run it:** `scp` the two scripts to `/root/`, then
  `cat lib.sh 22-seven-books.sh gm-script.sh | ssh foundry-pi 'bash -s'` (a dry run: counts and a list of what stays visible).
  Snapshot first (`/boot/dietpi/dietpi-backup 1`), the user's OK, then the same with `APPLY=1` (and `OTHER_WORLDS_OK=1`). Any
  other `APPLY` value is refused; a `GM_SCRIPT` in the environment is ignored (the script follows `MODE`).
- **Run it again** after anything that puts the dropped books back: a stage 11 push of `aitool-content`, a content module update.
  Stage 13 sets Actor Studio's sources afterwards (run it after this stage).
- **Check for drift (read-only):** `MODE=check` (same `scp` and pipe as the dry run, no `APPLY`, no snapshot needed) runs the trim
  as a dry run and fails with `DRIFT: ...` when the world no longer matches what the trim leaves: an entry of a dropped book is
  back in `aitool-content` (`move`), a kept entry links to something only the legacy pack has (`comeBack`) or to the SRD packs
  (`repoint`), a dnd5e pack is visible again (`hide`, `srdVisible`), or a dnd5e pack that kept entries link to is hidden from
  players (`open`; the real run makes it visible, the dry run prints `WILL OPEN`). Kept entries that link into an `aitool-content`
  pack players cannot open are listed (`LINKS INTO PACKS PLAYERS CANNOT OPEN`, the known GM-only `summons` and `tables` among
  them) but are not drift: a trim rerun cannot fix them. The `COPIED SRD ENTRIES THAT LINK TO dnd5e PACKS THEMSELVES` line
  names the copied items and creatures (features included) that link to other dnd5e packs, and which of those packs the real run
  hides; those links are not re-pointed. It stops the Assistant GM for the length of
  the run like any GM script. Run it after a stage 11 push, a module update and stage 25; `no drift` is the pass line.
- **Delete:** `MODE=delete APPLY=1 DELETE_LEGACY=with-the-users-ok` only after the user's OK; the legacy pack holds the only copy of
  about 1500 entries on the Pi (the PC's content module and the snapshot are the way back).
- **Baseline (one player-facing pack per type):** `seven-books-baseline.js` (`MODE=baseline`, after the trim) copies the kept
  entries of `aitool-content` and the Player's Handbook packs (about 3850) with the same ids into six world packs that
  players can open: `world.player-classes` (classes and subclasses), `-species`, `-backgrounds`, `-feats` (only real feats, subtype
  `feat`), `-spells` and `-items` (equipment, other items, and the class features and species traits that are feat-type entries).
  It rewrites every Compendium link that names a kept pack, in the copies and in the journal pages of
  `dnd-players-handbook.content` and `aitool-content.journals` (class text, spell lists), then hides the 11 old packs. Order: the six
  world packs are made hidden, all copies, then the journals, then a scan that no link still names an old pack, and only then the
  world packs are opened and the old packs hidden; a failure before the journal rewrite changes nothing players see (stage 13 keeps the module
  packs as Actor Studio's sources until then); a failure after it leaves journal links pointing at hidden world packs until a rerun or the undo, and MODE=check reports HALF-FINISHED then. Only copies the script marked itself (`baselineCopy`) are ever removed, and only
  when their source pack is still in the world. A second run changes nothing (Foundry's own `_stats`, effect change ids and `<hr />` spelling are not
  differences); `REFRESH` in the dry run names a copy whose source changed. Links to `aitool-content.summons` and `tables`
  stay as they are (GM-only, the known open point). Module updates overwrite the journal pages: rerun the baseline (the check says when).
  Stage 13 then points Actor Studio at the six world packs (it does that on its own once the six packs exist and players can open
  them, and goes back to the module packs when they are hidden).
  - **Pi sitting:** snapshot (`/boot/dietpi/dietpi-backup 1`), the user's OK, `scp` the three scripts, trim if not done
    (`MODE=trim`), then `MODE=baseline` (dry run: read `COUNT`, `JOURNAL PAGES`, `REFRESH`, `ORPHANS`, `SOURCE PACK MISSING`,
    `NAME-FORM LINKS`, `LINKS TO KEPT PACKS WITH NO ENTRY`; `SOURCE PACK MISSING` means a module pack is gone and its copies are kept, so stop and look and note
    that the check fails on it; `NAME-FORM LINKS` are `@Compendium[pack.Name]` links, which are not rewritten and are only counted; the baseline refuses to run, dry run and real run, when the legacy pack is missing and no
    `world.player-*` pack exists, i.e. before the trim),
    `MODE=baseline APPLY=1 OTHER_WORLDS_OK=1` (the baseline rewrites the journal pages of the shared module packs
    `dnd-players-handbook.content` and `aitool-content.journals`, so in the other worlds, e.g. strahd-kit, class text and spell lists
    link to `world.player-*` packs that exist only in curse-of-strahd; hence `OTHER_WORLDS_OK=1`), stage 13, `MODE=check` (it now checks the baseline too once the six packs exist),
    then join as a Player and build a character (class advancement, a spell list, the Actor Studio steps). The dry run took about 30 s
    and the real run 2 to 3 minutes on the PC (the Pi will be slower; the stage has no timeout, the Assistant GM is stopped
    meanwhile like any GM script). Afterwards the trim check lists the 11 old packs under `LINKS INTO PACKS PLAYERS CANNOT OPEN`:
    expected, not drift. Run the baseline after the trim: a baseline made before a trim copies dropped books, which the next
    baseline run removes again as orphans.
  - **Undo:** `MODE=baseline-undo APPLY=1 OTHER_WORLDS_OK=1`: the journals point at the old packs again, the old packs are visible, the six world
    packs are hidden (nothing is deleted); run stage 13. Or restore the snapshot. The undo scans the journal pages after pointing them back and
    stops before it shows or hides any pack if one still names a world pack by an id it can map; it logs `RESTORED` for each old pack it shows
    and counts links to world packs with no copy (they stay as they are, and the check does not call them half-finished).
- **Grave Domain content patch (MODE=grave-patch):** `grave-domain-patch.js` (scp it with the other GM scripts) patches the module packs
  `aitool-content.classes` and `.spells` so Circle of Mortality grants Spare the Dying (Wisdom, always prepared; the granted copy shows 30 ft and a
  bonus action), the five Domain Spells grants on the Grave Domain subclass are always prepared (the import left them at not prepared), and Channel Divinity: Path to the Grave has a Use activity that spends one Channel Divinity use (the curse stays by hand). The
  Spare the Dying copy is made from the Players Handbook spell at run time, so no spell text is in the repo. Pi sitting: snapshot, `MODE=grave-patch`
  dry run, `MODE=grave-patch APPLY=1` (it adds to shared module packs, which is harmless for other worlds), then `MODE=baseline` dry run and
  `APPLY=1 OTHER_WORLDS_OK=1` (REFRESH should list only the patched entries), then stage 13 (as after every baseline), then `MODE=grave-check`
  (read-only). `MODE=check` includes the grave check too when `grave-domain-patch.js` is uploaded, and then fails with "the file is uploaded
  but the patch is not applied" until the patch has run (and the baseline after it). The snapshot is the only way back: the patch has no undo
  mode. It was applied on the Pi on 2026-11-10 (L155's sitting: snapshot, patch, baseline copied 1 and refreshed 2). Characters already built from the old entries keep them (rebuild or add by hand). A content module update that rewrites the pack
  undoes the patch: `MODE=grave-check` says when. The Spare the Dying copy is on no class spell list, so spell pickers do not offer it.
  By hand on a test server, in the browser console of a GM session (serve the file from any local address that sends
  `Access-Control-Allow-Origin: *`; dry run first, `false` for the real run):
  `const AF = Object.getPrototypeOf(async function(){}).constructor; await new AF('args', await (await fetch(URL)).text())({ dryRun: true, log: console.log })`.
- Tests: `scripts/pi/seven-books.test.mjs` (the GM scripts against in-memory packs; with `PI_STAGE22_CONTAINER=1` the stage in a
  Debian 13 ARM64 container, run by the ARM job in CI).

## Pinned modules (stage 25)

Stage 25 (`scripts/pi/remote/25-modules.sh`) installs the module versions pinned in the PC archive. The plan, the checks and
the undo are in [MODULE-REHEARSAL.md](../MODULE-REHEARSAL.md) ("Pi: install from the archive").

- **Run it:** copy the archive's `modules/` and `pinned.json` to `/home/dietpi/module-archive` (`node scripts/modules/rehearse.mjs pi-plan`
  prints the `scp`), then `cat lib.sh 25-modules.sh | ssh foundry-pi 'bash -s'` (a dry run). Snapshot first, the user's OK, then the
  same with `APPLY=1`. `ONLY=id1,id2` limits it; `UNDO=1` puts the last run's old folders back. **UNDO reaches only the last run**
  (the state file keeps one run, the one before it is renamed `modules-stage.state.last`): after two runs, the first run's old
  folders are put back by hand from `/var/lib/foundry-import/prev-<time>-modules`. A run that stops half way (power cut, killed)
  leaves `phase=installing` and the next `APPLY=1` is refused until `UNDO=1` has put the folders back; a failed restore keeps
  that phase, so the stage never counts a half undone state as done. The zips are unpacked as the foundry user in a dot folder
  under `/var/lib/foundry/Data` (`.stage25-work-<time>`), removed at the end.
- Old and replaced folders stay in `/var/lib/foundry-import/prev-<time>-modules` and `failed-<time>-modules` until the user removes them.
- Tests: `scripts/pi/modules-stage.test.mjs` (the stage as text; with `PI_STAGE25_CONTAINER=1` the scenarios in a Debian 13 ARM64
  container, run by the ARM job in CI).
