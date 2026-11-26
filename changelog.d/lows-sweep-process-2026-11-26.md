### Fixes

- **Planner and scout lows:** the planner's Kit line no longer prints "on undefined" for a run without a git sha. The conflict scout now matches globs in a `touches` line (`scripts/*.mjs`), its replay waits up to 2 minutes for `gh` and says so when `gh` gives no data, and `claimAdvice` has a test.
