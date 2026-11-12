### Tests

- **Vitest 5:** every workspace and the LiveKit recorder run on Vitest 5.1.0 (pinned), with one Vite
  and one esbuild range across the repository, one `vitest.shared.mts` that every Vitest config
  extends, and a `deps:check` guard that fails when a shared dependency uses different ranges.
