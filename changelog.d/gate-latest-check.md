### Fixes

- The merge gate counts only the newest run of each CI check. A PR closed and reopened to rerun CI
  against a fixed main no longer stays blocked by the old failure on the same head.
