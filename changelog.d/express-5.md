### Dashboard

- **Express 5:** the dashboard server moved from Express 4 to the 5 line (with `@types/express` 5). The
  page routes now send `index.html` from its folder, so a build under a dot folder such as
  `.claude/worktrees` still loads.
