---
name: pi-work
description: Rules and steps for any work on the Orange Pi (or any Linux host) that runs Foundry for the Foundry AI Tool campaign - what may run freely, what needs the user's OK, dietpi-backup snapshots, stage scripts in scripts/pi/remote, the ARM64 container test, deployed-file checks, backups and Plan B. Use before running anything over ssh on the Pi, writing or changing a stage script, deploying to the Pi, or briefing a session that will.
---

# Pi work

Hardware: Orange Pi 5 Pro 16 GB, DietPi, Node 24, reached as `ssh foundry-pi`. Setup and stages:
`docs/dev/PI-SETUP.md`; remote access (Tailscale, Part C tunnel): `docs/dev/REMOTE-ACCESS.md`;
Plan B (game night on the PC): `docs/dev/PLAN-B.md`.

## The rule (the user, 2026-10-04)

- **Read-only commands freely** (status, logs, `df`, `systemctl status`, `cat` of our files).
- **Every change only from a reviewed stage script** in `scripts/pi/remote/` (Opus review: Pi
  scripts are a risky category), tested in the ARM64 container first (`scripts/pi/container-test/`),
  each run after the user's explicit OK. Any other change is shown to the user first and runs only
  after an OK.
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
- After the run, read the output for the expected result (for example the `users:` line), not
  just the exit code.
- Stage scripts: `${var:?}` in every `rm -rf`; `node --test .claude/hooks/guard-remote-commands.test.mjs`
  passes before pushing.
- Pi deploys go after a green merge-train `live:roundtrip` on main (see the `planner` skill).

## Current state and holds

- Holds in CLAUDE.md "Holds now" apply (stage 14 and dnd5e 6.0.6 on the Pi are paused until after
  G0; the Pi stays on dnd5e 6.0.5).
- Updates (D-098, D-110): newest Foundry, dnd5e and module versions, tested first on the PC test
  server (CI, `live:roundtrip`, `live:sweep`, full kit), then the kit on the Pi's `strahd-kit`
  world, then the real world; never on a game-night day; never a beta on the real world.
- Stage 12 (tunnel) refuses to run while any Pi world has a GM user with no password.
