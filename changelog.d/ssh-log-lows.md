### Fixes

- **Pi SSH log, exact token commands only:** stage 9's wrapper now treats only the exact `set-dashboard-access.sh` and runner-token commands (vault and board) as secret-carrying; anything else, including a token command with `;`, `&`, `|`, a backtick, `$(` or a newline added, keeps its full text in the log. The debug-level warning in the MCP server now names the actual log level. Not yet deployed to the Pi (needs the user's OK and a dietpi-backup).
