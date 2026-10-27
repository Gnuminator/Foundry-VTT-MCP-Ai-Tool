# Automated Conditions 5e (`automated-conditions-5e`)

Not verified live: drafted from the module's manifest, docs and source on disk, 2026-10-27; live check pending.

**Verdict: keep.** It is built for exactly this stack (module 14.606.4.5, verified Foundry 14.369, dnd5e 6.0.0 to 6.1.0, verified 6.0.6), so no version problem shows in the source. Our pre-flight already warns when it is missing, and our live feed already copes with its doubled condition effects.

**For Danni's guides:** This module makes conditions like frightened, prone or poisoned change dice rolls by themselves (advantage, disadvantage, auto-fail), and shows a small tooltip saying why.

## What it does

- Reads the conditions and effects on the attacker and on the target and adds advantage, disadvantage or auto-fail to attack rolls, saving throws, ability checks and skill checks, with a tooltip on the roll dialog and chat card that names the reason.
- Covers the dnd5e conditions (blinded, frightened, grappled, poisoned, prone, restrained, and so on), exhaustion, and range and visibility rules (see the options below).
- Extra opt-in rules: dodging, hiding, the Rage spell restrictions, underwater combat, the Heavy weapon property, environmental hazards, WAVES cover.
- Adds its own effect keys (Active Effect change type "AC5E", also offered in DAE) so a homebrew effect can grant advantage or bonuses on chosen rolls.
- Optional links to Midi-QOL, Dice So Nice (animated dice follow its maximize/minimize results), Simple Cover 5e and WAVES.

## Where its UI is

- **Settings > Configure Settings > Automated Conditions 5e** for everything below.
- The roll dialogs themselves: a tinted button and tooltip show where it changed a roll (colors are per-user settings).
- A GM-only keybinding (default Shift Left) to bypass its effect-application prompt (not verified how it looks).

## Settings we use and why

Labels are as the English lang file shows them; keys are in `scripts/ac5e-settings.mjs`. Defaults are from source; "we use" is a proposal until clicked through (not verified).

| Label                                                                       | Key                                                | Scope | Default                            | Proposal                                                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------- | ----- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| D&D 5e Condition Rules                                                      | `automateStatuses`                                 | world | on                                 | keep on, this is the whole point                                                                |
| Show AC5E Tooltips                                                          | `showTooltips`                                     | user  | both                               | keep both, Danni can see why a roll changed                                                     |
| Attack Targeting Rules                                                      | `targeting`                                        | world | "Ignore Target Statuses and Flags" | keep default; "Cancel roll" blocks attacks with no or several targets, which annoys new players |
| Item Use Rules                                                              | `autoArmorSpellUse`                                | world | Allow (off)                        | keep off for now, blocking use can look like a bug                                              |
| Visibility Rules                                                            | `visibilityChecks`                                 | world | on                                 | keep, then watch for false "cannot see target" in dark scenes (not verified)                    |
| Additional Automated Rules, range rules, WAVES cover, environmental hazards | `additionalAutomations`, `autoRangeChecks`, others | world | off                                | leave off until the table asks                                                                  |

Keys are the strings in `scripts/ac5e-settings.mjs`, prefixed `automated-conditions-5e.`.

## How it interacts with the AI Tool

- **Pre-flight:** rule `automated-conditions-5e` in `packages/foundry-module/src/preflight-scan.ts` (severity info, "missing" type) says: not active, conditions do not change rolls by themselves. It checks the module id or a title match. Nothing else in the scan reads its settings.
- **Live feed and play log:** it mirrors a dnd5e condition as a second ActiveEffect, so one toggle fires two create or delete events. `packages/foundry-module/src/effect-dedupe.ts` (used by the session-events feed and the play recorder, P-026) drops the second one within 1.5 s when actor, kind and name or status match. Tests use the name "Prone (AC5e)".
- **Our condition writes** (the Play set, `get-available-conditions`, `get-active-effects`, plan-actor-change and plan-token-change): they go through Foundry's normal effect create/delete, so its hooks (`preCreateActiveEffect`) run on them. Whether it rewrites or blocks a condition we add is (not verified).
- **Rolls through the tool** (`request-attack-roll`, `roll-saving-throws`, `request-ability-check`, `roll-npc-check`): it hooks `dnd5e.preRollAttack`, `preRollSavingThrow`, `preRollAbilityCheck`, `preUseActivity` and the build hooks, so a roll we trigger on an actor is likely to pick up its advantage state and tooltips (not verified).
- No bridge settings are needed and no AI Tool flags are touched.

## Gotchas on Foundry 14 / dnd5e 6

- Tight version window: dnd5e 6.0.0 to 6.1.0. A dnd5e update past 6.1.0 may make Foundry flag it as incompatible; check before updating either one.
- Roll behavior changes with Midi-QOL on or off (it switches to a Midi code path). Only matters if Midi is ever added; the table runs without it.
- The module deprecation warnings in the console are known and listed as out of scope in `docs/dev/RUNTIME-TEST-PLAN.md`.
- Its status-effect handling can copy dnd5e statuses; a world without it keeps the plain dnd5e conditions and any custom effects it created as ordinary Active Effects (not verified).
- Pi (headless, Linux): no OS-specific code seen; it only needs the module folder (not verified).

## Sources

- <https://github.com/thatlonelybugbear/automated-conditions-5e>, `module.json`, `Changelog.md` (14.606.4.x notes).
- `C:\FoundryTest\data\Data\modules\automated-conditions-5e\scripts\ac5e-main.mjs` (hook list), `ac5e-settings.mjs`, `lang/en.json`.
- Repo: `packages/foundry-module/src/preflight-scan.ts`, `effect-dedupe.ts`, `docs/dev/RUNTIME-TEST-PLAN.md`.
