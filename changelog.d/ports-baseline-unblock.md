### Fixes

- **Main green again after the ports check:** the port baseline now lists the one port literal each
  in `scripts/dev/usage-calls.mjs` and `scripts/test-env/small-obsidian-vault.mjs`, which merged
  before the check did. The proper fix (read those ports from `shared/ports.json`) is Backlog item
  `ports-baseline-two-scripts`.
