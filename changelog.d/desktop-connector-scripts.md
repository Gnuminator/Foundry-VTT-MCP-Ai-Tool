### Setup

- **Claude Desktop connector updates in two scripts:** `scripts/desktop/build-connector.ps1` builds the
  connector from a git ref into its own `foundry-mcp-server-<sha>` folder next to the older ones (with a smoke
  check on the test port), and `scripts/desktop/repoint-connectors.ps1` points the five `foundry-mcp*` entries
  at it. The repoint shows a dry run first, backs the config up before it writes, can put the backup back, and
  never restarts Claude Desktop.
