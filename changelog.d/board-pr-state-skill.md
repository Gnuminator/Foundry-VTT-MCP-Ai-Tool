### Process

- **Lane heartbeat retired:** `scripts/lane-beat.mjs`, its test and the `lane:beat` npm script are gone, as are the Heartbeat section and the per-milestone handover rewrites in the `lane` skill. The PM board reads PR, CI and review state from GitHub, so a lane's vault commits are the claim and the `- progress:` line.
