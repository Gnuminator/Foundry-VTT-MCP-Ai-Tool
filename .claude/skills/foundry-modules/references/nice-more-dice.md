# Nice more Dice (`nice-more-dice`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 1.4.2, 2026-10-28 (test server C, with Dice So Nice 6.4.2). Each player's dice picker was not clicked through (marked in place).

**Verdict: keep.** It adds extra dice looks (textures and number faces) to Dice So Nice. It only changes how dice look, costs 13 MB of images and has no settings. Worthless without Dice So Nice, harmless with it.

**For Danni's guides:** More dice skins to pick from, like fire or bark. Each player picks theirs in the Dice So Nice settings, and only the look changes.

## What it does

- Registers extra dice sets with Dice So Nice. With it on, `game.dice3d.DiceFactory.systems` listed 20 dice systems, including Dragon20, Dragon1, Hex, Flamestalker, PurpleMagic, Maze, planetary and roman next to Dice So Nice's own standard, spectrum and dot.
- Adds texture files (bark, blood, candy corn, claws and more) and number faces to the Dice So Nice appearance picker (the picker was not opened, not verified).
- Our attack rolls on the test world played Dice So Nice animations as normal.

## Where its UI is

- This module has no settings or menus of its own (0 registered). The dice picker is Dice So Nice's own: its tab in the sidebar and its entry in Game Settings.

## Settings we use and why

None of its own. Dice So Nice's per-player settings decide which dice each player uses: the dice set, colour and animation speed (`dice-so-nice.globalAnimationSpeed` is a world setting on the GM side).

## How it interacts with the AI Tool

- Cosmetic only. Rolls our tools make (`request-attack-roll`, `roll-saving-throws`, `roll-npc-check`) are normal Foundry rolls; the dice look is chosen by the roller's Dice So Nice settings. The play log reads the roll result, not the picture (reasoned from how Dice So Nice works, not tested here).
- No bridge settings. No kit scenario.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest: minimum 0.7.9, verified 14, no maximum. Requires Dice So Nice to be installed; the manifest has no relationship line, so Foundry will not warn if it is missing.
- It is 13 MB of images that every player downloads once.
- A player whose browser struggles with 3D can turn Dice So Nice off for themselves.
- Pi: static files only.

## Sources

- <https://github.com/LyncsCwtsh/fvtt-module-Nice-more-Dice>, `module.json` and `Used Assets Credits.txt` in `C:\FoundryTestC\data\Data\modules\nice-more-dice`.
- Live: `game.dice3d.DiceFactory.systems` and a roll on server C.
