# Health Estimate (`healthEstimate`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 36.1.1, 2026-10-28 (test server C; the estimate itself was computed on 35.2.2 before the module was updated, not rerun on 36.1.1). The estimate was computed live; the on-screen label was not captured (marked in place).

**Verdict: keep.** It gives words like "Badly Injured" instead of hit point numbers, which is how most tables want monster health to look. It reads HP and never writes anything, so it is safe next to our tools. It does not hide the HP bar by itself.

**For Danni's guides:** Instead of telling players a goblin has 4 of 7 hit points, they see "Injured" or "Near Death" when they hover over it. You still see the real numbers.

## What it does

- Turns a token's HP into a word. A wolf with 11 maximum HP read "Badly Injured" at 3 HP and "Near Death" at 2 HP when asked through `game.healthEstimate.getEstimation(token)` after a normal actor update.
- The label is drawn on hover (the source shows the text is only displayed while the token is hovered and visible). The label was not screenshotted, so how it looks on the canvas is not verified.
- It reads `system.attributes.hp` through a dnd5e provider and can add temporary HP, hide itself for dead tokens, or show "Dead".

## Where its UI is

- Over a hovered token on the map.
- **Game Settings > Health Estimate**: four visible entries ("Display Estimates", "Elevation Tooltip Position", "Add Temporary Health", "Hide Estimates on Tokens") and three menus: Behavior, Estimations (the word list per HP percent), Style.

## Settings we use and why

| Label                    | Key                                            | Scope | Default | Why                                                     |
| ------------------------ | ---------------------------------------------- | ----- | ------- | ------------------------------------------------------- |
| Display Estimates        | `healthEstimate.display`                       | user  | default | each user can turn it off for themselves                |
| Show Estimates: Users    | `healthEstimate.core.showDescription`          | world | all (0) | set to GM only or Players only to split the view        |
| Show Estimates: Tokens   | `healthEstimate.core.showDescriptionTokenType` | world | all (0) | limit to NPCs if player characters should show nothing  |
| Hide Estimates on Tokens | `healthEstimate.core.breakOnZeroMaxHP`         | world | zero    | hides it for tokens with no max HP                      |
| Add Temporary Health     | `healthEstimate.core.addTemp`                  | world | off     | count temp HP into the estimate if the table wants that |

## How it interacts with the AI Tool

- It only reads HP. A normal `actor.update` of HP changed the estimate immediately, so any HP change we make through a guarded write, such as `plan-actor-change`, should show up in it at once (only the plain update was tried).
- Spoilers: by itself it does not hide the real HP bar or HP numbers from players. That is set per token in Foundry (bar visibility) and by actor ownership. Our own player view and `get-token-details` are unchanged by this module.
- No bridge settings. No kit scenario. It was on in the all-modules run of 2026-10-04 (roundtrip 14 of 14, sweep 53/1/0, no load errors), which did not test it on its own.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest: Foundry 14 minimum and verified 14. Version 36.1.1 is what server A and the pages now use (server B had 36.0.0, server C had 35.2.2 before today).
- The estimate depends on the max HP; it hides for a max of 0, which is the sign of a token whose actor has no HP.
- The word list is editable per HP percent; the default words are English only, a Danish table would edit them (not verified).
- Pi: nothing platform specific.

## Sources

- <https://github.com/mclemente/healthEstimate>, `module.json` and `module/healthEstimate.js` in `C:\FoundryTestC\data\Data\modules\healthEstimate` (settings, the hover code near the display call).
- Live: `game.healthEstimate.getEstimation`, the settings registry, a test wolf token on server C.
