### Tests

- **Port ratchet and the scripts' port lists:** the port-literal ratchet ignores durations (only a timer's delay argument, named timeouts and sleeps) and also scans `.py`, `.yml`, `.env.example`, `.bat` and `.cmd`. The forbidden list adds the rehearsal row and the Control Center port. Plan B's reserved ports and the Pi drill's refused ports now read `shared/ports.json`, and test-env-safety evaluates the `ports.json` path chain of the voice-stack, livekit and drill scripts under pwsh.
- **Mock weapon activities:** a mock weapon item has `system.activities` as an object keyed by id, so the captured-shapes pin runs instead of being skipped.
- **visual-baselines start check:** the script uses the same entry check as the other scripts (real paths, mismatch exits 1).
