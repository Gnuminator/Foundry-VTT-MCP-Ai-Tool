# Dynamic effects using Active Effects, DAE (`dae`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 14.0.19, 2026-10-28 (test server C, effect editor opened live; automation and special durations were not exercised). The 2026-10-04 walkthrough covered 14.0.14 with the same result.

**Verdict: optional.** Keep it only if the Curse of Strahd characters' items use DAE special durations or macros (some D&D Beyond imports do); decide once those characters exist. It does not clash with the AI Tool, but dnd5e 6 already does concentration and the plain effect editor, and it adds two library dependencies and a bigger update surface. Leaning drop for session 0.

**For Danni's guides:** A bigger effect editor: you only open its extra tab if a spell or item effect needs an unusual end, like "until your next turn".

## What it does

- Replaces the Active Effect sheet with `DAEActiveEffectConfig` and four tabs: Details, Duration, DAE, Changes. The DAE tab holds an expression that removes the effect when false, one that disables it when true, an icon overlay switch, "Expiry Mode" (Default uses the global setting) and "Macro Repeat". The special-duration list ("until the end of the target's next turn", on the next attack, on rest) lives lower in that tab (not scrolled to).
- Adds a field picker for the Changes tab, and `flags.dae.specialDuration` on effects.
- Exposes a `DAE` global API for other modules (`DAE.daeSpecialDurations()`, `daeCustomEffect`, ...); only Midi QOL, which we do not run, needs most of it.

## Where its UI is

- Open any effect from an actor's or item's Effects tab: the editor shows the four tabs above. Settings: Module Settings, DAE.

## Settings we use and why

Key prefix `dae.`; defaults unless noted.

| Label (key)                                                            | Value         | Why                                                            |
| ---------------------------------------------------------------------- | ------------- | -------------------------------------------------------------- |
| Expire round effects on combat end (`expireRoundEffectsOnCombatEnd`)   | on if kept    | Round-based effects should not outlive the fight (not tested). |
| Expiry action, core expiry action (`expiryAction`, `coreExpiryAction`) | default       | Delete or update expired effects as the module decides.        |
| Auto migration (`enableAutoMigration`)                                 | off (default) | Do not let it rewrite world effects.                           |
| Untested systems, debug, disable effects                               | default       | Escape hatches only.                                           |

## How it interacts with the AI Tool

- An effect created the way the bridge does (`createEmbeddedDocuments('ActiveEffect', ...)`) gets `flags.dae.specialDuration: []` added by DAE and is otherwise unchanged (verified). So guarded effect writes survive DAE's hooks; they just have no special duration unless the plan sets `flags.dae.specialDuration`.
- Walkthrough 2026-10-04: concentration still works with DAE on (dnd5e 6 posts its save prompt on damage), and a player's self effect still needs the dnd5e setting "Allow Player Effect Application"; DAE only adds its flags and a dnd5e `createRiderConditions` deprecation warning.
- No tool reads DAE's flags. Kit scenario: none; the module is optional and the check above is cheap to repeat after a bump.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest: Foundry 14.368 to 14.999; requires `lib-wrapper` and `socketlib`. DAE patches effect application through libWrapper, so rerun the smoke kit after every DAE, libWrapper, dnd5e or Foundry bump.
- Old items that use deprecated special durations (a Cloak of Displacement effect in the Frostmaiden world) log a warning.
- `atlCompatibility` matters only with Active Token Effects, which we do not run.
- Removing the module leaves `flags.dae` on effects; harmless.
- Pi: nothing platform-specific found. On the test server C the module was 14.0.14 and was replaced by the archive's 14.0.19 for this check.

## Sources

- Manifest and source on disk: `C:\FoundryTest\data\Data\modules\dae` (`module.json`, `module/settings.js`, `dae.js`).
- Vault `Dev/Foundry AI Tool/Design/Module walkthrough plan.md` (2026-10-04).
