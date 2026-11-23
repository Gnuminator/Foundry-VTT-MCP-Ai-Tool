# socketlib (`socketlib`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 1.1.4, 2026-10-28 (loaded on test server A; it registers no settings and showed nothing in the client, as the source says; the dependents' socket calls were not exercised, marked "(not verified)").

**Verdict: keep.** Version 1.1.4 is a 335-line library with no settings, no menu and no stored data, and four installed modules require it. Nothing to tune, nothing to fear.

**For Danni's guides:** A hidden helper that other modules use to talk between players' screens; leave it switched on.

## What it does

A library for socket messaging. A module registers named functions and calls them on other clients: as the GM, as one user, for all GMs, for everyone. Calls return the remote result or fire and forget. A module must declare `socket: true` in its manifest. It adds `window.socketlib` and fires `socketlib.ready` at `init`.

## Where its UI is

None. It has no settings, no menu and no chat output. Errors appear only in the browser console, prefixed `socketlib |`.

## Settings we use and why

None.

## How it interacts with the AI Tool

- It is required by `autoanimations`, `dae`, `dice-stats` and `token-action-hud-core`; `get-modules` and `get-module-manifest` show that as a requirement. Sequencer, JB2A and `foundry-mcp-bridge` do not use it.
- The bridge runs in a GM browser, so GM-only calls from dependents succeed. Do not make bridge code depend on socketlib.
- No journals, chat, scenes or actors are touched.

## Gotchas on Foundry 14 / dnd5e 6

- 1.1.4 only updated the compatibility entry for Foundry 14; the code needed no change.
- `executeAsGM` throws a "no GM connected" error for a player when no GM is online; with a GM online only the active GM runs the call. In Automated Animations only tile placement and a settings check use it.
- A handler must be registered on every client or the caller gets an "unregistered handler" error.
- Disabling it makes Foundry refuse to enable the four modules above.
- Nothing dnd5e-specific, and nothing changes on the Pi.

## Sources

- Repo: https://github.com/farling42/foundryvtt-socketlib
- `C:\FoundryTest\data\Data\modules\socketlib\module.json`, `README.md`, `CHANGELOG.md`, `src\socketlib.js` (read in full).
