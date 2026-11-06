### Tooling (planner-wake-lows)

- **The planner wake watcher no longer fails silently:** a failed fetch or unreadable Backlog prints a stderr line, exit 4 says how many problems there were, a multi-line progress value prints the item id on every line, and exit codes are set without cutting the output.
- **Planner skill:** the agent-\* worktree warning, the "tell the user what merged" line and the `git checkout --detach` fallback are back, inside the word budget.
