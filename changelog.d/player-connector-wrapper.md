### Player connector

- **Desktop extension for players:** `npm run player-connector` builds `foundry-player.mcpb`, an
  extension for Claude Desktop that forwards MCP requests to the read-only player endpoint over
  HTTPS with the player's own Cloudflare Access login. The two login values are kept as sensitive
  settings and are never printed or logged; refusals, a missing network and timeouts come back as
  plain text. Server side and install guide are separate items (D-136).
