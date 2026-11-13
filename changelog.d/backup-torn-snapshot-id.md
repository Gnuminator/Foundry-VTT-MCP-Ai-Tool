### Orange Pi

- **The nightly backup forgets the right snapshot:** when the foundry container came back during the copy, the night now forgets the snapshot that run made (its id comes from the summary of `restic backup --json`), not whatever `restic snapshots --latest 1` listed first, which could be an older snapshot of another path set. A Docker daemon that does not answer at the check after the copy now fails the night and keeps the snapshot, with a line saying not to restore it before it is looked at. Run stage 6 again on the Pi to deploy it (Backlog `backup-torn-snapshot-id`).
