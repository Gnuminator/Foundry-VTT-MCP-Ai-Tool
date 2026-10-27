# Automated Animations (`autoanimations`)

Not verified live: drafted from the module's manifest, README, language file and bundle on disk, and from dnd5e 6.0.6 and the bridge source, 2026-10-27; live check pending.

**Verdict: optional.** Version 8.0.1 is Foundry 14 only and plays JB2A effects when an item is used, and it should fire on the bridge's own item use. But it needs Sequencer, socketlib and a JB2A module, compiles a large database at every load and with only the free JB2A set many spells will not animate. Worth it only if Danni wants spell effects.

**For Danni's guides:** When a character attacks or casts, a matching spell effect plays on the map by itself, so you do not have to set anything up for most spells.

## What it does

It listens for item and activity use and plays matching JB2A animations through Sequencer. "Automatic Recognition" matches item and activity names to built-in tables (melee, ranged, on-token, template, aura, preset, active effect); a custom entry on an item overrides it. It brings no animations itself. It needs `sequencer` and `socketlib` to be active, and in practice a JB2A module (free or Patreon).

## Where its UI is

- An "Automated Animations" button in the header of Item, Activity and Active Effect sheets, for the GM (and players unless `hideFromPlayers`).
- Configure Settings > Automated Animations: a "Launch Menu" button for the Automatic Recognition editor (GM only) and a Diagnostics window that checks Sequencer and photosensitive-mode settings for each connected user.
- No scene control, sidebar tab or hotkey. Put `[noaa]` in an activity's chat flavor to skip animation for that activity.

## Settings we use and why

Keys are `autoanimations.<key>`.

| Label (client)                | Key                | Scope  | Default | Our value / reason                                                    |
| ----------------------------- | ------------------ | ------ | ------- | --------------------------------------------------------------------- |
| Kill switch                   | `killAllAnim`      | client | on      | each player may turn animations off on a weak PC                      |
| Disable Automatic Recognition | `disableAutoRec`   | world  | off     | leave off, otherwise only hand-set items animate                      |
| Global delay                  | `globaldelay`      | world  | 100 ms  | leave                                                                 |
| Play on damage                | `playonDamageCore` | world  | off     | leave; on moves attack effects to the damage roll                     |
| Play on miss                  | `playonmiss`       | world  | off     | leave; needs hit data that only MIDI QOL supplies                     |
| JB2A location                 | `jb2aLocation`     | world  | empty   | leave empty unless the assets sit on external hosting (reload needed) |
| Hide from players             | `hideFromPlayers`  | world  | off     | on, so players do not edit the animations                             |

## How it interacts with the AI Tool

- **Triggers.** On dnd5e 6 without MIDI QOL it listens to `dnd5e.rollAttackV2`, `dnd5e.rollDamageV2` and `dnd5e.postUseActivity` (the last only for activities with no damage). The bridge uses `item.use`, `activity.use`, `rollAttack` and `rollDamage` (`actor-builder.ts`), which call those hooks in the GM browser that hosts the bridge. So `use-item`, `request-attack-roll` and `use-npc-activity` should animate, the same as a click on the sheet. (not verified live)
- **What can stop it.** The animation needs a token for the actor on the scene the GM is viewing. Targets come from the GM client's `game.user.targets`, which the bridge may not set, so ranged effects can play at the wrong place or skip. No token means a silent no-op. Anything that changes data without these hooks (a hand-made chat message, a document update) plays nothing. (not verified live)
- **Data.** It stores `flags.autoanimations` on Items and Active Effects, and on tiles it places. An item copied or written by a tool keeps the flag.
- **Chat.** No chat messages of its own.
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Compatibility minimum, verified and maximum are all 14. For dnd5e it needs a system newer than 3.9 and picks the dnd5e 6 hooks by version.
- Without a JB2A module the GM sees a permanent error banner at every load ("A JB2A Module (Free OR Patreon) is REQUIRED") and no visuals. With only the free JB2A, parts of the table do not resolve (which entries is not known).
- Core photosensitive mode suppresses effects; the Diagnostics window warns about it.
- It compiles the whole JB2A database at every ready; the script bundle is 2.5 MB. Clients fetch each clip on first play.
- Nothing in the installed set depends on it.
- On the Pi nothing runs server-side; the cost is in the browsers.

## Sources

- Repo: https://github.com/theripper93/autoanimations; wiki: https://api.theripper93.com/modulewiki/autoanimations/free
- `C:\FoundryTest\data\Data\modules\autoanimations\module.json`, `README.md`, `lang\en.json`, `dist\autoanimations.js` (searched, minified).
- Repo: `packages/foundry-module/src/data-access/actor-builder.ts`; dnd5e 6.0.6 `dnd5e.mjs` for the hook names.
