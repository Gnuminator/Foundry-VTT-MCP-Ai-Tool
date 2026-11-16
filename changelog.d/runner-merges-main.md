### Fixes

- **The merge runner brings a lane branch up to date itself:** when the gate refuses a ready PR only because it is behind main (a clean conflict, or the lockfile moved on main), the runner merges `aitool/main` into the branch, pushes it and writes a new ready line for the new head, so the review carries by patch id and the PR no longer waits hours for its lane. A real conflict, a lockfile that would still change, a fork or draft PR, or a head that is already a runner refresh commit stay refusals (runner-merges-main).
