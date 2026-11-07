### Fixes

- **Visual baselines helper with several lanes at once:** `npm run visual:baselines` now takes only a
  run for its own branch, refuses a run or artifact from another commit than the branch head at
  dispatch, and writes its output to a per-branch log in the temp folder.
