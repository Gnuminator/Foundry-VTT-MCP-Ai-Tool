# Tidy 5e Sheets (`tidy5e-sheet`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 14.4.0, 2026-10-28 (test server B; the character sheet, an attack from it, and our damage write and undo on an open sheet were driven live; NPC, group and vehicle sheets, item sheets and the sheet settings window were not).

**Verdict: optional.** The sheet is clean and fast, and everything we write shows up in it at once. But it is a second sheet to learn for a GM new to Foundry, it removes the Tokenizer portrait button, and the classic Tidy sheet is gone, so there is no gentle fallback. Keep dnd5e's own sheet as the default and let a player who asks switch.

**For Danni's guides:** A nicer-looking character sheet that players can pick for their own character; the normal sheet stays the default.

## What it does

A replacement set of sheets for dnd5e 6: character, NPC, encounter, group, vehicle and item sheets, all named "Tidy5e ... Quadrone". Version 14 removed the older Classic sheets. It adds an action-list tab, favourites, section footers, inline activities and reference tooltips. It does not change data: it only draws the same actor.

## Where its UI is

- Not active by default. On the first GM load it whispers a "Welcome to Tidy 5e Sheets" card and a notice about the removed Classic sheets to every GM account.
- Choose it per actor: sheet header, Toggle Controls, **Sheets** (Configure Sheet), then "Tidy5e Character Sheet Quadrone". The choice is stored as the actor flag `core.sheetClass`. Registered classes: `dnd5e.Tidy5eCharacterSheetQuadrone` (and the NPC, encounter, group, vehicle and item counterparts).
- Configure Settings > Tidy 5e Sheets: 18 visible settings.
- Sheet tabs seen: Sheet, Character, Inventory, Spells, Features, Effects, Biography, Journal.

## Settings we use and why

Keys are `tidy5e-sheet.<key>`; defaults unless noted.

| Label (client)                           | Key                             | Scope | Value         | Why                                                                   |
| ---------------------------------------- | ------------------------------- | ----- | ------------- | --------------------------------------------------------------------- |
| Item Identification Permission           | `itemIdentificationPermission`  | world | gm-and-owners | leave                                                                 |
| Use Group Sheet Member Security          | `useGroupSheetMemberSecurity`   | world | off           | leave; on hides members from players who do not own them (not tested) |
| Default Death Save Roll                  | `defaultDeathSaveRoll`          | world | public        | leave                                                                 |
| Character Sheet Tab Section Organization | `characterSheetTabOrganization` | world | origin        | leave                                                                 |

## How it interacts with the AI Tool

- **Reads and writes survive.** With Test Hero on the Tidy sheet, `plan-actor-change` damage of 3 changed HP 28 to 25 and the open sheet showed 25 at once; `undo-change` put it back to 28 and the sheet followed. The sheet only draws actor data, so no tool needs to know it is there.
- **Rolls from the sheet are logged.** Using the Longsword from the sheet opened dnd5e's attack roll dialog; `get-recent-events` recorded an `item-use` and a `roll` (1d20 + 3 + 2 = 7) as it does for dnd5e's own sheet.
- The sheet choice is an actor flag, not a world setting; `get-character` ignores it.
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest `compatibility` is minimum 14, verified 14: it will not load on 13.
- **Tokenizer conflict.** `vtta-tokenizer` registers a portrait menu command through Tidy's API; Tidy 14.4.0 answers "This feature is no longer supported" at load, and the Tokenizer button is missing from the Tidy sheet header (header buttons seen: Copy image file path, Detach Window, Prototype Token). Tokenizer still works from its other entry points (not re-checked).
- Opening a Tidy sheet from a script by constructing the class (`new Tidy5eCharacterSheetQuadrone({document})`) fails with `_browseAddDocumentItemTypes is not a function`; set the actor's `sheetClass` flag and render `actor.sheet` instead.
- `dae`, `autoanimations`, `quick-insert`, `dnd5e-item-resources` and `foundryvtt-actor-studio` all read Tidy's API and loaded with it without errors (37 modules active, no errors).
- Removing it leaves only the `core.sheetClass` flag on actors that chose it; Foundry falls back to the default sheet.
- Pi: nothing platform-specific found.

## Sources

- Repo: https://github.com/kgar/foundry-vtt-tidy-5e-sheets
- `C:\FoundryTestB\data\Data\modules\tidy5e-sheet\module.json`; source read: `tidy5e-sheet.js` (the API classes, the portrait menu warning).
