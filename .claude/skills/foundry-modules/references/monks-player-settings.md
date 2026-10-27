# Monk's Player Settings (`monks-player-settings`)

Not verified live: drafted from the module's manifest, docs and source on disk, 2026-10-27; live check pending.

**Verdict: keep.** It is small (two files of logic, no canvas or roll hooks), it solves a real problem for a new GM with five players on different browsers, and the source shows no clash with Foundry 14. The one caution is that the manifest only claims Foundry 13 (`compatibility.verified` is 13, module version 14.01) even though the changelog says "v14 compatibility".

**For Danni's guides:** This lets you open a player's personal settings (like their sound volume or sheet look) from your own screen and fix them for them, and it keeps a player's settings when they change browsers.

## What it does

- Adds a player drop-down to the Configure Settings window for the GM. Pick a player and the window shows that player's client settings; saving writes them to that player (applied at once if they are online, else on their next login).
- Keeps a copy of each user's client settings in a user flag (`monks-player-settings.client-settings`, with a `save-id`). On another browser it offers to sync from the saved copy.
- Only settings registered with `config: true`, client scope and a plain type (string, number, boolean, array) are considered. Settings of modules not installed in this world are dropped.
- A player must have logged in once before their settings show correctly (README).

## Where its UI is

- **Settings > Configure Settings** (the GM sees the player drop-down at the top; players see a sync prompt after login when their saved copy differs).
- **Module Settings > Monk's Player Settings** has two entries, listed below.
- It uses a socket `module.monks-player-settings` to push values to online players.

## Settings we use and why

| Label                       | Key                                    | Scope  | Default         | We use                                                                        |
| --------------------------- | -------------------------------------- | ------ | --------------- | ----------------------------------------------------------------------------- |
| Sync Settings               | `monks-player-settings.sync-settings`  | client | on              | keep on, it is the point                                                      |
| Ignore Modules              | `monks-player-settings.ignore-modules` | world  | `fuzzy-foundry` | keep; add a module id here if one of its client settings should not be synced |
| Reset ignore changes (menu) | n/a                                    | n/a    | n/a             | click it only if the "ignore until next change" box needs to come back        |

The module does not force values on its own. It only copies what a player (or the GM, through the drop-down) saved.

## How it interacts with the AI Tool

No interaction found: grepped `packages`, `scripts`, `docs` and `CHANGELOG.md` for "monks-player", no hit.

Indirect points worth knowing:

- It writes a user flag on every player's User document, so a `list-actor-ownership` or user listing may show the extra `monks-player-settings` flag (not verified).
- It saves a copy of client settings, which for our bridge module means any client-scope `foundry-mcp-bridge` setting would be copied too (the bridge's own settings are mostly world scope or feature switches; not verified). Add `foundry-mcp-bridge` to the Ignore modules list if a bridge client setting ever should not travel.
- The AI Tool's push-to-Pi script checks world settings for secret-looking names (`scripts/pi/world-refs.mjs`); this module's settings are not secret, and the saved copy lives in user flags, not world settings (not verified for what other modules' client settings end up inside it).

## Gotchas on Foundry 14 / dnd5e 6

- `compatibility.minimum` and `verified` are both 13; module version 14.01. Foundry shows it as "untested" or compatible depending on its rules; the changelog's v14 note is the only claim (not verified live).
- It monkey-patches `foundry.helpers.ClientSettings.prototype.sheet` and wraps `foundry.applications.settings.SettingsConfig`. A Foundry core change to that class would break it first; the first sign is the player drop-down missing.
- Settings from modules like Simple Calendar that have their own editors are not tracked (README).
- Players must log in once before the GM can see their settings.
- No dnd5e-specific code. Pi: no OS-specific behavior seen (not verified).

## Sources

- <https://github.com/ironmonk108/monks-player-settings>, `README.md`, `CHANGELOG.md` (14.01, 13.01 notes).
- `C:\FoundryTest\data\Data\modules\monks-player-settings\module.json`, `settings.js`, `monks-player-settings.js`, `apps\settings-config.js`.
- Repo greps: `packages`, `scripts`, `docs` (no hits).
