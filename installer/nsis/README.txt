Foundry AI Tool Client
======================

This installer connects Claude Desktop on this PC to a Foundry AI Tool bridge that runs on
another machine (the home server). Foundry, the bridge and the Foundry module live on that
machine, so none of them is installed here. This PC gets:

  - node.exe, the Node.js runtime that runs the client
  - foundry-mcp-client\index.cjs, the MCP client Claude Desktop starts
  - configure-claude.ps1, which edits Claude Desktop's settings

QUICK START
-----------
1. Quit Claude Desktop completely (right-click its tray icon, Quit). The installer will ask
   again if it is still running; it never closes Claude Desktop for you.
2. Run the installer and enter the bridge address: the name or IP address of the server on your
   private network (for example its Tailscale name). The port is 31414 unless you were told
   otherwise. A Cloudflare route for players and GMs outside the private network is planned.
3. Start Claude Desktop. Make sure your private network (Tailscale) is connected, then switch
   the connectors on in the "Search and tools" menu.

Claude Desktop gets five connectors, one per tool set: foundry-mcp (Core), foundry-mcp-play,
foundry-mcp-prep, foundry-mcp-build and foundry-mcp-admin. Each one only connects to the bridge
and never starts a bridge on this PC (MCP_NO_SPAWN=1).

SILENT INSTALL
--------------
  FoundryMCPServer-Setup-vX.Y.Z.exe /S /HOST=<name or IP> [/PORT=31414] [/D=<folder>]

/HOST is required with /S. The installer waits up to two minutes for Claude Desktop to quit; if
it is still running, the Claude Desktop step is skipped and the exit code is 3. Exit code 2 means
the address was missing or invalid. /D must be the last parameter and the folder must not be in
quotes.

CHANGING THE ADDRESS
--------------------
Run the installer again. It remembers the last address. The old entries are replaced, and every
other connector in Claude Desktop's settings is left alone. A backup of each settings file
(claude_desktop_config.json.backup-<date>) is made first.

Both the classic Claude Desktop (%APPDATA%\Claude) and the Microsoft Store version
(%LOCALAPPDATA%\Packages\Claude_...\LocalCache\Roaming\Claude) are handled.

UNINSTALL
---------
Settings, Apps (or Start Menu, Foundry AI Tool Client, Uninstall). It removes only the five
Foundry AI Tool entries from Claude Desktop's settings and the files it installed.

TROUBLESHOOTING
---------------
- The log is %TEMP%\foundry-mcp-claude-config.log.
- "The bridge is not reachable" in Claude: check that Tailscale is connected and that the
  address is right (run the installer again to change it).
- The connectors are missing after the install: Claude Desktop was probably still running and
  rewrote its settings when it closed. Quit it completely and run the installer again.

SUPPORT
-------
Documentation: https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool
Issues: https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/issues
