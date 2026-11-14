### Fixes

- **Merge gate and runner judge main's newest commit, not an older run:** both now read main's tip and wait (runner) or refuse for a retry (gate) while that commit has no CI run yet, so a merge GitHub never started CI for is no longer read as "main green" from the run before it. A rerun of a cancelled run is no longer called a rerun after a failure, and "no completed run" and "not a list of runs" are retried by the runner like "cannot read" (Backlog `main-tip-run-check`).
