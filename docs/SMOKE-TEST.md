# v0.16.0 release — live smoke-test checklist (user-driven)

This is the final acceptance check for the v0.16.0 release. It must be run **by you**, not from a Claude
Code session inside Claude Desktop, because **step 3 restarts Claude Desktop**, which ends any session
running inside it.

> Why you and not the assistant: the MCP server is launched by Claude Desktop. To load the new build,
> Claude Desktop has to restart — and that terminates the in-app Claude Code session. So the assistant
> prepares everything; you run the actual restart-and-verify.

## Before you start

- The GitHub Release for `v0.16.0` exists on
  [Gnuminator/Foundry-VTT-MCP-Ai-Tool](https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases)
  with these assets: `FoundryMCPServer-Setup-v0.16.0.exe`, `foundry-mcp-bridge.zip`,
  `foundry-mcp-server-v0.16.0.zip`, `module.json`.
- Close any Foundry world that has the bridge module enabled (you'll re-open it).

## Checklist

### 1. Install the new MCP server build

- [ ] Download and run `FoundryMCPServer-Setup-v0.16.0.exe` from the v0.16.0 release.
- [ ] Let it update the Claude Desktop MCP config (or confirm your existing config still points at the
      installed server).

### 2. Update the Foundry module to the new repo (one-time)

- [ ] In Foundry → **Add-on Modules** → **Install Module**, paste the new manifest URL:
      `https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases/latest/download/module.json`
- [ ] Confirm it installs/updates to **v0.16.0** and the source now reads `Foundry-VTT-MCP-Ai-Tool`.
      (Full details in [MIGRATION.md](MIGRATION.md).)

### 3. Restart Claude Desktop

- [ ] Fully quit and reopen Claude Desktop so it reloads the new MCP server.
      **(This ends any Claude Code session that was running inside it — expected.)**

### 4. Open Foundry as GM with the bridge enabled

- [ ] Launch the world as the **GM**, with the bridge module enabled.
- [ ] Confirm the bridge connects — the module reports connected and the loopback ports are live
      (`31414` control / `31415` Foundry link). No connection errors in the module status.

### 5. Verify the co-GM dashboard

- [ ] Open the co-GM dashboard.
- [ ] Confirm the **live feed** populates (session events appear).
- [ ] Confirm a **read tool** returns data (e.g. current scene / character list / world info shows real
      values, not an error).

### 6. (Optional) One read via Claude

- [ ] In Claude Desktop, ask for something read-only (e.g. "list the characters in my Foundry world")
      and confirm it returns live data through the new server.

## Pass / fail

- **PASS** — bridge connects on `31414`/`31415`, the dashboard's live feed updates, and a read tool
  returns real data. Record the result and close out Phase 5.
- **FAIL** — note exactly which step failed (and any console/module error text) and report back; a fresh
  Claude Code session can diagnose from there. Common first suspects: manifest/download URL mismatch
  (404 on install), Claude Desktop not actually restarted, or the module not enabled in the world.

## Notes

- The assistant **cannot** observe steps 3–6 (the restart ends its session) — that's by design. Report
  back, or start a fresh session to verify.
- Do **not** run a second backend from a dev session during the test — it would bind `31414`/`31415` and
  collide with the live bridge.
