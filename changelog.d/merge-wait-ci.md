### Tooling

- **`lane:merge --wait-ci`:** `node <main copy of lane-merge.mjs> <PR> --wait-ci` waits in one
  process (up to 30 minutes) until every CI check on the PR's head commit has finished, then runs
  the normal gate unchanged and merges or refuses with the reason. A failed check ends the wait at
  once and is named (exit 3), a changed head refuses with "head moved" (exit 4), a timeout exits 5.
  The planner starts it with `run_in_background` once the review says Merge; lanes stop at "ready to
  merge" (D-122 log, 2026-10-16).
