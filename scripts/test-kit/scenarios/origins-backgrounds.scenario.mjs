/**
 * Every background of the content profile is applied to a level 1 hero through the system's own
 * advancement, and the hero is checked against the background's data: the ability score increases
 * (2024 rules: points to spend, the cap, the locked abilities, and the scores on the actor), skill
 * and tool proficiencies, the origin feat it grants and that feat's own grants. Each granted
 * activity is used once and the hero put back. Starting equipment is counted, not applied: the
 * system adds it only through a dialog. Failures are KIT, CONTENT or SYSTEM; known and accepted ones
 * are listed in data/origins-expected.json. A `smoke` run takes two backgrounds, `full` every one.
 */
import { runOriginList } from '../lib/origins-list.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'origins-backgrounds',
  title: 'Every background gives its ability scores, proficiencies and origin feat',
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
    await runOriginList(t, 'background');
  },
};
