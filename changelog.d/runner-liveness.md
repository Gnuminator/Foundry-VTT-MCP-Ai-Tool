### Fixes

- **A dead merge runner is noticed:** the merge runner writes a heartbeat every minute, and
  `backlog.mjs status --planner` and the session start hook say so when the runner is gone, its
  heartbeat is over 15 minutes old, or it stopped on a red main. The scheduled task now repeats every
  10 minutes, so a killed runner, or one that stopped on a red main, starts again by itself (a repeated
  identical stop posts to Discord only once; a stop that needs a person, such as a killed gate, is not
  restarted until its heartbeat file is deleted). Re-register it once with
  `pwsh scripts/register-merge-runner.ps1` to get the repeat.
