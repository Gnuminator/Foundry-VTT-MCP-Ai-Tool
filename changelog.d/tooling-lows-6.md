### Fixes

- **Merge gate lock without hard links:** when hard links are missing, the rename back in `acquireLock` first checks that the lock is free and otherwise prints the same lock-race warning instead of overwriting a third run's lock (#385).
