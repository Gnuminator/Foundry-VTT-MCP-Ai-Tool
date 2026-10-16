### Process

- **`npm run usage:week` shows the split per model:** a Models line after the targets gives turns
  per model (main thread + subagents) and each model's share of the weighted cost, so a week
  where lanes slip back to Opus shows up (`models` in `--json`).
- **Model routing rules in the lane and planner skills:** every Agent call, Workflow `agent()` call
  and `start_session` (cards and successors too) sets `model`, because an unset model inherits
  the caller's; the Opus review is picked from the PR's file list. Finding: vault D-122.
