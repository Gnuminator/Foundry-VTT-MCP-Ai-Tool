### Orange Pi (D-068)

- **Stage 13 tests in the repo (#232 follow-up):** `scripts/pi/player-creation.test.mjs` checks the
  settings script against a fake `game` (usage-tracking off for every user, a second run changes
  nothing) and runs the stage in an ARM64 container with stand-ins for systemd: the downgrade guard,
  an unreadable `/api/status`, services that were off, and a failed Assistant GM browser start. CI
  runs the container part on the ARM runner.
