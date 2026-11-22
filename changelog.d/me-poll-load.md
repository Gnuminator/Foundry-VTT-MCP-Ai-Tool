### Dashboard

- **Player pages poll lighter:** `/api/me` and the party stash share one sheet read per player,
  remembered for 4 seconds and cleared on a game event, a roll or a portrait change. The stash reads
  all players at once instead of one after another (item me-poll-load).
