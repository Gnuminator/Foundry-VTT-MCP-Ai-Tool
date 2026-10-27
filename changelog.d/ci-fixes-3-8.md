### Tooling (CI failure review fixes 3 to 8)

- **Pre-push check:** `git push` now runs the lint and em-dash ratchets and the typecheck first
  (skipped when `npm run green` passed on the same commit), so a +1 warning is refused locally.
- **Merge gate verdict:** `lane:merge --wait-ci` always ends with one `wait-ci ended` line with the
  exit code and the reason, also after a killed relaunched copy or an unexpected error.
- **Visual Docker runs:** the node_modules volumes are per worktree, and a stopped Docker Desktop
  gets a plain message.
- **Tool-set budgets:** the drift check prints each set's headroom and warns under 500 characters.
