### Tooling

- **Every test file runs:** seven test files that no workflow ran (`scripts/dev` usage reports,
  `scripts/wiki/da`, the dnd-helper build and the livekit recorder) now run in CI and in
  `npm run green`, and a new step (`scripts/test-coverage-check.mjs`) fails when a test file is
  reached by no workflow command or known runner.
