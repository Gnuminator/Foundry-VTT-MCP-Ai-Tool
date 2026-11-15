### Tests

- **Dashboard page shots are no longer committed:** the 54 full-page screenshots (dashboard moments, drawers, player pages) are still rendered on every CI run, but uploaded as the artifacts `dashboard-page-shots-N` (one per shard that ran page tests) instead of compared with committed PNGs, so a PR that adds a control to a page no longer regenerates baselines. The 362 story shots are unchanged, and a test fails if a page PNG returns to `__screenshots__`.
