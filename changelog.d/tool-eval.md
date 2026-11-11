### Tooling

- `npm run tool-eval` runs 22 tool-picking cases through `claude -p` on the subscription (no API key) against a stub that serves the real tool list, and scores hard gates (no write without a yes, no stand-in when a connector is off, Danish replies) and good paths per model.
