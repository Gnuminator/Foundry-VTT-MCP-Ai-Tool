### Dashboard

- **Download my helper:** the player's own `/me` page has a button that hands them a ready `foundry-player.mcpb` made for them, with their own endpoint, Client ID and Client Secret already inside (no form to paste into). It is built per request, never stored or logged, sent with `Cache-Control: no-store`, and only to the logged-in player for their own pair (404 for a player with no pair). The generic file and the paste route stay as the fallback. `npm run player-preset -- --player <name>` makes the same file by hand from the connector config (Backlog `player-preset-download`).

### Docs

- **Player guide:** installing the helper is now: install Claude Desktop, open My character, Download my helper, double-click the file, restart (English and Danish).
