# 3DS:ATLAS (`3ds-atlas`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 1.5.3, 2026-10-28 (loaded on test server A; its settings and chat output read from the live world; menus not clicked through, marked "(not verified)").

**Verdict: keep.** Keep it only as long as Calendaria or Travel Pace is on. It is a library with no play-time features, and both of those modules require it. Its one footprint is a small update check to `3deathsaves.com` when the world opens.

**For Danni's guides:** You will never use this one; it just has to stay switched on while the calendar and travel modules are.

## What it does

The shared base of the 3 Death Saves modules: a theme engine (per-module, forced and custom colour themes), update notices with a changelog popup, logging, a troubleshooter that builds a support report, settings export and import across the suite, a docs search window and a relay for events that must run on one GM. It also provides `ATLAS.isPrimaryGM`, which Calendaria uses to decide which GM client advances time.

## Where its UI is

Only in Configure Settings > 3DS:ATLAS: four buttons (themes, troubleshooter, settings import and export, docs search). No scene control, sidebar tab or hotkey.

## Settings we use and why

Keys are `3ds-atlas.<key>`.

| Label (client) | Key             | Scope  | Default      | Our value / reason                                                              |
| -------------- | --------------- | ------ | ------------ | ------------------------------------------------------------------------------- |
| Logging level  | `loggingLevel`  | client | 2 (warnings) | leave                                                                           |
| Update notices | `updateNotices` | world  | on           | off if the table finds the popups noisy                                         |
| Changelogger   | `changelogger`  | world  | on           | leave                                                                           |
| Primary GM     | `primaryGM`     | world  | automatic    | set it to the GM who runs the table if Calendaria runs the wrong client's clock |

The theme settings are hidden and need no change.

## How it interacts with the AI Tool

One footprint in chat: on the first load as GM it posted a whisper from "3DS:ATLAS" titled "Updates Available" naming 3DS:ATLAS 1.5.4 and Calendaria 1.4.7 (seen live), so `get-chat-log` and the play recorder see it once. `get-modules` and `get-module-manifest` list it as a library (`library: true`) at 1.5.3, and list it under the requirements of `calendaria` and `travel-pace`. It creates no scenes, journals or documents. Its settings are plain world and client keys.

## Gotchas on Foundry 14 / dnd5e 6

- Foundry 14 only (`minimum` and `verified` are 14). It reads one dnd5e setting for its diagnostics and nothing else, so no dnd5e 6 problem is expected.
- **Network.** At `ready` each client fetches `https://www.3deathsaves.com/versions.json`. The docs search calls `/search`. A support report is posted to the same site only when someone submits one; it lists installed modules, versions and a settings summary (the builder was not read line by line). On an offline host the update check fails quietly (not verified).
- Disabling it breaks Calendaria and Travel Pace; Foundry will not enable them without it.
- Its stylesheet loads on every page, with a small visual effect.
- Seen live: with only the `Claude` GM online, the primary GM was `Claude`.
- The `primaryGM` setting is a user choice, not the bridge's GM; with two GM accounts online, check which one it picks.

## Sources

- Repo: https://github.com/Sayshal/3ds-atlas
- `C:\FoundryTest\data\Data\modules\3ds-atlas\module.json`, `release_notes.txt`, `lang\en.json`, `3ds-atlas.mjs` (searched, minified), `templates\`.
