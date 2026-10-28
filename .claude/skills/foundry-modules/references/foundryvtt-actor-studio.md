# Actor Studio, AI Tool fork (`foundryvtt-actor-studio`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 2.10.5-aitool.4, 2026-10-28 (test server B). Parts not clicked through are marked "(not verified)".

**Verdict: keep.** The table builds its characters with it (players make level-1 heroes at session 0, D-112/D-113), and the test kit drives it. We run our own fork, `2.10.5-aitool.4`, not the upstream release.

**For Danni's guides:** Actor Studio is the character builder: one window with tabs for abilities, species, background, class, equipment and spells, and a Create Character button at the end.

## What it does

A step-by-step window for making and levelling D&D 5e characters. Tabs (from `lang/en.json`): Abilities, Species (called Races for 2014 data), Background, Class, Equipment, Shop, Biography, plus an Advancements tab that catches the system's advancement prompts instead of letting them pop up as dialogs. With the default settings on server B the window shows only Abilities, Species, Background and Class; Equipment, Shop and Spells appear when `enableEquipmentSelection`, `enableEquipmentPurchase` and `enableSpellSelection` are on (all three are off by default). Ability scores can be manual, standard array, point buy or rolled, but by default only manual entry is offered (`allowStandardArray`, `allowPointBuy` and `allowRolling` are all false). The title bar reads the module, Foundry, dnd5e, rules (2024) and Player's Handbook versions, and a progress bar starts at "25% Complete". The character name box defaults to the user name. It also adds a Level Up button on the character sheet (setting `enableLevelUp`) and can add multiclass levels.

It reads its choices from compendium packs you assign per step ("Compendium Sources"), so what a player sees depends entirely on which packs are ticked.

The manifest says Foundry 11 to 14 and dnd5e 3.0.0 to 6.999 (verified 6.0.3). Upstream author: Noel da Costa (Aardvark Games). The fork lives at `Gnuminator/foundryvtt-actor-studio`.

## Where its UI is

- An icon-only button (`#gas-sidebar-button`) in the header of the Actors tab (setting "Show button in sidebar", `showButtonInSideBar`, on by default). It reacts to mousedown, which is why the kit dispatches a mousedown. The Create Actor dialog has no Actor Studio button.
- Level Up button on the character sheet header when Enable Level Up is on (not verified).
- Settings: Game Settings, category **[Aardvark Games] Actor Studio (AI Tool fork)**, 11 entries, with Configure menus: compendiumSources, abilityScoresSettings, equipmentSettings, progressionSettings, uiSettings, accessControlSettings, compendiumDisplaySettings, spellSettings, diagnosticsSettings (see `docs/gm/prepare-session-0.md`, section 3).
- A welcome window opens on first load per user unless "don't show again" is ticked (`dontShowWelcome`); a player sees it too. It carries a donation advert, a Marketplace advert and Discord links, and says usage tracking is off by default in the fork.

## Settings we use and why

Keys are `foundryvtt-actor-studio.<key>`. Names are the client labels from `lang/en.json`.

| Label                                 | Key                                                                    | Our value                                                                                                                               | Why                                                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enable Equipment Selection            | `enableEquipmentSelection`                                             | on (default is off; off on server B)                                                                                                    | Players pick starting equipment; stage 13 of `docs/dev/PI-SETUP.md` sets it                                                                        |
| Compendium Sources                    | `compendiumSources`                                                    | equipment = `["dnd-players-handbook.equipment"]`; species, background, class, subclass, spell and feat from the Player's Handbook packs | The table keeps to the 2024 book. Untick the system (dnd5e) packs or every choice shows twice                                                      |
| Usage tracking (per user)             | `usage-tracking`                                                       | off for everyone                                                                                                                        | Privacy; the fork defaults it off (false on B) and stage 13 turns it off for any user who saved it on. Label not found in `en.json` (not verified) |
| Enable Equipment Purchase             | `enableEquipmentPurchase`                                              | default off (off on B); see the GM guide                                                                                                | Adds the Shop tab for characters that got starting gold                                                                                            |
| Enable Level Up / Milestone Levelling | `enableLevelUp`, `milestoneLeveling`                                   | defaults on B: Level Up on, Milestone off; GM's choice                                                                                  | Milestone shows Level Up without needing the XP                                                                                                    |
| Force D&D5e Level Up Automation       | `forceDnd5eLevelUpAutomation`                                          | leave as default (on)                                                                                                                   | The hint says Actor Studio cannot apply changes without it                                                                                         |
| Access control                        | `disableOtherActorCreationOptionsForPlayers`, `nonGmsCanOnlyCreatePCs` | leave as default (both on)                                                                                                              | Players can only make player characters                                                                                                            |

The keys `enableLLM`, `enableLicenseTracker` and `enableDonationTracker` that the source suggests did not appear in the settings registry on 14.368 (not found), so there is nothing to switch off there.

World permission: `core.permissions` must let Player and Trusted Player create actors (`ACTOR_CREATE`). Without it Actor Studio tells the player "User requires the 'Create New Actors' permission". Stage 13 sets it on the Pi.

## How it interacts with the AI Tool

- No bridge handler or tool depends on it. It creates ordinary dnd5e actors and items, so `list-characters`, `get-character` and the guarded actor writes see its output like any other character.
- The test kit drives it: the `heroes-studio` scenario builds a hero per class in Actor Studio's own windows and compares it with the raw kit hero; `player-character-creation` does the same as the kit player in its own browser (`docs/dev/TEST-KIT.md`). The scenario fails with advice if the module is not active; run `kit init` once on a kit world.
- The kit holds a list of known findings (`lib/studio-expected.mjs`) that is version-aware: entries with a `fixedIn` fork build are dropped for the fork, so a fixed finding that returns on the fork fails the run.
- Our writes do not collide with it; the module acts only while its window is open.
- Kit scenario: `heroes-studio` and `player-character-creation` (see `docs/dev/TEST-KIT.md`); `heroes-studio` passes 13/13 on the fork.

## Gotchas on Foundry 14 / dnd5e 6

- Upstream 2.10.5 is not enough for us. The fork `2.10.5-aitool.1` to `.4` fixes (per TEST-KIT): the Subclass advancement, a selector error, a 404, a missing spell-slot spend, and filling spell slots again when a level up ends. Do not let Foundry's own Update replace the fork with upstream; the fork's manifest URL points at its own GitHub releases.
- The Pi installs the fork from the release `module.zip` pinned by sha256 (stage 13). Stage 11 swaps in the PC's copy of the module and resets `strahd-kit`, so run stage 13 again after it. Never change a Pi setting outside a stage script (CLAUDE.md).
- Settings are read when the page loads: tell players to press F5 after the GM changes sources.
- The module logs usage when `usage-tracking` is on; keep it off for everyone (see above).
- Building a character, the sheet's Level Up button and what is left when the module is removed were not clicked through in the 2026-10-28 run; the kit scenarios cover the build.
- A world without the module keeps the actors it made (plain actors); nothing is left behind except the module's own settings and flags (not verified).
- The module ships its own test bundles in `dist/*-tests-*.js`; they do nothing at the table.

## Sources

- Fork repo: https://github.com/Gnuminator/foundryvtt-actor-studio (upstream: geoidesic / Aardvark Games)
- `C:\FoundryTest\data\Data\modules\foundryvtt-actor-studio\module.json`, `lang/en.json`, `dist/` (key names by grep)
- `docs/dev/TEST-KIT.md` (heroes-studio, fork fixes), `docs/dev/PI-SETUP.md` (stage 13), `docs/gm/prepare-session-0.md` section 3
