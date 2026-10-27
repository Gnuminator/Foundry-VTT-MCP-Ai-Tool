# Actor Studio, AI Tool fork (`foundryvtt-actor-studio`)

Not verified live: drafted from the module's manifest, docs and source on disk, 2026-10-27; live check pending.

**Verdict: keep.** The table builds its characters with it (players make level-1 heroes at session 0, D-112/D-113), and the test kit drives it. We run our own fork, `2.10.5-aitool.4`, not the upstream release.

**For Danni's guides:** Actor Studio is the character builder: one window with tabs for abilities, species, background, class, equipment and spells, and a Create Character button at the end.

## What it does

A step-by-step window for making and levelling D&D 5e characters. Tabs (from `lang/en.json`): Abilities, Species (called Races for 2014 data), Background, Class, Equipment, Shop, Biography, plus an Advancements tab that catches the system's advancement prompts instead of letting them pop up as dialogs. Ability scores can be manual, standard array, point buy or rolled. It also adds a Level Up button on the character sheet (setting `enableLevelUp`) and can add multiclass levels.

It reads its choices from compendium packs you assign per step ("Compendium Sources"), so what a player sees depends entirely on which packs are ticked.

The manifest says Foundry 11 to 14 and dnd5e 3.0.0 to 6.999 (verified 6.0.3). Upstream author: Noel da Costa (Aardvark Games). The fork lives at `Gnuminator/foundryvtt-actor-studio`.

## Where its UI is

- A button in the sidebar actors tab and a button in the Create Actor dialog (setting "Show button in sidebar" and "Create Actor dialog button"; the sidebar one needs a browser refresh) (not verified).
- Level Up button on the character sheet header when Enable Level Up is on (not verified).
- Settings: Game Settings, category **[Aardvark Games] Actor Studio (AI Tool fork)**, with Configure buttons such as Compendium Sources (see `docs/gm/prepare-session-0.md`, section 3).
- A welcome window on first load unless `dontShowWelcome` is ticked (not verified).

## Settings we use and why

Keys are `foundryvtt-actor-studio.<key>`. Names are the client labels from `lang/en.json`.

| Label                                                         | Key                                                          | Our value                                                                                                                               | Why                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Enable Equipment Selection                                    | `enableEquipmentSelection`                                   | on                                                                                                                                      | Players pick starting equipment; stage 13 of `docs/dev/PI-SETUP.md` sets it                                                           |
| Compendium Sources                                            | `compendiumSources`                                          | equipment = `["dnd-players-handbook.equipment"]`; species, background, class, subclass, spell and feat from the Player's Handbook packs | The table keeps to the 2024 book. Untick the system (dnd5e) packs or every choice shows twice                                         |
| Usage tracking (per user)                                     | `usage-tracking`                                             | off for everyone                                                                                                                        | Privacy; the fork defaults it off and stage 13 turns it off for any user who saved it on. Label not found in `en.json` (not verified) |
| Enable Equipment Purchase                                     | `enableEquipmentPurchase`                                    | see the GM guide (not verified)                                                                                                         | Adds the Shop tab for characters that got starting gold                                                                               |
| Enable Level Up / Milestone Levelling                         | `enableLevelUp`, `milestoneLeveling`                         | GM's choice (not verified)                                                                                                              | Milestone shows Level Up without needing the XP                                                                                       |
| Force D&D5e Level Up Automation                               | `forceDnd5eLevelUpAutomation`                                | leave as default                                                                                                                        | The hint says Actor Studio cannot apply changes without it                                                                            |
| Enable LLM Name Generation, License Tracker, Donation Tracker | `enableLLM`, `enableLicenseTracker`, `enableDonationTracker` | leave off (not verified)                                                                                                                | They call outside services or ask for a licence key; the LLM key is a secret, never put one in the repo                               |

World permission: `core.permissions` must let Player and Trusted Player create actors (`ACTOR_CREATE`). Without it Actor Studio tells the player "User requires the 'Create New Actors' permission". Stage 13 sets it on the Pi.

## How it interacts with the AI Tool

- No bridge handler or tool depends on it. It creates ordinary dnd5e actors and items, so `list-characters`, `get-character` and the guarded actor writes see its output like any other character.
- The test kit drives it: the `heroes-studio` scenario builds a hero per class in Actor Studio's own windows and compares it with the raw kit hero; `player-character-creation` does the same as the kit player in its own browser (`docs/dev/TEST-KIT.md`). The scenario fails with advice if the module is not active; run `kit init` once on a kit world.
- The kit holds a list of known findings (`lib/studio-expected.mjs`) that is version-aware: entries with a `fixedIn` fork build are dropped for the fork, so a fixed finding that returns on the fork fails the run.
- Our writes do not collide with it; the module acts only while its window is open.

## Gotchas on Foundry 14 / dnd5e 6

- Upstream 2.10.5 is not enough for us. The fork `2.10.5-aitool.1` to `.4` fixes (per TEST-KIT): the Subclass advancement, a selector error, a 404, a missing spell-slot spend, and filling spell slots again when a level up ends. Do not let Foundry's own Update replace the fork with upstream; the fork's manifest URL points at its own GitHub releases.
- The Pi installs the fork from the release `module.zip` pinned by sha256 (stage 13). Stage 11 swaps in the PC's copy of the module and resets `strahd-kit`, so run stage 13 again after it. Never change a Pi setting outside a stage script (CLAUDE.md).
- Settings are read when the page loads: tell players to press F5 after the GM changes sources.
- The module logs usage when `usage-tracking` is on; keep it off for everyone (see above).
- A world without the module keeps the actors it made (plain actors); nothing is left behind except the module's own settings and flags (not verified).
- The module ships its own test bundles in `dist/*-tests-*.js`; they do nothing at the table.

## Sources

- Fork repo: https://github.com/Gnuminator/foundryvtt-actor-studio (upstream: geoidesic / Aardvark Games)
- `C:\FoundryTest\data\Data\modules\foundryvtt-actor-studio\module.json`, `lang/en.json`, `dist/` (key names by grep)
- `docs/dev/TEST-KIT.md` (heroes-studio, fork fixes), `docs/dev/PI-SETUP.md` (stage 13), `docs/gm/prepare-session-0.md` section 3
