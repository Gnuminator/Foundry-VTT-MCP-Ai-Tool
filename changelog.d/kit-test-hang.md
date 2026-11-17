### Fixes

- **Test kit no longer hangs CI:** `kit:test` has a per-test timeout, and the sync-watch build test lets go of its child pipes so a leftover esbuild cannot keep the run alive.
