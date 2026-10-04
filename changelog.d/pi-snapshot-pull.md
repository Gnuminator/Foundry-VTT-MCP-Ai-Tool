### Orange Pi

- **Snapshots on this PC:** `scripts/pi/pull-snapshot.ps1` copies the Pi's newest `dietpi-backup`
  snapshot over SSH into `E:\PiBackup` as one `tar.zst` archive (read-only on the Pi, test-read
  before it is kept, 14 daily plus 8 weekly kept, logs), and `scripts/pi/register-snapshot-task.ps1`
  runs it daily and at logon as a hidden scheduled task. The guide has a restore section.

### Dev tools

- **Token usage report:** `python scripts/dev/usage-report.py [since]` sums Claude Code usage per
  session from this PC's transcripts (cache reads, writes and output, weighted like API prices), to
  spot sessions whose context grew too large.
