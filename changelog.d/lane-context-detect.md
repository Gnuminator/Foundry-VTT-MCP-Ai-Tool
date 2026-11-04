### Fixes

- **Lanes get their own context lines in desktop-app worktrees:** the context hooks now count a session as a lane when its project dir is under `.claude/worktrees/` or its transcript sits in a worktree project folder (both fixed at session start), so a lane no longer gets the planner's 200k and 250k lines by mistake. A planner that `cd`s into a worktree stays a planner.
