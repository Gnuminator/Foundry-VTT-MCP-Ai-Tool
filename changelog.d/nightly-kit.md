### Tests

- **The test kit runs once a day on its own:** `scripts/test-kit/register-nightly.ps1` now registers a Windows task that starts 10 minutes after each logon (this PC is not on all night) and runs `kit-run.mjs --daily`, which does nothing when a run already finished that day. It uses test server B's lock, so lanes on server A are never stopped, and a lane holding B only makes it record a skipped run.
- **The planner sees the result:** `backlog.mjs status --planner` prints a "Nightly kit" line from `last-run.json` (result, age, failing scenarios, a STALE flag after 36 hours).
