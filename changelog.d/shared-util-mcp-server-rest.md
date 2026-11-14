### Fixes

- **One `escapeHtml` and `sleep` in shared:** the MCP server's Tarokka text and guarded-write polling use the shared helpers instead of private copies (Backlog `shared-util-dedupe`).
