### Fixes

- **Tool call log (D-126, I-113):** every MCP tool call writes one line (time, tool, tool set, ms, result size, ok or error, no arguments) to `<data folder>/_usage/<date>.calls.jsonl`. `npm run usage:calls` counts calls per tool and set, errors, slowest calls, so the tool sets can be trimmed on data. `FOUNDRY_AI_USAGE_LOG=off` turns it off.
