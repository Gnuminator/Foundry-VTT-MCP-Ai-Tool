### Fixes

- **Lanes get their own context lines in desktop-app worktrees:** the context hooks now count a session as a lane when either the project dir or the working directory is under `.claude/worktrees/`, so a lane no longer gets the 200k and 250k lines.
