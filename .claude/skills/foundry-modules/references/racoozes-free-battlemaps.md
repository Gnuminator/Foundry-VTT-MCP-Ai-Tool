# Racooze's Free Battlemaps (`racoozes-free-battlemaps`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 1.2.0, 2026-10-28 (loaded on test server A and the pack read from the live client; an import was not tried, marked "(not verified)").

**Verdict: optional.** Version 1.2.0 is a free Scene compendium with no code, no settings and no network, so it cannot break anything. It is useful for quick encounters, but about 77 MB of images ride along and imported scenes keep pointing into the module folder.

**For Danni's guides:** Open the Compendium tab, find Racooze's Free Battlemaps and drag a map into your scenes when you need a quick battle.

## What it does

A pack of ready-made battlemaps (Scene documents), free from Racooze. According to the manifest each map carries a logo roof tile that the GM may delete or hide. The live client lists 63 scenes in the pack (my first estimate of about 41 from a byte scan was wrong).

## Where its UI is

Compendium sidebar > the "Racooze's Maps" folder > "Racooze's Free Battlemaps" (type Scene). Players can look inside (observer); GMs import with drag and drop or the Import button. The setup screen shows a thumbnail.

## Settings we use and why

None. The module registers no settings and has no menu.

## How it interacts with the AI Tool

- `list-compendium-packs` lists one Scene pack. Whether `search-compendium` finds Scene entries is not known (not verified live).
- After a GM imports a map it is a normal Scene for `list-scenes` and the scene tools.
- No journals, chat or media tools are involved. No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Verified on Foundry 14; Scene packs in the usual LevelDB format.
- Imported scenes use image paths inside `modules/racoozes-free-battlemaps/assets/` (128 webp files, about 77 MB). If the module is disabled or removed, those scenes lose their backgrounds. To keep a scene on its own, move the image into the world first.
- Players have observer access to the whole pack, so they can browse every map. The maps hold no story text, so no spoiler risk (not verified).
- Not connected to `racooze-map-library`: this one needs no login or key.
- Free maps: still keep the images out of the repo and the vault.

## Sources

- Patreon: https://patreon.com/racooze (module url in the manifest)
- `C:\FoundryTest\data\Data\modules\racoozes-free-battlemaps\module.json`; `packs\` and `assets\` read only for sizes and counts.
