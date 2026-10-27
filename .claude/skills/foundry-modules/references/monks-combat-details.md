# Monk's Combat Details (`monks-combat-details`)

Status: source and README read (version 14.03, Foundry 14 verified). Live pass on a test server: pending.

## What it does

Quality of life for combat: turn alerts with sound ("you are next", "your turn"), the tracker pops out when combat starts and closes at the end, the current combatant is kept in view, player characters sort to the top while rolling initiative, a warning if you start before everyone has rolled, enemy names hidden until their first turn, auto-defeat at 0 HP, a combat CR estimate, a combat playlist swap, separate token bars in combat, and clear targets / pan to token on your turn.

## Where the UI is

- Settings: Module Settings > Monk's Combat Details (about fifty options, many client scope).
- The combat tracker and a toast overlay for turn alerts.

## Settings we would use, and why

| Setting                               | Value                  | Why                                                                                                                 |
| ------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `prevent-initiative`                  | on (default)           | Warns before starting with unrolled combatants.                                                                     |
| `hide-enemies` / `hide-until-turn`    | on / on                | Players do not see the monster list until it acts (spoiler-safe). Check against the AI Tool's roll-initiative flow. |
| `auto-defeated`                       | default (NPCs at 0 HP) | Removes "dead but still in the order" noise.                                                                        |
| `show-combat-cr`                      | on (default)           | A hint for a new GM.                                                                                                |
| `popout-combat` / `switch-combat-tab` | default on             | Less clicking.                                                                                                      |
| `show-combat-playlist`                | off                    | We use the playlist tool.                                                                                           |
| `disablesounds`                       | off                    | Players mute their own volume (`volume`, client scope).                                                             |

## How it interacts with the AI Tool

- `roll-initiative-for-npcs`, `set-initiative`, `advance-combat-turn` change the Combat document; Monk's reacts to the same hooks (alerts fire, the tracker scrolls, defeated state is set). It does not need the bridge.
- `hide-enemies` hides combatants from players; the GM-only `get-combat-state` still lists them.
- Monk's round chat messages (`round-chatmessages`) land in `get-chat-log`; switch that off if the log gets noisy.
- `auto-defeated` marks combatants defeated when a guarded HP change takes them to 0; undo reverts HP but may not un-defeat. Verify in the live pass.

## Gotchas

- Large settings surface: change only the few above.
- `reroll-initiative` is registered twice in the source; harmless.
- Custom turn-message HTML files cannot be picked with Foundry's file picker; type the path.
- Possible overlap with Combat Tracker Dock (installed): the pop-out tracker may fight the dock; check both on in the live pass.

## Verdict

Draft: **keep.** Combat feels guided for a new GM with few clicks, and monster names stay hidden from players. Costs: many options (leave defaults), a sound on every turn. Final verdict after the live pass.

## Danni's guide line

"It pops the combat list up, tells each player when they are next, and keeps monster names hidden until they act."
