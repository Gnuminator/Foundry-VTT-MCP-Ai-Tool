# Deployment

The bridge has two halves that are deployed differently:

1. **Foundry module** — installs into the Foundry server (incl. hosted, e.g. Molten-Hosting).
2. **MCP server** — runs locally next to Claude Desktop.

---

## 1. Foundry module — Manifest URL install (recommended)

The module is published as a GitHub Release on the fork, so it installs like any other Foundry module.

**In Foundry:** Setup → **Add-on Modules** → **Install Module** → paste this in the _Manifest URL_
field → Install:

```text
https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases/latest/download/module.json
```

This works on hosted Foundry (Molten-Hosting) — no file-manager/SFTP access needed. Foundry reads the
manifest, downloads `foundry-mcp-bridge.zip`, and installs it. "Check for Updates" will pull future
releases automatically because the manifest uses `releases/latest/download/`.

> The module folder **must** stay named `foundry-mcp-bridge` — the MCP backend routes sockets to that id.

## 2. MCP server — Claude Desktop

The server runs locally. Point Claude Desktop's `claude_desktop_config.json` at the bundled entry,
once per tool set (see [TOOL-SETS.md](../reference/TOOL-SETS.md)):

```json
{
  "mcpServers": {
    "foundry-mcp": {
      "command": "<node>",
      "args": ["<repo>/packages/mcp-server/dist/index.bundle.cjs"],
      "env": { "FOUNDRY_AI_TOOL_SETS": "core" }
    },
    "foundry-mcp-prep": {
      "command": "<node>",
      "args": ["<repo>/packages/mcp-server/dist/index.bundle.cjs"],
      "env": { "FOUNDRY_AI_TOOL_SETS": "prep" }
    }
  }
}
```

The other entries are `foundry-mcp-play`, `foundry-mcp-build` and `foundry-mcp-admin` with their set
names. Without `FOUNDRY_AI_TOOL_SETS` an entry serves every tool. Environment settings such as
`MCP_CONTROL_HOST` go into every entry.

Build it with `npm run build && npm run bundle:server`. Restart Claude Desktop after changing the config.

### The Windows client installer

For a GM's PC when the bridge runs on a home server there is a small installer,
`FoundryMCPServer-Setup-vX.Y.Z.exe` (built from `installer/`). It installs only a portable Node.js
and the bundled client, and writes the five entries above with `MCP_CONTROL_HOST`,
`MCP_CONTROL_PORT` and `MCP_NO_SPAWN=1` (see the next section). It does not install Foundry, the
Foundry module or a local bridge. It asks for the bridge address, which for now is the server's
name on your private network (for example its Tailscale name); a Cloudflare route is planned.

- **Silent install:** `FoundryMCPServer-Setup-vX.Y.Z.exe /S /HOST=<name or IP> [/PORT=31414]`.
  Exit code 3 means Claude Desktop was still running after two minutes, 2 means the address was
  missing or invalid.
- **Claude Desktop must be closed** while the installer writes its settings (Claude Desktop
  rewrites them when it quits). The installer asks you to quit it from the tray icon and retry; it
  never closes it. It backs up each settings file first and keeps every other entry.
- **Config files:** the classic `%APPDATA%\Claude\claude_desktop_config.json` and the Microsoft
  Store build's copy under `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\`; every one
  that exists is written, and the classic one is created when none does.
- **Uninstall** removes only the five entries.
- `installer/nsis/configure-claude.ps1` does the editing and can be run by hand
  (`-InstallDir`, `-BridgeHost`, `-BridgePort`, `-Uninstall`, `-ConfigPath` for a single file).

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

There is one release workflow (`.github/workflows/release.yml`) and one version number: the `version`
in the root `package.json`. `dist/` is git-ignored, so the built module ships as release assets, not
in the repo tree.

1. Set the version everywhere: `npm run version:sync -- --set X.Y.Z`. It stamps every `package.json`,
   `module.json`, `package-lock.json`, `shared/src/version.ts` (`TOOL_VERSION`) and the installer script (`installer/nsis/foundry-mcp-server.nsi`).
   `npm run version:check` (and the release workflow) fail if any place disagrees.
2. Commit, then tag `vX.Y.Z` (the tag must equal the root version) and push the tag. The workflow
   verifies, builds and publishes one GitHub release with these assets, all under that tag's own links:
   - `module.json` (manifest and download URLs point at this tag)
   - `foundry-mcp-bridge.zip` (the module with its built code)
   - `foundry-mcp-server-vX.Y.Z.zip` (standalone bridge)
   - `FoundryMCPServer-Setup-vX.Y.Z.exe` (Windows client installer: Node.js, the MCP client and the
     Claude Desktop entries; no bridge, no Foundry module)

   A manual run of the workflow (Actions, Release, Run workflow) builds everything as artifacts
   without publishing.

3. Verify: `curl -sIL https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases/download/vX.Y.Z/module.json`
   returns HTTP 200. The committed `module.json` keeps `releases/latest/download/...` URLs so
   Foundry's "Check for Updates" follows the newest release.

Nothing is sent to foundryvtt.com: the package id belongs to the upstream project.

## Repository

- Remote `aitool` → `https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool` (canonical — push here).
- Remote `fork` → `https://github.com/Gnuminator/Foundry-VTT-MCP` (old fork — retire/archive).
- Push work with `git push aitool <branch>:main`.
