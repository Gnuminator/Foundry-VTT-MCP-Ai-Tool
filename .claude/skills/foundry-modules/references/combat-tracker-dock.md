# Carousel Combat Tracker (`combat-tracker-dock`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 5.0.2, 2026-10-28 (test server C, world ai-tool-test, six combatants). Parts not clicked through are marked "(not verified)".

**Verdict: keep.** It puts the turn order on the map as a row of portraits and it loaded and ran with no errors of its own. On 2026-10-04 a Player's carousel left out a hidden monster, so it does not spoil the fight. It replaces how combat looks for everyone, so it is a matter of taste for Danni; nothing in the AI Tool depends on it.

**For Danni's guides:** When a fight starts, the turn order shows as a row of faces along the top of the screen, with the current turn highlighted and a health bar under each face.

## What it does

- Draws the combat as a carousel of portraits docked to the map. Started a combat of six tokens on Test Arena (roll all, start): the row appeared at the top, the active combatant is marked and the round counter shows in it.
- Each portrait can show an attribute bar (HP by default), the initiative number and a disposition colour. These are all settings, not hand edits.
- Hides the core combat tracker in the sidebar while it is on (setting "Hide Conflicting UIs", on) (not verified).
- Hidden combatants: with a monster's token and combatant hidden, the Player's carousel showed only the player character (module test of 2026-10-04, not repeated today).

## Where its UI is

- The carousel itself: the top of the map (position setting "Position", default a docked row).
- **Game Settings > Carousel Combat Tracker**: 30 entries; three of them are client settings every user sets for their own screen ("Carousel Size", "Less Buttons", "Overflow Style"); the rest are world settings.
- The attributes list has its own menu entry in the same Game Settings category (`combat-tracker-dock.attributesMenu`).

## Settings we use and why

We leave everything at its default. These are the ones that matter at the table:

| Label                   | Key                                          | Scope  | Default | Why it matters                                             |
| ----------------------- | -------------------------------------------- | ------ | ------- | ---------------------------------------------------------- |
| Hide Enemy Initiative   | `combat-tracker-dock.hideEnemyInitiative`    | world  | off     | turn on if players should not see monster initiative rolls |
| Hide Defeated           | `combat-tracker-dock.hideDefeated`           | world  | off     | turn on to drop dead monsters from the row                 |
| Hide Until First Turn   | `combat-tracker-dock.hideFirstRound`         | world  | off     | keeps the row empty until the fight really starts          |
| Always Show Player Info | `combat-tracker-dock.playerPlayerPermission` | world  | off     | whether players see each other's HP bars                   |
| Position                | `combat-tracker-dock.direction`              | world  | docked  | docked row or a floating one for the whole table           |
| Carousel Size           | `combat-tracker-dock.portraitSize`           | client | 70px    | a player on a small screen can shrink it                   |

## How it interacts with the AI Tool

- It only reads the combat document. Our combat tools (`advance-combat-turn`, `set-initiative`, `roll-initiative-for-npcs`) change the combat as before and the carousel follows (module group test 2026-10-04: roundtrip 14 of 14, sweep 53/1/0, all targeted checks passed).
- Our own dashboard combat panel is a separate page and does not conflict.
- No bridge settings needed. No kit scenario: it changes nothing the tools read or write.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest says Foundry 14 only (minimum, verified and maximum 14); a Foundry 15 update will need a new release.
- Two world settings hold its attribute list and events, `attributes` and `events`; they stay in the world after the module is turned off (harmless, not verified).
- Pi: nothing platform specific seen (not verified on the Pi).

## Sources

- <https://github.com/theripper93/combat-tracker-dock>, `module.json` in `C:\FoundryTestC\data\Data\modules\combat-tracker-dock`.
- Live: console, `game.settings.settings` for the namespace, a started combat on server C.
- Vault `Design/Module walkthrough plan.md` (group C, 2026-10-04).
