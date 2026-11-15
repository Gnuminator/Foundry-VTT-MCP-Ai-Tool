### Tools

- **Tool usage report:** `usage:calls` and the weekly check now say so when the tool call log is empty because a Claude Desktop connector runs a server build from before call logging existed (the five Desktop connectors on the PC run the 6 Oct build, which is why the log has been empty; the fix there is a new connector build plus `repoint-connectors.ps1`). The weekly line reads "1 call", "last 1 day" and "all days", ranks worst tools by error count, `--pi` with `--dir` is refused, and an unreadable log no longer stops the weekly check (Backlog `tool-usage-lows`).
