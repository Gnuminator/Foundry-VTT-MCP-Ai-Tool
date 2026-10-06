/**
 * Every feat of the content profile is added, one at a time, to a copy of a host hero that meets its
 * prerequisites (a fighter or wizard of level 1, 4 or 19, as built or with every score raised to 15),
 * through the system's own advancement. Each feat is checked against its own data: the item and its
 * grants, the trait grants and choices, the ability score improvement (points, cap, the scores on the
 * actor), nothing the host had is lost. Each granted activity is used once. A feat no host can take is
 * recorded with the prerequisite that failed, never forced. Origin, general, fighting style and epic
 * boon feats all run. A `smoke` run takes the first and last feat of each type, `full` every feat.
 * Failures are KIT, CONTENT or SYSTEM; known and accepted ones are in data/origins-expected.json.
 */
import { runFeats } from '../lib/origins-feats.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'origins-feats',
  title:
    'Every feat can be taken by a hero that meets its prerequisites and does what its data says',
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
    'cloneHero',
    'inspectBuild',
    'inspectActor',
    'inspectFeatures',
    'exerciseActor',
    'deleteKitActor',
  ],
  // After the others, before the feature scenarios (order 100): a few dozen chat cards, not thousands.
  order: 90,
  timeoutMs: 4 * 60 * 60 * 1000,

  async run(t) {
    await runFeats(t);
  },
};
