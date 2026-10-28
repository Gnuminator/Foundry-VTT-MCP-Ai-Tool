# Combat Spell Timer (`combat-spell-timer`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 2.3.0, 2026-10-28 (test server C; a Bless cast, ten rounds of turns and the install ping were driven live).

**Verdict: drop (optional).** It works on dnd5e 6 and does not clash with the AI Tool, but dnd5e 6 and Foundry 14 already track concentration and effect durations, so all it adds is a "rounds left" row in the tracker. It also sends an install ping with no switch. Keep it only if Danni likes the reminder row.

**For Danni's guides:** Under a caster in the combat tracker you see how many rounds their spell has left, and the spell ends by itself when the rounds run out.

## What it does

- Watches dnd5e spell casts during a combat and stores a timer on the combat. The tracker shows a row "Bless (Test Cleric), 10 rounds left" and, under the caster, "Concentrating: Bless, Cast: Round 1, 10 rounds left".
- When the rounds are used up it deletes the timer and the Concentrating effect. Live: Test Cleric cast Bless in round 1 (duration 1 minute, so 10 rounds); the timer and the effect were both gone when the combat reached round 11.
- Concentration is tracked per caster (casting a second concentration spell asks whether to drop the first, not exercised).
- Also tracks class features with a duration (Rage with an extend or end prompt, Form of the Beast, Totem Spirit, Zealous Presence, Path to the Grave, Wild Surge); not exercised.
- Optional Beyond20 integration; we do not use Beyond20.

## Where its UI is

- The combat tracker rows described above; the effect sheet gets a "Show effect details" toggle.
- Settings (client scope): Debug Logging, two Beyond20 switches, and a GM-only spell-name map menu. There is nothing world-wide to tune.

## Settings we use and why

Defaults, with one change if the module is kept: turn "Beyond20: Cast Spell button" (`combat-spell-timer.beyond20Integration`, default on) off, since we have no D&D Beyond roller. Leave "Beyond20: Auto-cast spell / apply effect" (`combat-spell-timer.beyond20AutoCast`) off, its default.

## How it interacts with the AI Tool

- **Cast through an item use creates the timer (verified):** `Item#use` on Bless (the path `use-item` takes) wrote `flags.combat-spell-timer.timers` on the combat with `durationRounds: 10`, `concentration: true` and a link to the Concentrating effect.
- **Advancing turns removes it (verified):** `Combat#nextTurn()` (what `advance-combat-turn` calls) thirty-one times, from round 1 to round 11, ended the timer and the effect at round 11. The core effect has the same one-minute duration, so the module did not change the outcome, only showed it.
- Our combat read tools (`get-combat-state`, `get-combat-play-by-play`) do not show the timers; `get-character` and the dashboard do not either. They live only in the combat flag and the tracker row.
- It writes through a GM socket, so with no GM connected a timer is not stored.
- Kit scenario: none. The module is a drop recommendation and a scenario would test code we plan not to run; the recipe above (use-item, then advance turns, then read the combat flag) is the scenario to write if it is kept.

## Gotchas on Foundry 14 / dnd5e 6

- **Install ping (verified):** on `ready` the active GM's browser posts `{moduleId, system, systemVersion, foundryVersion, worldId, moduleVersion}` once per module version to `https://foundry.turkeysunite-local.org/module-install`, with an `x-install-tracker-key` header, up to three tries per version. There is no setting to turn it off. On the test server the browser blocked it (CORS preflight, "Failed to fetch"), the module recorded `attempts: 1` in its hidden setting `installTracker`, and nothing was sent. Because the custom header forces a preflight, whether a real world is ever recorded depends on that server's CORS answer. No campaign text or player data is in the payload; the world id is.
- Manifest: Foundry 13 to 14, dnd5e 5.0.0 or newer; it declares no dnd5e 6 support but worked on 6.0.6.
- Only dnd5e is supported; on another system the module loads no adapter and stays idle.
- A cast with no combat running creates no timer.
- Disabling it leaves the combat flag on old combats; harmless.
- Pi: a host without internet just fails the ping silently.

## Sources

- Repo: https://github.com/kamcknig/combat-spell-timer ; manifest and source on disk in `C:\FoundryTest\data\Data\modules\combat-spell-timer` (`scripts/combat-spell-timer.mjs`, `core/timers.mjs`, `core/store.mjs`, `utils/installTracker.mjs`).
- Vault `Dev/Foundry AI Tool/Design/Module walkthrough plan.md` (2026-10-04, no clash).
