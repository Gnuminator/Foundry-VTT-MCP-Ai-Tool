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

---

## Cutting a new release (maintainers)

There is one release workflow (`.github/workflows/release.yml`) and one version number: the `version`
in the root `package.json`. `dist/` is git-ignored, so the built module ships as release assets, not
in the repo tree.

1. Set the version everywhere: `npm run version:sync -- --set X.Y.Z`. It stamps every `package.json`,
   `module.json`, `package-lock.json`, `shared/src/version.ts` (`TOOL_VERSION`) and the installer script.
   `npm run version:check` (and the release workflow) fail if any place disagrees.
2. Commit, then tag `vX.Y.Z` (the tag must equal the root version) and push the tag. The workflow
   verifies, builds and publishes one GitHub release with these assets, all under that tag's own links:
   - `module.json` (manifest and download URLs point at this tag)
   - `foundry-mcp-bridge.zip` (the module with its built code)
   - `foundry-mcp-server-vX.Y.Z.zip` (standalone bridge)
   - `FoundryMCPServer-Setup-vX.Y.Z.exe` (Windows installer)

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
