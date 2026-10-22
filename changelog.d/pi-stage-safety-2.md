### Orange Pi stage scripts (pi-stage-safety-2; follow-ups from PR #432)

- **Stage 3 puts the old Foundry back:** if it fails after stopping Foundry (the swap, or a new program that does
  not start), it restores `/opt/foundry.prev`, starts Foundry again and keeps the zip, so a failed run never leaves
  the Pi without a Foundry. Stage 2 puts the old Node back if the second rename fails.
- **The Assistant GM is subtracted only once it has joined:** `require_quiet` looks for the browser's "joined world"
  line since the service last started, so a browser that runs but has no world no longer hides a real player.
- **Token scripts check first:** `set-tunnel-token.sh`, `set-dashboard-access.sh` and `set-discord-token.sh` refuse,
  before asking for anything, while players are online or a recording runs. `FORCE=1` goes on;
  `set-discord-token.ps1 -Force` passes it through. The first two now need `lib.sh` copied next to them
  (Remote access, steps 8 and 10).
- **The nightly 04:30 backup waits for the players:** while anyone is online it does not stop Foundry, looks again
  every 30 minutes (six times), then skips the night with an ERROR line. The unit's timeout is now 5 hours.
- **Tests:** failing-`mv` tests for stages 2 and 3, the nightly backup, the three token scripts and the ps1.
  `7-vault.sh` loses two unused variables.
