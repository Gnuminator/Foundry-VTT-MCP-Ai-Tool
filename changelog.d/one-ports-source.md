### Tests

- **One source for ports:** every live, test and rehearsal port is in `shared/src/ports.ts`, with
  `shared/ports.json` for scripts. The bridge, dashboard and standalone defaults read from it, the
  voice stack and LiveKit scripts take their forbidden-port list from it (their READMEs now list
  the test server B and C ports too), and a test fails on a new port literal in production code.
