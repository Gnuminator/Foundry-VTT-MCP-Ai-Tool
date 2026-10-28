# Monk's TokenBar (`monks-tokenbar`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 14.01, 2026-10-28 (test server C; the module's request dialog, the combat movement switch and the save card were driven live; player-side rolling, the Assign XP dialog and loot were not).

**Verdict: drop.** Saves rolled from its request cards are written into its own chat card and no dnd5e roll message is created, so the play recorder, session log, recaps and stats miss every one of them. dnd5e 6's own roll requests and our `request-player-rolls` are logged. Keep it only if Danni wants its bar badly enough that we teach the recorder to read its cards.

**For Danni's guides:** The bar of your players' faces on the canvas: click a face to jump to that token; the dice button asks everyone for the same save in one go (but the AI's recap will not see those rolls).

## What it does

- Shows the party's tokens (owned by a player and friendly) as a small floating bar with AC and passive Perception per token. Clicking a face pans to the token.
- The GM's group dialogs: Request Roll (ability, saving throw, skill, plain dice, tools; optional DC; public, private GM, blind or self roll mode; "Request" or "Request with Roll"), Contested Roll between two tokens, Assign XP (opens after a fight, splits XP evenly).
- Movement limits for the party: Free Movement, No Movement, Combat Turn (only the token whose turn it is can move). Starting a combat switched it to Combat Turn by itself and showed "Movement changed to Combat Turn" (setting `change-to-combat`).
- Optional lootable conversion of dead NPCs (needs a loot sheet; not used).

## Where its UI is

- A floating window on the canvas, `#tokenbar`, with a collapse arrow, a controls toggle and a close button. Its buttons, left to right: Free Movement, No Movement, Combat Turn, Request Roll, Contested Roll, Assign XP.
- Settings: Game Settings, Configure Settings, Module Settings, Monk's TokenBar.
- The Request Roll dialog is titled "Request Roll"; the roll list is on the right, the actor list on the left, and the two buttons at the bottom are "Request with Roll" and "Request".

## Settings we use and why

Key prefix `monks-tokenbar.`; defaults unless noted.

| Label (key)                                                          | Value         | Why                                                                     |
| -------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------- |
| Allow player (`allow-player`)                                        | off (default) | Players get no request buttons.                                         |
| Change to combat (`change-to-combat`)                                | on (default)  | Party movement becomes combat-only while a fight runs. Tell Danni.      |
| Show XP dialog (`show-xp-dialog`)                                    | off if kept   | We award XP by session, not per fight (not verified).                   |
| Lootable menu, auto gold, loot sheet (`show-lootable-menu` and more) | off           | `loot-sheet` defaults to Monk's Enhanced Journal, which we do not run.  |
| Capture saving throws (`capture-savingthrows`)                       | off           | Would pull sheet-rolled saves into the card; not tested (not verified). |

Remember to set `movement` back to `free` after a fight if combat ends by deleting the combat: it is a world setting that stays on Combat Turn until the module resets it (not verified for a normal end of combat).

## How it interacts with the AI Tool

- **Log gap (verified, same as the 2026-10-04 walkthrough on 14.01):** "Request with Roll" for Test Hero produced exactly one chat message, `type: base`, flag `monks-tokenbar` with the request and result, and one embedded roll (1d20 + 3 + 2 = 9). It carries no `flags.dnd5e` and no dnd5e `system` data, which is what `play-recorder.ts` reads for saves. So `get-session-log`, the play recorder, recaps and stats will not count a TokenBar save. Rolls from dnd5e 6 chat-card buttons and from `request-player-rolls` / `roll-saving-throws` are recorded.
- No tool calls the module. A save the AI requests and one TokenBar requests are separate cards; answering one does not answer the other.
- The bar only lists friendly, player-owned tokens, so NPC tokens the bridge creates will not appear.
- The movement lock acts on players. Whether it stops a bridge token move (`plan-token-change`, which runs as the GM) was not tested (not verified).
- Kit scenario: none. Add one only if the module is kept (request a save through the module, assert the log gap is closed).

## Gotchas on Foundry 14 / dnd5e 6

- Manifest `compatibility.verified` is "14" (no minor). The module has no libWrapper or socketlib dependency.
- The request dialog is a v14 application: a click through the accessibility tree on "Request" missed during the 2026-10-04 walkthrough while a click by position worked, with four "Cannot set properties of null (setting 'hidden')" errors nearby, cause unclear (not re-checked).
- Old data: the module logs missing token images from the old Frostmaiden world (Tokenizer folder missing); harmless.
- Disabling the module leaves its flags on chat messages and its world settings; nothing else.
- Pi: nothing platform-specific found.

## Sources

- Repo and README: `C:\FoundryTest\data\Data\modules\monks-tokenbar\README.md`, `CHANGELOG.md`, `module.json`; upstream https://github.com/ironmonk88/monks-tokenbar.
- Source read: `settings.js`, `apps/tokenbar.js`, `apps/savingthrow.js`.
- Vault `Dev/Foundry AI Tool/Design/Module walkthrough plan.md` (2026-10-04 findings).
- Repo: `packages/foundry-module/src/play-recorder.ts` (what counts as a save).
