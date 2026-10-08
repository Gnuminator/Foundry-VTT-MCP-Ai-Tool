### Developer tools

- **Drift check before "PR ready":** `npm run drift:check` fetches main, trial-merges it into the
  branch, runs the guards that only fail once another lane's PR is on main (lint and em-dash
  baselines, changelog fragments, usage catalog, version sync, tool counts and the tool reference),
  then undoes the merge. It needs a clean tree, never commits or pushes, and names the files when
  main conflicts.
