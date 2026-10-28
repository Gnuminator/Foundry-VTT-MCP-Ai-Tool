# Monk's Player Settings (`monks-player-settings`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 14.01, 2026-10-28 (test server C; first look on server B, 14.368). Parts not clicked through are marked "(not verified)".

**Verdict: keep.** Caution first: the author's manifest only claims Foundry 13 (`compatibility.verified` is 13), so a Foundry update may need a new release. In our check its main feature, a drop-down in Game Settings for the GM to view and edit another player's client settings, worked on Foundry 14.369. The module is small and loaded without a visible problem (console read incomplete on 2026-10-28, so absence of errors is not proven).

**For Danni's guides:** In Game Settings there is a drop-down at the top. Pick a player and you see that player's own settings (like sound volume) and can change them for them. A player who has never logged in has nothing saved yet.

## What it does

- Adds a player drop-down (`#mps-view-group`) to the Game Settings window for the GM, to view and edit that player's client settings. **Verified on 14.369** (see the Verdict). Editing and saving a player's value was not done (not verified).
- Keeps a copy of each user's client settings in a user flag (`monks-player-settings.client-settings`, with a `save-id`). Verified: user Claude has both flags (`client-settings` and `save-id`). Offering a sync on another browser was not tried (not verified).
- Only settings registered with `config: true`, client scope and a plain type (string, number, boolean, array) are considered. Settings of modules not installed in this world are dropped.
- A player must have logged in once before their settings show correctly (README).

## Where its UI is

- **Settings tab > Game Settings**: the player drop-down is at the top of the window (the window's id is `settings-config`). Players are said to see a sync prompt after login when their saved copy differs (not verified).
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

Kit scenario: none yet, none earned (it changes no AI Tool tool result).

Indirect points worth knowing:

- It writes a user flag on every player's User document, so a `list-actor-ownership` or user listing may show the extra `monks-player-settings` flag (not verified).
- It saves a copy of client settings, which for our bridge module means any client-scope `foundry-mcp-bridge` setting would be copied too (the bridge's own settings are mostly world scope or feature switches; not verified). Add `foundry-mcp-bridge` to the Ignore modules list if a bridge client setting ever should not travel.
- The AI Tool's push-to-Pi script checks world settings for secret-looking names (`scripts/pi/world-refs.mjs`); this module's settings are not secret, and the saved copy lives in user flags, not world settings (not verified for what other modules' client settings end up inside it).

## Gotchas on Foundry 14 / dnd5e 6

- Settled 2026-10-28: the first page said the drop-down was missing on 14.368 because that check opened a settings window from code. Opened the way a user does it (Settings tab, "Game Settings"), the drop-down "-- All Players --" with Claude, Gamemaster, Verifier A, Verifier B, Assistant GM and Player appears and choosing Player switched the window to that user.
- The author's manifest claims Foundry 13 only (`compatibility.minimum` and `verified` are both 13; module version 14.01). It loaded and worked on 14.368 and 14.369 in our check, but nobody has certified it for 14.
- It monkey-patches `foundry.helpers.ClientSettings.prototype.sheet` and adds the drop-down in a `renderSettingsConfig` hook (`apps/settings-config.js`). A settings window made from code with `new SettingsConfig()` had no drop-down when tried, while the Game Settings button showed it (the module's patched `sheet` is the likely reason, not proven). This is what the first page of 2026-10-28 mistook for a broken module.
- Its own copy of the player's settings (`client-settings` flag) was 27 KB for the Claude user on this test world, so many modules make the flag large.
- Settings from modules like Simple Calendar that have their own editors are not tracked (README).
- Players must log in once before the GM can see their settings.
- No dnd5e-specific code. Pi: no OS-specific behavior seen (not verified).

## Sources

- <https://github.com/ironmonk108/monks-player-settings>, `README.md`, `CHANGELOG.md` (14.01, 13.01 notes).
- `C:\FoundryTest\data\Data\modules\monks-player-settings\module.json`, `settings.js`, `monks-player-settings.js`, `apps\settings-config.js`.
- Repo greps: `packages`, `scripts`, `docs` (no hits).
