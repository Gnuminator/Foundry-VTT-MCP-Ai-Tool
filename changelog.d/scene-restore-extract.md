### Plan B (scene restore follow-up; Backlog scene-restore-extract)

- **`extract-scenes.ps1`:** restores only a world's scenes database from the newest backup into a folder of its own (read-only on restic, says how old the snapshot is, prints the folder for `backupPath`). `plan-scene-restore` and PLAN-B.md name it instead of a second `restore.ps1 -Root`.
