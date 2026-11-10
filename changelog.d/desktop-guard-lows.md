### Fixes

- **Desktop guard lows:** the Claude Desktop check now loads the installer's process check only when it is needed (a dry run works without the installer file), refuses when that file has a parse error, and the repoint rollback message says to start Claude Desktop, not restart it. Tests now run the real process check under strict mode and cover both saved-values cases (desktop-guard-lows).
