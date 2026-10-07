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
| `--no-coverage`            | Skip the coverage pass (see "Pick coverage").                              |
| `--coverage-cap <n>`       | The most coverage heroes one run builds. Default 40.                       |
| `--only a,b`               | Run only these scenario ids.                                               |
| `--scenarios <dir>`        | An extra scenario folder (repeatable). The repo's own folder is always on. |
| `--world <id>`             | Only a check: it must match the profile's world, or the run stops.         |
| `--report-dir <dir>`       | Where the report goes. Default `<kit home>/reports/<time>-<size>`.         |
| `--fake`                   | Use the in-process fake instead of Foundry (this is what CI does).         |
| `--headed`                 | Show the GM browser window instead of running it hidden.                   |

`npm run kit` is a short way to start it. `npm run kit:test` runs the kit's own unit tests.

### Sizes

| Size    | Heroes                                                                         | Scenarios                  |
| ------- | ------------------------------------------------------------------------------ | -------------------------- |
| `smoke` | every class once, at level 5, with its first subclass                          | the eighteen SRD scenarios |
| `full`  | every class at 1, 5, 11 and 17, and every subclass at 20, plus coverage heroes | the eighteen SRD scenarios |
| `long`  | the same heroes as `full`                                                      | scenarios that list `long` |

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

The `srd` profile lists the Actor Studio module under `modules`; run `kit init` once on a kit world to
enable it (the `heroes-studio` scenario fails with that advice when the module is not active).

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
subclass when the level reaches it. Every hero takes the average for hit points and starts from the
standard array placed for its class (`heroAbilities` in `lib/builder.mjs`): 15 in the class's primary
ability (15 and 14 when the class needs both of two, like the Monk), Constitution always 13, the rest
in the order Dexterity, Wisdom, Strength, Intelligence, Charisma. A class with no primary ability in
its data uses its spellcasting ability. The manifest keeps the scores (`abilities`), and the
`heroes-studio` scenario types the same scores into Actor Studio. (Before 2026-10-06 every hero had
Strength 15 and Charisma 8, so a Bard's Bardic Inspiration had no uses.)

**Choice rotation.** Every choice (a skill, a weapon mastery, a spell, a feat, an ability score
improvement) takes option number `(rotation + k) % options` of the options the system offers, where
`k` counts the hero's picks in the order the system asks. The rotation is the hero's number within
its class (0 for the first, 1 for the second, and so on). So the heroes of one class differ from
each other, together they cover many options, and a rebuild makes the same choices. An ability score
improvement alternates between +2 and a general feat on the same count.

**Pick coverage.** Each Trait and ItemChoice pick in the manifest also records what the system
offered (`offered`, at most 300 options). The `heroes-advancement` scenario attaches `picks`
(`lib/picks.mjs`): per class and choice, the options offered, how often each was picked, and the
options no hero picked. The report's "Picks" section shows it. An option no hero picked is not a
failure, but its feature was never built, so `heroes-features-use` never used it either.

**Coverage heroes.** Some of those options change how a hero plays: a feature pool that a class or
subclass offers (a fighting style, a maneuver, an invocation, a rune) and a damage resistance,
damage immunity or condition immunity choice. Skills, tools, languages, saving throws, weapon
mastery, expertise, spells, and anything a background, a species or an origin feat asks are not
mechanical and stay in the report only (the filter is `mechanicalPick` in `lib/picks.mjs`). At sizes
`full` and `long`, after the normal heroes are built, the builder plans extra heroes with role
`coverage` for the mechanical options nobody picked (`lib/coverage.mjs`). Each one copies a template
hero that was offered the choice (class, subclass, level and rotation; among the heroes that cover
the most open options, the lowest level wins) and carries `prefer`, per choice title, the options to
take first: a hero with N picks of a choice takes N unpicked options, the rest of its choices follow
the rotation. A hero is named `Kit Fighter 3 cov 1`. The planner repeats until every mechanical
option is picked or the cap is reached (`--coverage-cap`, default 40), at most three rounds;
an option a coverage hero was asked for and did not take is not asked again. `--no-coverage` turns the
pass off, and `smoke` never runs it. The coverage heroes go through the same scenarios as the others;
`heroes-studio` builds them in Actor Studio only at size `long`, each at its own level, with the same
forced options. The Picks section ends with a line "Coverage heroes: X built, Y mechanical options
still never picked", and says when the cap stopped the pass.

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

Twenty-two SRD scenarios ship in the repo. The first eighteen in the table are in `smoke` and `full`; `heroes-advancement`, the two
feature scenarios, `heroes-studio`, the three monster scenarios, the two spell scenarios and the four origin
scenarios are in `long` as well. The spell scenarios use the sizes differently: `smoke` casts a sample of about
thirty spells, `full` and `long` cast them all. The dashboard scenarios at the end of the table are real-browser
scenarios with their own sizes, named in the table and in the text after it.

| Id                      | What it proves                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `bridge-health`         | The bridge, dashboard and module agree: health, world, module version, all tools, the kit.                              |
| `compendium-monsters`   | Every kit monster matches its compendium entry and has a token on the scene.                                            |
| `guarded-damage-undo`   | A guarded damage change applies, is listed, undoes exactly, and healing stops at the max.                               |
| `scripted-fight`        | A short fight shows up the same way in combat state, play-by-play, session log and stats.                               |
| `player-no-spoilers`    | A hidden token and monster HP never reach the player screen; the player's hero shows HP.                                |
| `heroes-advancement`    | Every hero has what its class and subclass give at its level.                                                           |
| `heroes-features-use`   | Every feature of every hero can be used once with no dialog; the hero is put back.                                      |
| `heroes-features-deep`  | 21 rule checks (uses, dice, slots, AC, rests) against the 2024 SRD class tables.                                        |
| `heroes-studio`         | A hero per class built in Actor Studio's own windows equals the raw kit hero.                                           |
| `monsters-every`        | Every monster of every pack of the profile is copied in, uses one action and is deleted.                                |
| `monsters-matrix`       | The monsters by CR band, type, size and trait, the gaps, and the data every creature needs.                             |
| `monsters-odd`          | Legendary actions and resistance, lair, regeneration, shapechangers, movement, recharge, multiattack, spells.           |
| `origins-species`       | Every species gives its size, speed, senses, traits and features; each feature can be used.                             |
| `origins-backgrounds`   | Every background gives its ability scores, proficiencies and origin feat.                                               |
| `origins-feats`         | Every feat can be taken by a hero that meets its prerequisites and does what its data says.                             |
| `heroes-multiclass`     | Multiclass heroes get the reduced proficiencies, the combined slots and the features of both classes.                   |
| `spells-cast-all`       | Every spell of the profile's spell packs can be cast once; the caster is put back.                                      |
| `spells-deep`           | 31 rule checks on SRD spells: attacks, saves, areas, concentration, upcasting, slots.                                   |
| `dashboard-write-flows` | The dashboard's write flows clicked in Edge: confirm, Undo, Tarokka, party, handouts, notes, links. Full and long only. |
| `dashboard-login-split` | With a GM and a player token: no token gets nothing, `/player` has no GM controls, the GM token works. Runs last.       |
| `dashboard-controls`    | Every dashboard and player control is there, opens what it should and logs no console error. Full and long only.        |
| `player-rendered`       | The drawn player page shows no hidden token, true monster name or canary. Smoke and full.                               |

`dashboard-write-flows` and `dashboard-login-split` need a real browser (`t.browser`), so against the fake
they skip themselves. The write flows click the real page (the tool runner form and its confirm window, Undo
in Recent Changes and on the toast, the Tarokka, Party and Handouts drawers, a map note, the player links),
read Foundry or the bridge to see the change is there, undo it and read again; they put everything back, also
after a failure (the throwaway handout journal and the "Kit Party" group stay in the kit world). The Tarokka,
handouts and party features are switched on for the run and put back afterwards; a flow skips itself with the
reason when the world still lacks something (a switch the run does not manage), but a refusal that names a
switch the run turned on itself (those three features, GM Actions) fails the flow. The page the login
split opens with no token is meant to fail: its console errors are attached to the scenario instead of the
report's console list and checked there (each one must be a 401 or a failed resource with no status; a script
error fails the step), and every page is closed before a restart. The login split restarts the test
dashboard (`lib/dashboard-proc.mjs`: `stop.ps1` and `start.ps1 -Only dashboard`) with two random tokens made
at run time, checks three states in a fresh Edge with no cookies (the player page is read once it has drawn
its world line), and restarts it in the normal mode on the way out, also after a failure, so the split never
stays on. The restart is guarded three ways: the kit refuses before stopping anything when its own checkout has
no built dashboard (`start.ps1` would leave it down), it skips itself when the dashboard already runs in a
split it did not make (it cannot put those tokens back), and `stop.ps1` kills a recorded pid only when it is
ours: a node process that owns the service's port or whose command line shows the service `start.ps1` starts
(ours, but not on its port yet), or the `cmd.exe` wrapper with our command line (its node child is stopped
first). `start.ps1` records each process's start time, with its pid, in `pids.started.json` next to `pids.json`
(a separate file, so older checkouts' readers never see it; the time counts only for the pid it was recorded
with, since an older checkout may cycle a service without touching it), so a pid another process holds by now
(another start time, or another command line) is reported as not running and forgotten; one that holds our port, or one whose command
line cannot be read and listens on nothing, is refused with exit code 1 (the pid is kept in the second case), as
is a kill that did not take or a port still open after our process was stopped. `reset-demo-world.ps1` stops on
a refusal, or on an open Foundry port, instead of copying over an open world. The decision is a pure function (`Resolve-StopAction` in `config.ps1`) with a table test
(`stop-decision.test.mjs`, through `pwsh`).

`dashboard-controls` and `player-rendered` also need a real browser and skip themselves against the fake.
The control sweep walks a classification table (`lib/dashboard-controls.mjs`) with one row for every
dashboard and player control in the usage catalog, and a unit test fails when a control has no row (a new
control must be classified on purpose). A row says what a test may do with the control: open it, read it,
toggle it and put it back, check it is present (Obsidian and Foundry links, the AI controls), or never click it
(it changes the game or the world, and the write flows cover it). One report step per drawer or group lists
the controls that failed; the `controls` attachment has one row per control (pass, fail or skip with the
reason), and the report links one screenshot per drawer, view, moment and During layout for a person to
look at (no pixel comparison). A control that depends on data (a boss in the combat, a stored Tarokka reading,
AI on) is skipped with a note when it is not on the screen, never failed; a console error during a row fails
it even so (the sweep waits a moment after each row so a late error lands on the row that caused it). The
tool runner's Pick button and the player page's name picker are required rows: every kit world has tools with
a picker and the kit player user. The sweep turns GM Actions on for the run (put back afterwards) so the
Everyone tab's Undo opens its window, and walks that window read-only: Just this, Everything since and the
rewind under Advanced only plan, Apply is never clicked. The sweep puts the page back after
each control: the theme, the During layout, any open drawer, the undo window and the AI tab of Recent Changes. `player-rendered` places a hidden token with a
canary name in a combat, opens `/player`, waits for the page to draw the combat and checks that neither the
HTML nor the text of the page names the canary or the monsters' true names.

### heroes-advancement

One step per hero, labelled `<hero name>: <class> <level> (<subclass>)`, so the report lists every
failure. The advancement data of the class and subclass (the GM action `describeClass`) is the
oracle. The actor (`inspectActor`) is what is checked:

- the class and its levels, the subclass from its level, and the item each was made from,
- every grant the data gives up to that level is on the actor (matched by source uuid, else by
  name; optional grants are skipped). A grant inside a pack may name its item by a short
  `Item.<id>` uuid; like Foundry, the kit looks for it in the granting class's or subclass's own pack,
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
  refusal and any throw is SYSTEM; a CONTENT note ends with `; from <pack>` when the item came from a
  compendium, so a known-list entry can name the content it is about),
- a chat card was posted,
- the item's uses went up by what the activity says it consumes (when that is a plain number). Uses
  that only recover on combat periods (each turn, the start or end of a turn: Sneak Attack and other
  once-per-turn features) are spent only in combat, as in dnd5e, and the kit uses features outside combat, so it
  expects 0 for them,
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

### heroes-studio

The table builds its characters with the Actor Studio module (`foundryvtt-actor-studio`, tested with
2.10.5). For each class of the profile this scenario builds one hero through Actor Studio's own windows
and compares it with the raw kit hero of the same class, level and choices. The hero is the tier hero
at level 5 (the highest tier level at or below 5 when there is none). One class takes 50 to 160
seconds, a whole `srd` run about 15 minutes and a `licensed` run (13 classes) about 17.

What it clicks (Playwright on the GM page, never a password):

1. The Actors tab, the Actor Studio button, the six ability scores (the standard array, as the raw
   heroes use), the Species, Background and Class drop-downs, the character name, "Create Character".
2. The Spells tab when the window shows it: cantrips first, then spells, by the kit's rotation rule over
   the list the tab offers, then "Finalize".
3. For each level from 2: the "level up" button on the character sheet, the class row, the subclass
   drop-down when the level asks for one, "Add Level".

Actor Studio embeds the system's advancement questions (skills, weapon masteries, fighting styles,
feats, ability score improvements) in its window. The answer pump (`lib/studio-pump.mjs`, the GM action
`studioPump`) answers them with the same rotation rule as `createHero`, so both heroes make the same
choices; the subclass is left to Actor Studio's own drop-down. The pump is the one part that is not a
click: the question dialogs are the system's, and answering them by hand would be one click per
checkbox.

**Settings.** Actor Studio's own defaults would build a different hero (it reads the 2014 SRD packs,
rolls hit points, asks for XP). The scenario sets what a table would set and puts it back afterwards:
the compendium sources (narrowed to the packs of the hero being built, so a profile with 2024 and
legacy packs does not offer two Fighters), the average for hit points, milestone levelling, the Spells
tab on and equipment off (the raw hero has none). **Usage tracking** is different: the module posts
anonymous usage data to its author's server on every page load while its per-user setting
`usage-tracking` is on, and it is on by default. `kit init` turns it off for the kit GM and a run never
puts it back. The `srd` profile lists the module under `modules`; `kit init` enables it in the kit
world.

**What is compared** (`lib/studio-compare.mjs`): class levels and subclass, character level, hit dice,
proficiency bonus, spell slots and the slots a new hero can spend, scale values, saving throws, ability
scores, hit points (maximum and current), armor class, skills, other proficiencies, size, movement and
senses, the items granted and the items chosen, spells, where each item came from (its advancement
origin) and what each advancement of the class, subclass, species and background holds. The feature use
pass of `heroes-features-use` then runs on both heroes; a problem only the Studio hero has is a finding.

**Kinds.** A difference is one of `KIT` (our side: the two heroes made different choices, the pump
failed, the raw hero lacks something), `CONTENT`, `SYSTEM` (the dnd5e system does it for any actor) and
`STUDIO` (Actor Studio itself). When the choices differ, the choice-dependent differences (ability
scores, skills, hit points) become notes under one `KIT` problem. A difference that was traced is in
`KNOWN` in `lib/studio-compare.mjs`, with its reason.

**Expected findings.** The known findings are listed in `data/studio-expected.json` (an id, a kind and
the reason each). The scenario counts them in its report (`expectedFindings`) and passes; a finding that
is not on the list, or that changes kind, fails (`newFindings`). An id is the category and what it says,
the same for every class (`advancement-values:advancement-value-of-subclass`). When Actor Studio fixes
one in our fork, give its line `fixedIn` (for example `"fixedIn": "2.10.5-aitool.1"`); when a new one is
understood and accepted, add its line.

**The list follows the installed version.** The file holds the findings of upstream Actor Studio
2.10.5. The scenario reads the module's version from the GM page (`game.modules`), and `loadExpected`
(`lib/studio-expected.mjs`) leaves out every entry whose `fixedIn` is a fork build at or before the
installed one (`2.10.5-aitool.1` and later builds of the fork). Upstream 2.10.5 therefore gets the whole
list, the fork gets the list without the four fixed findings (the Subclass advancement, the selector
error, the 404 and `feature-problems:no-slot-to-spend`), from `2.10.5-aitool.2` also without the spell
slot finding (`spell-slots-available:spell-slots-a-new-hero-can-spend`, `fixedIn` `2.10.5-aitool.2`), and
one of those coming back on the fork is a new finding that fails. A version the list does not know (not 2.10.5, not a fork build) falls back to the
whole upstream list; the step line of the scenario says which list was used (`expectedList` in the
coverage as well), and a fallback is also logged. The console groups of the report use the same
version.

**Findings of the first live runs (2026-10-06, Foundry 14.368, dnd5e 6.0.5, Actor Studio 2.10.5).** All
12 `srd` classes and all 13 classes of the `licensed` profile were built through Actor Studio, with no
build failure. In every class the choices, ability scores, hit points, armor class, hit dice, scale
values, features granted and their origins equal the raw hero. The findings: `srd` KIT 8, CONTENT 0,
SYSTEM 24, STUDIO 14; `licensed` KIT 9, CONTENT 0, SYSTEM 29, STUDIO 15 (one subclass finding per
class and two console errors, the rest are the repeats below). What differs:

- `STUDIO`, every class: the class's **Subclass advancement is left unset** (`value.uuid` is null). Actor
  Studio drops the subclass item itself after the class level, so the hero has the subclass and all of
  its features, but the class does not record which subclass it was.
- `STUDIO`, every run: the module's `gas.captureAdvancement` hook **throws a selector error** on every
  advancement dialog when "take average hit points" is on (`dnd5e-checkbox[aria-label*="average" i]`: the
  `i` flag is not valid in the jQuery that Foundry 14 ships). Hundreds of console errors per run; the
  hero is still built. Also one 404 for `black-parchment.webp` (a doubled path).
- `SYSTEM`, casters: a hero from Actor Studio starts with **empty spell slots** (0 of max). The system
  leaves a new actor's slots empty until a long rest and the raw builder fills them. So a table that
  builds a hero and presses play has no slots until the first long rest, and the features that spend a
  slot (Font of Inspiration, Wild Resurgence, Font of Magic and their kin) refuse to run.
- `SYSTEM`, one sorcerer subclass: its hit point bonus per level raises the maximum, not the current
  value, so the hero starts at 32 of 37. The same for any effect that adds to the maximum.
- `SYSTEM`, every class: the Human species' Size step shows Small first; both heroes come out Small. A
  player who presses Next keeps Small.
- `KIT`, the 8 casters: the raw hero has **no class spells** (the system asks for none through
  advancement); Actor Studio's Spells tab adds them. Prepared casters get their whole list on the sheet,
  unprepared, and the always-prepared domain spells; nothing is prepared for a wizard.

**The fork build (2026-10-06, Actor Studio 2.10.5-aitool.1).** The same `smoke` scenario against our fork
of Actor Studio (branch `aitool/fixes` of `Gnuminator/foundryvtt-actor-studio`, upstream 2.10.5 plus five
fixes) passes on both worlds: `licensed` 13 of 13 heroes, KIT 9, CONTENT 0, SYSTEM 23, STUDIO 0; `srd`
12 of 12, KIT 8, CONTENT 0, SYSTEM 21, STUDIO 0; no console errors. Gone from the list: the unset
Subclass advancement, the selector error, the 404 and `feature-problems:no-slot-to-spend`. Still on it:
the Size step, the missing class spells of the raw hero, one sorcerer subclass's current hit points, and
the spell slots: the fork fills the slots of a new level 1 hero, but a hero levelled to 5 keeps the slots
of level 1 (for example 2 of 4), because the system does not refill slots on a level up. The expected
list is version-aware (below), so the same file serves the fork and upstream 2.10.5.

**The fork build 2.10.5-aitool.2 (2026-10-06).** It fills the slots again when a level up ends, one or many
levels and multiclass included. The same `smoke` scenario passes on both worlds with no spell slot finding
left: `licensed` 13 of 13 heroes, KIT 9, CONTENT 0, SYSTEM 13, STUDIO 0; `srd` 12 of 12, KIT 8, CONTENT 0,
SYSTEM 13, STUDIO 0 (before: SYSTEM 23 and 21); no console errors. Every slot level and the pact slots of
each hero levelled from 1 to 5 stand at their maximum. `heroes-studio` builds no multiclass hero, so that path
is covered by the fork's own unit test only. What stays on the list: the Size step, the missing class
spells of the raw hero and, in the `srd` run, one sorcerer subclass's current hit points.

Development filters (environment variables): `KIT_STUDIO_CLASSES=fighter,wizard`, `KIT_STUDIO_LEVEL=3`,
`KIT_KEEP_STUDIO=1` (keep the Studio heroes; they carry the kit flag and the next build wipes them),
`KIT_SKIP_STUDIO=1`. Against the fake the scenario builds the "Studio" hero with the builder, which
tests the comparison and the report in CI; it clicks nothing.

### Species, backgrounds, feats and multiclass

Four scenarios (`origins-species`, `origins-backgrounds`, `origins-feats`, `heroes-multiclass`) check what a character gets
before and besides its class. All four use the system's own advancement, make their heroes in the folder "Kit Origin Heroes"
and delete them again (set `KIT_KEEP_ORIGINS=1` to keep them for a look). They run after the others and before the feature
scenarios (order 90). The oracle is the data of the document, read by the GM action `describeOrigin` (what its advancements
say), plus a few rules written down in `lib/origins.mjs`. The GM actions `listOrigins`, `describeOrigin` and `cloneHero` are
new; `createHero` can now add items to an existing kit hero (`actorId`, `items`), start from given ability scores
(`abilities`) and answer a Size choice (`chooseSize`).

| Size    | Species | Backgrounds | Feats                                | Multiclass heroes |
| ------- | ------- | ----------- | ------------------------------------ | ----------------- |
| `smoke` | 3       | 2           | the first and last of each feat type | 4 combinations    |
| `full`  | all     | all         | all                                  | all 12            |
| `long`  | all     | all         | all                                  | all 12            |

**Species** (`origins-species`). One step per species: a level 1 hero of the profile's fighter (else its first class) with
that species. Checked against the species' data: the item and every granted feature, the fixed trait grants (languages,
resistances) and the trait choices made, the size (a species with more than one size is asked, option number `rotation %
options`, and the answer must stick), walking speed and every other movement mode, senses (darkvision and the rest). Each
activity the species granted is used once and the hero put back, like `heroes-features-use`.

**Backgrounds** (`origins-backgrounds`). One step per background, with the default species. Checked: the ability score
increase under the 2024 rules (the points are all spent, none above the cap, none on a locked ability, and every score on the
actor equals the standard array plus every increase the answers made), skill and tool proficiencies, and the origin feat the
background grants: the feat is on the actor and is itself checked against its own data (its grants, trait choices and
features), then used. Starting equipment is counted and named in a note, not applied: the system adds it only through a
dialog, which has no answer in a headless page.

**Feats** (`origins-feats`). A feat needs a hero that meets its prerequisites, so the scenario keeps a few hosts (a fighter at
level 1, 4 and 19 and a wizard at level 4 and 19, `FEAT_HOSTS`), built once through the advancement. For each feat it asks the
system (`assertPrerequisites`, through `describeOrigin` with an `actorId`) which host qualifies, first as built and then with
every score raised to 15. A host that already has the feat (its background gave it) is copied without it. The feat is added
to a copy of the host (`cloneHero`, so the next feat starts from the same host), then checked: the item and its grants, trait
grants and choices, the ability score improvement (points, cap, locked abilities, the scores on the actor), nothing the host
had is lost, and each granted activity is used once. A feat no host can take (a score of 17, say) passes with "skipped:" and
the failed prerequisite and is listed under `unmetPrerequisites` in the coverage attachment; the kit never forces one.
Origin, general, fighting style and epic boon feats all run.

**Multiclass** (`heroes-multiclass`). Twelve combinations (`MULTICLASS_PLAN`): fighter and wizard; wizard and cleric; paladin
and sorcerer (half and full caster); ranger and paladin (two half casters); wizard and warlock (Pact Magic beside the table);
cleric, druid and warlock (three classes); barbarian and monk (no spellcasting); rogue and ranger; paladin and rogue; cleric 1
and wizard 1; fighter 11 and wizard 9 (level 20); and a third caster subclass (a fighter or rogue subclass whose spellcasting
is `third`, when the profile has one). A class the profile lacks skips its combination, with the reason in the coverage
attachment. The kit sets the ability scores (15 in every primary ability either class asks for, Constitution 13), builds the
first class and then adds each further class through the advancement manager at its own level. Checked:

- the multiclass prerequisite (13 in the primary ability of both classes) holds for the scores the kit set (KIT when not),
- for each further class: no saving throw proficiency, the multiclass-only advancements applied, nothing gained beyond them
  and the choices made (`checkMulticlassProficiencies`),
- the class levels, the character level, the proficiency bonus (`2 + floor((level - 1) / 4)`) and one hit die per level in
  each class's size,
- the spell slots by the multiclass rules: the caster level adds full caster levels, half casters rounded up (the 2024 rules;
  a 2014 half caster rounds differently and skips the slot check) and a third of third caster levels rounded down, and the
  slots are the table at that level; Pact Magic comes from the warlock levels alone and is checked on its own,
- hit points: the first class at the full first level, every other level the die average, plus Constitution,
- the features and scale values of every class (the data of each class at its level, read with `describeClass`; the second
  class with `multiclass: true`, which leaves out the first-class-only advancements and counts every hit die level as an
  average), and the choices made,
- the features the added classes gave, used once (at most 12 per hero).

**Failure classes and expected findings.** A difference from the data is SYSTEM, the data against the rules is CONTENT, a
mistake of the kit is KIT. Findings the kit knows and accepts are listed in `data/origins-expected.json` (an id, a kind and
the reason; the id is the scenario's category and what it says, such as `species:movement`). The scenarios count them in their
coverage attachment (`expectedFindings`) and pass; a finding that is not on the list, or that changes kind, fails the step.
The fake implements the rules the checks use, so a green fake run proves the plumbing, not dnd5e. One finding is on the list: `background:trait-choice-with-an-empty-pool` (CONTENT). The system's 2024 Criminal background has a Trait
choice of 1 with an empty pool, which the system never offers.

**What the live runs showed (2026-10-06, Foundry 14.368, dnd5e 6.0.5).** `srd` full: all four scenarios pass (14 species, 4
backgrounds, 16 feats with a host each, 11 of 12 multiclass combinations; the twelfth needs a third caster subclass the SRD
lacks, so it is skipped). The `licensed` profile (79 species, 19 backgrounds, 98 feats, 12 combinations): KIT 0. What the runs
settled:

- `assertPrerequisites` returns what `describeOrigin` reads: all 16 SRD feats and all 98 licensed feats found a host, none was
  left unmet.
- A second class added with `forNewItem` gets the secondary advancements only: no saving throw, the multiclass armor and weapon
  set, nothing more. A chosen feature (a Divine Order) and the class's own subclass add their proficiencies on top, and the check
  allows exactly those (read from the feature's Trait advancements and effects).
- Half casters round up in the 2024 multiclass table (a paladin 5 and a sorcerer 3 give caster level 6; a ranger 4 and a paladin 4
  give 4); the slot tables the system builds match.
- A Size advancement takes `{size}`; the size of all 14 SRD species is answered and read back.

What the live runs taught the kit (all KIT, fixed): dnd5e 6 keeps a species' speed and senses under `movement.speeds` and
`senses.ranges`, and the speeds are strings ("30"); an advancement of a higher level (a species feature at level 5, a feat that
learns more spells as you level) waits for the hero and is not checked at level 1; a module's copy of a system item has the same
item id in another pack (a note, not a mix-up); a granted feature may raise a sense (superior darkvision).

What is left in the `licensed` profile, all findings about the content and not kit failures: CONTENT, 24 species features whose
attack or utility activity spends an item use but the item has none set (no uses to spend), 5 feats of the same kind, 1 feat whose
cantrip choice offers no option, and 2 multiclass uses of an imported ward feature that starts with more uses spent than it has;
SYSTEM, 1: a species feature whose damage activity consumes 0 of the 1 use the activity says.

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

The bridge's `hasSpells` follows the actor's spell items (since PR #134). Before that it followed the spellcasting ability, which
dnd5e 6 sets on every npc, so a monster with no spells was shown as a spellcaster. The check still only notes that case (the
coverage attachment counts it) and fails the other: a monster that has spells the bridge does not show is a SYSTEM problem.

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
reads the creature type of a legacy stat block as an empty object (SYSTEM). Since 2026-10-07 (test kit 8) a challenge
rating 0 creature with no items or no activity at all is no problem, a creature with no type does not make the bridge
disagree, and the rest of those findings are on the srd known list, so the three scenarios pass on `srd`. In `monsters-odd`: all 60 legendary monsters spend their legendary pool (175 of 200 legendary activities were used: 19 spend it through a consumption target, 156 through the system's action consumption, and 25 need a dialog and were left out), so using them in Foundry moves the Boss pips; legendary resistance, lair, regeneration, shapechangers, movement and recharge rolls all agree with the
data; the SRD has no damage threshold (skipped) and no lair actions as activities (text only). Before PR #134 the bridge's `hasSpells`
was true for 294 monsters that have no spells (a spellcasting ability is set on every npc), and false for a Cloaker that has
spells and no ability (the live runs here were made before that fix and have not been repeated). `licensed` full: 1499 monsters (1114 in the local content module, 385 in the 2024 pack, 47 stat blocks), about 3.5
minutes: 3 data findings, 25 monsters with a finding in the broad pass (5 CONTENT, 20 SYSTEM, all of the old `hasSpells`
kind), and in `monsters-odd` all 132 legendary monsters spend their pool (362 of 405 legendary activities used: 298 through a target, 64 through the action, 43 left out for a dialog), 24 of 127 with a legendary
resistance feature that has no activity, 23 spellcasters with data problems (a missing spellcasting ability or an innate spell with
no uses). The `smoke` sample of the `licensed` profile has 31 monsters and takes seconds. These are findings, not kit failures.

### spells-cast-all

One step per spell level. The GM action `listSpells` reads the profile's spell packs (names and numbers
from the index, no text). `selectSpells` keeps each spell name once per rules version (the first pack
wins) and the profile's rules versions; `smoke` then takes a repeatable sample of about thirty
(`sampleSpells`: the first and last spell of every level, one of every kind of first activity and
every area shape, a concentration spell, a ritual), `full` and `long` take them all.

Each spell goes to a suitable caster: the best hero of each spellcasting class is a candidate, and the
first one with slots of the spell's level by its own class table casts it (a cantrip goes to the first
candidate). When no hero has such a slot, the GM action forces one (an override of 2 slots, put back
after) and the report counts it as `slotsForced`. The GM action `exerciseSpell` gives the hero a copy
of the compendium spell, casts its first activity at its base level through `activity.use` with no
dialog, no measured template, no summons, no roll after the card and no action cost, reads what the
system did, and puts the hero back (items, slots, hit points, effects, chat messages; a whole
`actor.system` compare, like `exerciseActor`). Each cast is judged (`judgeCast` in `lib/spells.mjs`):

- the system did not throw or refuse (a refusal about an item the actor lacks is CONTENT, a spell with
  no activity is CONTENT, a slot problem after the kit forced a slot is KIT, anything else SYSTEM),
- a chat card was posted,
- the slot went down by one when the activity consumes one (and nothing else changed); a cantrip or a
  spell cast by another method takes none,
- a spell that needs concentration made a concentration effect,
- the hero is exactly as before (KIT when not).

Two kinds of spell are left out of the cast instead of failing it, and the coverage attachment (`leftOut`,
`noActivity`) counts them:

- A spell whose only activities are of type `transform` or `order` asks for a dialog nobody can answer in a
  headless page (a form to take, a bastion facility). When the spell has another activity that one is cast;
  otherwise the spell is left out with that reason.
- A spell that loads with no activity at all (`noActivity`) is classified (`classifyNoActivity`):
  `described` (the system's own pack ships it with none too, or it has no system counterpart and its
  description has nothing to roll) is expected and not a problem; `lost` (the system's own pack has
  activities for the same name), `foreign` (every activity in the pack is of a type the system does not
  have, such as an importer's macro activity, so the item loads empty) and `rollable` (no counterpart, the
  description mentions a saving throw, an attack, damage, healing or a summon) are CONTENT, each with its
  reason and a fix route in the attachment. `foreign` and `lost` have a counterpart to copy the activities
  from.

The coverage attachment has the spell counts by level, the casters, the forced slots, the problems by
kind and every failed spell with its problems. A licensed profile's report stays in the kit home.

### spells-deep

One step per check, 31 checks on SRD spells (the spell names are public SRD text; a licensed profile
that has a spell of the same name is judged against the same table). A check whose spell the profile
lacks is skipped with the reason and listed under `checksSkipped`. The oracle is the 2024 SRD rules
written down in `lib/spells-deep.mjs`: a number the imported data gets wrong is CONTENT, a number the
data has right and the system gets wrong is SYSTEM.

| Check                   | What it proves                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `attack-ranged`         | Fire Bolt: the attack bonus is proficiency plus the casting ability, a ranged attack      |
| `attack-melee`          | Shocking Grasp: the same for a melee spell attack                                         |
| `save-dc`               | Burning Hands: the save DC is 8 + proficiency + the casting ability, a Dexterity save     |
| `save-half`             | Fireball: 8d6 fire, Dexterity save, half damage on a save, the rolled dice match          |
| `save-negates`          | Hold Person: a Wisdom save, no damage, the paralyzed condition applies (and is removed)   |
| `template-sphere`       | Fireball: a 20 ft sphere makes a circle Region                                            |
| `template-cone`         | Burning Hands: a 15 ft cone makes a cone Region                                           |
| `template-line`         | Lightning Bolt: a 100 ft line makes a line Region                                         |
| `template-cube`         | Thunderwave: a 15 ft cube makes a rectangle Region                                        |
| `template-wall`         | Wall of Fire: a wall of 60 ft makes a line Region                                         |
| `concentration-begin`   | Bless: casting makes one concentration effect and takes a 1st level slot                  |
| `concentration-replace` | Bless then Hold Person: the second concentration spell ends the first                     |
| `concentration-none`    | Magic Missile: an instant spell does not begin concentration                              |
| `upcast-dice`           | Burning Hands in a 3rd level slot: 5d6, scaling 2, only the 3rd level slot goes           |
| `upcast-targets`        | Magic Missile in a 3rd level slot: 5 darts instead of 3, each 1d4 + 1                     |
| `upcast-heal`           | Cure Wounds in a 3rd level slot: 6d8                                                      |
| `heal-roll`             | Cure Wounds: 2d8 plus the casting ability, a healing roll                                 |
| `temp-hp`               | False Life: 2d4 + 4 temporary hit points, applied to the caster                           |
| `teleport`              | Misty Step: a bonus action teleport, a 2nd level slot (the activity type is a note)       |
| `reaction-shield`       | Shield: a reaction, +5 Armor Class while it lasts                                         |
| `mage-armor`            | Mage Armor: Armor Class 13 + Dexterity for a hero with no armor                           |
| `bless-effects`         | Bless: +1d4 to attack rolls and saving throws while it lasts                              |
| `ritual-no-slot`        | Detect Magic: a normal cast takes a slot, a ritual cast takes none                        |
| `cantrip-no-slot`       | Fire Bolt: a cantrip takes no slot                                                        |
| `cantrip-scaling`       | Fire Bolt: 1, 2, 3 and 4 dice at character level 1, 5, 11 and 17 (the levels the kit has) |
| `pact-slot`             | Hex through Pact Magic: a pact slot goes, cast at the pact slot level                     |
| `slot-choice`           | Cure Wounds in a 2nd level slot takes the 2nd level slot and not the 1st                  |
| `no-slot-refused`       | Burning Hands with no 1st level slot left is refused, posts nothing, changes nothing      |
| `summon-placed`         | Flaming Sphere: the summon is placed on the kit scene and cleaned up again                |
| `scroll`                | A Fireball scroll: cast from the scroll, no slot, the scroll used up                      |
| `auto-hit-damage`       | Magic Missile: a damage activity (no attack, no save), 1d4 + 1 force                      |

Two things the checks do instead of the real thing, because the real thing is interactive: an area
template is checked by creating the Region the system would build from the activity's template data
(`TemplatePlacement.fromActivity` waits for a click), and the summon replaces `TokenPlacement.place`
for the length of one call. The effects of a spell (a condition, an armor formula, bonus dice) are
applied to the caster as a copy of the spell's effect, as the chat card's apply button does, and
removed again by the restore.

**What the first live runs showed (2026-10-06).** `srd` `smoke` and `full`: both spell scenarios pass. `full` casts all
340 spells of the system's 2024 pack with no problem and all 31 deep checks pass; the `smoke` sample is 34 spells
and the whole `smoke` run takes about a minute. `licensed` `full`: 1168 spells are listed in the three spell packs,
845 are counted (each name once per rules version) and cast in about 80 seconds (the whole run with the 157-hero
build is about 15 minutes); 5 of them have only a transform activity and are left out, and 2 have no activity
after loading: both come from one licensed content pack and carry an activity of a type the system does not have
(the `foreign` kind above), and both have a spell of the same name in the system's own pack to copy the activities
from. All 31 deep checks pass on the licensed data. In the system's own packs and the licensed book pack no
spell is without activities. The deep checks take about 4 seconds because they are about 40 casts of 0.1 seconds.
Three things the first runs taught the kit: ending a concentration effect also ends the effects that depend on
it, so the restore deletes new effects one by one; a transform activity waits for a dialog for ever, so the cast
pass picks another activity or leaves the spell out; and whether a teleport spell uses a teleport or a utility
activity is the data's choice, so the Misty Step check judges the bonus action and only notes the type.

### Failure classes

Every failed check says which kind it is, first in the message, with its evidence:

| Class     | Meaning                                                      | Example                                                  |
| --------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `KIT`     | Our builder or our check is wrong.                           | a choice was not made, the hit point sum is off          |
| `CONTENT` | The imported data is wrong or incomplete.                    | a grant whose uuid does not resolve                      |
| `SYSTEM`  | The dnd5e system did something other than its own data says. | a grant not applied, a slot table that differs           |
| `STUDIO`  | Actor Studio did something the plain system route does not.  | a Subclass advancement left unset (`heroes-studio` only) |

Fix `KIT` failures in the kit. Report `CONTENT` and `SYSTEM` failures: do not change the imported
content or the product to make the kit green. Report `STUDIO` failures to the module's author: do not
change Actor Studio to make the kit green.

### Known findings

A `CONTENT` or `SYSTEM` failure that is understood and reported goes on the profile's known list, so
the next run counts it instead of failing on it, and a new failure stands out. `heroes-advancement`,
`heroes-features-use`, `heroes-multiclass`, the origins scenarios, `monsters-matrix`, `monsters-every`,
`monsters-odd` and `spells-cast-all` read the list (`lib/known.mjs`; the origins ones after their own `data/origins-expected.json`);
`heroes-studio` keeps its own (`data/studio-expected.json`). In `monsters-odd` a monster whose
problems are all known is counted in the check's `known` number and does not fail the check; in
`spells-cast-all` a spell whose problems are all known does the same for its level.

| Profile    | Known list                                                    |
| ---------- | ------------------------------------------------------------- |
| `srd`      | `scripts/test-kit/data/profiles/srd.known.json` (in the repo) |
| a local id | `<kit home>\licensed\profiles\<id>.known.json` (this PC only) |

The licensed list names licensed features, so it stays on this PC like its profile. A missing file is
an empty list. A profile that includes the system's own packs also has the system's findings, so its
file names the profiles whose lists count too: `"knownAlso": ["srd"]` in the licensed profile. The
profile's own entries are checked first, then the inherited ones (one level); an id in two lists is
an error. A monster finding ends with the monster's pack (`...; in aitool-content.monsters`) and a
spell finding with the spell's pack, so an entry's `match` can name the pack and the same creature in
two packs is told apart. An entry:

```json
{
  "id": "some-pack-uses-not-set",
  "scenario": "heroes-features-use",
  "kind": "CONTENT",
  "what": ["the system refused the use", "uses consumed"],
  "max": 530,
  "match": "none are set; from some-module.classes",
  "why": "the pack's features spend their own uses, but the items have none set"
}
```

A problem is known when the scenario and kind are equal, the problem's `what` is the entry's `what`
(or one of them, when it is a list), and the problem's evidence contains `match`. `what` is required,
so an entry covers only the problem it names; where one problem packs several items ("2 grant(s)
missing: ..."), put the count in `what`, so a new item beside the old one fails. `max` (optional)
caps the problems an entry may cover in one run, and the ones over it fail: give a pack-wide entry a
`max` near the count a `full` run sees, so new findings of its kind are not absorbed. A `KIT` problem
is never known, and neither is a hero that was not built. A step whose problems are all known passes and names the entries in its detail; the report's "Known findings" section lists how
often each entry matched and the entries a run did not see (normal in `smoke`; in `full` the content
may have been fixed, so remove the entry).

## Console errors

The GM page's console errors and page errors are collected for the whole run. A full run can log
hundreds of the same one, so the report **groups** them: same message and place, with ids, hosts and
line numbers stripped (`Texture <id> failed`), and for a page error the function it was thrown in.
Each group shows its count, first and last time, and the scenarios it came during (`build` for the
build). New groups come first. The raw list stays in `report.json` (`consoleErrors`, each with
`at`, `message`, `source` and `scenario`); the groups are there too (`consoleGroups`).

**Known groups.** A group is known when its finding id is in `data/studio-expected.json` (ids that
start with `console:`: the hook it names, `console:gas.captureAdvancement`, or the file it failed to
load, `console:black-parchment.webp`; a page error gets `console:pageerror:<function>`). Known groups
show their kind (STUDIO, SYSTEM) and reason. Anything else is **NEW**: the report starts with a
warning line, `report.md` and `report.html` mark the group, and the command prints the totals and
every new group at the end. A new console error warns and does not fail the run; the older rules
still fail: a console error from our own module fails its scenario (the `module console errors`
step), and `heroes-studio` fails on a new Actor Studio finding. To accept a new known error, add an
entry with its id to `studio-expected.json` and say why.

**The notification error (fixed in the kit).** Full runs used to log hundreds of `TypeError: Cannot
set properties of null (setting 'hidden')` from `#postNotification`. Cause: the kit uses an item or a
spell, which makes a chat card, and puts the world back by deleting the card moments later. Foundry
14 shows each new card as a pop-up notification and animates it for about 100 ms; when the card is
deleted in that time its element is gone, and the next line (`element.hidden = false`, Foundry
`chat.mjs`, `#postNotification`) throws. It needs a card created and deleted within a tenth of a
second, which a table never does, so this is a kit artifact and not a bug to report. The kit's GM
page now answers "no" to `_shouldShowNotifications` (the same as the setting "Chat notifications:
pip"; `quietChatNotifications` and `keepChatNotificationsQuiet` in `lib/gm.mjs`), so no pop-up is
animated. The change is made again after every page reload (Actor Studio setup and a failed Studio
build reload the page, and a reload brings the pop-ups back). If the error comes back it shows as
NEW, which means the page hook no longer works.

## How to write a scenario

A scenario is a file `<id>.scenario.mjs` whose default export describes it. The full contract is in
`lib/contract.mjs`. In short:

- `id` (kebab-case), `title`, `sizes`, `tags`, `needs` (which parts of the manifest it uses).
- `order` (optional number, default 0): lowest runs first. The feature scenarios have 100, so they run last: they
  post thousands of chat cards.
- `t.size` (read only): the kit size of the run, for a scenario that samples.
- `tools`: every bridge tool it calls. `kit check` fails if a tool is not in `tool-sets.ts`.
- `gmActions`: every GM action it calls (the only way to run code inside Foundry).
- `run(t)`: the scenario. `t` has `step`, `check`, `equal`, `tool`, `guarded.planApply`,
  `guarded.undo`, `gm`, `player.state`, `player.html`, `http`, `kit` (the manifest), `log`,
  `attach`, `attachFile`, `browser` (dashboard pages in Edge, see below) and `cleanup`.

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

### Dashboard pages and screenshots

A scenario that checks the dashboard or the player view in a real browser uses `t.browser` and
`t.attachFile`. Both are for the live run only: against the fake `t.browser` is null (check for it and
call `t.skip(...)`), and `t.attachFile` returns null when the run has no report folder.

- `await t.browser.open(path, { fresh, viewport })` opens a page of the dashboard (`path` is relative,
  for example `/` or `/player`) and waits for it to load. It returns a Playwright page. By default the
  page is a new tab in the GM's Edge. With `fresh: true` it is a separate headless Edge with no cookies,
  for the login checks; that browser starts the first time a scenario asks for it. `viewport` sets the
  size, for example `{ width: 390, height: 844 }` for a phone.
- `t.browser.consoleErrors(page)` returns the console and page errors of that page so far (of every page
  of the scenario without an argument). The runner also puts them in the report's console errors with
  `page: 'dashboard'` or `'player'` (a path starting with `/player`), grouped apart from Foundry's errors.
  Close nothing yourself: the runner closes every page after the scenario, even when it failed.
- `t.attachFile(name, data, { type })` writes a file (a screenshot from `page.screenshot()`, `type`
  `'image/png'` by default) to `<report folder>/files/<scenario id>/<name>`. The name is cut down to
  lower case letters, digits, `.`, `_` and `-`. The report links the file in `report.md` and shows images
  in `report.html`. It returns the written path.

```js
const page = await t.browser.open('/player', { viewport: { width: 390, height: 844 } });
t.attachFile('player-phone.png', await page.screenshot({ fullPage: true }));
t.check(t.browser.consoleErrors(page).length === 0, 'the player page logs no errors');
```

## Where things live

| What                                      | Where                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The engine, the GM actions, the fake      | `scripts/test-kit/lib/`                                                                                                                     |
| The contract everything builds against    | `scripts/test-kit/lib/contract.mjs`                                                                                                         |
| The hero checks and failure classes       | `scripts/test-kit/lib/advancement.mjs`                                                                                                      |
| The feature checks and rules tables       | `scripts/test-kit/lib/features.mjs`                                                                                                         |
| The monster checks, matrix and odd checks | `scripts/test-kit/lib/monsters.mjs`                                                                                                         |
| The spell judging and the sampling        | `scripts/test-kit/lib/spells.mjs`                                                                                                           |
| The deep spell checks and their rules     | `scripts/test-kit/lib/spells-deep.mjs`                                                                                                      |
| The spell GM actions (in the page)        | `scripts/test-kit/lib/gm-spells.mjs`                                                                                                        |
| The origin checks, hosts and multiclass   | `scripts/test-kit/lib/origins.mjs`, `origins-flow.mjs`, `origins-list.mjs`, `origins-feats.mjs`, `origins-multiclass.mjs`, `gm-origins.mjs` |
| The expected origin findings              | `scripts/test-kit/data/origins-expected.json`                                                                                               |
| Driving Actor Studio, the answer pump     | `scripts/test-kit/lib/studio.mjs`, `studio-flow.mjs`, `studio-pump.mjs`                                                                     |
| Comparing a Studio hero with a raw hero   | `scripts/test-kit/lib/studio-compare.mjs`, `inspect-build.mjs`                                                                              |
| The SRD scenarios (no licensed content)   | `scripts/test-kit/scenarios/*.scenario.mjs` (in the repo)                                                                                   |
| The SRD content profile                   | `scripts/test-kit/data/profiles/srd.json`                                                                                                   |
| The known findings of a profile           | `scripts/test-kit/lib/known.mjs`, `data/profiles/srd.known.json`, `<kit home>\licensed\profiles\<id>.known.json`                            |
| The pick coverage                         | `scripts/test-kit/lib/picks.mjs`                                                                                                            |
| The monsters and the scene                | `scripts/test-kit/data/smoke-matrix.json`                                                                                                   |
| The manifest of the last build            | `<kit home>\worlds\<world>\manifest.json`                                                                                                   |
| Reports                                   | `<kit home>\reports\` (this PC only)                                                                                                        |
| Console error groups, known list          | `scripts/test-kit/lib/console-errors.mjs`, `data/studio-expected.json`                                                                      |
| Licensed profiles and scenarios           | `<kit home>\licensed\` (this PC only)                                                                                                       |

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

- The full matrix of spells is done (slice 3b: see "spells-cast-all" and "spells-deep").
- Dashboard checks in a real browser (Playwright), not only the JSON the dashboard serves.
- Actor Studio at other levels (1, 11, 17, 20), with equipment and its biography tab on, and a multiclass
  level-up (the plain route is covered by `heroes-multiclass`); the Actor Studio findings above sent to its author.
- A Pi target: the same kit against the Orange Pi, once the Pi has a kit world.
- The licensed layer: the Curse of Strahd scenarios, kept on this PC only.
