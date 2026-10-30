### Tooling

- **CI on the PR head is the green for lanes:** the lane skill now says a lane runs quick local
  checks, pushes, and lets CI be the full green. The full local `npm run green` is for a request or
  for what CI cannot see (Windows-only local behaviour such as the heavy lock and the `.husky` hook
  path).
- **`npm run green -- --quick`:** typecheck and unit tests of the packages a branch touched against
  `aitool/main`, the node tests of changed scripts and hooks, and the dashboard e2e specs it
  touched. It takes no heavy-check lock.
- **The pre-push hook** runs only the em-dash check now (a second, no lock). The lint ratchet and
  the typecheck are left to CI; waiting for the heavy-check lock made the hook take a median 22
  minutes.
