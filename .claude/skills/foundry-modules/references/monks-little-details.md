# Monk's Little Details (`monks-little-details`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 14.01, 2026-10-28 (test server C). Parts not clicked through are marked "(not verified)".

**Verdict: keep.** A bundle of small quality-of-life changes (more condition icons, a pause border, a find-my-token button, nicer compendium sorting) that loaded without a visible problem (console read incomplete on 2026-10-28, so absence of errors is not proven). Each part has its own switch, so a part that annoys someone can be turned off.

**For Danni's guides:** Lots of small tidy-ups: extra condition icons on tokens (like Charmed, Grappled, Raging, Dodging), a coloured border while the game is paused, and a button that finds your own token on the map.

## What it does

- Adds 14 extra status effects to the token HUD, so the world has 52 status effects in total: Charmed, Exhausted, Grappled, Incapacitated, Petrified, Hasted, Slowed, Concentrating, Raging, Distracted, Dodging, Disengage, Cover, Turned (read from the module's `additional-effects` setting).
- Adds a body class and a coloured border while the game is paused (class `mld-paused` seen live; setting "Pause Border").
- Adds a "Find my Token" tool to the token controls (the `findtoken` tool exists live; it is a client setting, off by default).
- README and settings also list: quick links in journals, compendium sorting and shortcuts, scene palette, "Open Actor" on tokens, lighting progress, a "Module Management Changes" tweak, key swapping for tools. Only the first three were seen in action (the rest not verified).

## Where its UI is

- **Game Settings > Monk's Little Details**: 28 visible entries and two menus (update images, edit effects).
- The token HUD (right click a token), the pause banner, the token controls on the left.

## Settings we use and why

We keep defaults. These bite:

| Label                     | Key                                              | Scope  | Default | Why                                                             |
| ------------------------- | ------------------------------------------------ | ------ | ------- | --------------------------------------------------------------- |
| Add extra statuses        | `monks-little-details.add-extra-statuses`        | world  | on      | turn off if the extra icons clash with dnd5e's own conditions   |
| Change Core CSS           | `monks-little-details.core-css-changes`          | world  | on      | restyles Foundry windows; turn off if a theme module is used    |
| Change Window Styles      | `monks-little-details.window-css-changes`        | world  | on      | same                                                            |
| Module Management Changes | `monks-little-details.module-management-changes` | world  | on      | changes the module list window; harmless, turn off if confusing |
| Find my Token             | `monks-little-details.find-my-token`             | client | off     | players can switch it on for themselves                         |

## How it interacts with the AI Tool

- The 14 extra statuses are registered in `CONFIG.statusEffects`. Conditions set through our tools (`plan-token-change`, the play-side condition tools) still use the dnd5e conditions; whether `get-available-conditions` lists the extra icons was not checked (not verified).
- The module group test of 2026-10-04 passed with it on: roundtrip 14 of 14, sweep 53/1/0, no errors.
- No bridge settings. No kit scenario: nothing it does changes what our tools read or write.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest: Foundry 14 minimum and verified 14, no dnd5e code.
- It restyles core windows, so a screenshot in a guide may look different from stock Foundry when it is on.
- Concentration and Dodging icons it adds overlap in meaning with what dnd5e 6 and Automated Conditions 5e do; do not rely on the module's icons for rules.
- Pi: nothing platform specific (not verified).

## Sources

- <https://github.com/ironmonk108/monks-little-details>, `module.json` in `C:\FoundryTestC\data\Data\modules\monks-little-details`.
- Live: `CONFIG.statusEffects`, `game.settings.settings`, the token controls and the body classes, server C.
- Vault `Design/Module walkthrough plan.md` (group C).
