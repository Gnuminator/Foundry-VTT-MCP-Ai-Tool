### Fixes

- **Merge gate lock without hard links:** when hard links are missing, `acquireLock` now copies a moved lock back with an exclusive create and prints the lock-race warning if a third run took the slot, instead of renaming over that run's lock (#385).
