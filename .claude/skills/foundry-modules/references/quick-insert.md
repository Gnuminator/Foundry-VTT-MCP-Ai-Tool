# Quick Insert (`quick-insert`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 3.7.8, 2026-10-28 (test server B; the search window as GM and as a player, and the GMs-only setting, were driven live; the sheet filters and drag and drop from results were not).

**Verdict: keep.** Ctrl+Space finds any actor, item, spell, journal, scene or macro in one box, which is what a GM new to Foundry needs most while running a table. One setting must be turned on first: by default a player can search the names of things they cannot see.

**For Danni's guides:** Press Ctrl+Space, type a few letters, and press Enter to open or drag the result onto the map or a sheet.

## What it does

A search widget over the world's documents and every compendium. Results show the document type and its pack; Enter opens it, drag puts it on the canvas, a sheet or a journal. It builds its index when the GM loads the world (a notice about "Building creature index" appears at that moment, from dnd5e's own compendium browser).

## Where its UI is

- Keyboard: Ctrl+Space (`quick-insert.toggleOpen`, rebindable in Configure Controls). Typing in the box searches live; hovering a result shows a card (a longsword showed its reach and properties).
- Configure Settings > Quick Insert: its own menus (not opened); all 24 values are registered as hidden settings.

## Settings we use and why

Keys are `quick-insert.<key>`; every one is registered hidden and edited through the module's own menus.

| Label (client)              | Key                    | Scope | Default | Our value / reason                                                                                                                                      |
| --------------------------- | ---------------------- | ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GMs only                    | `gmOnly`               | world | off     | **on.** Seen live: with it off a Player found the Aboleth, which they have no permission on; with it on the Player client builds no search index at all |
| Character sheet integration | `filtersSheetsEnabled` | world | on      | leave (not tested)                                                                                                                                      |
| Automatic indexing          | `automaticIndexing`    | world | -1      | leave                                                                                                                                                   |
| Index journal pages         | `embeddedIndexing`     | world | off     | leave; on indexes page text, which includes spoiler text, GM only anyway                                                                                |

## How it interacts with the AI Tool

- No interaction. It reads documents; it writes nothing and flags nothing.
- It indexes the same compendiums our `search-compendium` reads, including the licensed PHB module on this PC, so keep `gmOnly` on or players can browse licensed pack names.
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest `compatibility` is minimum 13.341, verified 14.361: current on 14.369.
- **Spoiler leak with the default.** Foundry sends every world actor, scene and journal to a player's client even at permission None, and Quick Insert lists them by name. Opening one shows nothing, but a name such as a hidden villain is itself the spoiler. Turn `gmOnly` on in the Strahd world before any player joins.
- Ctrl+Space can collide with a system or browser shortcut on some PCs; rebind it in Configure Controls.
- The first load builds an index of every pack; with the full Strahd pack list it takes a few seconds (not timed).
- Removing it leaves only its world settings.
- Pi: nothing platform-specific found.

## Sources

- Repo: https://gitlab.com/fvtt-modules-lab/quick-insert
- `C:\FoundryTestB\data\Data\modules\quick-insert\module.json`; settings read live from `game.settings`.
