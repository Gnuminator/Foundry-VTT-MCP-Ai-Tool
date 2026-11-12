### Process and tooling

- **One script writes the Backlog:** `node scripts/backlog.mjs` has `status`, `claim`, `progress`,
  `release`, `done`, `add` and `low`. Each write pulls the vault, edits one item, checks that
  nothing else moved, commits only its own files and pushes, and redoes the edit on a rejected push
  (up to 5 times). A new hook, `guard-backlog.mjs`, refuses hand edits of `Backlog.md` from lane
  worktrees, and the lane and planner skills point at the script with lower word budgets that a
  test now checks (item backlog-tool).
