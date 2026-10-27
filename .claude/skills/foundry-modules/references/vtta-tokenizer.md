# Tokenizer (`vtta-tokenizer`)

Not verified live: drafted from the module's manifest, docs and source on disk, 2026-10-27; live check pending.

**Verdict: keep.** It is the tool for making round token pictures and portraits with a frame, and the world's NPC images already live under `Data/tokenizer/` (the Pi push depends on it). `compatibility.verified` is 13 (module 5.0.3), but the source uses the Foundry 13+ APIs (`foundry.applications.apps.FilePicker.implementation`, ApplicationV2 header controls), so I saw no 14 break in the code. It is a GM tool; no players need it.

**For Danni's guides:** Tokenizer is the "make a token" window: open an actor, click Tokenizer, drag the picture into the circle, pick a frame, and it saves a token and a portrait for you.

## What it does

- A window that crops, masks and frames an image into a round token and a square portrait, with frames, masks, backgrounds and a dynamic token ring option.
- Saves the files into the world's `Data/tokenizer/` folders and sets the actor's portrait and prototype token to them. Can also update tokens already on scenes.
- Compendium tools: tokenize every actor in a compendium, or all NPCs in a folder (context menu).
- Can fetch images from a web address; the default proxy host is `images.ddb.mrprimate.co.uk` (hidden `proxy` setting) for D&D Beyond images.

## Where its UI is

- **Actor sheet header**, a "Tokenizer" button (an ApplicationV2 header control, shown to users who can upload files; players only if "Disable for Users lacking permissions?" is off). In the older V1 path the button needs "title-link" on (default off); the V2 path does not check it (from source).
- Right-click an actor in the **Actors directory** > Tokenizer (and compendium entries).
- Clicking an actor's portrait image on supported sheets (switch `disable-avatar-click`, default off; whether it works on the dnd5e 6 sheet is not verified).
- **Settings > Module Settings > Tokenizer** for folders and defaults.

## Settings we use and why

Keys are `vtta-tokenizer.<key>`; defaults are from `dist/main.js`. Scope "player" in the source is not a Foundry scope: Foundry 14's `ClientSettings.register` turns an unknown scope into `client` (checked in the core client file), so those settings are per browser.

| Label (approx.)                        | Key                             | Scope  | Default                       | We use                                              |
| -------------------------------------- | ------------------------------- | ------ | ----------------------------- | --------------------------------------------------- |
| Image upload directory (PC)            | `image-upload-directory`        | world  | `[data] tokenizer/pc-images`  | keep                                                |
| NPC image upload directory             | `npc-image-upload-directory`    | world  | `[data] tokenizer/npc-images` | keep; the Pi push expects `tokenizer/`              |
| Frame directory                        | `frame-directory`               | world  | `[data] tokenizer/frames`     | keep                                                |
| Masks directory                        | `masks-directory`               | world  | `[data] tokenizer/masks`      | keep                                                |
| Image save type                        | `image-save-type`               | world  | `webp`                        | keep                                                |
| Token size / Portrait size             | `token-size` / `portrait-size`  | client | 400 / 1000                    | keep                                                |
| Disable for Users lacking permissions? | `disable-player`                | world  | on                            | keep on, so players do not see the button           |
| Auto-apply dynamic token ring          | `auto-apply-dynamic-token-ring` | client | off                           | leave off (not verified how it behaves on 14 rings) |

## How it interacts with the AI Tool

- **Pi world push:** `docs/dev/PI-SETUP.md` (around line 728) says `Data/tokenizer/` must be copied with the world or scenes and tokens show broken images. `scripts/pi/push-world.ps1` and `scripts/pi/remote/11-world.sh` accept only `ddb-images/` and `tokenizer/` as asset folders. `scripts/pi/world-refs.mjs` classifies `tokenizer/...` paths used by actors (its test uses `tokenizer/npc-images/a.png`).
- **Secret check on push:** the module name never counts as a secret word; its folder settings (`image-upload-directory`, `frame-directory`) are listed as harmless in `world-refs.test.mjs`. The hidden `proxy` setting is a URL, not a credential.
- Our tools do not call it. `dnd5e-create-npc` and friends use whatever image path they are given. Tokens it makes are ordinary files; nothing in the bridge reads or writes its settings.
- Needs no `foundry-mcp-bridge` settings.

## Gotchas on Foundry 14 / dnd5e 6

- `compatibility.verified` is 13 and the manifest has no 14 line. Foundry will show it as unverified; the code points to 13+ APIs. Clicks to confirm (not verified): the header button appears on the dnd5e 6 sheet, the window opens, a save writes a file and updates the actor portrait.
- It also hooks the older `getActorSheetHeaderButtons` and per-sheet `render<SheetName>` hooks for V1 sheets; those do nothing on 14 (from source, not verified).
- Written files go to the Foundry server's `Data/tokenizer/`. On the Pi (Linux, case-sensitive) a mixed-case file name saved on Windows still matches only by exact spelling; `push-world.ps1` and `world-refs.mjs` check that every referenced path exists.
- Players with upload rights can use it; nothing else needs a special permission.
- A world that drops the module keeps the saved images (plain files) and the actors' texture paths; only the button disappears.

## Sources

- <https://github.com/MrPrimate/tokenizer>, `module.json`; `LICENSE.md`.
- `C:\FoundryTest\data\Data\modules\vtta-tokenizer\dist\main.js` (settings, header controls, FilePicker use), `lang\en.json`.
- Repo: `docs/dev/PI-SETUP.md`, `scripts/pi/world-refs.mjs`, `scripts/pi/world-refs.test.mjs`, `scripts/pi/push-world.ps1`, `scripts/pi/remote/11-world.sh`.
- Core: `C:\FoundryTest\app\client\helpers\client-settings.mjs` (scope fallback).
