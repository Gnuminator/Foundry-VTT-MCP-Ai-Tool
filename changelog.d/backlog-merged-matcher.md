### Fixes

- **One "merged" test in the Backlog tool:** `claim`, `status` and the Pi list flag now share one function that reads the newest progress line by date and counts only "PR #n merged" or "merged at" (not "main merged" or "merges only after"). `backlog.mjs done` writes the merge commit from GitHub instead of the PR head, and the merge runner no longer closes a merged item that still has a Pi run or a Waiting blocker.
