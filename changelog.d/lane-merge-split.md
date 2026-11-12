### Tooling

- **The merge gate is split by gate:** `scripts/lane-merge.mjs` stays the entry point and keeps every export, and the code now lives in `scripts/lane-merge/` (risky list, review notes, CI checks, changelog check, merge train, announce, relaunch from main, drift run and the main run). No behaviour change. Main's copy of the gate is now fetched as the entry file plus that folder (relaunch, merge runner and the lane skill command), and a test keeps the entry file under 150 lines. The temporary line-ratchet exception for the gate is gone.
