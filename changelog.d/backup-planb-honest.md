### Pi and Plan B scripts (backup-truth, planb-honest-output)

- **A backup that leaves Foundry down now fails:** the nightly restic script waits up to 30 seconds for
  `foundry.service` to be active after its restart and ends with an ERROR line and exit 1 if it is not.
  Needs a Pi run of stage 6 to take effect.
- **The PC's pull scripts judge the backup by the snapshot's age:** a copy of a week-old snapshot no longer
  counts as fresh (it is not recorded on the Pi, so the stale-backup DM can fire), and an unplugged backup
  drive is logged to `%LOCALAPPDATA%\foundry-ai-tool\pull-fallback.log` instead of failing silently.
- **Stage 16 board report** adds the age of the newest `dietpi-backup` snapshot, whether `foundry.service` is
  active and the clock (NTP state and offset). Needs a Pi run of stage 16.
- **Bridge vault backup:** the comment no longer promises a bot alert that does not exist.
- **Plan B output is honest:** `start.ps1` says it is waiting up to 30 s for Foundry's data lock, ends every
  failure with one `FAIL:` line and exit 1, and prints no literal `<domain>` placeholder; `check.ps1`
  reports the module link as unknown behind a login and reads the tunnel's current state; `restore.ps1`
  refuses a newest backup over 36 hours old unless `-AllowOld` (`-Force` stays for the played-data refusal only).
