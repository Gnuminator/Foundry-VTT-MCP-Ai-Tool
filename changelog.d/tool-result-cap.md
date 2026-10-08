### MCP server (D-109)

- **One size cap for every tool result Claude gets:** a result over 100,000 characters (Claude Desktop handles about 150,000 per call) is cut, with a note that says how much was left out, that the JSON is incomplete, and how to ask for less or a different part, naming the tool's own parameters (`limit`, `since` and the like first). Only the Claude Desktop entries apply it; the dashboard still reads every result in full. Tests cover the guard and the tools whose results grow with the world (chat log, session log, changes, compendium and creature searches, journals).
