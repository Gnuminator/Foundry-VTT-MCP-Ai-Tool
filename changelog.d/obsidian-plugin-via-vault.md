### Orange Pi

- **The Obsidian plugin follows the server (stage 33):** a new stage writes the release's plugin files (`main.js`, `manifest.json`, `styles.css`, never `data.json`) into the GM vault on the Pi, and Syncthing carries exactly those three files to the GM's PC, so the plugin updates with no hand step (restart Obsidian to load it). The vault's ignore list (stage 7, the sync guide, `setup-syncthing-pc.ps1`) lets exactly those files through. The stage is read-only with `CHECK=1`, tested against two real Syncthings in the ARM64 container, and not run on the Pi yet.

### Docs

- **GM guides:** the Obsidian sync guide (English and Danish) has the three new ignore lines, the plugin setup page says the plugin arrives through the vault, and the Claude Desktop update note no longer claims what it did not.
