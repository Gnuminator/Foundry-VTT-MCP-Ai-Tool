---
title: Orange Pi setup
description: Bring up the Orange Pi 5 Pro from scratch as the home server for Foundry, the tool, backups and the Discord bot, with as much automation as possible.
---

# Orange Pi setup

The Orange Pi 5 Pro (16 GB) becomes the always-on home server: Foundry VTT itself, the bridge, the
dashboard, the Discord bot, backups and vault sync. Decisions: vault notes D-068 (the Pi),
D-075 (how players reach it).

How the work is split:

- **Part A, you (about 30 minutes, today):** prepare a microSD card on this PC, plug the Pi in, run
  one script. After that this PC can reach the Pi over SSH. Checked against DietPi's current image
  on 2026-10-04.
- **Part B, Claude (over SSH from this PC):** the system, Node.js, Foundry, private admin access,
  the tool, backups and vault sync, in stages. Claude stops before each stage and at the few steps
  only you can do (licence key, logins in your browser).
- **Part C: players and the GM from outside** through Cloudflare (Foundry and the dashboard live since 2026-10-14). Your steps:
  [Remote access, Part C](REMOTE-ACCESS.md#part-c-players-and-the-gm-reach-the-orange-pi-through-cloudflare);
  Claude's side is stage 12, in the stage table and in Part C below.

Day-to-day development and testing stay on this PC's test server; the Pi only runs released builds
and the campaign world.

## Pages

This page used to hold everything. The text now lives in these pages (every old section link still lands here and points on):

- [Part A: you (the card and the first login)](pi/part-a-you.md): What you need, what to install on this PC, and the five steps you do yourself: image, card, settings, first start.
- [Part B: Claude brings the Pi up](pi/part-b-bring-up.md): The stage table and how Claude takes the Pi from a fresh image to a running server.
- [Backups, drills and storage](pi/backups-and-storage.md): Snapshots and restic copies on this PC, stale copies, the rebuild drill, the NVMe move and the storage space check.
- [Game-night watch and guards](pi/game-night-watch.md): The game-night watch, the assistant GM hang watchdog, the crash guard and the clock sync.
- [Vaults, Syncthing and recordings](pi/vaults-and-recordings.md): The GM vault, who it is shared with, the player vault, vault sync checks, recordings, the recorder endpoint and the Discord bot.
- [Network and access](pi/network-and-access.md): The UniFi gateway, players and the GM from outside, SSH keys only, the join page and the player connector.
- [Licensed content and the training world](pi/licensed-content.md): The books and Curse of Strahd, the training world, world switches, the seven-book trim and pinned modules.
- [Characters, trials, the kit session and GM scripts](pi/worlds-and-trials.md): Player character creation, the system trial, switching the running world, the kit session, GM scripts and the first load after an update.
- [The stack, runners and where things live](pi/stack-and-ops.md): Board status report, GitHub Actions runners, the stack in containers and where everything lives on the Pi.

## Old section links

Each heading below is where a section used to be. The link under it goes to its new home.

### What you need

Moved to [Part A: you (the card and the first login)](pi/part-a-you.md#what-you-need).

### On your PC

Moved to [Part A: you (the card and the first login)](pi/part-a-you.md#on-your-pc).

### Part A: you

Moved to [Part A: you (the card and the first login)](pi/part-a-you.md#part-a-you).

#### 1. Download and check the image

Moved to [Part A: you (the card and the first login)](pi/part-a-you.md#1-download-and-check-the-image).

#### 2. Write the image to the card

Moved to [Part A: you (the card and the first login)](pi/part-a-you.md#2-write-the-image-to-the-card).

#### 3. Put the settings on the card

Moved to [Part A: you (the card and the first login)](pi/part-a-you.md#3-put-the-settings-on-the-card).

#### 4. Start the Pi

Moved to [Part A: you (the card and the first login)](pi/part-a-you.md#4-start-the-pi).

#### 5. Find the Pi and hand over

Moved to [Part A: you (the card and the first login)](pi/part-a-you.md#5-find-the-pi-and-hand-over).

### Part B: Claude

Moved to [Part B: Claude brings the Pi up](pi/part-b-bring-up.md#part-b-claude).

### Snapshots on this PC

Moved to [Backups, drills and storage](pi/backups-and-storage.md#snapshots-on-this-pc).

### Restic copies on this PC

Moved to [Backups, drills and storage](pi/backups-and-storage.md#restic-copies-on-this-pc).

### Game-night watch (I-145)

Moved to [Game-night watch and guards](pi/game-night-watch.md#game-night-watch-i-145).

### Stale backup copies

Moved to [Backups, drills and storage](pi/backups-and-storage.md#stale-backup-copies).

### Rebuild drill

Moved to [Backups, drills and storage](pi/backups-and-storage.md#rebuild-drill).

### The GM vault and Syncthing

Moved to [Vaults, Syncthing and recordings](pi/vaults-and-recordings.md#the-gm-vault-and-syncthing).

### Storage space check

Moved to [Backups, drills and storage](pi/backups-and-storage.md#storage-space-check).

### Recordings

Moved to [Vaults, Syncthing and recordings](pi/vaults-and-recordings.md#recordings).

### Your UniFi gateway

Moved to [Network and access](pi/network-and-access.md#your-unifi-gateway).

### Part C: players and the GM from outside

Moved to [Network and access](pi/network-and-access.md#part-c-players-and-the-gm-from-outside).

### SSH keys only (stage 15)

Moved to [Network and access](pi/network-and-access.md#ssh-keys-only-stage-15).

### Licensed content (the books and Curse of Strahd)

Moved to [Licensed content and the training world](pi/licensed-content.md#licensed-content-the-books-and-curse-of-strahd).

#### Training world (D-118)

Moved to [Licensed content and the training world](pi/licensed-content.md#training-world-d-118).

##### Switching Foundry to the training world and back

Moved to [Licensed content and the training world](pi/licensed-content.md#switching-foundry-to-the-training-world-and-back).

#### World switches (frostmaiden-training and curse-of-strahd)

Moved to [Licensed content and the training world](pi/licensed-content.md#world-switches-frostmaiden-training-and-curse-of-strahd).

### Player character creation (stage 13)

Moved to [Characters, trials, the kit session and GM scripts](pi/worlds-and-trials.md#player-character-creation-stage-13).

### System trial (stage 14)

Moved to [Characters, trials, the kit session and GM scripts](pi/worlds-and-trials.md#system-trial-stage-14).

### Switching the running world

Moved to [Characters, trials, the kit session and GM scripts](pi/worlds-and-trials.md#switching-the-running-world).

### Kit session (strahd-kit test run)

Moved to [Characters, trials, the kit session and GM scripts](pi/worlds-and-trials.md#kit-session-strahd-kit-test-run).

### GM scripts

Moved to [Characters, trials, the kit session and GM scripts](pi/worlds-and-trials.md#gm-scripts).

### The first load after an update

Moved to [Characters, trials, the kit session and GM scripts](pi/worlds-and-trials.md#the-first-load-after-an-update).

### Moving to NVMe (done 2026-10-30)

Moved to [Backups, drills and storage](pi/backups-and-storage.md#moving-to-nvme-done-2026-10-30).

#### How it is set up now

Moved to [Backups, drills and storage](pi/backups-and-storage.md#how-it-is-set-up-now).

#### Which part was lost

Moved to [Backups, drills and storage](pi/backups-and-storage.md#which-part-was-lost).

### Board status report (stage 16)

Moved to [The stack, runners and where things live](pi/stack-and-ops.md#board-status-report-stage-16).

### GitHub Actions runners for the PM board (stage 17)

Moved to [The stack, runners and where things live](pi/stack-and-ops.md#github-actions-runners-for-the-pm-board-stage-17).

### Clock sync (stage 18)

Moved to [Game-night watch and guards](pi/game-night-watch.md#clock-sync-stage-18).

### Recorder status endpoint (stage 27)

Moved to [Vaults, Syncthing and recordings](pi/vaults-and-recordings.md#recorder-status-endpoint-stage-27).

### Discord bot on the game server (stage 26)

Moved to [Vaults, Syncthing and recordings](pi/vaults-and-recordings.md#discord-bot-on-the-game-server-stage-26).

### Join page look (stage 19)

Moved to [Network and access](pi/network-and-access.md#join-page-look-stage-19).

### Vault sync check and time zone (stage 20)

Moved to [Vaults, Syncthing and recordings](pi/vaults-and-recordings.md#vault-sync-check-and-time-zone-stage-20).

### Who the GM vault is shared with (stage 31)

Moved to [Vaults, Syncthing and recordings](pi/vaults-and-recordings.md#who-the-gm-vault-is-shared-with-stage-31).

### Player vault share (stage 21)

Moved to [Vaults, Syncthing and recordings](pi/vaults-and-recordings.md#player-vault-share-stage-21).

### The stack in containers (stages 23 and 24)

Moved to [The stack, runners and where things live](pi/stack-and-ops.md#the-stack-in-containers-stages-23-and-24).

### Seven-book trim (stage 22)

Moved to [Licensed content and the training world](pi/licensed-content.md#seven-book-trim-stage-22).

### Pinned modules (stage 25)

Moved to [Licensed content and the training world](pi/licensed-content.md#pinned-modules-stage-25).

### Assistant GM hang watchdog (stage 28)

Moved to [Game-night watch and guards](pi/game-night-watch.md#assistant-gm-hang-watchdog-stage-28).

### Game-night watch on the Pi (stage 29)

Moved to [Game-night watch and guards](pi/game-night-watch.md#game-night-watch-on-the-pi-stage-29).

### Player connector (stage 30)

Moved to [Network and access](pi/network-and-access.md#player-connector-stage-30).

### Crash guard and clock check (stage 32)

Moved to [Game-night watch and guards](pi/game-night-watch.md#crash-guard-and-clock-check-stage-32).

### Where things live on the Pi

Moved to [The stack, runners and where things live](pi/stack-and-ops.md#where-things-live-on-the-pi).

### Sources

Moved to [The stack, runners and where things live](pi/stack-and-ops.md#sources).
