### Tooling (checks-single-list)

- **One list of checks:** `scripts/checks.mjs` now holds every CI command, `npm run green` step and drift-check
  guard once, with a name, a group and the drift flags. `green.mjs` reads its steps and heavy list from it;
  `green.test.mjs` parses `ci.yml` with a YAML parser (`js-yaml`, now a dev dependency) and fails when CI and the
  list differ, and when `drift-check.mjs` stops matching the list. `node scripts/checks.mjs --list` prints it.
