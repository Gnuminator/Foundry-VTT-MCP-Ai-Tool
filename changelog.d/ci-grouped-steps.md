### Tests

- **CI runs checks in groups:** the build-test job calls eight groups, and the ARM job one, with `node scripts/checks.mjs --run <group>` instead of about eighty steps. A group runs every check in it, names each red one, and writes a table of checks and seconds to the job summary. The Pi container matrix is generated from `scripts/checks.mjs` too. Adding a test is one line in `scripts/checks.mjs`; a test fails if `ci.yml` holds a test command outside such a call. The three required check names are unchanged.
