### Fixes

- The merge gate counts only the newest run of each CI check. A PR closed and reopened to rerun CI
  against a fixed main no longer stays blocked by the old failure on the same head. A run that is
  still queued (gh reports its start time as 0001-01-01) counts as the newest; with equal or unknown
  times the worse result stays. A hand-dispatched CI run off main now fails on purpose, so it cannot
  hide a failure on the merge ref.
