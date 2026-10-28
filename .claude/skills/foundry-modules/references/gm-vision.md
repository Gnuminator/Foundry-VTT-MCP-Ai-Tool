# GM Vision (`gm-vision`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 2.0.5, 2026-10-28 (test server C). The toggle was switched on and off and the control icon changed; the look of the lit map was not screenshotted (marked in place).

**Verdict: keep.** One switch that lets the GM see the whole dark map, hidden tokens and fog while preparing or running a scene, and switch it back to normal. It changes nothing for players, is tiny and has no settings to manage.

**For Danni's guides:** Press Ctrl+G (or right click the lightbulb in the scene controls) to see the whole map as if the lights were on, including hidden tokens. Press it again to go back to what the players see.

## What it does

- GM only. Turned on, it brightens the map, removes the fog and shows hidden tokens with a hatched outline, while the player's own view is unchanged (manifest description and source).
- Verified: `game.settings.set('gm-vision', 'active', true)` made the lighting control icon switch from outline to solid (`fa-regular` to `fa-solid`); setting it back restored it. The brightness itself was not looked at (not verified).

## Where its UI is

- **Scene controls > Lighting layer button** (the lightbulb): right click toggles it; the icon is solid when on.
- Keybinding **Ctrl+G** ("Toggle GM Vision", editable in Controls Configuration).
- One hidden client setting, `gm-vision.active`.

## Settings we use and why

None. The only setting is the on/off state (`gm-vision.active`, client scope, hidden, default off), stored per browser.

## How it interacts with the AI Tool

- No interaction. Players never see the effect, so it does not change what our `get-token-positions` or player view show.
- No bridge settings. No kit scenario.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest: minimum 13, verified 14. It wraps the token and lighting filter classes, so a future Foundry version may break the look first.
- The on/off state is saved per browser, so if left on it is still on after a reload.
- It does not work for a user who is not a GM (the module checks `game.user.isGM`).
- Pi: nothing platform specific.

## Sources

- <https://github.com/dev7355608/gm-vision>, `module.json` and `script.js` in `C:\FoundryTestC\data\Data\modules\gm-vision` (the source is one bundled file; the toggle and the keybinding were read there).
- Live: the setting toggle and the lighting control icon, server C.
