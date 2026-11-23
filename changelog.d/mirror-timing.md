### Obsidian

- **The mirror times itself:** the log line "Obsidian mirror updated" now carries `cycleMs` and `reconcileMs`, and `_status.md` says how long the last full check took (comparing the vault with Foundry) and how long its whole cycle took. The status note changes only at a full check (about every 10 minutes, or after a settings change), so it is one small rewrite per check and nothing per cycle. This is the measuring half of the timed first sync on the Pi.
