### Orange Pi (D-068)

- **Stage 6, backups** (`scripts/pi/remote/6-backup.sh`): a nightly restic backup at 04:30 of
  Foundry's data, the tool's storage and its secrets into `/var/lib/foundry-backup/restic` (7 daily
  kept), written as a systemd timer. Foundry stops for the minute or two the backup takes (a trap
  always starts it again); logs, the Assistant GM's browser profile and recordings are left out. The
  repository password is generated on the Pi in a root-only file and never printed.
- **The PC copy** (`scripts/pi/pull-restic.ps1`, task "Foundry Pi restic copy" from
  `register-restic-task.ps1`, daily 12:30 and 15 minutes after logon): copies new Pi snapshots into
  `E:\PiBackup\restic` over SFTP (14 daily, 8 weekly, 12 monthly kept) and once a month checks 10 % of
  the data and test-restores the newest snapshot's worlds. The PC repository's password is generated
  once in `%APPDATA%\foundry-ai-tool`; store a copy in your password manager. No USB drive any more
  (`docs/dev/PI-SETUP.md`).
