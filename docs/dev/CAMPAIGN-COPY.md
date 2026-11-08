# Campaign copy: the live Curse of Strahd world as a test server

A copy of the live Foundry (the Orange Pi, world `curse-of-strahd`) that runs on this PC, so
campaign-specific problems can be reproduced, fixed and tested without touching the live server.
It is a test server like A, B and C, but its data is the live world, so the copy is ours to change
and the Pi is never changed.

| What              | Value                                                                           |
| ----------------- | ------------------------------------------------------------------------------- |
| Foundry           | `http://localhost:30004`, data folder `C:\FoundryCampaign\data`                 |
| Bridge, dashboard | none (Foundry only). Module copy dials 31545, where nothing listens             |
| Join as           | `Gamemaster` (role 4) or `Assistant GM`; every user has an empty password       |
| App               | the shared Foundry app from `C:\FoundryTest\appdir.txt` (same 14.370 as the Pi) |
| Licence           | server A's `license.json`, copied into the copy                                 |

## Commands

```bash
pwsh scripts/test-env/campaign-copy.ps1 refresh   # pull a fresh copy from the Pi (read-only there)
pwsh scripts/test-env/campaign-copy.ps1 start     # Foundry on 30004, auto-launches the world
pwsh scripts/test-env/campaign-copy.ps1 stop
pwsh scripts/test-env/campaign-copy.ps1 status
```

`refresh` needs the copy stopped. It overwrites every change made on the copy (the previous data
folder is kept once as `data.prev`). Options: `-WithJB2A` (also pull the 1.6 GB animation module),
`-PiHost` (ssh name, default `foundry-pi`), `-Port`, `-Root`.

## What refresh does on the Pi, and what it copies

- **Only reads.** One `ssh foundry-pi "nice -n 19 tar cf - ..."` of `/var/lib/foundry/Data`, no
  compression on the Pi, no writes, no restart, no snapshot needed (the Pi rule allows read-only
  commands freely). About 2.1 GB, a minute on the LAN. The world is live while it is read, so a
  write in that second can land half in the copy; refresh again if something looks off.
- Copied: the world `curse-of-strahd` (data, `packs/` with the six `world.player-*` packs plus
  `legacy-other-books` and the linked SRD packs, settings), `systems/` (dnd5e 6.0.5), `modules/`
  (all of them at the Pi's versions, without JB2A), `assets/`, `ddb-images/`, `tokenizer/`.
  Not copied: the other Pi worlds (`strahd-kit`, `frostmaiden-training`, `pi-check`) and
  `Config/` (the Pi's `options.json` and licence are not used).
- Then, locally: a `Config/options.json` for port 30004, server A's licence file, no `admin.txt`
  (the copy's setup screen has no admin password, it listens on this PC only), the module copy of
  `foundry-mcp-bridge` gets `flags.foundry-mcp-bridge.defaultServerPort = 31545` and no update
  manifest (so it never reaches a real bridge), and `campaign-copy-users.mjs` gives every user the
  empty-password hash (Foundry stores "no password" as that hash, an empty string is rejected).

## Rules

- Never starts a bridge, so nothing of the copy binds 31414 to 31416, the Plan B rehearsal ports,
  3100 or the other test servers' ports; the script refuses those as `-Port`.
- Licence: the copy runs on the licence file of server A. Servers A, B and C already run next to
  each other (and next to the Pi) the same way, so a fourth local instance is the same situation.
  If Foundry ever refuses a second session, stop the copy first.
- World data and licensed packs live in `C:\FoundryCampaign` only, never in the repo or the vault.
- The world's journals and actors contain campaign text. Do not paste book text into notes.
- Do not start the AI Tool bridge or the dashboard against it without picking free ports; the
  test-env scripts for A, B and C do not know this copy.

## Differences from the live world

The copy has no Assistant GM browser, no bridge link (the module reports it offline), no Cloudflare
tunnel and no JB2A animations. Everything the Actor Studio, compendiums, sheets and macros do runs as
on the Pi.
