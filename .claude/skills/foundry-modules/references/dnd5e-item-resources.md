# 5e - Resource trackers (`dnd5e-item-resources`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 1.3.00, 2026-10-28 (test server C). Parts not clicked through are marked "(not verified)".

**Verdict: optional.** It adds a coloured, animated bar on the character sheet for any item that has limited uses. It loaded with no errors, but the manifest only claims Foundry 14.361 and says nothing about dnd5e 6, and dnd5e 6 already shows uses on the sheet. A nice look for a player who likes it, not something the game needs.

**For Danni's guides:** If a feature has a limited number of uses (like Second Wind), a player can switch on a coloured bar for it on their sheet, so they see at a glance how many uses are left.

## What it does

- Per item, adds a resource bar to the character sheet for items with limited uses (README: tick the tracker box on the item's Details tab, then pick colours and an animation).
- On Second Wind of the test hero, the item sheet's Details tab showed four new controls: a checkbox, an animation drop-down and two colour pickers. Whether the bar then draws correctly on the character sheet and counts down was not clicked through (not verified).
- Ships about 21 MB of bar animation images.

## Where its UI is

- **Item sheet > Details tab**: the checkbox, animation and two colours (form fields `flags.dnd5eItemResources.resourceBar`, `.animation`, `.barFirstColor`, `.barSecondColor`).
- The bar itself: on the actor sheet next to the item (not verified).
- It has no entries in Game Settings (0 settings registered).

## Settings we use and why

None. There is nothing to set world wide; every choice is on the item.

## How it interacts with the AI Tool

- It stores its choices as item flags under the scope `dnd5eItemResources`. Our item tools (`manage-world-items`, `dnd5e-add-feature`, `dnd5e-add-features-from-compendium`) do not set these flags, so a feature we create has no bar until someone ticks the box (not verified end to end).
- Uses are still spent and read by the normal dnd5e fields, so `get-character-resources` and `use-item` see the right numbers (module group test of 2026-10-04: roundtrip 14 of 14, sweep 53/1/0).
- No kit scenario: it changes nothing the tools read or write.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest: minimum 13, verified 14.361, no maximum; no dnd5e relationship. It works on 6.0.6 in a quick look but is not tested by its author for dnd5e 6.
- If the module is turned off the flags stay on the items (harmless).
- Pi: just static files (not verified there).

## Sources

- <https://github.com/misthero/dnd5e-item-resources>, `README.md`, `CHANGELOG.md`, `module.json` in `C:\FoundryTestC\data\Data\modules\dnd5e-item-resources`.
- Live: Second Wind item sheet on Test Hero, server C.
