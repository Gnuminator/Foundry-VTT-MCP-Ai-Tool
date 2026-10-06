### Backups and installer (follow-ups to PR #165 and #168)

- **Stale-backup DM, long-broken records:** an unreadable or invalid record file starts its problem
  clock at the earlier of its modified time and now, so a file that has been broken for days alarms
  on time after a bot restart, and a modified time in the future cannot push the alarm out.
- **Stale-backup DM, how to fix an unreadable record:** the DM names the task to run once ("Foundry
  Pi restic copy" or "Foundry Pi snapshot pull"); a successful run writes the record again.
- **Stage 6:** `record-pull.sh` uses `mv -fT` for its atomic rename; an unreachable "not read"
  fallback in the reader is gone.
- **Windows client installer:** when it runs as another account than the signed-in user (for
  example "Run as administrator" with a different admin account), it warns that Claude Desktop will
  not see the new entries and says to run it again as the signed-in user. A warning only: the
  entries are still written.
