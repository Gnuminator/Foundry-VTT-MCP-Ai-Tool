# Monk's Common Display (`monks-common-display`)

Verified on Foundry 14.369 / dnd5e 6.0.6, module 14.01, 2026-10-28 (test server C). Only the load and the settings window were checked; the display itself was not run (not verified).

**Verdict: optional.** It turns one player login into a clean map-only screen for a TV at the table, which is only useful if the group plays in the same room. For an online campaign it does nothing, and a login set as the display loses its normal screen.

**For Danni's guides:** If you play in person and have a TV, log a spare player in on it. This module hides the buttons and shows only the map, and you choose what it shows from your own screen.

## What it does

- README: a player marked as the common display sees only the canvas (you pick which parts stay: chat log, combat tracker, camera views). A small toolbar on the GM side clears shared images and journals and chooses what the display follows (what the GM sees, or a chosen token).
- Verified: the settings window "Monks Common Display" opens and lists only players (the test world's `Player` user), not GMs, with a Display drop-down and "Save Changes". The display itself was not started (not verified).
- Can be set from the player list by right-click, "Set as Common Display" (README, not verified).

## Where its UI is

- **Game Settings > Monk's Common Display**: 16 entries plus two menus (reset position, configure).
- GM toolbar icon beside the normal toolbar toggles the display toolbar (not verified).
- It uses a module socket to move the display's view.

## Settings we use and why

We leave defaults. If the table has a TV, set these:

| Label                      | Key                                     | Scope | Default | Why                                                    |
| -------------------------- | --------------------------------------- | ----- | ------- | ------------------------------------------------------ |
| Hide UI                    | `monks-common-display.hide-ui`          | world | on      | the point of the module                                |
| Allow Assistant GM Players | `monks-common-display.allow-gm-players` | world | off     | needed if the display login is an assistant GM         |
| Show Chat log              | `monks-common-display.show-chat-log`    | world | on      | turn off if chat could show whispers or spoilers on TV |
| Show Combat                | `monks-common-display.show-combat`      | world | on      | keep the turn order on the TV                          |
| Just Friendly              | `monks-common-display.just-friendly`    | world | on      | only friendly tokens are followed                      |

## How it interacts with the AI Tool

- No interaction found: the module reads and drives the display client's view, and our tools never touch that.
- Spoiler note: a display login sees what its player user sees, so make the display a plain player with no ownership of hidden actors, and leave the chat log off if the GM whispers a lot. Our player view of Tarokka and handouts is the normal Foundry visibility and applies to it as well.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest: Foundry 14 minimum, verified 14. No dnd5e code.
- Setting a player as display hides that player's UI, so do not pick a real player who also plays from their own computer.
- Settings stay in the world after the module is turned off (not verified); the user flag that marks the display user stays on the user.
- It only makes sense on a real screen; the Pi runs no browser, so nothing changes there.

## Sources

- <https://github.com/ironmonk108/monks-common-display>, `README.md`, `module.json` in `C:\FoundryTestC\data\Data\modules\monks-common-display`.
- Live: `game.settings.settings` for the namespace and the opened configure window, server C.
- Vault `Design/Module walkthrough plan.md` (group C, no load errors).
