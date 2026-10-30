# Not Your Turn! (`NotYourTurn`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 4.1.0, 2026-10-28 (test server B). Parts not clicked through are marked "(not verified)".

**Verdict: keep.** It is small (one script, no data written to actors or scenes), 4.0.0 was reworked for v14 and 4.1.0 is dated August 2026. It stops players wandering off in combat, and the AI Tool runs as a GM, for whom it only warns by default. The manifest says verified "14", not 14.368, and the README still says "tested on v13", but the move hook fires on 14.368 (see below). Player-side behaviour (the dialog, Request) was not tested (not verified).

**For Danni's guides:** In a fight, a player who drags their token on someone else's turn gets a pop-up: they can undo the move or ask you to allow it.

## What it does

Version 4.1.0. It hooks `preMoveToken` (Foundry 14's token movement) and, when a user who owns the token moves it while it is not that token's turn in a started combat, it warns, asks, or cancels the move by returning `false`. Out of combat nothing is blocked unless the GM turns on the non-combat toggle. A dialog offers Undo, Ignore (if allowed for that user) and Request (asks a GM over its socket to accept or decline; the GM can undo the move). It resets its remembered choice on `combatTurnChange`.

## Where its UI is

- Scene controls, basic controls (left bar), GM only: two toggles, "Block Combat Movement" (setting `enable`, default on) and "Block Non-Combat Movement" (setting `nonCombat`, default off).
- Game Settings, Configure Settings, Not Your Turn: the settings below.
- Pop-ups: "It's not your turn!" for the player, "Movement Request" for the GM.

## Settings we use and why

Recorded in `scripts/modules/strahd-modules.json` (`worldSettings`, checked by a test). Drop-down values: 0 Off, 1 Warning Only, 2 Dialog Box, 3 Autoblock. With Autoblock a player gets no dialog, so the Request button never shows for them; the move is just cancelled. Key prefix `NotYourTurn.`; all settings are world scope, so one set for the whole table. Values seen live on server B (a fresh install): `BlockPlayer` 2, `BlockTrusted` 2, `BlockAssistant` 1, `BlockGM` 1, `IgnoreButton` 2, `RequestButton` on, `ChatMessages` on, `AlwaysBlock` off, `OnlyOncePerCombatTurn` off, hidden `nonCombat` off, `enable` on. The drop-downs store the 0-based option value; the labels offered for Ignore Button are Everyone, Trusted & Up, Assistants & Up, Gamemaster only, Nobody. The defaults column below comes from the source and matches these values.

| Label                            | Key                     | Default           | Our value                                                                                                  |
| -------------------------------- | ----------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Player                           | `BlockPlayer`           | Dialog Box        | **Autoblock** (3; Danni 2026-10-30: block completely)                                                      |
| Trusted                          | `BlockTrusted`          | Dialog Box        | **Autoblock** (3)                                                                                          |
| Assistant                        | `BlockAssistant`        | Warning Only      | leave (1)                                                                                                  |
| Gamemaster                       | `BlockGM`               | Warning Only      | leave; do not set to Dialog Box or Autoblock (see AI Tool section)                                         |
| Ignore Button                    | `IgnoreButton`          | Assistants and up | leave, so players must use Request                                                                         |
| GM Request Button                | `RequestButton`         | on                | leave on                                                                                                   |
| Chat Messages                    | `ChatMessages`          | on                | consider off: it whispers the GM (several copies seen) when a token moves out of turn in Warning Only mode |
| Always Block Combat Movement     | `AlwaysBlock`           | off               | leave                                                                                                      |
| Only ask once per combat turn    | `OnlyOncePerCombatTurn` | off               | consider on, so a player is asked once, not on every nudge                                                 |
| Block Combat Movement toggle     | `enable`                | on                | on during fights                                                                                           |
| Block Non-Combat Movement toggle | `nonCombat`             | off               | off for exploration                                                                                        |

## How it interacts with the AI Tool

Kit scenario: none yet, none earned (it only warns for the GM account, changes no data and does not alter any tool result).

Grep of `packages/`, `docs/`, `scripts/` finds no mention of the module. Source reading plus one live test:

- **Combat tools.** `advance-combat-turn` calls `combat.nextTurn()` (`data-access/combat.ts`); the module only reacts by clearing its remembered choice. No interaction.
- **Roll and use-item tools.** `request-ability-check`, `request-attack-roll`, `use-item`, `roll-*` do not move tokens and the module does not look at them. No interaction.
- **Token tools.** `plan-token-change` and the NPC turn helper move tokens by updating `x` and `y` in the GM's client (`live-plan-token.ts`, `scenes-tokens.ts`). The module's check applies to the acting user's role: the AI Tool acts as the GM (role 4), whose default is Warning Only, so the move goes through. Verified live on 14.368 as GM: with another creature as the current combatant, a plain `tokenDocument.update({x: x+100})` on a token (what a token-move tool does) was not blocked (the token moved 100) but did trigger the module: a "It's not your turn!" notification on the GM's screen and several whispered chat messages to the GM ("<token> moved when it was not their turn"). So a plain `x`/`y` update does fire the hook. Consequences:
  - An AI-planned token move out of turn adds whispered noise to `get-chat-log`; turn `ChatMessages` off if that bothers the GM.
  - If the GM setting is ever raised to Dialog Box or Autoblock, an AI-planned token move could be blocked or open a dialog nobody answers (not verified).
- Undo of a token change writes the old position back, which is also a move; same rules.
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest: minimum 13, verified "14" (no minor). v4.0.0 (2026-06-16) is the v14 rework. README text is older (v13).
- Players can still move with other tools that do not trigger `preMoveToken` (for example direct token drag handled by another module); it is a courtesy, not security.
- Uses a socket (`module.NotYourTurn`) for the Request button; the GM must be on the same scene or the request is declined ("GM is not on the same scene").
- Needs a started combat (`combat.started`); a combat that exists but has not begun counts as no combat.
- Removing the module leaves only its world settings.
- Pi: nothing platform-specific found.

## Sources

- Repo: https://github.com/STBaf/NotYourTurn ; `README.md`, `changelog.md` on disk.
- `C:\FoundryTest\data\Data\modules\NotYourTurn\module.json`, `NotYourTurn.js` (hooks, role check), `src\settings.js`, `lang\en.json`.
- Repo: `packages/foundry-module/src/data-access/combat.ts`, `live-plan-token.ts`, `data-access/scenes-tokens.ts`.
