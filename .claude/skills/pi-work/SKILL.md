---
name: pi-work
description: Rules for any work on the Orange Pi or a Linux host: stage scripts, backups, deployed checks, Plan B. Use before any ssh or Pi script work.
---

# Pi work

Hardware: Orange Pi 5 Pro 16 GB, DietPi, Node 24, reached as `ssh foundry-pi`. Setup and stages:
`docs/dev/PI-SETUP.md` (index to the pages in `docs/dev/pi/`); remote access (Tailscale, Part C tunnel): `docs/dev/REMOTE-ACCESS.md`;
Plan B (game night on the PC): `docs/dev/PLAN-B.md`.

## The rule (the user, 2026-10-04)

- **Read-only commands freely** (status, logs, `df`, `systemctl status`, `cat` of our files).
- **Every change only from a reviewed stage script** in `scripts/pi/remote/` (Opus review: Pi
  scripts are a risky category), tested in the ARM64 container first (`scripts/pi/container-test/`),
  each run after the user's explicit OK. Any other change is shown to the user first and runs only
  after an OK. Every OK is asked through `AskUserQuestion`, never in prose or via the planner.
- **Explicit OK every time, never bundled:** deleting outside our folders (`/opt/foundry*`,
  `/opt/node24`, `/var/lib/foundry*`, `/etc/foundry-ai-tool`, `/tmp`), users and groups, disks,
  partitions, filesystems, the bootloader, removing packages, firewall, SSH and network settings,
  reboots. An OK never becomes automatic.
- **Snapshot first:** `/boot/dietpi/dietpi-backup 1` (over non-login ssh it is not on PATH) before
  every stage and before anything on the list above. Snapshots live in `/mnt/dietpi-backup` (3 kept,
  nightly); the PC pulls copies to `E:\PiBackup`.
- Prompts for Pi work carry this rule in full.

## Before a run

- Stage scripts piped over ssh are the repo's copy, but they call helpers an earlier stage
  installed (for example `/opt/foundry-ai-tool/gm-browser/assistant-gm.mjs` from stage 5). If the
  run relies on a new feature, compare the deployed helper with the repo copy (sha256, or grep for
  the new env var) first. Container tests install the repo's stand-in and cannot catch this.
- Look at what is deployed first with `deploy/pi/deployed-state.ps1` (read-only: units, containers, env
  names, libicu, the deployed build against the newest release and the helper hash). It needs no snapshot.
- After the run, read the output for the expected result (for example the `users:` line), not
  just the exit code.
- Stage scripts: `${var:?}` in every `rm -rf`; `node --test .claude/hooks/guard-remote-commands.test.mjs`
  passes before pushing.
- **Deploy order after a new release: stage 5, then stage 33 right after it.** Stage 33
  (`33-obsidian-plugin.sh`) puts the build's Obsidian plugin into the GM vault so Syncthing carries it to the PCs. Stage 5
  ends with stage 33's read-only `CHECK=1` result as a warning line; a warning means run stage 33 (snapshot and the user's OK
  first). The plugin tells the GM "Restart Obsidian" when the synced manifest is newer than the running one.
- Pi deploys go after a green merge-train `live:roundtrip` on main (see the `planner` skill).

## Current state and holds

- Holds in CLAUDE.md "Holds now" apply. The Pi moves to the newest Foundry, dnd5e and tool release
  (D-128, the user, 2026-10-24), in the order written in `docs/dev/pi/worlds-and-trials.md`,
  "System trial (stage 14)" (trial, stage 3, stage 5, test kit, switch).
- Updates (D-098, D-110, D-128): newest Foundry, dnd5e and module versions, tested first on the PC test
  server (CI, `live:roundtrip`, `live:sweep`, full kit), then the kit on the Pi's `strahd-kit`
  world, then the real world; never on a game-night day; never a beta on the real world.
- **Update sitting (OS packages):** the Pi card on the PM board shows the upgradable package count, a pending
  reboot and whether `/lib/modules` matches the running kernel (stage 16 `os` block). Read-only check by hand:
  `ssh foundry-pi 'apt list --upgradable 2>/dev/null; ls /var/run/reboot-required; uname -r; ls /lib/modules'`.
  A sitting is its own item on the sitting list, never on a game-night day or the day before: `dietpi-backup`
  snapshot, then the upgrade, like any change through a reviewed stage script or shown to the user first and run
  after an OK (an upgrade that removes packages and the reboot each need their own OK, never bundled). Reboot
  after any kernel package upgrade: `modulesMatchKernel` only turns false when the running kernel's folder
  in `/lib/modules` is gone (a version change or a removed kernel); a same-version rebuild is not detected, and
  `rebootPending` depends on the package writing `/var/run/reboot-required`. Until the reboot, drivers (docker
  networking) may fail to load, so do not restart containers in between. Afterwards read the card: count 0
  (an apt failure shows no count, not 0), no reboot pending, modules match, Foundry up. The count comes from cached lists
  (updated by DietPi's own apt refresh), so it can lag a day.
- Stage 12 (tunnel) refuses to run while any Pi world has a GM user with no password.
