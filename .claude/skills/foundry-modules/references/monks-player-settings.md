# Monk's Player Settings (`monks-player-settings`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 14.01, 2026-10-28 (test server B). Parts not clicked through are marked "(not verified)".

**Verdict: optional.** Its main feature, the README's player drop-down in Game Settings for viewing and editing another player's client settings, is not present on Foundry 14.368: no select with the user names appears in the Game Settings dialog. What still works is the browser sync (it saves each user's client settings in a user flag). The module is small and loads cleanly, so it does no harm, but it no longer does what the README promises. The manifest also only claims Foundry 13 (`compatibility.verified` is 13).

**For Danni's guides:** This keeps a player's personal settings (like sound volume or sheet look) when they change browsers. The part where you open a player's settings from your own screen does not show up on our Foundry version, so do not promise it.

## What it does

- README: adds a player drop-down to the Configure Settings window for the GM, to view and edit that player's client settings. **Not present on 14.368** (checked in the open Game Settings dialog: no select with the user names). Everything described for it below is from the README and source only (not verified).
- Keeps a copy of each user's client settings in a user flag (`monks-player-settings.client-settings`, with a `save-id`). Verified: user Claude has both flags (`client-settings` and `save-id`). Offering a sync on another browser was not tried (not verified).
- Only settings registered with `config: true`, client scope and a plain type (string, number, boolean, array) are considered. Settings of modules not installed in this world are dropped.
- A player must have logged in once before their settings show correctly (README).

## Where its UI is

- **Settings > Configure Settings**: the README's player drop-down is missing on 14.368. Players are said to see a sync prompt after login when their saved copy differs (not verified).
- **Game Settings** category "Monk's Player Settings" has 3 entries (two settings and the reset menu, listed below).
- It uses a socket `module.monks-player-settings` to push values to online players.

## Settings we use and why

| Label                       | Key                                    | Scope  | Default         | We use                                                                        |
| --------------------------- | -------------------------------------- | ------ | --------------- | ----------------------------------------------------------------------------- |
| Sync Settings               | `monks-player-settings.sync-settings`  | client | on              | keep on, it is the point                                                      |
| Ignore Modules              | `monks-player-settings.ignore-modules` | world  | `fuzzy-foundry` | keep; add a module id here if one of its client settings should not be synced |
| Reset ignore changes (menu) | n/a                                    | n/a    | n/a             | click it only if the "ignore until next change" box needs to come back        |

Live values: `sync-settings` true, `ignore-modules` "fuzzy-foundry", one menu `resetIgnore`. The module does not force values on its own. It only copies what a player saved.

## How it interacts with the AI Tool

No interaction found: grepped `packages`, `scripts`, `docs` and `CHANGELOG.md` for "monks-player", no hit.

Kit scenario: none yet, none earned (it changes no AI Tool tool result and its one visible feature is gone on 14).

Indirect points worth knowing:

- It writes a user flag on every player's User document, so a `list-actor-ownership` or user listing may show the extra `monks-player-settings` flag (not verified).
- It saves a copy of client settings, which for our bridge module means any client-scope `foundry-mcp-bridge` setting would be copied too (the bridge's own settings are mostly world scope or feature switches; not verified). Add `foundry-mcp-bridge` to the Ignore modules list if a bridge client setting ever should not travel.
- The AI Tool's push-to-Pi script checks world settings for secret-looking names (`scripts/pi/world-refs.mjs`); this module's settings are not secret, and the saved copy lives in user flags, not world settings (not verified for what other modules' client settings end up inside it).

## Gotchas on Foundry 14 / dnd5e 6

- `compatibility.minimum` and `verified` are both 13; module version 14.01. It loads on 14.368 without a problem, but the changelog's "v14 compatibility" claim does not hold for the player drop-down.
- It monkey-patches `foundry.helpers.ClientSettings.prototype.sheet` and wraps `foundry.applications.settings.SettingsConfig`. The missing player drop-down is the sign that this wrap no longer takes effect on 14.368 (the cause was not investigated).
- Settings from modules like Simple Calendar that have their own editors are not tracked (README).
- Players must log in once before the GM can see their settings.
- No dnd5e-specific code. Pi: no OS-specific behavior seen (not verified).

## Sources

- <https://github.com/ironmonk108/monks-player-settings>, `README.md`, `CHANGELOG.md` (14.01, 13.01 notes).
- `C:\FoundryTest\data\Data\modules\monks-player-settings\module.json`, `settings.js`, `monks-player-settings.js`, `apps\settings-config.js`.
- Repo greps: `packages`, `scripts`, `docs` (no hits).
