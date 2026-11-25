### Tooling

- **New-tool hook:** a PostToolUse hook prints the steps a new MCP tool still needs (one `set`, live sweep step or recorded skip, tool reference pages and count tests, write gate) when an edit adds a name to a tool module's `tools` map, and stays silent otherwise.
