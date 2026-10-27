# Dynamic effects using Active Effects, DAE (`dae`)

Status: source read (version 14.0.19, Foundry 14.368 to 14.999). Live pass on a test server: pending.

## What it does

- Extends Foundry's Active Effect editor with the full list of dnd5e fields to change (a field picker instead of typing `system.attributes.ac.bonus`), special durations (until the end of the target's next turn, on the next attack, on short or long rest, and so on), and a Dependent Conditions mode.
- Gives item and spell effects a "transfer to actor" behaviour with those durations, and an API other modules (Midi QOL, which we do not run) call.
- A second editor, DIME, edits item macros attached to effects.

## Requires

`lib-wrapper` and `socketlib` (both installed on the test servers).

## Where the UI is

- The Effects tab of an actor or item sheet: the effect editor gets DAE's extra tabs and a longer duration list. Settings: Module Settings > DAE.

## Settings we would use

| Setting                                           | Value            | Why                                                        |
| ------------------------------------------------- | ---------------- | ---------------------------------------------------------- |
| `expireRoundEffectsOnCombatEnd`                   | on               | Round-based effects should not outlive the fight. Test it. |
| `expiryAction` / `coreExpiryAction`               | default          | Defaults delete or update expired effects.                 |
| `DAEUntestedSystems`, `ZZDebug`, `disableEffects` | off / none / off | Debug and escape hatches only.                             |
| `enableAutoMigration`                             | off              | Do not let it rewrite world effects.                       |

## How it interacts with the AI Tool

- The bridge writes effects as plain Active Effect documents (`get-active-effects`, `plan-actor-change`, `use-item`). DAE does not block that, but it adds `flags.dae.*` and `specialDuration` fields to effects it creates. An effect the AI applies has no special duration unless the plan sets `flags.dae.specialDuration`, so "until the end of its next turn" is a round count unless a tool learns otherwise.
- DAE patches Active Effect application through libWrapper; re-run the kit after every DAE or libWrapper bump.
- Without Midi QOL most of DAE's value is the editor and the durations, not automation.

## Gotchas

- Foundry 14 changed active effect behaviour; DAE has a Foundry 14 only build, so dnd5e and Foundry bumps are the risk. Pin versions in the rehearsal archive.
- `atlCompatibility` (default `legacy`) matters only with Active Token Effects, which we do not run.

## Verdict

Draft: **optional: keep only if the Strahd characters' items need DAE durations or macros (some D&D Beyond imports do), decided once those characters exist.** Walkthrough 2026-10-04 (14.0.14): no clash; concentration works with DAE on (dnd5e 6 does it itself), a player's self effect still needs "Allow Player Effect Application" on, DAE adds its flags and a dnd5e `createRiderConditions` deprecation warning, nothing breaks. Leaning drop for session 0. The dnd5e 6 Active Effects editor covers a GM's needs, and DAE earns its place with Midi QOL or heavy homebrew effects. Cost: two library dependencies and a larger update surface. Final verdict after the live pass (does the duration list work with dnd5e 6 spell effects?).

## Danni's guide line

"A bigger effect editor: only open it if a spell or item effect needs an unusual duration."
