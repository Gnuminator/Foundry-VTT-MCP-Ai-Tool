# Player connector (Claude Desktop extension)

A `.mcpb` extension that lets a player's own Claude Desktop reach the read-only player endpoint
(`/mcp/player`) through Cloudflare Access (D-136). It speaks MCP on stdio and forwards each request
as JSON-RPC over HTTPS with two headers, `CF-Access-Client-Id` and `CF-Access-Client-Secret`, taken
from the extension's settings (both marked sensitive, so Claude Desktop keeps them in the Windows
credential store). Tool definitions come from the server, so this file does not change when a tool
does. One file, no dependencies; Claude Desktop runs it with its own Node.

- Build: `npm run player-connector` writes `tools/player-connector/dist/foundry-player.mcpb`. Set
  `FOUNDRY_PLAYER_ENDPOINT=https://...` first to pre-fill the endpoint address.
- Test: `node --test tools/player-connector/build.test.mjs` (a fake local endpoint; checks headers,
  error text and that no secret reaches stdout or stderr).
- Never logs or prints a secret; refuses plain `http` except to localhost.
- Install: double-click the file in Claude Desktop, paste the two values. The step-by-step guide is
  `docs/player/dnd-helper.md` (item `player-skill-zip`).
