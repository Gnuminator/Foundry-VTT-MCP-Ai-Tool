### Tools (I-152)

- **`search-rules` (core, read-only):** full-text search of rulebook journal pages and item, spell and feature descriptions, limited to an allowlist of packages (setting "Rules search packs"; default the Player's Handbook module, `aitool-content` and the dnd5e SRD). World journals and other packs are searched only when asked. Returns the page or item id with a short snippet; the full text comes from `get-compendium-item` or `list-journals`. The `rules-question` prompt now starts with it.
