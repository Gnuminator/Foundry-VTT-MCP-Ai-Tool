# Combat Spell Timer (`combat-spell-timer`)

Status: source read (version 2.3.0, Foundry 13 to 14, dnd5e 5+). Live pass on a test server: pending.

## What it does

- Watches dnd5e spell casts, shows a per-combatant timer row in the combat tracker with rounds remaining, and ends the spell's effect when the duration runs out. Concentration is tracked per caster; casting a second concentration spell asks whether to drop the first.
- Also tracks class features with a duration: Rage (with a turn-end extend/end prompt), Form of the Beast, Totem Spirit, Zealous Presence, Path to the Grave, Wild Surge.
- Optional Beyond20 integration (auto-cast from a D&D Beyond roll). We do not use Beyond20.

## Where the UI is

- Combat tracker: a row under the caster with the spell icon and "N rounds left"; right-click or the row menu to update or remove. The effect sheet gets a "Show effect details" toggle.
- Settings (client scope): Debug Logging, Beyond20 switches, a spell-name map menu (GM only). Nothing world-scope to tune.

## Settings we would use

Defaults. Leave both Beyond20 switches off (the auto-cast one is off by default; turn the plain Beyond20 one off too, there is no D&D Beyond roller in our setup).

## How it interacts with the AI Tool

- State lives in the combat document: flag `flags.combat-spell-timer.timers`. The bridge's combat tools (`get-combat-state`, `advance-combat-turn`, `get-combat-play-by-play`) read round and turn but do not show the timers. The module reacts to the same `updateCombat` / `combatTurnChange` hooks, so advancing a turn through the bridge should end spells the same way as the tracker's next-turn button (verify live).
- A cast through `use-item` fires dnd5e's usage hooks, so it should create a timer; verify in the live pass (this is why the module earns a kit scenario).
- The module writes through a GM socket (`socket: true`); no GM connected means timers are not stored.

## Gotchas

- **Phones home:** on `ready` the active GM posts `{moduleId, system, systemVersion, foundryVersion, worldId, moduleVersion}` once per module version to `https://foundry.turkeysunite-local.org/module-install` (up to 3 tries, no user switch). No campaign text or player data. Under our trust model that is acceptable, but Danni should know; a host without internet just fails silently and gives up after three tries.
- Active timers do not show in `get-character` or the dashboard; only in the tracker.
- Combat must exist for a timer to be created.
- Only dnd5e is supported (another system loads no adapter and the module stays idle).

## Verdict

Draft: **keep if Danni runs spellcaster-heavy fights, otherwise optional.** Concentration and spell duration are the easiest thing for a new GM to forget; the cost is one more row in the tracker and the install ping. Final verdict after the live pass.

## Danni's guide line

"Under a caster in the combat tracker you see how many rounds their spell has left; it ends the effect for you."
