### Fixes

- **Plan B and repoint scripts leave a running Claude Desktop alone:** `connectors.ps1` and `repoint-connectors.ps1` now refuse to write the Desktop config while Claude Desktop runs (it rewrites the file when it quits and would undo the change); a dry run still works. The saved-values fallback of `connectors.ps1` only applies to `-To pi` without `-ConfigFile`. Script headers and test notes match the code.
