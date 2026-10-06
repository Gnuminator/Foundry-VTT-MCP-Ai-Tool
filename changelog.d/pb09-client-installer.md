### Installer (PB-09)

- **The Windows installer is now a Claude Desktop client installer:** it installs only a portable
  Node.js and the bundled MCP client, and no longer ships or installs the Foundry module or a local
  bridge (no Foundry data-folder detection, no module section). Foundry, the bridge and the module
  run on the home server.
- **It asks for the bridge address** (a host name or IP, for example the server's name on your
  private network; port 31414 by default) on its own page, validates it (not empty, no spaces or
  quotes) and remembers it for the next run. Silent install: `/S /HOST=<name or IP> [/PORT=31414]`.
- **The five Claude Desktop entries** (`foundry-mcp`, `-play`, `-prep`, `-build`, `-admin`) are
  written with `MCP_CONTROL_HOST`, `MCP_CONTROL_PORT` and `MCP_NO_SPAWN=1`. Every other entry and
  key is kept, a timestamped backup is made first, and a damaged config file is left alone instead of
  being recreated. Both the classic `%APPDATA%\Claude` file and the Microsoft Store build's copy
  (`%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude`) are written; the classic one is
  created when none exists.
- **Claude Desktop must be closed** (it rewrites its settings when it quits): the installer asks you
  to quit it from the tray icon and retry, waits up to two minutes in a silent install (exit code 3
  if it is still open) and never closes it. Uninstall removes only the five entries.
- The settings file is read and written as UTF-8 without a BOM (Windows PowerShell 5.1 would
  otherwise garble every non-ASCII character), replaced atomically, and only the newest five
  timestamped backups are kept. The classic `%APPDATA%\Claude` file is created only when no
  Microsoft Store Claude Desktop was found. Process detection fails closed and ignores Claude Code.
  The address is a host name, IPv4 address or bracketed IPv6 literal.
- `configure-claude.ps1` takes `-BridgeHost`, `-BridgePort`, `-Uninstall` and `-ConfigPath` (one file,
  for tests). The batch fallback wrapper, the local `start-server.bat` and `test-connection.bat`
  are gone. The installer ships `node.exe` only (not npm or a second copy of node.exe) and uses LZMA
  compression, so it is much smaller.
- Fixed: the version stamp for the Programs list wrote doubled backslashes into the registry key
  path.
