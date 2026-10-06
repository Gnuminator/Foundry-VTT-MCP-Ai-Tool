### Pi backups (PB-06)

- **Discord DM when the PC's backup copies go stale:** after each successful run, `pull-restic.ps1`
  and `pull-snapshot.ps1` run one fixed command on the Pi (`record-pull.sh restic|snapshot`, installed
  by stage 6), which writes the Pi's own clock into `/var/lib/foundry-backup-pulls/<kind>.json`
  (root-owned, outside the foundry user's tree; the bot only reads it). The recorder bot reads those files every 15 minutes and DMs the owner when either kind (restic or
  snapshot) is older than 3 days, judged per kind (`FOUNDRY_AI_BACKUP_STALE_DAYS` changes it): one DM
  naming the stale kind or kinds and their age, a reminder at most once a day for each stale kind, one
  "copied again" DM for a kind that recovers while the other keeps its own schedule. A record that
  stays missing (while the other kind is recorded), unreadable or invalid for longer than the limit
  counts as stale too, and a record dated more than a day ahead is invalid; no DM while nothing was
  ever recorded. The first check after a bot start waits 15 minutes, so a restart does not repeat the
  DM. A Pi that cannot be told only logs a WARNING on the PC. Rollout: stage 6, a new tool build (stage 5), stage 8;
  the scheduled tasks need no re-registering. Details: `docs/dev/PI-SETUP.md`, "Stale backup copies".
