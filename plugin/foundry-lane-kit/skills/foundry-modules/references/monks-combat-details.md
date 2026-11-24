# Monk's Combat Details (`monks-combat-details`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 14.03, 2026-10-28 (test server C; the start-combat check, the tracker pop-out, auto-defeat and the CR line were seen live; turn sounds, hide-enemies from a player's view and the playlist feature were not).

**Verdict: keep.** It guides a new GM through a fight with few clicks, and nothing it does clashes with the AI Tool. It is optional and a matter of Danni's taste. Its one visible interaction is a confirm dialog when combat is started by hand before everyone has rolled initiative.

**For Danni's guides:** It pops the combat list up when a fight starts, warns you if someone has not rolled initiative, and marks monsters as defeated at 0 HP.

## What it does

- **Start check (seen):** starting a combat with an unrolled combatant opens "Not all Initiative have been rolled... Do you wish to continue with starting the combat?" with Yes and No.
- **Pop-out (seen):** once combat started the tracker opened as its own window ("Combat Tracker", Round 1) and the Test Cleric row was highlighted.
- **CR estimate (seen):** the encounter header showed "CR: 1/4" for the combat (setting `show-combat-cr`, on by default).
- **Auto-defeat (seen):** with the default `auto-defeated` value (NPCs at zero), setting Wolf 1's HP to 0 marked its combatant defeated and the token dead; setting HP back to 11 cleared both. So an undo of a damage change also undoes the defeat.
- Also: turn and next-up alerts with sound, "Round N" chat card, current combatant kept in view, clear targets and pan on your turn, enemy names hidden from players, combat bars, playlist swap (not exercised).

## Where its UI is

- Settings: Module Settings, Monk's Combat Details (about fifty options, many client scope).
- The combat tracker window and the alerts shown as toasts.

## Settings we use and why

Key prefix `monks-combat-details.`.

| Label (key)                                                       | Value                                           | Why                                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Prevent initiative (`prevent-initiative`)                         | on (default)                                    | The "not all rolled" warning.                                                                                                               |
| Hide enemies, hide until turn (`hide-enemies`, `hide-until-turn`) | off (default); on to hide monsters from players | Adding a hostile combatant mid-combat with `hide-enemies` on did not hide it in our test, so check the path you use (not verified further). |
| Auto defeated (`auto-defeated`)                                   | default (`npc-zero`)                            | Removes "dead but still in the order" noise.                                                                                                |
| Show combat CR (`show-combat-cr`)                                 | on (default)                                    | A hint for a new GM.                                                                                                                        |
| Show combat playlist (`show-combat-playlist`)                     | off (default)                                   | We use the playlist tool.                                                                                                                   |
| Volume, disable sounds (`volume`, `disablesounds`)                | default                                         | `volume` is per client, so each player sets their own; `disablesounds` is world-wide.                                                       |

## How it interacts with the AI Tool

- Our combat tools change the same documents it listens to, and its features follow (turn alerts, "Round N" card, auto-defeat on an HP write). It does not need the bridge.
- **Start dialog:** a script or tool that calls `Combat#startCombat()` on a combat with an unrolled combatant waits on that dialog and times out. The kit helper rolls everyone first (`rollAll` in `gm-actions.mjs`), so kit runs are not affected. A player or GM starting a fight by hand sees the question.
- `get-combat-state` is GM-only and lists every combatant whatever the hide settings.
- `round-chatmessages` posts "Round N" cards that land in `get-chat-log`; turn that setting off if the log gets noisy.
- Kit scenario: none; the kit's `scripted-fight` already covers the combat flow with the module able to run beside it.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest verified "14". Large settings surface: change only the few above.
- `reroll-initiative` is registered twice in the source; harmless.
- Custom turn-message HTML files cannot be picked in Foundry's file picker; the path has to be typed.
- Overlap with Combat Tracker Dock (installed): both draw a tracker; check them together before G0 (not verified).
- Removing the module leaves only its world settings.
- Pi: nothing platform-specific found.

## Sources

- Repo: https://github.com/ironmonk88/monks-combat-details ; `README.md`, `CHANGELOG.md`, `settings.js` in `C:\FoundryTest\data\Data\modules\monks-combat-details`.
- Vault `Dev/Foundry AI Tool/Design/Module walkthrough plan.md` (2026-10-04); repo `scripts/test-kit/lib/gm-actions.mjs`.
