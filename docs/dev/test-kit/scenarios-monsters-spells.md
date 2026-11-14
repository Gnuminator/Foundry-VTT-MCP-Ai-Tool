---
title: Monster and spell scenarios
description: The monsters, spells-cast-all and spells-deep scenarios.
---

# Monster and spell scenarios

Part of [TEST-KIT](../TEST-KIT.md).

## The monsters

Three scenarios cover the monster compendium of the content profile. The monsters of a profile are the actors of type npc in the
packs of `packs.monsters` (the `srd` profile lists `dnd5e.actors24` and the legacy `dnd5e.monsters`; a profile with licensed books
lists theirs). Characters and vehicles in those packs are left out and counted. The GM action `listMonsters` reads them as facts
(names, numbers and flags, never text); a probe copy is made with `createMonster` and removed with `deleteMonsters`, which refuses an
actor without the kit flag. A probe is always deleted, also when a step fails, and carries the kit flag, so a rebuild wipes one a
dead run left behind. `monsters-every` and `monsters-odd` run last (`order` 100), like the feature scenarios; `monsters-matrix` has no `order` (0), so it runs with the early ones.

A creature with no challenge rating (what a spell makes or summons: a steed, an animated object, a familiar) is a **stat block**.
It is copied and used like any monster, but it is not held to the data a creature needs (a rating, a known type, hit points, armor
class, items); the matrix counts it on its own line.

| Size    | `monsters-every`                                                  | `monsters-odd`                              |
| ------- | ----------------------------------------------------------------- | ------------------------------------------- |
| `smoke` | a sample: the first monster of each CR band, type, size and trait | 2 monsters per check, one per movement mode |
| `full`  | every monster                                                     | every monster a check applies to            |
| `long`  | every monster                                                     | every monster a check applies to            |

### monsters-every

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

### monsters-matrix

Reads the packs and changes nothing. Steps: the packs are installed and have monsters, the counts add up, then the counts by CR
band (9 bands), creature type (the 14 types), size, book and trait (29 traits: resistance, immunity, vulnerability, condition
immunity, damage modification, the four senses, languages, spells, innate spellcasting, legendary actions and resistance, lair and lair actions, the five movement modes,
regeneration, shapechanger, damage threshold, multiattack, recharge, summon, transform), the damage types and conditions and
languages, and **the gaps**: a band, type, size or trait nobody in the profile has. The counts and gaps are attached
(`matrix`) and do not fail the scenario. The last step checks the data every creature needs (`judgeRow`, CONTENT): a valid
rating, a known type and size, hit points, armor class, items, a legendary pool that matches its legendary actions, sane speeds.

### monsters-odd

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
