### Remote access

- **GM tool sets as remote connectors:** the dashboard serves `/mcp/core`, `/mcp/play`, `/mcp/prep`, `/mcp/build` and `/mcp/admin`, one path per tool set, so the same five sets can be added to Claude as custom connectors without the local installer. Off unless `FOUNDRY_AI_GM_CONNECTOR=on`; login is a Cloudflare Access Managed OAuth token for the GM application (`FOUNDRY_AI_GM_CONNECTOR_CONFIG` names its audience and, optionally, the allowed emails). Same tool budgets, same plan, confirm and undo. Tested on the test bridge only; nothing deployed (remote-gm-connector).
