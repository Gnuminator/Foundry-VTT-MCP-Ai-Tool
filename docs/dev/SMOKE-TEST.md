# Release smoke test: the Windows client installer (user-driven)

The acceptance check for a release's `FoundryMCPServer-Setup-vX.Y.Z.exe`, which installs only the
Claude Desktop client (Node.js and the MCP client) and points Claude Desktop at a bridge that runs
on another machine. It must be run **by you**, not from a Claude Code session inside Claude Desktop,
because the installer needs Claude Desktop closed and **step 3 restarts it**, which ends any session
running inside it.

> Why you and not the assistant: Claude Desktop rewrites its settings when it quits, so the installer
> only writes them while Claude Desktop is closed, and the new connectors load only after a restart.
> That ends the in-app Claude Code session. The assistant prepares everything; you run the
> install-and-restart.

## Before you start

- The GitHub Release for `vX.Y.Z` exists on
  [Gnuminator/Foundry-VTT-MCP-Ai-Tool](https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases)
  with these assets: `FoundryMCPServer-Setup-vX.Y.Z.exe`, `foundry-mcp-bridge.zip`,
  `foundry-mcp-server-vX.Y.Z.zip`, `module.json`.
- The bridge and Foundry are running on the home server with the module active in the world, and this
  PC can reach the server over your private network (for example Tailscale is connected).
- You know the bridge address: the server's name or IP address on that network (port 31414).

## Checklist

### 1. Close Claude Desktop

- [ ] Quit Claude Desktop completely (right-click its tray icon, **Quit**). The installer will not
      close it for you.

### 2. Run the installer

- [ ] Run `FoundryMCPServer-Setup-vX.Y.Z.exe`. On the **Bridge address** page enter the server's name
      or IP address (leave the port at 31414). An empty address, a space or a quote is refused.
- [ ] The installer finishes without an error box. If it says Claude Desktop is running, quit it and
      click **Retry**.
- [ ] `%TEMP%\foundry-mcp-claude-config.log` says "The bridge answered." (a warning that the bridge did
      not answer means the address or the private network is wrong).
- [ ] Claude Desktop's settings file now holds five `foundry-mcp*` entries with
      `MCP_CONTROL_HOST`, `MCP_CONTROL_PORT` and `MCP_NO_SPAWN`, and your other connectors are still there.

### 3. Start Claude Desktop

- [ ] Start Claude Desktop. In the **Search and tools** menu the five Foundry AI Tool connectors
      (Core, Play, Prep, Build, Admin) are listed; switch Core on.
      **(Anything that was running inside Claude Desktop ended when you quit it: expected.)**

### 4. Read through Claude

- [ ] Ask for something read-only (for example "list the characters in my Foundry world") and confirm it
      returns live data from the server.
- [ ] Open the dashboard on the server and confirm the live feed shows the request.

### 5. Uninstall (optional)

- [ ] With Claude Desktop closed, uninstall from Windows Settings, Apps. Only the five Foundry AI Tool
      entries disappear from Claude Desktop's settings; other connectors stay.

## Pass / fail

- **PASS:** the connectors appear, a read tool returns real data from the server, and the dashboard's
  live feed updates. Record the result.
- **FAIL:** note exactly which step failed and any text from the log
  (`%TEMP%\foundry-mcp-claude-config.log`) and report back; a fresh Claude Code session can diagnose
  from there. Common first suspects: wrong address or Tailscale not connected ("The Foundry AI Tool
  bridge is not reachable" in Claude), Claude Desktop still running during the install (the
  connectors are missing), or the module not enabled in the world.

## Notes

- The assistant **cannot** observe steps 3 to 5 (the restart ends its session). Report back, or start a
  fresh session to verify.
- For a silent install use `/S /HOST=<name or IP>` (see `installer/nsis/README.txt`).
