### Fixes

- **Multi-PR Backlog items stay open:** a PR body line `Backlog-part: <id>` makes the merge runner
  log "PR #n merged at <sha>" on the item instead of closing it; `Backlog: <id>` still closes it
  (runner-multi-pr-items).
