### Fixes

- **`npm run docs:tools -- --check`:** exits non-zero when a generated tool reference page is stale and writes nothing (also `npm run docs:tools:check`). The unit step of CI and `npm run green` already ran the same comparison through the mcp-server test, so no new CI step is added.
