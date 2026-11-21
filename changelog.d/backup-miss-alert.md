### Orange Pi

- **A missed nightly backup posts to #gm-bot:** stage 32 adds an `OnFailure=` drop-in to the nightly restic backup unit, so a night that fails or is skipped (players still online, disk space critical) posts one line to #gm-bot the same morning, with the commands to look and to run it when it is quiet. Rerun stage 32 after stage 6 on a Pi that has not got the unit yet (backlog `backup-miss-alert`).
