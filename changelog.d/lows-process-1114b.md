### Fixes

- **Merge gate relaunch supports nested module folders:** the copy of main's gate under `scripts/lane-merge/` keeps sub-folders, and the same-gate check lists them, so a nested module no longer makes every run relaunch. More gate tests: a vault that exists but cannot be read, and three cases where a skipped matrix leg must not clear a cancelled check (Backlog `lows-sweep-process-1114b`).
