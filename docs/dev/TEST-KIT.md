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

## Pages

This page used to hold everything. The text now lives in these pages (every old section link still lands here and points on):

- [Running the kit](test-kit/what-it-runs.md): Commands, sizes, running it live and on the Pi, the three test servers and the kit run command.
- [Content profiles, heroes and coverage](test-kit/content-and-heroes.md): What the kit builds: content profiles, the heroes for every class and subclass, and the coverage report.
- [The scenarios](test-kit/scenarios.md): The generated scenario table and the hero scenarios.
- [Monster and spell scenarios](test-kit/scenarios-monsters-spells.md): The monsters, spells-cast-all and spells-deep scenarios.
- [Failure classes and known findings](test-kit/findings.md): How a failure is classified and the findings the kit has already turned up.
- [Writing scenarios, CI and safety guards](test-kit/writing-and-safety.md): Console errors, how to write a scenario, dashboard pages and screenshots, where things live, CI and live, safety guards and what comes next.

## Old section links

Each heading below is where a section used to be. The link under it goes to its new home.

### Commands

Moved to [Running the kit](test-kit/what-it-runs.md#commands).

#### Sizes

Moved to [Running the kit](test-kit/what-it-runs.md#sizes).

#### Running it live

Moved to [Running the kit](test-kit/what-it-runs.md#running-it-live).

#### Running it on the Pi

Moved to [Running the kit](test-kit/what-it-runs.md#running-it-on-the-pi).

#### Three test servers

Moved to [Running the kit](test-kit/what-it-runs.md#three-test-servers).

#### The kit run command

Moved to [Running the kit](test-kit/what-it-runs.md#the-kit-run-command).

### Content profiles

Moved to [Content profiles, heroes and coverage](test-kit/content-and-heroes.md#content-profiles).

### The heroes

Moved to [Content profiles, heroes and coverage](test-kit/content-and-heroes.md#the-heroes).

### Coverage

Moved to [Content profiles, heroes and coverage](test-kit/content-and-heroes.md#coverage).

### The scenarios

Moved to [The scenarios](test-kit/scenarios.md#the-scenarios).

#### heroes-advancement

Moved to [The scenarios](test-kit/scenarios.md#heroes-advancement).

#### heroes-features-use

Moved to [The scenarios](test-kit/scenarios.md#heroes-features-use).

#### heroes-features-deep

Moved to [The scenarios](test-kit/scenarios.md#heroes-features-deep).

#### heroes-studio

Moved to [The scenarios](test-kit/scenarios.md#heroes-studio).

#### Species, backgrounds, feats and multiclass

Moved to [The scenarios](test-kit/scenarios.md#species-backgrounds-feats-and-multiclass).

#### The monsters

Moved to [Monster and spell scenarios](test-kit/scenarios-monsters-spells.md#the-monsters).

##### monsters-every

Moved to [Monster and spell scenarios](test-kit/scenarios-monsters-spells.md#monsters-every).

##### monsters-matrix

Moved to [Monster and spell scenarios](test-kit/scenarios-monsters-spells.md#monsters-matrix).

##### monsters-odd

Moved to [Monster and spell scenarios](test-kit/scenarios-monsters-spells.md#monsters-odd).

#### spells-cast-all

Moved to [Monster and spell scenarios](test-kit/scenarios-monsters-spells.md#spells-cast-all).

#### spells-deep

Moved to [Monster and spell scenarios](test-kit/scenarios-monsters-spells.md#spells-deep).

#### Failure classes

Moved to [Failure classes and known findings](test-kit/findings.md#failure-classes).

#### Known findings

Moved to [Failure classes and known findings](test-kit/findings.md#known-findings).

### Console errors

Moved to [Writing scenarios, CI and safety guards](test-kit/writing-and-safety.md#console-errors).

### How to write a scenario

Moved to [Writing scenarios, CI and safety guards](test-kit/writing-and-safety.md#how-to-write-a-scenario).

#### Dashboard pages and screenshots

Moved to [Writing scenarios, CI and safety guards](test-kit/writing-and-safety.md#dashboard-pages-and-screenshots).

### Where things live

Moved to [Writing scenarios, CI and safety guards](test-kit/writing-and-safety.md#where-things-live).

### CI and live

Moved to [Writing scenarios, CI and safety guards](test-kit/writing-and-safety.md#ci-and-live).

### Safety guards

Moved to [Writing scenarios, CI and safety guards](test-kit/writing-and-safety.md#safety-guards).

### What comes next

Moved to [Writing scenarios, CI and safety guards](test-kit/writing-and-safety.md#what-comes-next).
