### Tests

- **One table for ports:** the live, test and rehearsal ports are in `shared/src/ports.ts`, with
  `shared/ports.json` for scripts. The bridge, dashboard and standalone defaults read from it, the
  voice stack and LiveKit scripts take their forbidden-port list from it (their READMEs now list
  the test server B and C ports too), and a test fails on a new port literal in production code.
  Plan B's and the Pi drill's own lists are still separate copies, checked against `servers.json`.
