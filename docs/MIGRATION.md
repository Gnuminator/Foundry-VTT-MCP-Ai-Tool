# Migrating to **Foundry AI Tool** (the new repo)

**Foundry AI Tool** is the new home of the project that used to live at
`Gnuminator/Foundry-VTT-MCP` (itself a fork of `adambdooley/foundry-vtt-mcp`). The canonical repository
is now:

> https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool

## TL;DR

- **Nothing breaks.** The Foundry module id (`foundry-mcp-bridge`), the socket channel, the settings
  namespace, and the query method names are all **unchanged**. An existing install keeps working with no
  data migration.
- **The only thing that moved is where updates come from.** Your installed module's manifest URL still
  points at the **old** repo, so Foundry keeps checking the old repo for updates. To get updates from the
  new repo, do a **one-time reinstall** from the new manifest (below).

## Why a reinstall is needed

Foundry stores the **manifest URL** inside each installed module and polls _that_ URL for updates. A
module installed from the old repo has the old manifest URL baked in, so it will never see releases
published to the new repo — even though it's the same module id. Reinstalling from the new manifest
rewrites that stored URL; from then on, updates flow from the new repo automatically.

Because the module id is identical, Foundry treats the new install as the **same module** — your world
settings, enabled state, and any data tied to the module are preserved.

## One-time migration steps (Foundry module)

1. In Foundry, go to **Add-on Modules**. (Optional) note that the old version is installed and enabled.
2. **Install from the new manifest.** Click **Install Module**, and in the _Manifest URL_ field paste:

   ```
   https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases/latest/download/module.json
   ```

   Installing over the existing module id updates it in place. (If your Foundry version refuses to
   overwrite, uninstall the old one first — your world data is unaffected because it's keyed to the
   module id, which is unchanged — then install from the manifest above.)

3. Confirm the installed version is **v0.16.0** (or newer) and that the source/manifest now points at
   `Foundry-VTT-MCP-Ai-Tool`.
4. Restart Foundry (or reload the world) and re-enable the module if needed.

> Once installed from the new manifest, future releases from the new repo will show up in Foundry's
> normal "Update" flow — no manual manifest entry again.

## MCP server side (Claude Desktop)

The MCP server is installed separately (Windows NSIS installer or the standalone server ZIP) and talks to
the module over the bridge on the loopback ports (`31414` control / `31415` Foundry link) — these are
**unchanged**. To move to the new build:

1. Download the new installer (`FoundryMCPServer-Setup-v0.16.0.exe`) or the standalone server ZIP from
   the new repo's
   [latest release](https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases/latest).
2. Run it (the installer updates the Claude Desktop MCP config automatically; the standalone ZIP requires
   the manual Claude Desktop config already in place).
3. **Restart Claude Desktop** so it reloads the MCP server.

## Verifying the migration

After reinstalling both sides and restarting Claude Desktop:

- Open Foundry as the GM with the bridge module enabled and confirm it connects (bridge status / ports
  `31414` + `31415`).
- Open the co-GM dashboard and confirm the live feed appears and a read-only tool returns data.

(That live check is also the release smoke test — see `docs/SMOKE-TEST.md`.)

## Notes

- The old repo (`Gnuminator/Foundry-VTT-MCP`) is **retired**; its v0.15.0 release stays up for anyone who
  hasn't migrated, but it will not receive new releases.
- Upstream attribution is preserved in [CREDITS.md](../CREDITS.md). Upstream
  (`adambdooley/foundry-vtt-mcp`) is unaffected and is not part of this migration.
