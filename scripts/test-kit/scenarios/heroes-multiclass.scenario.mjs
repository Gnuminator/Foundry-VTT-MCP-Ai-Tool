/**
 * Multiclass heroes: a first class, then one or two more taken through the system's own advancement
 * (the second class at its own level). Twelve combinations cover the casting rules: a martial class
 * with a full caster, two full casters, a half caster with a full caster and with another half caster,
 * Pact Magic beside a full caster and in a three class hero, two classes with no spellcasting, a
 * third caster subclass, one level each and a level 20 hero. Each is checked for the 13 in the primary
 * ability of both classes (the kit sets the scores), the proficiencies a further class gives (no
 * saving throw, only the multiclass set), the combined spell slots (full levels plus half levels
 * rounded up plus a third of third caster levels; Pact Magic from warlock levels alone), hit points
 * (the first class at the full first level, every other level the average), hit dice, the proficiency
 * bonus and the features and scale values of every class. The features of the added classes are used
 * once. A `smoke` run takes four combinations, `full` all twelve; a class the profile lacks skips its
 * combination. Failures are KIT, CONTENT or SYSTEM; known and accepted ones are in
 * data/origins-expected.json.
 */
import { runMulticlass } from '../lib/origins-multiclass.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'heroes-multiclass',
  title:
    'Multiclass heroes get the reduced proficiencies, the combined slots and the features of both classes',
  sizes: ['smoke', 'full', 'long'],
  tags: ['build', 'module'],
  needs: [],
  tools: [],
  gmActions: [
    'listCompendium',
    'listOrigins',
    'describeOrigin',
    'describeClass',
    'ensureFolder',
    'createHero',
    'inspectBuild',
    'inspectActor',
    'inspectFeatures',
    'exerciseActor',
    'deleteKitActor',
  ],
  // After the others, before the feature scenarios (order 100): a few dozen chat cards, not thousands.
  order: 90,
  timeoutMs: 3 * 60 * 60 * 1000,

  async run(t) {
    await runMulticlass(t);
  },
};
