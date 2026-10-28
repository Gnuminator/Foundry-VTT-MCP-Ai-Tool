### MCP server (I-138)

- **MCP SDK 1.32.2:** the five connectors run on `@modelcontextprotocol/sdk` 1.32.2 (was 1.29.0 in the lockfile), and the range in `packages/mcp-server/package.json` is now `^1.32.2` instead of `^1.10.0`. No behaviour change for our tools; it keeps us on the v1 line's latest fixes until we move to the MCP 2026-07-28 protocol revision.
