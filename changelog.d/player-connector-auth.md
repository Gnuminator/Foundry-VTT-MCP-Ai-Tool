### Player connector

- **Per-player login (D-136):** the dashboard serves a read-only `/mcp/player` endpoint that is off
  unless `FOUNDRY_AI_PLAYER_CONNECTOR=on`. Each player is a Cloudflare Access service token; the
  dashboard checks the signed token against the player application, maps its Client ID to one
  Foundry user from the Pi's `player-connector.json`, and runs the five player tools for that user
  only. A GM login, an unknown token or a user Foundry does not list as a player gets a bare 401
  or 403.
- **Your Claude connector:** a player's own `/me` page shows their Client ID and Secret with copy
  buttons, never anyone else's.
