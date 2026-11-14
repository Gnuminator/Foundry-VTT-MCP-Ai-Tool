---
title: Content profiles, heroes and coverage
description: What the kit builds: content profiles, the heroes for every class and subclass, and the coverage report.
---

# Content profiles, heroes and coverage

Part of [TEST-KIT](../TEST-KIT.md).

## Content profiles

A profile says where the builder finds its content: the packs for classes, subclasses, species,
backgrounds, monsters, spells and feats, the modules to enable, and which rules versions count. It
names pack ids and module ids only, never book text. A profile file is JSON; the shape is
`ContentProfile` in `lib/contract.mjs` and `lib/profiles.mjs` checks it.

| Profile    | Lives in                                                | World                  |
| ---------- | ------------------------------------------------------- | ---------------------- |
| `srd`      | `scripts/test-kit/data/profiles/srd.json` (in the repo) | `ai-tool-kit-srd`      |
| a local id | `<kit home>\licensed\profiles\<id>.json` (this PC only) | `ai-tool-kit-licensed` |
| a local id | `<kit home>\licensed\profiles\<id>.json` (this PC only) | `strahd-kit`           |

- **Only the `srd` profile is in the repo.** It uses the packs that ship with the system.
- **A licensed profile never goes into a repo or the vault.** It lives under the kit home, next to
  the licensed scenarios and the notes about them. `--profile licensed` loads
  `<kit home>\licensed\profiles\licensed.json`.
- **A profile's world must be a kit world** (`KIT_WORLDS` in the contract). A profile for any other
  world is refused, so a bad profile cannot build into the everyday test world or a real campaign.
- **An unknown profile is an environment error** (exit code 2) that names the file it looked for.
- **A profile may pick the matrix monsters** with `"matrixMonsters": {"pack": "<pack id>", "rules":
"2024"}`: the build's monster matrix then picks from that pack instead of `dnd5e.actors24` (the
  matrix file's pack), and only entries whose `system.source.rules` is that version. The licensed
  profile names its imported Monster Manual, so its kit monsters do not come from the system's SRD
  copies, whose features name the Monster Manual module's ids.
- **`strahd-kit` is a throwaway copy of the campaign world** for the licensed Curse of Strahd
  scenarios (the same name as the Pi's test copy). It is made again from the campaign world whenever
  it is needed, with the world id and title changed; the campaign world itself is never a kit world.

The folder layout on this PC:

```text
C:\FoundryTest\test-kit\            the kit home (or the folder in TEST_KIT_HOME)
  worlds\<world>\manifest.json      what the last build made (worlds-B\ for server B)
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
| `srd`      | `smoke` | 12     | about 1 minute   | about 1 minute (see below)      |
| `srd`      | `full`  | 64     | about 5 minutes  | about 5 minutes                 |
| `licensed` | `smoke` | 13     | about 1 minute   | about 1.5 minutes (see below)   |
| `licensed` | `full`  | 157    | about 12 minutes | about 13 minutes                |

The `smoke` times were measured before `foundry-controls` joined `smoke`. That scenario launches a second Edge,
rebuilds the creature index (it waits up to 4 minutes) and polls the join page in a fresh Edge per
attempt, so a `smoke` run now takes several minutes longer than the table says. It has not been re-measured.

The two feature scenarios add little: about 25 seconds to an `srd` `full` run (5 minutes in all) and about
2 minutes to a `licensed` `full` run (14 minutes in all, 157 heroes, 2195 activities used).

Start a `full` run in the background and do not wait on it.
