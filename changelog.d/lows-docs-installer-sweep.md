### Installer

- **Claude Code no longer blocks the client auto-update:** the updater only counts Claude Desktop as running, not Claude Code's `claude.exe` (under `.local\bin`, `.claude` or `node_modules`). A failed launch of the updater at sign-in is now written to `update.log`, and the updater header says the checksum is an integrity check only.

### Docs

- **Tool-set sizes refreshed:** `docs/reference/TOOL-SETS.md` now shows the measured sizes of every set and the total. The room whisper line in the GM guide (English and Danish) no longer says players see nothing at all.
