# Game-day brief (scheduled task)

`SKILL.md` is the definition. On the tool admin's PC, in Claude Desktop, create a scheduled task
named `game-day-brief-<date>` with that text as its prompt and a one-time `fireAt` (or a cron) two
hours before the game night. The G0 run is `game-day-brief-2026-11-22`, 17:00 local.

- **Read-only:** set the task's tool permission to exactly `get-preflight`, `get-prep-digest` (prep
  connector) and `PushNotification`. The prep connector also serves write tools, and the digest
  quotes prep notes, so the permission list, not the prose, is the guard. `scripts/game-day-brief.test.mjs`
  checks that the definition names only those tools and that both are read tools.
- **Who gets it:** the push goes to the Claude account owner's PC and phone (phone only with Remote
  Control on), that is the tool admin, who tells the GM if something is red.
- **Needs:** Claude Desktop open and the bridge answering; otherwise the line says so. It uses the
  subscription, never the paid API (D-066).
