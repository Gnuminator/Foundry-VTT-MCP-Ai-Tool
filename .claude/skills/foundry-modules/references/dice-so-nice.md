# Dice So Nice! (`dice-so-nice`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 6.4.4, 2026-10-28 (test server B). Parts not clicked through are marked "(not verified)".

**Verdict: keep.** Version 6.4.4 requires Foundry 14 and is verified on 14.368. Rolls are still decided by Foundry; the module only animates them, and our bridge adds two dice colour sets to it (from source). The two costs are a short delay before roll cards appear and its heavy asset set, both manageable with settings.

**For Danni's guides:** Your dice roll across the screen in 3D, and the result shows in chat a moment later when they land.

## What it does

It listens for new chat messages that contain rolls and plays a 3D dice animation on every connected client (it also uses its own socket channel `module.dice-so-nice`). While the dice fly, it hides the roll's chat card (and initiative values in the tracker) until the dice stop. It adds per-player dice appearance (colours, materials, fonts), dice "roles" (appearance by roll type or damage type), sound, persistent tabletop dice and optional interactive throws (a player throws the dice to reveal a roll). It exposes `game.dice3d`, an API (`api.js`: `addColorset`, `addSystem`, `addDicePreset`, `addDamageTypeDecoration` and others) and hooks such as `diceSoNiceReady`, `diceSoNiceRollStart` and `diceSoNiceRollComplete`.

## Where its UI is

- A "3D Dice Settings" entry in the character sheet's three-dot header menu, and a "3D Dice Settings" button in Game Settings for each player's own look (tabs: Appearance, Preferences, Display, Special Effects, Profiles and Data) (the tab list is from the source, not verified).
- Game Settings, Configure Settings, Dice So Nice: 24 entries, with the menus `dice-so-nice` (3D dice configuration), `rollable-area`, `dice-roles-config` (Configure Dice Roles, GM) and `custom-diceterm-config`.
- A sidebar tab unless `hideSidebarTab` is on (it is off by default).

## Settings we use and why

Keys are `dice-so-nice.<key>`. World = the GM's, applies to all; the look settings live in a per-user `settings` entry.

| Label                            | Key                              | Scope | Default                                             | Our value                                                                                       |
| -------------------------------- | -------------------------------- | ----- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Display chat message immediately | `immediatelyDisplayChatMessages` | world | off                                                 | consider on for a long fight; it also switches interactive throws off                           |
| Disabled during combat           | `disabledDuringCombat`           | world | off                                                 | consider on if combat feels slow (not verified)                                                 |
| Disabled for Initiative rolls    | `disabledForInitiative`          | world | off                                                 | consider on: a roll-all-initiative call otherwise animates every NPC                            |
| Disable 3D dice on NPC rolls     | `hideNpcRolls`                   | world | off                                                 | consider on: our NPC roll tools then skip the animation                                         |
| Max Number of Dice               | `maxDiceNumber`                  | world | 20                                                  | leave                                                                                           |
| Global animation speed           | `globalAnimationSpeed`           | world | "0" (Players' choice)                               | leave                                                                                           |
| Simultaneous rolls are merged    | `enabledSimultaneousRolls`       | world | on (reload)                                         | leave                                                                                           |
| Interactive dice throws          | `interactiveThrows`              | world | "1" (live value on B; `allowInteractivity` is true) | leave; or Disabled so nobody has to throw                                                       |
| Configure Dice Roles / Theme     | `roles`                          | world | Basic row: default theme                            | pick **AI Tool: The Veil** or **AI Tool: Neutral** before session 1 (docs/gm/before-session.md) |

Other live defaults on B: `showGhostDice` "0" (disabled), `hide3dDiceOnSecretRolls` true, `persistentDice` true, `animateRollTable` false, `animateInlineRoll` true, `forceCharacterOwnerAppearance` "2", `immediatelyDisplayChatMessages`, `disabledDuringCombat`, `disabledForInitiative` and `hideNpcRolls` all false. The AI Tool colour sets were not looked at in the dice picker on 2026-10-28 (not verified).

## How it interacts with the AI Tool

One real link, otherwise none:

- **Dice themes.** `packages/foundry-module/src/dice-themes.ts`, registered from `main.ts`, waits for `diceSoNiceReady` and calls `addColorset` for "AI Tool: The Veil" and "AI Tool: Neutral" (category "AI Tool"). Without the module the hook never fires and nothing happens. Documented in `docs/gm/features.md` (Themed dice) and `docs/gm/before-session.md`.
- **Roll tools.** `request-attack-roll`, `request-ability-check`, `use-item`, `roll-npc-check`, `roll-saving-throws`, `roll-initiative-for-npcs` evaluate the roll and create the chat message in the GM client (`actor-builder.ts`, `combat.ts`). They await dnd5e's roll promise, not the animation, so the numbers come back as before. The module only delays when the card is shown to people; the chat message document exists at once, so `get-chat-log` and the play recorder read it normally (not verified live). Live check: a skill check through `actor.rollSkill`, the same dnd5e call path our roll tools use, returned in 25 ms and made one chat message while two d20s (disadvantage) animated on the canvas, so the roll promise does not wait for the animation.
- **Player rolls.** `request-player-rolls` posts roll buttons in chat (`player-rolls.ts`); the player's click rolls on their client and animates there.
- `advance-combat-turn` rolls no dice; no interaction.
- Kit scenario: none yet, none earned. The module is cosmetic and the roll promise does not wait for it, so no kit result changes with it on or off.
- No `foundry-mcp-bridge` setting is needed. The dashboard e2e (`packages/cogm-dashboard/web/e2e/diagnostics.spec.ts`) uses `module:dice-so-nice` only as a sample module name in a fake error stack.

## Gotchas on Foundry 14 / dnd5e 6

- **Missing asset error.** `docs/history/LIVE-VERIFICATION-2026-06-16.md` records a console 404 for `celticlynx/d2-2b.webp`; `docs/dev/RUNTIME-TEST-PLAN.md` lists "dice-so-nice's missing asset" as out of scope (not ours). Expect it in the Diagnostics panel; it does not stop rolls. Whether 6.4.4 still logs it is (not verified): the 2026-10-28 run did not see it in the console errors that were still buffered, which does not settle it either way.
- **Chat delay.** Roll cards stay hidden until the dice land. With many dice (a fireball, an NPC group) that is a few seconds. A kit or recording step that waits for a card should allow for it.
- **Interactive throws** make a roll wait for a player to throw only when the user opts in or the system asks; dnd5e does not ask (not verified). Leave world setting off if a rolling tool ever stalls.
- Heavy: large textures, sounds and WebGL; weak laptops may stutter. The Pi only serves files, so no Pi cost.
- Removing the module may leave a `dice-so-nice` flag on users and its settings behind; harmless (from source, not verified).

## Sources

- Repo: https://gitlab.com/riccisi/foundryvtt-dice-so-nice
- `C:\FoundryTest\data\Data\modules\dice-so-nice\module.json`, `lang\en.json`, `api.js`, `main.js` (settings registration, hooks).
- Repo: `packages/foundry-module/src/dice-themes.ts`, `docs/gm/features.md`, `docs/gm/before-session.md`, `docs/dev/RUNTIME-TEST-PLAN.md`, `docs/history/LIVE-VERIFICATION-2026-06-16.md`, `packages/cogm-dashboard/web/e2e/diagnostics.spec.ts`.
