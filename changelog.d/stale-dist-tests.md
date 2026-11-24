### Fixes

- **Tests that need a build skip when it is stale or missing:** the two MCP wrapper suites skip with a clear message when `dist/index.js` is missing or older than its source (outside CI; CI stays strict and fails instead), and the Pi `check_build_loads` test skips when any module it names is unbuilt, so a missing `discord-bot/dist` no longer fails a lane's checks.
