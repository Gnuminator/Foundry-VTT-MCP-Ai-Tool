### Orange Pi (D-068)

- **Rebuild drill** (`scripts/pi/rebuild-drill.ps1`, section "Rebuild drill" in `docs/dev/PI-SETUP.md`):
  one command rebuilds the Pi in an ARM64 Debian 13 container on this PC, never touching the Pi. It
  reads the newest snapshot of the restic copy in `E:\PiBackup` (read-only, `--no-lock`), runs
  stages 1 to 3, restores the snapshot, runs stages 5 to 8, starts Foundry, the bridge and the
  dashboard from the unit files the stages wrote, and checks the result (about 10 minutes, most of
  it stage 5's build; the timings are in the guide). Stage 4 (Tailscale login) and stage 9 (SSH log)
  need a person and a real Pi and are skipped.
- **`scripts/pi/drill/restore.sh`:** the restore step of a rebuild: the newest snapshot into a
  staging folder, copied into place with the old `foundry` user's owners fixed. The guide's runbook
  for a real rebuild uses it.
- **What the drill found, in the runbook:** restore before stage 6 (otherwise the restored
  `restic-pi.pass` does not open the new repository); the Foundry licence is bound to the host name
  `foundry-pi`; the `foundry` user id can change; the drill leaves out Syncthing's device key so a
  container never runs with the real Pi's identity; a restore on Windows exits 1 over one Chromium
  symlink.
- **Drill and runbook safety:** `restore.sh` stages in `/var/lib/foundry-restore/restored` (override
  with `STAGE_DIR`), removes it on exit even after a failure, and puts stage 9's `ssh-log` folder
  back to root only after the `chown`. The runbook copies the PC repository into
  `/var/lib/foundry-restore` (so the cleanup passes the SSH guard hook), adds stage 9 and
  `ssh-keygen -R` after a reflash. `rebuild-drill.ps1` restores the caller's restic variables, stops
  the container even when a stage fails, and says at the end where the restored secrets are left.
  The drill's check compares the Syncthing device certificate with the restored one.
