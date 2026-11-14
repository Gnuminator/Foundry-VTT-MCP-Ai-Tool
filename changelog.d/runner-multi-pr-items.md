### Fixes

- **Multi-PR Backlog items stay open:** a PR body line `Backlog-part: <id>` makes the merge runner
  log "part PR #n landed on main" on the item instead of closing it; `Backlog: <id>` still closes
  it. A PR body the runner cannot read keeps the item open too (runner-multi-pr-items).
