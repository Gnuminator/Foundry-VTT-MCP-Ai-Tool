### Fixes

- **Merge runner waits before the "no ready line" post:** the #pr-log notice for a PR with green CI and a Merge note but no ready line now appears only after the PR has stayed that way for 15 minutes, so lanes that write the ready line a few minutes after the note no longer trigger it. `status --planner` still shows it at once.
