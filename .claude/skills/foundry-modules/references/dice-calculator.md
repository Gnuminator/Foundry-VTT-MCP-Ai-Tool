# Dice Tray (`dice-calculator`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 4.0.6, 2026-10-28 (test server C). It loaded and the tray drew; no roll was made from the tray (marked in place).

**Verdict: keep.** A row of dice buttons under the chat box, so a player or the GM can click a d20 or a d6 instead of typing a roll. Small, loads clean, each player can hide it for themselves.

**For Danni's guides:** Under the chat box there is a row of dice. Click a die to add it, set how many you want, then press Roll. You do not need to know the roll commands.

## What it does

- Draws a dice tray under the chat message box: a button per die, a number box, advantage and disadvantage buttons and a Roll button. Seen live under the chat on the test world.
- Turns the d20 icon next to the chat box into a small dice calculator (manifest description).
- Rolls from the tray are said to go through the normal Foundry chat roll (not verified; no tray button was pressed).

## Where its UI is

- Under the chat box in the sidebar.
- **Game Settings > Dice Tray**: four visible settings plus a menu to edit the dice rows (`DiceRowSettings`).

## Settings we use and why

| Label                   | Key                                 | Scope | Default  | Why                                              |
| ----------------------- | ----------------------------------- | ----- | -------- | ------------------------------------------------ |
| Enable Dice Tray        | `dice-calculator.enableDiceTray`    | user  | on       | every user can turn it off for themselves        |
| Dice Tray Popout Button | `dice-calculator.popout`            | user  | none     | pick a side to get a button that floats the tray |
| Auto Open Popout        | `dice-calculator.autoOpenPopout`    | user  | off      | opens the floating tray on login                 |
| Right Click Command     | `dice-calculator.rightClickCommand` | world | decrease | what right-clicking a die does                   |

The hidden settings `hideAdv`, `compactMode`, `hideNumberInput`, `hideNumberButtons`, `hideRollButton` are set through the dice rows menu.

## How it interacts with the AI Tool

- No interaction with our tools. A tray roll is a normal chat roll, so our play log and `get-chat-log` see it like a typed roll (not verified).
- No bridge settings. No kit scenario.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest: Foundry 14 minimum and verified 14. Earlier on server C the module was 4.0.5; 4.0.6 is the current build (A and B).
- Adds the tray to the chat panel, so a guide screenshot shows it unless the user switched it off.
- Dice So Nice animates tray rolls like any other roll.
- Pi: no platform specific parts.

## Sources

- <https://github.com/mclemente/fvtt-dice-tray>, `module.json` in `C:\FoundryTestC\data\Data\modules\dice-calculator`.
- Live: the tray under the chat box and the settings registry on server C.
