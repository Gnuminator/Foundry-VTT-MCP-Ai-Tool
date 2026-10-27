# Monk's TokenBar (`monks-tokenbar`)

Status: source and README read (version 14.01, Foundry 14 verified). Live pass on a test server: pending (see "Live check").

## What it does

- A bar of the party's tokens along the top of the canvas (owned by a player and friendly). Click a token to pan to it; right-click for sheet, token, target and a per-token movement limit.
- Group roll dialogs for the GM: saving throw / ability / skill requests to several tokens at once (optional DC, roll mode public / private GM / blind / self), contested rolls between two tokens, and an Assign XP dialog that opens after a fight with the XP split evenly.
- Movement limits: free, none, or combat-only (only the token whose turn it is moves).
- Optional lootable conversion of dead NPCs (needs a loot sheet; we use `lootsheet-simple`, not Monk's Enhanced Journal, so leave it off).

## Where the UI is

- The bar sits on the canvas; its buttons (saving throw, contested roll, assign XP, movement) are under the bar. Settings: Game Settings > Configure Settings > Module Settings > Monk's TokenBar.
- Roll requests show as chat cards with a roll button for the player.

## Settings we would use, and why

| Setting                                            | Value         | Why                                                                                      |
| -------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `allow-player`                                     | off (default) | Players do not get the GM's request buttons.                                             |
| `change-to-combat`                                 | on (default)  | Movement becomes combat-only while a fight runs. Danni should know it exists.            |
| `show-xp-dialog` / `npc-xp-sharing`                | on / off      | XP prompt after a fight; if the table awards milestone XP this can be switched off.      |
| `show-lootable-menu`, `auto-gold-cr`, `loot-sheet` | off           | The loot flow belongs to a loot module; `loot-sheet` defaults to a module we do not run. |
| `capture-savingthrows`                             | off           | Would capture saves rolled from sheets into the request. Test before enabling.           |
| `request-roll-sound-file`, `gm-sound`              | default       | Player alert sound is client scope.                                                      |

## How it interacts with the AI Tool

- **Log gap (walkthrough 2026-10-04, 14.01):** a save rolled from TokenBar's request card is not seen by the session log or play recorder (see Verdict).
- No tool calls it. Our `request-player-rolls`, `request-ability-check`, `roll-saving-throws` use the bridge's own roll path and chat cards; TokenBar's "Request" cards are a second, separate path. Both can be used in one session, but a roll made on one card does not answer the other.
- TokenBar reads token disposition and ownership: a token the bridge creates with non-friendly disposition will not appear in the bar.
- Whether the movement lock stops a token move made through a bridge token tool is unverified; test in the live pass before telling Danni "the AI can still move tokens in combat".
- Group saves are chat messages; they appear in `get-chat-log`.

## Gotchas

- A token missing from the bar: check friendly disposition and player ownership first (the README says so itself).
- Request cards need an active GM connected (the module sends sockets). No libWrapper or socketlib dependency.
- The README references screenshots that are not shipped; ignore the broken image links.
- Version scheme is `<foundry major>.<minor>`; 14.01 is the first Foundry 14 build.

## Verdict

Draft: **drop (recommended), or keep only if Danni wants its bar and we teach the recorder to read its cards.** The module walkthrough (2026-10-04, vault `Design/Module walkthrough plan.md`) found that TokenBar writes a save result into its own chat card (a message update) and posts no dnd5e roll message, so the session log, play recorder, recaps and stats miss every save rolled from its cards. dnd5e 6's own roll requests and our `request-player-rolls` are logged. The bar and group-request dialog are nice for a GM new to Foundry, which is the case for keeping. Re-verify the log gap on the newest version in the live pass.

## Danni's guide line

"The bar of your players' faces at the top: click one to jump to them; the dice button asks everyone for the same save in one go."
