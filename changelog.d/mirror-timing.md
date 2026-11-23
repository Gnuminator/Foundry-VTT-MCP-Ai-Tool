### Obsidian

- **The mirror times itself:** the log line "Obsidian mirror updated" now carries `cycleMs` and `reconcileMs`, and `_status.md` says how long the last full check took (comparing the vault with Foundry) and how long its whole cycle took. The status note only changes at a full check, so Syncthing sees no extra writes. This is the measuring half of the timed first sync on the Pi.
