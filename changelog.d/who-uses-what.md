### Usage

- **Who uses what:** the bridge now writes the tool call log itself, so each line says who made the
  call (the GM, or a player's Foundry user id from the verified login) and, for a skill guide, which
  skill and stub revision. It keeps which version of the connector, the player helper, the Obsidian
  plugin (a random install id per PC) and the Claude app each person runs, and a GM-only report
  (`GET /api/who-uses-what`, `node scripts/who-uses-what.mjs`) joins it with the dashboard and Foundry
  control use, the tools never called and the error rate per tool. Counts only: never typed text,
  tool arguments or results (D-146; item `who-uses-what`, closes `real-tool-usage`).
