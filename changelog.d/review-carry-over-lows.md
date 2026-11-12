### Fixes

- **Merge gate review carry, lows from PR 966:** the carry now also refuses when a note lists another patch after the carried review, pins the submodule diff flags, times out `git fetch` without asking for a login, fetches main once per run, and its tests cover mode-only and binary changes and clean up their temp repos (review-carry-over-lows).
