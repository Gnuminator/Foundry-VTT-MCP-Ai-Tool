### Fixes

- **Pi nightly backup: the skip marker is dated:** when players stay online all night the backup is skipped and a marker is left. The marker now holds the date, and the "back up anyway" rule applies only when it says yesterday. A manual run or a stage 6 rerun the evening after a skipped night waits for the players and skips again, instead of stopping Foundry under them. A marker from the earlier version (empty) is not trusted. Reaches the Pi with the next stage 6 run.
