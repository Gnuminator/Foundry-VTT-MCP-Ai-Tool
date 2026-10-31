### Fixes

- **Two PRs that fit the dashboard budget alone can no longer turn main red together:** the merge
  gate's drift check now builds the dashboard and runs the bundle budget on the trial merge with
  the newest main whenever the branch or main since the merge base touched `packages/cogm-dashboard/`.
- **Budgets warn before they fail:** the dashboard bundle budget prints a GitHub warning when the
  first load has under 2 KB left (a raise must leave 2 KB or make something lazy), and the tool-set
  size test adds the same annotation under 500 characters.
- **CI runs on main are no longer cancelled by the next merge,** so a red on main shows on the commit
  that caused it.
