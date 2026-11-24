### Test kit

- **Pi measurements:** `node scripts/test-kit/pi-measure.mjs --not-game-night` times the dashboard's read calls (prep digest, preflight, state, first load) against a Pi kit session and samples CPU per systemd unit over read-only ssh. Nothing is written or applied on the Pi (I-098; the first numbers are in the speed pass note).
