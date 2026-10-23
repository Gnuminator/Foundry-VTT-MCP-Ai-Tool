### Tooling

- **`npm run usage:now`:** writes the vault note `Usage now.md` that the PM board's Today view reads, from the plan percentages passed in (`get_usage`) plus the `usage:week` check numbers. The planner skill says when to write it (each planner start and before each lane start).
- **Skills:** the planner skill names the `- progress:` line as the ready state, moves the Planner title step to "Starting lanes", renames the old planner "CLOSED (handed over DATE) Planner" before detaching, and tidies long lines; the lane skill says what to do about the worktree hold when no planner is left.
