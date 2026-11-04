### Pi

- **Stage 24 installs the pinned Foundry modules on the Pi:** `scripts/pi/remote/24-modules.sh` reads the module
  archive's `pinned.json` on the Pi, checks every zip (sha256, entry names, the id and version inside) before it changes
  anything, and shows a dry run by default. A real run (`APPLY=1`, snapshot and nobody online first) moves each old
  folder aside, puts the pinned version in, restarts Foundry and reads the result back; a failure puts the old folders
  back, and `UNDO=1` does the same later. It installs modules only and does not switch them on in the world. The plan in
  `docs/dev/MODULE-REHEARSAL.md` is updated to match, and a container test runs the scenarios on ARM64 in CI.
