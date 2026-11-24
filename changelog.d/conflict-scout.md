### Fixes

- **Conflict scout at claim time:** `backlog.mjs claim` now prints which open PRs and which merges of the last 24 hours touch the same files as the item (its `touches` line), names the hot files, and says go, wait for a PR, or split. `scripts/conflict-scout.mjs --files a,b` runs it on its own, and `--replay` checks it against the merge runner's conflict refusals.
