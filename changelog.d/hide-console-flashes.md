### Fixes

- **No flashing console windows on Windows:** the merge runner, the merge gate, `drift-check`, the
  heavy lock and `npm run green` start every child process with `windowsHide: true`, so a merge
  round or a quick check no longer pops up command windows (item `hide-console-flashes`).
- **Merge runner gates a rewritten ready line:** a PR refused by the gate stays refused only while
  its ready line is gone; when the lane writes a ready line again for the same head, the runner
  gates it in the next round instead of skipping it until a restart.
