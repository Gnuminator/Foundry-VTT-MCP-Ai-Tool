### Process

- **Planner wake watcher:** `node scripts/planner-wake.mjs` exits when a `- progress:` line in the vault Backlog changes, so the planner wakes on a lane's "ready to merge" instead of a fixed timer; after an hour of idleness it prints a brief for a fresh planner.
