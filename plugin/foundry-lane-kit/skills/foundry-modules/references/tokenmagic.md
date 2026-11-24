# Token Magic FX (`tokenmagic`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 0.8.4, 2026-10-28 (test server B; the API on a token, our move tool with a filter running, and the load log were driven live; the FX Editor window, template effects from spells and the player view were not).

**Verdict: drop.** It works, but it is a lot of machinery for glow, fire and ripple filters, Automated Animations and FXMaster already give the table its visible effects, and it is the noisiest module of the batch in the log. Skip it unless Danni specifically wants burning or glowing tokens.

**For Danni's guides:** Not needed. It adds a filter editor for tokens and tiles, and the table has other effect modules.

## What it does

PIXI filters on tokens, tiles, drawings, templates and scenes: glow, fire, frost, ripples, outline, bevel, shadow and more, with an FX Editor, 71 built-in presets (seen live), and optional automatic effects on spell templates. Filters are stored in document flags, so they travel with the token.

## Where its UI is

- Token HUD FX control (the setting "Always display HUD's FX Editor Control" is on by default); the FX Editor window and a preset library sit behind it (not opened).
- Macro and module API: `TokenMagic.addFilters(placeable, presetNameOrParams)`, `deleteFilters`, `getPresets`, `hasFilterId` and more.
- Configure Settings > Token Magic FX: 9 visible settings (below).

## Settings we use and why

Keys are `tokenmagic.<key>`.

| Label (client)                    | Key                   | Scope  | Value        | Why                                                                                             |
| --------------------------------- | --------------------- | ------ | ------------ | ----------------------------------------------------------------------------------------------- |
| Enable automatic template effects | `autoTemplateEnabled` | world  | on (default) | **turn off if kept:** it decorates spell templates on its own and overlaps Automated Animations |
| Permissive mode                   | `fxPlayerPermission`  | world  | off          | leave: on lets players add filters (not tested)                                                 |
| Disable FX Animations             | `disableAnimations`   | client | off          | a weak PC may turn it on                                                                        |
| Disable filter caching on startup | `disableCaching`      | client | on           | leave                                                                                           |

## How it interacts with the AI Tool

- **Filters survive our writes.** I put the `fire` preset on Test Hero (`flags.tokenmagic.filters`, one `FilterFire` on the mesh, visibly burning), moved the token through `plan-token-change` and `apply-planned-change`: the token moved and kept the filter. `undo-change` moved it back. `get-token-details` does not show the flag.
- No tool adds or removes filters. The filter lives in a token flag, so `plan-token-change` does not clear it.
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest `compatibility` is minimum 14, verified 14.363. It requires `lib-wrapper`.
- **Log noise.** The first load of a world ran the 0.4.0 to 0.5.2 preset migrations and printed about 500 console lines ("import -> add: ..."); the diagnostics buffer in `get-module-errors` also holds a repeated TokenMagic warning stack from `tokenmagic.js` and, in the console, a PixiJS notice that `filters.DisplacementFilter` has moved to `DisplacementFilter`. No errors.
- Removing it leaves `flags.tokenmagic` on every token or tile that had a filter (invisible without the module) and its presets in a world setting.
- Pi: filters run on the player's GPU; the headless Pi does not matter.

## Sources

- Repo: https://github.com/Feu-Secret/Tokenmagic
- `C:\FoundryTestB\data\Data\modules\tokenmagic\module.json`; settings and filters read live.
