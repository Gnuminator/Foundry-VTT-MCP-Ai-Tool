### Tooling

- **Stopped lanes reach the planner:** a lane that hands over at its context line now always
  messages the newest Planner, and the planner re-reads every claimed Backlog item on each wake,
  starts a successor for a stopped lane and archives the old session once its worktree is clean.
