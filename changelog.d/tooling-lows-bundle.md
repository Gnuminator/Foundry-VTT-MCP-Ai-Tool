### Fixes

- **Tooling review lows:** `tsc7.mjs` prints a spawn error or the signal that stopped the compiler;
  `typescript` is held at `~6.0.3` (typescript-eslint caps below 6.1) and the `typescript7` alias is
  pinned to exactly 7.0.2; the CI checks list flags `defaults.run.working-directory` too, and the
  gate's drift-check copy is guarded by a test; the screenshot README matches the `#status` mask and
  the private-handout locator is scoped; the CodeQL cache cleanup rechecks up to six times, 10 seconds
  apart, before failing on a cache that is still being deleted.
