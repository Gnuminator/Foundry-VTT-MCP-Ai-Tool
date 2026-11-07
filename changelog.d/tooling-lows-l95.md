### Tooling (review lows of #740, #792, #794, #816)

- **Test coverage check:** reads `git ls-files -z` (non-ASCII test names no longer vanish), keys its
  runner list on the real vitest include patterns, and counts a Python test only when its tool
  folder has a `pyproject.toml`; the header lists what it cannot see.
- **Local green:** skips `npm ci` for the Livekit recorder when its `node_modules` is newer than
  the lockfile; the `usage-week` step is called `dev-scripts`.
- **Test environment:** the world.json version bump swaps the file in one step; the session notes
  pass logs a line when the test-only `FVTT_VOICE_STACK` override is set.
- **Weekly usage report test:** the lane-line test uses UTC times and covers 22:59:53Z and 22:59:54Z.
