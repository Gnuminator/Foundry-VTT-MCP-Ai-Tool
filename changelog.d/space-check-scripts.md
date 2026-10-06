### Orange Pi (D-068)

- **Stage 10, a storage space check** (`scripts/pi/remote/10-space-check.sh`): an hourly systemd timer
  runs `/opt/foundry-ai-tool/space/space-check.sh`, which writes
  `/var/lib/foundry-ai-tool/space/status.json` (free space per filesystem, the jobs that use it, a
  level: low below 20 % free, critical below 5 %) and logs a WARNING or CRITICAL line to the journal.
  `UNDO=1` removes it. The Discord bot and the dashboard read the status file (separate change).
- **The nightly restic backup checks first** (`6-backup.sh`): it runs the checker as its own job,
  records `lastJob`, still runs below 20 %, and is skipped before Foundry stops when space is critical
  (under 5 % free, or less free than the data it would back up). Run stage 6 again after stage 10.
- **The PC pulls check space** (`scripts/pi/space-check.ps1`, called at the start of
  `pull-snapshot.ps1` and `pull-restic.ps1`): the backup drive, the Syncthing vault folder and the
  Pi's status (read-only over SSH). Below 20 % free they log a WARNING and show a Windows
  notification naming the disk, the free percentage and GB, and the job; at critical on the
  destination they skip the copy and exit 1. A missing or stale (over 3 hours) Pi status is only a
  warning. `-Test` prints what would be notified.

### Tests

- `scripts/pi/space-check.test.mjs` (CI step "Pi space check"): the stage scripts parse, the checker's
  JSON follows the contract, job blocking and `lastJob`, and the PC helper's levels and Pi-status
  handling. The remote command guard test now includes stages numbered 10 and up.
