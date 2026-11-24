### Fixes

- **Tests that need a build skip when it is stale or missing:** the two MCP wrapper suites skip with a clear message when `dist/index.js` is missing or older than its source, and the Pi `check_build_loads` test skips when any module it names is unbuilt. CI (`GITHUB_ACTIONS`) stays strict and fails instead.
