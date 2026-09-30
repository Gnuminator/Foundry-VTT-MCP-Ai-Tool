# Deployment

The bridge has two halves that are deployed differently:

1. **Foundry module** — installs into the Foundry server (incl. hosted, e.g. Molten-Hosting).
2. **MCP server** — runs locally next to Claude Desktop.

---

## 1. Foundry module — Manifest URL install (recommended)

The module is published as a GitHub Release on the fork, so it installs like any other Foundry module.

**In Foundry:** Setup → **Add-on Modules** → **Install Module** → paste this in the _Manifest URL_
field → Install:

```
https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases/latest/download/module.json
```

This works on hosted Foundry (Molten-Hosting) — no file-manager/SFTP access needed. Foundry reads the
manifest, downloads `foundry-mcp-bridge.zip`, and installs it. "Check for Updates" will pull future
releases automatically because the manifest uses `releases/latest/download/`.

> The module folder **must** stay named `foundry-mcp-bridge` — the MCP backend routes sockets to that id.

## 2. MCP server — Claude Desktop

The server runs locally. Point Claude Desktop's `claude_desktop_config.json` at the bundled entry:

```json
{
  "mcpServers": {
    "foundry-mcp": {
      "command": "<node>",
      "args": ["<repo>/packages/mcp-server/dist/index.bundle.cjs"],
      "env": {}
    }
  }
}
```

Build it with `npm run build && npm run bundle:server`. Restart Claude Desktop after changing the config.
(Packaging the server with its own installer/release is future work — see ROADMAP.)

### Pointing Claude Desktop at a bridge that runs elsewhere

By default the Claude Desktop entry (`index.js` / `index.bundle.cjs`) connects to the bridge on
`127.0.0.1:31414` and, if nothing answers, starts a backend itself. When the bridge runs on another
machine (for example the Orange Pi, reached over Tailscale), set these in the `env` block:

| Variable           | Default     | Meaning                                                                                            |
| ------------------ | ----------- | -------------------------------------------------------------------------------------------------- |
| `MCP_CONTROL_HOST` | `127.0.0.1` | Host of the bridge control channel.                                                                |
| `MCP_CONTROL_PORT` | `31414`     | Port of the bridge control channel.                                                                |
| `MCP_NO_SPAWN`     | unset       | `1` or `true`: never start a backend from this entry, only connect to one that is already running. |

A backend is also never started when `MCP_CONTROL_HOST` is not a loopback address (`127.0.0.1`,
`::1`, `localhost`), because a backend started on this PC would not be the one at that address.
When the bridge cannot be reached and spawning is off, every tool call answers "The Foundry AI Tool
bridge is not reachable at HOST:PORT. Start it (or check the address) and try again." and the tool
list is empty.

```json
"env": { "MCP_CONTROL_HOST": "100.64.0.7", "MCP_CONTROL_PORT": "31414" }
```

---

## Cutting a new release (maintainers)

`dist/` is git-ignored, so the **built** module ships as release assets, not in the repo tree.

1. Bump the version in `packages/foundry-module/module.json` and the four `package.json` files.
2. Build + package:
   ```bash
   npm run build
   npm run bundle:server          # refreshes dist/index.bundle.cjs for the MCP server
   ```
   Then stage the module (manifest + built dist + lang/styles/templates) and zip it so `module.json`
   sits at the archive root, producing `foundry-mcp-bridge.zip`.
3. Create a GitHub Release tagged `vX.Y.Z` on `main` and upload **two assets**, named exactly:
   - `module.json` (the fork-URL manifest)
   - `foundry-mcp-bridge.zip`

   The asset names must match the `manifest`/`download` URLs in `module.json`
   (`releases/latest/download/module.json` and `.../foundry-mcp-bridge.zip`).

   Via the web UI: drag-drop both files onto a new release. Via `gh`:

   ```bash
   gh release create vX.Y.Z module.json foundry-mcp-bridge.zip -t "vX.Y.Z" -n "<notes>"
   ```

4. Verify: `curl -sIL .../releases/latest/download/module.json` returns HTTP 200.

## Repository

- Remote `aitool` → `https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool` (canonical — push here).
- Remote `fork` → `https://github.com/Gnuminator/Foundry-VTT-MCP` (old fork — retire/archive).
- Push work with `git push aitool <branch>:main`.
