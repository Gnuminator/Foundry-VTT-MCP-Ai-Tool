### Developer tooling

- **The in-repo project dashboard is gone:** `scripts/dev/project-dashboard` and its npm scripts
  (`project-dashboard`, `project-dashboard:test`, `vault:sync`) are deleted, with its green and CI step.
  The Control Center (Gnuminator/control-center, port 3200) replaces it and runs the same suites in its own CI.
  The test kit's vault note now goes through `scripts/test-kit/lib/vault-push.mjs`, a copy of the Control
  Center's newer vault wrapper.
