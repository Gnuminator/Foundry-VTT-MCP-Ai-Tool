### Tooling

- **Planner state on one screen:** `node scripts/backlog.mjs status --planner` adds the open PRs with CI state and the review verdict for the head, the merge train count, main's CI, the due Waiting items, and a line for every accepted item nobody claimed for more than 3 days (Backlog `planner-state`).
