### Fixes

- **Web-address player connector opens the helper guide first:** the `/mcp/player` initialize instructions and the `get-player-skill-guide` description now say to call the guide first, with no arguments, and follow it (a skill that names a stubRevision passes it instead), so a chat with no skill installed still opens it before the first answer. The Desktop extension keeps its own guide.
