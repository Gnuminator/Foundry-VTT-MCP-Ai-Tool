# Universal Battlemap Importer (`dd-import`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 6.1.1, 2026-10-28 (test server C). No map was imported, so the import itself is not verified (marked in place).

**Verdict: keep.** It is the tool that turns a map file with walls and lights already drawn into a ready Foundry scene, which saves a lot of hand work for bought battlemaps. It does nothing until someone uses it, loaded with no errors and has no settings that bite.

**For Danni's guides:** If you have a map made in Dungeondraft or DungeonFog, this turns it into a scene with its walls, doors and lights already set up, in one step.

## What it does

- Imports scene elements from Universal VTT files (`.dd2vtt`, `.df2vtt`, `.uvtt`) made by Dungeondraft or DungeonFog: the map image, walls, doors, lights and the grid (README and manifest description; the import was not run, not verified).
- Adds a **Universal Battlemap Import** button to the Scenes directory in the sidebar (seen live next to Create Scene).
- Nothing runs in the background.

## Where its UI is

- **Scenes sidebar > Universal Battlemap Import** opens the importer (not opened this time, not verified).
- Game Settings has one visible entry, "Openable Windows" (off). A second hidden setting, `importSettings`, holds the default upload folder (it had `worlds/ai-tool-test` live).

## Settings we use and why

| Label            | Key                         | Scope | Default | We use                                             |
| ---------------- | --------------------------- | ----- | ------- | -------------------------------------------------- |
| Openable Windows | `dd-import.openableWindows` | world | off     | keep off; its effect was not tested (not verified) |

## How it interacts with the AI Tool

- No interaction: it creates scenes from files, and our scene tools (`list-scenes`, `plan-scene-change`, `switch-scene`) read the scenes it made like any other.
- Maps it imports are scene data in the world; the licensed map packs never go in the repo (CLAUDE.md).
- No kit scenario: no automated import is possible without a map file.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest: Foundry minimum, verified and maximum are all 14, so Foundry 15 needs a new release.
- It is 7.4 MB; no library needed.
- The default upload folder is kept in the hidden `importSettings` setting (`worlds/ai-tool-test` live).
- Pi: not tried there (not verified).

## Sources

- Manifest in `C:\FoundryTestC\data\Data\modules\dd-import\module.json` (authors Moo Man, m42e, jacquie; no repository URL in the manifest).
- Live: the Scenes directory buttons and the settings registry on server C.
- Vault `Design/Module inventory (Frostmaiden world).md` (old world list).
