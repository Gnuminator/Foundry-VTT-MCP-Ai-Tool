### Fixes

- **Tool errors are errors:** a wrong or missing parameter on chat, rolls, saving throws, rests, initiative, distance and the module manifest now comes back as a real tool error, so Claude and the call log see it as a failure instead of a successful answer (backlog `lows-mcp-tools-2026-11-21`).
- **Claude is told when the tool list changes:** after the bridge restarts on another build or with other switches, the connector sends `tools/list_changed` so the new list shows without restarting Claude. The connector's reconnect is now single-flight, and a call to a hung bridge ends after 10 minutes.
- **Timed conditions:** exhaustion with `ends` says to leave `ends` out (not `rounds`); a fight that has not started says so instead of "not in the fight"; the start stamp comes from the same fight as the turn holder; the plan line says the timer counts from now, so plan again if the turn moves first.
