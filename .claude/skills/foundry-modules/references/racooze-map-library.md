# Racooze Map Library (`racooze-map-library`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 1.2.42, 2026-10-28 (loaded on test server A; the Map Library button seen in the Scenes directory; no Patreon login was made, so connecting, browsing and importing are drafted from the source and marked "(not verified)").

**Verdict: optional.** Version 1.2.42 is a well-behaved importer for Racooze battlemaps on Foundry 14, but it needs a paid Patreon connection, sends its download key to `library.racooze.de` on every call and writes big files. Use it on the PC to build scenes; the Pi world only needs the scenes it produces.

**For Danni's guides:** The Map Library button in the Scenes tab lets you pick a Racooze map and bring it in as a ready scene, once your Patreon is connected.

## What it does

It adds a "Map Library" button to the Scenes directory. The window lists the Racooze catalogue (early access, free, premium; Classic and Dynamic variants), shows previews, downloads the files and scene data from `library.racooze.de` into the Foundry Data folder and creates Scenes with walls, lights, tiles and sounds. It tracks installed versions and shows New and Updated badges and an update queue.

## Where its UI is

- Scenes sidebar > the "Map Library" button (only for users who may manage the library: GM, or Assistant GM unless blocked).
- One large window: search, filters, preview, download queue, updates. Configure Settings > Racooze Map Library has a Patreon connection menu and a GM-only access menu.
- No scene control, hotkey or API object.

## Settings we use and why

Keys are `racooze-map-library.<key>`.

| Label (client)            | Key                        | Scope  | Default | Our value / reason                                                      |
| ------------------------- | -------------------------- | ------ | ------- | ----------------------------------------------------------------------- |
| Large download warning    | `showLargeDownloadWarning` | client | on      | leave on: it confirms downloads of 50 MB or more                        |
| Allow Assistant GM access | `allowAssistantGmAccess`   | world  | on      | off if only the full GM should import                                   |
| Download key (hidden)     | `downloadKey`              | client | empty   | set only by the Patreon connect flow; **secret, never print or commit** |
| Installed state (hidden)  | `installationState`        | world  | empty   | JSON of installed maps and fingerprints; leave                          |

## How it interacts with the AI Tool

- **Scenes.** An import makes ordinary inactive Scenes (flag `flags.racooze-map-library`: `mapSlug`, `requestedVariant`, `resolvedVariant`, `assetRoot`, `importedAt`). `list-scenes` and the scene tools then treat them like any scene; the image paths are under `assets/racooze-map-assets/`.
- **Nothing else.** No journals, chat or media. The import itself needs a GM click and a Patreon login, so the AI Tool cannot run it. The download key is a client-scope setting (that browser's storage), so the bridge is unlikely to read it (not verified live).
- **Licensed content.** Map names and images are paid content: keep them out of the repo, the vault and public docs.
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Supports Foundry 13.351 and 14. The Dynamic variant needs 14.363 or newer and falls back to Classic below that.
- **What leaves the PC.** Every call is a POST to `https://library.racooze.de/api` with the download key in the body (routes: bootstrap, updates, installed status, download manifest, scene, asset, Patreon connect, install analytics with the map slug and variant). The Patreon sign-in runs in the normal browser; the module never sees the Patreon password.
- The key is per browser. A second PC or browser needs its own Patreon connect.
- Files go to `Data/assets/racooze-map-assets/<slug>/...`; a few maps can be large. On the Pi, check disk space before importing there (a stage script's job, not a hand copy).
- A map larger than the GPU limit or 8192 px gets a warning when its scene loads.
- No dnd5e use. Scenes keep their asset files in the world's Data folder, so they stay after the module is removed.

## Sources

- Patreon: https://www.patreon.com/racooze (module url in the manifest)
- `C:\FoundryTest\data\Data\modules\racooze-map-library\module.json`, `lang\`, `scripts\main.js` (read, about 9,600 lines). No README ships.
