### Fixes

- **Merge runner no longer skips a finished PR silently:** an open, non-draft PR with CI green on
  its head and a Merge review note for that head, but no ready line on its Backlog item, now shows
  in its own section of `backlog.mjs status --planner` and is posted once to #pr-log, with the
  command that writes the ready line. The runner still never writes a ready line itself.
