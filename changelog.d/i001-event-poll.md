### MCP server (I-001)

- **`wait-for-game-event` (Play set):** Claude can wait for the next game event of a kind (combat
  turn, scene change, roll, damage, condition and the other session event types) instead of polling
  `get-recent-events` in a loop. It returns as soon as the event pump logs a match, or empty after
  25 seconds (at most 45), and hands back a `latestTimestamp` to pass as `sinceTimestamp` so nothing
  between two calls is lost. It sleeps on the existing event pumps and never queries Foundry, so it
  adds no load; at most four waits run at once, and a wait ends when its connection closes.
