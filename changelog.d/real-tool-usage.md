### Tests

- **Real tool usage in the weekly check:** `npm run usage:week` now ends with a line on the MCP tool
  call log (calls, tools used of the catalog, never used, error rate, tools with most errors) and
  `--write-vault` adds the same numbers to the weekly note. `npm run usage:calls` gets `--line`
  for that one line and `--pi` to read the Pi's `_usage` folder over ssh, read-only (I-113).
