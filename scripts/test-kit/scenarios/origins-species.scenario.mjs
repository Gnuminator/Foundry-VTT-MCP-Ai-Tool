/**
 * Every species of the content profile is applied to a level 1 hero through the system's own
 * advancement (the choices rotate like the hero builder's), and the hero is checked against the
 * species' data: its item and granted features, the trait grants and choices, size (a species with
 * two sizes is asked), walking speed and other movement modes, senses (darkvision and the rest) and
 * resistances. Each granted activity is used once and the hero put back (the feature pass of
 * heroes-features-use). Failures are KIT, CONTENT or SYSTEM; known and accepted ones are listed in
 * data/origins-expected.json. A `smoke` run takes three species, `full` every one.
 * Species names stay in the local report.
 */
import { runOriginList } from '../lib/origins-list.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'origins-species',
  title:
    'Every species gives its size, speed, senses, traits and features; each feature can be used',
  sizes: ['smoke', 'full', 'long'],
  tags: ['build', 'module'],
  needs: [],
  tools: [],
  gmActions: [
    'listCompendium',
    'listOrigins',
    'describeOrigin',
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
    await runOriginList(t, 'species');
  },
};
