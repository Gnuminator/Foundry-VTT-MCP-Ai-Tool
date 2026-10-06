# The test kit

The test kit checks that the whole tool works together: Foundry, the module, the bridge, the
dashboard and the player screen. It builds a known world, then runs scenarios against it and
writes a report. Run it before you call a change done, and before a real session.

The kit lives in `scripts/test-kit/`. Its plan is in the Obsidian vault
(`Dev/Foundry AI Tool/Design/Test kit plan.md`).

## What it does

1. **Build.** It joins a kit world as the passwordless "Kit GM", wipes what an earlier build made,
   and builds the kit again. The same every time:
   - a scene "Kit Arena" (24 by 16 squares, with walls, a door and a light),
   - heroes for every class and subclass, leveled through the system's own advancement with every
     choice made (see "The heroes" below),
   - eleven monsters picked by rule from the system compendium (a CR 0 beast, a flyer, a legendary
     dragon, and so on),
   - a token for the first four classes' level 5 heroes and for every monster.
2. **Run.** It runs the scenarios. Each one talks to the bridge tools through the dashboard, and
   reads the truth straight from the Foundry page when it needs to.
3. **Report.** It writes `report.html`, `report.md` and `report.json` for the run. The report names
   the content profile, shows what the build covered (classes, subclasses, heroes) and lists the
   console errors the Foundry page logged during the build and during each scenario.

The exit code is 0 when every scenario passed, 1 when one failed, and 2 when the environment is not
ready (nothing is listening, the wrong world, a refused target).

## Commands

```text
node scripts/test-kit/kit.mjs <command> [options]
```

| Command | What it does                                                                   |
| ------- | ------------------------------------------------------------------------------ |
| `init`  | Creates the kit world's files and its users (Kit GM, Kit Player). Run it once. |
| `build` | Opens the GM session and builds the kit. Writes the manifest.                  |
| `run`   | Runs the scenarios against the built kit and writes a report.                  |
| `all`   | `build`, then `run`.                                                           |
| `check` | Loads and validates every scenario against the tool catalog. Needs no Foundry. |

| Option                     | Meaning                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `--size smoke\|full\|long` | How big the kit is and which scenarios run. Default `smoke`. See "Sizes".  |
| `--profile <id>`           | The content profile. Default `srd`. It also picks the kit world.           |
| `--classes a,b`            | Build only these classes (identifier or name). A development filter.       |
| `--only a,b`               | Run only these scenario ids.                                               |
| `--scenarios <dir>`        | An extra scenario folder (repeatable). The repo's own folder is always on. |
| `--world <id>`             | Only a check: it must match the profile's world, or the run stops.         |
| `--report-dir <dir>`       | Where the report goes. Default `<kit home>/reports/<time>-<size>`.         |
| `--fake`                   | Use the in-process fake instead of Foundry (this is what CI does).         |
| `--headed`                 | Show the GM browser window instead of running it hidden.                   |

`npm run kit` is a short way to start it. `npm run kit:test` runs the kit's own unit tests.

### Sizes

| Size    | Heroes                                                   | Scenarios                  |
| ------- | -------------------------------------------------------- | -------------------------- |
| `smoke` | every class once, at level 5, with its first subclass    | the eleven SRD scenarios   |
| `full`  | every class at 1, 5, 11 and 17, and every subclass at 20 | the eleven SRD scenarios   |
| `long`  | the same heroes as `full`                                | scenarios that list `long` |

The monster scenarios also read the size (`t.size`): `smoke` probes a sample of the monsters (see "The monsters"), `full` and
`long` probe every one.

The plan is `HERO_PLAN` in `lib/contract.mjs`. A class gets its subclass from the level its own
Subclass advancement says (level 3 for most classes, earlier for a few). Below that level the
hero has none.

### Running it live

The local test environment must be up with the kit world of the profile. One world at a time:
stop Foundry before you start it on the other world.

```powershell
pwsh scripts/test-env/sync-module.ps1
pwsh scripts/test-env/start.ps1 -World ai-tool-kit-srd
node scripts/test-kit/kit.mjs all --profile srd
pwsh scripts/test-env/stop.ps1
```

The kit opens its own GM page first. The bridge only has a Foundry link while that page is open.
The test server is shared: run one live job at a time. See the `foundry-test-env` skill.

## Content profiles

A profile says where the builder finds its content: the packs for classes, subclasses, species,
backgrounds, monsters, spells and feats, the modules to enable, and which rules versions count. It
names pack ids and module ids only, never book text. A profile file is JSON; the shape is
`ContentProfile` in `lib/contract.mjs` and `lib/profiles.mjs` checks it.

| Profile    | Lives in                                                | World                  |
| ---------- | ------------------------------------------------------- | ---------------------- |
| `srd`      | `scripts/test-kit/data/profiles/srd.json` (in the repo) | `ai-tool-kit-srd`      |
| a local id | `<kit home>\licensed\profiles\<id>.json` (this PC only) | `ai-tool-kit-licensed` |

- **Only the `srd` profile is in the repo.** It uses the packs that ship with the system.
- **A licensed profile never goes into a repo or the vault.** It lives under the kit home, next to
  the licensed scenarios and the notes about them. `--profile licensed` loads
  `<kit home>\licensed\profiles\licensed.json`.
- **A profile's world must be a kit world** (`KIT_WORLDS` in the contract). A profile for any other
  world is refused, so a bad profile cannot build into the everyday test world or a real campaign.
- **An unknown profile is an environment error** (exit code 2) that names the file it looked for.

The folder layout on this PC:

```text
C:\FoundryTest\test-kit\            the kit home (or the folder in TEST_KIT_HOME)
  worlds\<world>\manifest.json      what the last build made
  reports\<time>-<size>\            report.html, report.md, report.json of each run
  licensed\                         this PC only, never in a repo or the vault
    README.txt
    profiles\licensed.json          the licensed content profile
    (later: licensed scenarios, loaded with --scenarios)
```

## The heroes

The builder reads the profile's class and subclass packs through the GM page and chooses by rule:

- Every 2024 class and every 2024 subclass.
- Plus the legacy (2014) subclasses that remain. A legacy subclass is skipped when a 2024 one has the
  same identifier or name. An exact duplicate across packs is skipped, the first pack wins.
- A legacy subclass is paired with the legacy version of its class when the profile has one,
  else with the 2024 class. A legacy class with no 2024 version is a hero class of its own.

Each hero is made with the system's advancement manager, with no dialogs: the species (Human) and
the background (Soldier) first, then the class in one run up to the hero's level, and the
subclass when the level reaches it. Every hero starts from the same standard array (Constitution 13) and takes the average for hit points.

**Choice rotation.** Every choice (a skill, a weapon mastery, a spell, a feat, an ability score
improvement) takes option number `(rotation + k) % options` of the options the system offers, where
`k` counts the hero's picks in the order the system asks. The rotation is the hero's number within
its class (0 for the first, 1 for the second, and so on). So the heroes of one class differ from
each other, together they cover many options, and a rebuild makes the same choices. An ability score
improvement alternates between +2 and a general feat on the same count.

The hero the kit gives to the player user ("Kit Player") is the first class's level 5 hero. The
manifest marks it with `owner`, and the player screen must show its HP as numbers.

A hero the advancement could not finish keeps its row in the manifest with `buildError`. The build
goes on, so one broken class does not hide the others.

## Coverage

The manifest and the report say what the build covered: classes found and built, subclasses found,
built and failed (by name), and the number of heroes. In `smoke` only one subclass per class is
built, so "built" is lower than "found" on purpose. The `heroes-advancement` scenario adds its own
summary (heroes checked, heroes failed, failures by kind) as an attachment.

Build time depends on the number of heroes, about five seconds each. Measured on the test PC:

| Profile    | Size    | Heroes | Build            | Whole run (build and scenarios) |
| ---------- | ------- | ------ | ---------------- | ------------------------------- |
| `srd`      | `smoke` | 12     | about 1 minute   | about 1 minute                  |
| `srd`      | `full`  | 64     | about 5 minutes  | about 5 minutes                 |
| `licensed` | `smoke` | 13     | about 1 minute   | about 1.5 minutes               |
| `licensed` | `full`  | 157    | about 12 minutes | about 13 minutes                |

The two feature scenarios add little: about 25 seconds to an `srd` `full` run (5 minutes in all) and about
2 minutes to a `licensed` `full` run (14 minutes in all, 157 heroes, 2195 activities used).

Start a `full` run in the background and do not wait on it.

## The scenarios

Eleven SRD scenarios ship in the repo. All are in `smoke` and `full`; `heroes-advancement`, the two
feature scenarios and the three monster scenarios are in `long` as well.

| Id                     | What it proves                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `bridge-health`        | The bridge, dashboard and module agree: health, world, module version, all tools, the kit.                    |
| `compendium-monsters`  | Every kit monster matches its compendium entry and has a token on the scene.                                  |
| `guarded-damage-undo`  | A guarded damage change applies, is listed, undoes exactly, and healing stops at the max.                     |
| `scripted-fight`       | A short fight shows up the same way in combat state, play-by-play, session log and stats.                     |
| `player-no-spoilers`   | A hidden token and monster HP never reach the player screen; the player's hero shows HP.                      |
| `heroes-advancement`   | Every hero has what its class and subclass give at its level.                                                 |
| `heroes-features-use`  | Every feature of every hero can be used once with no dialog; the hero is put back.                            |
| `heroes-features-deep` | 21 rule checks (uses, dice, slots, AC, rests) against the 2024 SRD class tables.                              |
| `monsters-every`       | Every monster of every pack of the profile is copied in, uses one action and is deleted.                      |
| `monsters-matrix`      | The monsters by CR band, type, size and trait, the gaps, and the data every creature needs.                   |
| `monsters-odd`         | Legendary actions and resistance, lair, regeneration, shapechangers, movement, recharge, multiattack, spells. |

### heroes-advancement

One step per hero, labelled `<hero name>: <class> <level> (<subclass>)`, so the report lists every
failure. The advancement data of the class and subclass (the GM action `describeClass`) is the
oracle. The actor (`inspectActor`) is what is checked:

- the class and its levels, the subclass from its level, and the item each was made from,
- every grant the data gives up to that level is on the actor (matched by source uuid, else by
  name; optional grants are skipped),
- every choice the data asks for was made, per level (items, traits, ability score improvements),
  and every item the builder picked is on the actor,
- every scale value (rage damage, ki points and so on) has the expected value,
- hit points equal the hit die average plus Constitution times the level. A hit point bonus from
  an effect on the actor (a feat such as Tough) is read from the actor and named in the step
  detail, never accepted silently,
- spell slots equal the system's own table for the class's progression and level, and pact slots
  are checked on their own,
- skill proficiencies are at least the class's choices, and the saving throw proficiencies are the
  class's,
- the player's hero is owned by the player user.

A Trait choice whose options were all taken already (the species, the background or an earlier
feat gave them) is not a failure: the system offers nothing and the same would stop a player. The
step detail says so.

### heroes-features-use

One step per hero. The GM action `inspectFeatures` lists the hero's features; every activity of
every feature (items of type feat: class, subclass, species, background and feat features) that can
run with no dialog is used once through `exerciseActor` (op `use`): no dialog, no measured template,
no roll after the card, no action cost. Each use is judged (`judgeUse` in `lib/features.mjs`):

- the system did not throw or refuse (a refusal because the uses resolve to 0 is CONTENT, any other
  refusal and any throw is SYSTEM),
- a chat card was posted,
- the item's uses went up by what the activity says it consumes (when that is a plain number),
- the hero is exactly as before: uses, activity uses, slots, hit points, hit dice, effects, new
  items and the chat messages the use created are put back, and the GM action says when that failed
  (KIT).

Left out, with the reason in the coverage attachment: activities that need a dialog (summon,
transform, cast, order) and activities the system says cannot be used. Weapons, equipment and
spells are not used in this pass. The system's error toasts are collected as notes instead of being
shown.

### heroes-features-deep

One step per check, over every hero it applies to. The oracle is a rules table written down in
`lib/features.mjs` (`RULES`, the 2024 SRD class tables), not the imported data, so a wrong import
shows. Checks that compare a number with a table only look at heroes of a 2024 class (`classRules`
in the manifest), because a few 2014 tables differ; the general checks (hit dice, spell slots,
proficiency bonus, rests) look at all heroes.

| Check                | What it proves                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `rage`               | uses by level; with the effect on: damage bonus and the three resistances; one use costs 1 |
| `wild-shape`         | uses by level and a transform activity                                                     |
| `channel-divinity`   | cleric and paladin uses by level, back on a long rest                                      |
| `sneak-attack`       | the dice are ceil(level / 2) d6                                                            |
| `bardic-inspiration` | the die by level (d6, d8, d10, d12) and uses = Charisma modifier (at least 1)              |
| `focus-points`       | monk Focus points = level                                                                  |
| `sorcery-points`     | sorcerer Sorcery points = level                                                            |
| `pact-magic`         | warlock slots and slot level by level, full at the start, no other slots                   |
| `action-surge`       | uses by level                                                                              |
| `lay-on-hands`       | the pool is 5 x level and the feature has a heal activity                                  |
| `second-wind`        | uses by level and a heal activity                                                          |
| `arcane-recovery`    | one use, back on a long rest                                                               |
| `divine-smite`       | the paladin has Paladin's Smite (a Divine Smite spell item is only noted)                  |
| `cunning-action`     | three bonus action activities                                                              |
| `extra-attack`       | present from level 5 (fighter: more at 11 and 20), not before                              |
| `superiority-dice`   | dice by level; skipped when no hero has the feature (the srd profile has none)             |
| `unarmored-defense`  | AC = 10 + Dexterity + Constitution (barbarian) or Wisdom (monk), with no armor             |
| `spell-slots`        | every full and half caster against the slot table (2024 half casters cast from level 1)    |
| `hit-dice`           | one die per level, the class's die size, all unspent                                       |
| `rest-recovery`      | the top hero of each class: everything spent, then a short and a long rest                 |
| `proficiency-bonus`  | 2 + floor((level - 1) / 4)                                                                 |

A rest probe spends every use, slot and hit die and sets hit points to 1, takes the rest with no
dialog, and compares with what the system's own recovery data says should come back: item uses by
their recovery profile (the first period that matches, "lr" then "sr" for a long rest), pact slots
on both rests, other slots and hit points on a long rest, hit dice on a long rest only.

A check with no hero it applies to (the kit has no barbarian, say) passes with the detail
"skipped:" and the reason and is listed under `checksSkipped` in the coverage attachment. A number that
differs from the table is CONTENT when the actor agrees with the class's own scale value (the
imported data differs from the rules), SYSTEM when it does not (the system did not follow its own
data). If a table is wrong, fix the table (KIT) and say so in the pull request.

**What the first live runs showed (2026-10-06).** `srd` smoke and full: both feature scenarios pass; the only
failure of the run is the `heroes-advancement` CONTENT finding from slice 2a. `licensed` full: the deep checks
pass (21 of 21 ran); the use pass reports 420 CONTENT problems and 7 SYSTEM ones, almost all of one kind: an
activity consumes the uses of an item that has none set (or points at an item the actor does not have). The
`contentByFeature` list in the coverage attachment shows which features. These are findings about the imported
data, not kit failures. Two things the first runs taught the kit: a fresh item can have `uses.spent` null in its
source (the restore puts null back), and the system adds and removes the bloodied status when hit points change
(the restore waits for it).

### The monsters

Three scenarios cover the monster compendium of the content profile. The monsters of a profile are the actors of type npc in the
packs of `packs.monsters` (the `srd` profile lists `dnd5e.actors24` and the legacy `dnd5e.monsters`; a profile with licensed books
lists theirs). Characters and vehicles in those packs are left out and counted. The GM action `listMonsters` reads them as facts
(names, numbers and flags, never text); a probe copy is made with `createMonster` and removed with `deleteMonsters`, which refuses an
actor without the kit flag. A probe is always deleted, also when a step fails, and carries the kit flag, so a rebuild wipes one a
dead run left behind. All three scenarios run last (`order` 100), like the feature scenarios.

A creature with no challenge rating (what a spell makes or summons: a steed, an animated object, a familiar) is a **stat block**.
It is copied and used like any monster, but it is not held to the data a creature needs (a rating, a known type, hit points, armor
class, items); the matrix counts it on its own line.

| Size    | `monsters-every`                                                  | `monsters-odd`                              |
| ------- | ----------------------------------------------------------------- | ------------------------------------------- |
| `smoke` | a sample: the first monster of each CR band, type, size and trait | 2 monsters per check, one per movement mode |
| `full`  | every monster                                                     | every monster a check applies to            |
| `long`  | every monster                                                     | every monster a check applies to            |

#### monsters-every

One step per monster, labelled `<name> (<pack>, CR <rating>)`. For each: the copy is made, read (`inspectFeatures`, with an `npc`
block) and checked against the compendium row (challenge rating, type, size, hit points, armor class, movement, legendary and
lair pools, number of items; a difference is SYSTEM). One action is used through `exerciseActor` (op `use`, no dialog, no template,
no summons, no roll after the card, no action cost): the first attack on an action of a weapon or feature, else another attack,
else another action, else a spell (`planMonsterUse`). Legendary and lair actions are left out here; `monsters-odd` takes them.
The use is judged like a hero's (`judgeUse`): no throw or refusal, a chat card, the uses it says it consumes, the monster put back.
Finally the bridge tool `get-character` is called for the copy and must agree with Foundry (`judgeBridge`): challenge rating,
type, size, hit points, armor class, the legendary pool, and spells.

One thing is only noted, not failed: dnd5e 6 gives every npc a spellcasting ability and the bridge reports `hasSpells` for any
ability, so a monster with no spells is shown as a spellcaster. The coverage attachment counts it as a note. A monster that has
spells the bridge does not show is a SYSTEM problem.

#### monsters-matrix

Reads the packs and changes nothing. Steps: the packs are installed and have monsters, the counts add up, then the counts by CR
band (9 bands), creature type (the 14 types), size, book and trait (28 traits: resistance, immunity, vulnerability, condition
immunity, the four senses, languages, spells, innate spellcasting, legendary actions and resistance, lair, the five movement modes,
regeneration, shapechanger, damage threshold, multiattack, recharge, summon, transform), the damage types and conditions and
languages, and **the gaps**: a band, type, size or trait nobody in the profile has. The counts and gaps are attached
(`matrix`) and do not fail the scenario. The last step checks the data every creature needs (`judgeRow`, CONTENT): a valid
rating, a known type and size, hit points, armor class, items, a legendary pool that matches its legendary actions, sane speeds.

#### monsters-odd

One step per check, over the monsters it applies to. A check no monster applies to passes with "skipped:" and the reason and is
listed in the coverage attachment. For each monster the scenario makes a probe copy, reads it, runs the check and deletes the copy.

| Check                  | What it proves                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `legendary-actions`    | the pool is full, the bridge shows it, the monster has legendary actions and each one spends the pool by its cost |
| `legendary-resistance` | the feature exists and spends one use of the legendary resistance pool                                            |
| `lair-actions`         | the lair flag survives, the lair count is sane, a lair action (when it is an activity) can be used                |
| `regeneration`         | the feature is there; a note says whether it is only text (Foundry does not heal by itself)                       |
| `damage-threshold`     | skipped when no monster has one (the SRD has none)                                                                |
| `shapechangers`        | transform activities can be used; a non-transform activity of the feature is used                                 |
| `movement-modes`       | fly, swim, burrow, climb and hover of the copy, and as stored, are the compendium's; hover needs a fly speed      |
| `recharge`             | the target is 2 to 6, the ability has uses, it is used once, and six recharge rolls each agree with the target    |
| `multiattack`          | Multiattack can be used and the monster has an attack activity                                                    |
| `innate-spellcasting`  | an ability and a save DC are set, the bridge shows the spells, and a spell can be used                            |

**Legendary actions and the Boss pips.** The dashboard's Boss pips read `resources.legact` (`max` and `spent`). In dnd5e 6 a
legendary activation spends that pool in one of two ways: through a consumption target of the activity itself
(`resources.legact.value`), or, when the activity has no such target, through the system's action consumption
(`consume.action`, `_prepareUsageUpdates`). The kit's normal use turns action consumption off (a hero's action cost is not what it
tests), so the legendary check asks for it (`consumeAction: true` on `exerciseActor`) and expects the pool to change by the
activity's cost, whichever way the system spends it. A pool that does not change, or changes by another amount, is SYSTEM. (The
first version of this check left action consumption off and so reported every no-target legendary action as data that does not spend
the pool; that was a kit artifact.) The recharge probe spends the ability, makes the system's own recharge roll (`uses.rollRecharge`)
six times, and compares each roll with the target.

**What the live runs showed (2026-10-06, after the legendary fix).** `srd` full: 722 monsters (385 in the 2024 pack, 337 in the legacy pack, 60 of them stat blocks). The three scenarios take about 90 seconds
together (the copy, use, check and delete of one monster takes about 35 milliseconds). Findings, all of them about the imported
data or the bridge and none about the kit: 4 monsters with data the matrix names (a feature-less Giant Fly, a creature type of
"(lycanthrope)"), 5 monsters with no usable action (a Frog and a Sea Horse with items but no activity) and a bridge that
reads the creature type of a legacy stat block as an empty object (SYSTEM). In `monsters-odd`: all 60 legendary monsters spend their legendary pool (175 of 200 legendary activities were used: 19 spend it through a consumption target, 156 through the system's action consumption, and 25 need a dialog and were left out), so using them in Foundry moves the Boss pips; legendary resistance, lair, regeneration, shapechangers, movement and recharge rolls all agree with the
data; the SRD has no damage threshold (skipped) and no lair actions as activities (text only). The bridge's `hasSpells` is true for
294 monsters that have no spells (a spellcasting ability is set on every npc), and false for a Cloaker that has spells and no
ability. `licensed` full: 1499 monsters (1114 in the local content module, 385 in the 2024 pack, 47 stat blocks), about 3.5
minutes: 3 data findings, 25 monsters with a finding in the broad pass (5 CONTENT, 20 SYSTEM, all of the bridge's `hasSpells`
kind), and in `monsters-odd` all 132 legendary monsters spend their pool (362 of 405 legendary activities used: 298 through a target, 64 through the action, 43 left out for a dialog), 24 of 127 with a legendary
resistance feature that has no activity, 23 spellcasters with data problems (a missing spellcasting ability or an innate spell with
no uses). The `smoke` sample of the `licensed` profile has 31 monsters and takes seconds. These are findings, not kit failures.

### Failure classes

Every failed check says which kind it is, first in the message, with its evidence:

| Class     | Meaning                                                      | Example                                         |
| --------- | ------------------------------------------------------------ | ----------------------------------------------- |
| `KIT`     | Our builder or our check is wrong.                           | a choice was not made, the hit point sum is off |
| `CONTENT` | The imported data is wrong or incomplete.                    | a grant whose uuid does not resolve             |
| `SYSTEM`  | The dnd5e system did something other than its own data says. | a grant not applied, a slot table that differs  |

Fix `KIT` failures in the kit. Report `CONTENT` and `SYSTEM` failures: do not change the imported
content or the product to make the kit green.

## How to write a scenario

A scenario is a file `<id>.scenario.mjs` whose default export describes it. The full contract is in
`lib/contract.mjs`. In short:

- `id` (kebab-case), `title`, `sizes`, `tags`, `needs` (which parts of the manifest it uses).
- `order` (optional number, default 0): lowest runs first. The feature scenarios have 100, so they run last: they
  post thousands of chat cards.
- `tools`: every bridge tool it calls. `kit check` fails if a tool is not in `tool-sets.ts`.
- `gmActions`: every GM action it calls (the only way to run code inside Foundry).
- `run(t)`: the scenario. `t` has `step`, `check`, `equal`, `tool`, `guarded.planApply`,
  `guarded.undo`, `gm`, `player.state`, `player.html`, `http`, `kit` (the manifest), `log`,
  `attach` and `cleanup`.

A tiny example:

```js
export default {
  id: 'world-name',
  title: 'The world has a title',
  sizes: ['smoke', 'full'],
  tags: ['bridge'],
  needs: [],
  tools: ['get-world-info'],
  async run(t) {
    await t.step('get-world-info names the kit world', async () => {
      const info = await t.tool('get-world-info', {});
      t.equal(info.id, t.kit.world, 'world id');
    });
  },
};
```

Rules of thumb:

- **Leave the world as you found it.** Register a `t.cleanup(...)` for everything you change. They
  run after the scenario, last in first out, even when it failed. End combats, undo changes, remove
  tokens.
- **Read the truth from Foundry, not from the tool under test.** Use the GM action `readActor` to
  check HP. Monster tokens are unlinked, so pass `sceneId` and `tokenId` to read the token's own HP.
- **Wait for the bridge when it needs a moment.** `waitFor` in `lib/helpers.mjs` polls until a
  condition holds. The play log and the player screen are not instant.
- **Do not compare against random rolls.** Set fixed values (initiative, damage amounts) and
  compare the numbers you set or read.
- **Pick heroes with the helpers.** Not every hero has a token: `tokenHeroes(kit)` lists the ones
  on the scene, `playerHero(kit)` the one the player owns, `builtHeroes(kit)` the ones that were
  built. A hero with a `buildError` has no actor.
- **A new GM action** goes into `GM_ACTIONS` in the contract, `lib/gm-actions.mjs` and the fake,
  all three together. An action that changes a hero (`exerciseActor`) puts it back and says whether
  that worked.
- A `continueOnFail` step lets the scenario go on after a failure. Use it for lists of
  independent checks, such as one step per monster or per hero.

## Where things live

| What                                      | Where                                                     |
| ----------------------------------------- | --------------------------------------------------------- |
| The engine, the GM actions, the fake      | `scripts/test-kit/lib/`                                   |
| The contract everything builds against    | `scripts/test-kit/lib/contract.mjs`                       |
| The hero checks and failure classes       | `scripts/test-kit/lib/advancement.mjs`                    |
| The feature checks and rules tables       | `scripts/test-kit/lib/features.mjs`                       |
| The monster checks, matrix and odd checks | `scripts/test-kit/lib/monsters.mjs`                       |
| The SRD scenarios (no licensed content)   | `scripts/test-kit/scenarios/*.scenario.mjs` (in the repo) |
| The SRD content profile                   | `scripts/test-kit/data/profiles/srd.json`                 |
| The monsters and the scene                | `scripts/test-kit/data/smoke-matrix.json`                 |
| The manifest of the last build            | `<kit home>\worlds\<world>\manifest.json`                 |
| Reports                                   | `<kit home>\reports\` (this PC only)                      |
| Licensed profiles and scenarios           | `<kit home>\licensed\` (this PC only)                     |

The kit home is `C:\FoundryTest\test-kit`, or the folder in the environment variable
`TEST_KIT_HOME`. **Licensed profiles, scenarios and reports never go into a repo or the vault.** A
profile or scenario names documents by pack id, name or id and never carries book text. Load
licensed scenarios with `--scenarios C:\FoundryTest\test-kit\licensed`.

## CI and live

CI has no Foundry, so it runs the kit against the fake (`lib/fake/`). The fake is a small HTTP
server that answers the dashboard API (`/api/health`, `/api/tools`, `/api/tool`, `/api/control`,
`/api/player/state`, `/player`) from a tiny in-memory game, and a `gm` object with every GM action.
It is not dnd5e. It has a few classes and subclasses with made-up advancement data, including a
legacy pair, so the builder's selection rules, the hero checks and the three failure classes run
in CI. Its job is to catch mistakes in the scenarios and in the engine: a wrong tool name, a broken
step, a changed contract.

CI runs three things after the build:

1. `npm run kit:test`: the engine's unit tests, including full `all --fake` runs and tests that a
   broken scenario or a broken hero fails with the right message.
2. `node scripts/test-kit/kit.mjs check`: every scenario loads and names only real tools.
3. `node scripts/test-kit/kit.mjs all --fake`: the whole kit against the fake.

The fake can only be as right as its author. The live run is the real check. **A green CI run does
not replace a live run** when you changed the module, the bridge link or a guarded write.

When you change a tool's result shape, change the fake with it.

## Safety guards

- **Kit worlds only.** The kit builds and writes only in the worlds listed in `KIT_WORLDS`
  (`ai-tool-kit-srd` and `ai-tool-kit-licensed`). It never touches a real campaign,
  `ai-tool-test` or `ai-tool-kit`.
- **The wipe is by flag.** Every document the builder makes carries the flag `world.testKit`. A
  rebuild deletes only documents with that flag.
- **Live ports are refused.** The bridge ports 31414 to 31416 are never used, also with `--fake`.
  The only real target is the test dashboard on `127.0.0.1:3100` and the test Foundry on
  `127.0.0.1:30001`. Anything not on this machine is refused.
- **Wrong world, no run.** If the connected world is not the profile's kit world, the run stops
  with exit code 2 before it changes anything.
- **GM Actions are turned on for the run and put back** as they were found.
- **No secrets.** The kit never types a password. The GM and player users are passwordless.

## What comes next

- The full matrix of spells (the monsters are done: see "The monsters").
- Dashboard checks in a real browser (Playwright), not only the JSON the dashboard serves.
- A Pi target: the same kit against the Orange Pi, once the Pi has a kit world.
- The licensed layer: the Curse of Strahd scenarios, kept on this PC only.
