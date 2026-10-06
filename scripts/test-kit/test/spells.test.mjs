import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKit } from '../lib/builder.mjs';
import { loadToolCatalog } from '../lib/catalog.mjs';
import { createDashboardClient } from '../lib/dashboard.mjs';
import { FAKE_SPELLS } from '../lib/fake/spells.mjs';
import { startFake } from '../lib/fake/index.mjs';
import { loadScenarios } from '../lib/loader.mjs';
import { loadProfile } from '../lib/profiles.mjs';
import { runScenariosDetailed } from '../lib/runner.mjs';
import {
  casterCandidates,
  casterFor,
  classifyNoActivity,
  judgeCast,
  refusalOfCast,
  sampleSpells,
  selectSpells,
  throwKind,
} from '../lib/spells.mjs';
import { DEEP_SPELL_CHECKS, runSpellCheck } from '../lib/spells-deep.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const WORLD = 'ai-tool-kit-srd';

/** @param {any} o */
const entry = o => ({
  packId: 'dnd5e.spells24',
  id: o.name,
  uuid: `Compendium.dnd5e.spells24.Item.${o.name}`,
  school: 'evo',
  rules: '2024',
  book: 'SRD',
  ritual: false,
  concentration: false,
  activities: ['utility'],
  template: '',
  level: 1,
  ...o,
});

/* ---------- which spells ---------- */

test('selectSpells keeps the first of a name per rules version and drops other versions', () => {
  const list = [
    entry({ name: 'Alpha', packId: 'first' }),
    entry({ name: 'alpha', packId: 'second' }),
    entry({ name: 'Alpha', rules: '2014', packId: 'legacy' }),
    entry({ name: 'Beta', rules: '2014' }),
    entry({ name: 'Gamma', rules: '' }),
  ];
  const kept = selectSpells(list, { rules: ['2024', '2014'] });
  assert.deepEqual(
    kept.map(e => `${e.name}/${e.rules}/${e.packId}`),
    ['Alpha/2024/first', 'Alpha/2014/legacy', 'Beta/2014/dnd5e.spells24', 'Gamma//dnd5e.spells24']
  );
  assert.deepEqual(
    selectSpells(list, { rules: ['2024'] }).map(e => e.name),
    ['Alpha', 'Gamma']
  );
  assert.deepEqual(
    selectSpells(list, { rules: ['2024'], skipNames: ['Alpha'] }).map(e => e.name),
    ['Gamma']
  );
});

test('sampleSpells is repeatable, bounded, and has every level, every first activity and every shape', () => {
  const list = [];
  for (let level = 0; level <= 9; level += 1) {
    for (let i = 0; i < 12; i += 1) {
      list.push(
        entry({
          name: `S${level}-${String(i).padStart(2, '0')}`,
          level,
          activities: [['save', 'damage', 'heal', 'utility'][i % 4]],
          template: i === 3 ? 'cone' : i === 5 ? 'line' : '',
          concentration: i === 7,
          ritual: i === 9,
        })
      );
    }
  }
  const sample = sampleSpells(list, 40);
  assert.ok(sample.length >= 20 && sample.length <= 45, `${sample.length}`);
  assert.deepEqual(sample, sampleSpells([...list].reverse(), 40));
  assert.deepEqual([...new Set(sample.map(e => e.level))].sort(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const type of ['save', 'damage', 'heal', 'utility'])
    assert.ok(
      sample.some(e => e.activities[0] === type),
      type
    );
  assert.ok(sample.some(e => e.template === 'cone') && sample.some(e => e.template === 'line'));
  assert.ok(sample.some(e => e.concentration) && sample.some(e => e.ritual));
  assert.equal(sampleSpells(list.slice(0, 5), 40).length, 5);
});

test('casterCandidates takes the best hero of each caster class; casterFor prefers natural slots', () => {
  const heroes = [
    { name: 'a', classIdentifier: 'fighter', level: 20 },
    { name: 'b', classIdentifier: 'wizard', level: 5 },
    { name: 'c', classIdentifier: 'wizard', level: 11 },
    { name: 'd', classIdentifier: 'cleric', level: 11 },
    { name: 'e', classIdentifier: 'warlock', level: 17 },
  ];
  const cands = casterCandidates(heroes);
  assert.deepEqual(
    cands.map(h => h.name),
    ['e', 'c', 'd']
  );
  const withFacts = [
    { hero: 'e', facts: { spells: { pact: { max: 4 } } } },
    { hero: 'c', facts: { spells: { spell1: { max: 4 }, spell6: { max: 1 } } } },
    { hero: 'd', facts: { spells: { spell1: { max: 4 }, spell6: { max: 1 } } } },
  ];
  assert.equal(casterFor(0, withFacts)?.hero, 'e');
  assert.equal(casterFor(6, withFacts)?.hero, 'c');
  assert.equal(
    casterFor(9, withFacts)?.hero,
    'e',
    'no natural slot: the first caster, a slot is forced'
  );
});

/* ---------- judging a cast ---------- */

/** @param {any} over */
const good = (over = {}) => ({
  casts: [
    {
      ok: true,
      chatCard: true,
      threw: null,
      notes: [],
      level: 3,
      method: 'spell',
      slotKey: 'spell3',
      slotBefore: { value: 2, max: 3 },
      slotAfter: { value: 1, max: 3 },
      spells: { spell3: { before: 2, after: 1 } },
      facts: { consumesSlot: true, concentration: false },
      concentrating: [],
      ...over,
    },
  ],
  restored: true,
  drift: [],
  error: null,
});

const e3 = entry({ name: 'Zap', level: 3 });
const kinds = (/** @type {any[]} */ ps) => ps.map(p => `${p.kind} ${p.what}`);

test('judgeCast: a clean cast has no problem', () => {
  assert.deepEqual(judgeCast(e3, good()), []);
});

test('judgeCast: no card, a slot not taken, a wrong slot and a cantrip that took one', () => {
  assert.deepEqual(kinds(judgeCast(e3, good({ chatCard: false }))), ['SYSTEM no chat card']);
  assert.deepEqual(kinds(judgeCast(e3, good({ slotAfter: { value: 2, max: 3 }, spells: {} }))), [
    'SYSTEM slot consumed',
  ]);
  assert.deepEqual(
    kinds(
      judgeCast(
        e3,
        good({ spells: { spell3: { before: 2, after: 1 }, spell1: { before: 4, after: 3 } } })
      )
    ),
    ['SYSTEM wrong slot']
  );
  const cantrip = good({
    level: 0,
    slotKey: null,
    slotBefore: null,
    slotAfter: null,
    facts: { consumesSlot: false },
    spells: { spell1: { before: 4, after: 3 } },
  });
  assert.deepEqual(kinds(judgeCast(entry({ name: 'Bolt', level: 0 }), cantrip)), [
    'SYSTEM slot consumed',
  ]);
  const ritual = good({ method: 'ritual', slotKey: null, spells: {} });
  assert.deepEqual(judgeCast(e3, ritual), []);
});

test('judgeCast: a throw, a refusal, no activity, a GM action error and a hero not put back', () => {
  assert.deepEqual(
    kinds(judgeCast(e3, good({ ok: false, threw: 'Cannot read properties of undefined' }))),
    ['SYSTEM the cast threw']
  );
  assert.deepEqual(kinds(judgeCast(e3, good({ ok: false, threw: 'no spell Compendium.x' }))), [
    'CONTENT the cast threw',
  ]);
  assert.deepEqual(
    kinds(
      judgeCast(
        e3,
        good({ ok: false, notes: [{ level: 'error', message: 'Zap could not be found' }] })
      )
    ),
    ['CONTENT the system refused the cast']
  );
  assert.deepEqual(
    kinds(
      judgeCast(
        e3,
        good({
          ok: false,
          slotForced: true,
          notes: [{ level: 'error', message: 'No spell slots left' }],
        })
      )
    ),
    ['KIT the system refused the cast']
  );
  assert.deepEqual(kinds(judgeCast(e3, good({ ok: false }))), [
    'SYSTEM the system refused the cast',
  ]);
  assert.deepEqual(
    kinds(
      judgeCast(entry({ name: 'Zap', level: 3, hints: ['save'] }), good({ noActivities: true }))
    ),
    ['CONTENT the spell has no activity']
  );
  assert.deepEqual(kinds(judgeCast(e3, { casts: [], restored: true, drift: [], error: 'boom' })), [
    'KIT the GM action failed',
  ]);
  const drift = { ...good(), restored: false, drift: ['item Zap', 'spells'] };
  assert.deepEqual(kinds(judgeCast(e3, drift)), ['KIT the hero was not put back']);
});

test('judgeCast: a concentration activity with no concentration effect is a SYSTEM problem', () => {
  const r = good({ facts: { consumesSlot: true, concentration: true }, concentrating: [] });
  assert.deepEqual(kinds(judgeCast(e3, r)), ['SYSTEM no concentration']);
  const ok = good({
    facts: { consumesSlot: true, concentration: true },
    concentrating: ['Concentrating: Zap'],
  });
  assert.deepEqual(judgeCast(e3, ok), []);
});

test('judgeCast: a spell left out with a reason is not a problem', () => {
  const left = {
    casts: [{ skipped: 'a transform activity asks which form to take' }],
    restored: true,
    drift: [],
    error: null,
  };
  assert.deepEqual(judgeCast(e3, left), []);
});

test('classifyNoActivity: a lost activity is CONTENT, a description-only spell is expected', () => {
  const lost = entry({ name: 'Zap', activities: [] });
  const own = entry({ name: 'Zap', activities: ['save', 'save'] });
  assert.equal(classifyNoActivity(lost, own).expected, false);
  assert.equal(classifyNoActivity(lost, own).kind, 'lost');
  const foreign = entry({ name: 'Zap', activities: ['ddbmacro'] });
  assert.equal(classifyNoActivity(foreign, own).kind, 'foreign');
  assert.match(classifyNoActivity(foreign, own).why, /type the system does not have \(ddbmacro\)/);
  assert.match(classifyNoActivity(foreign, own).route, /copy the activities/);
  assert.match(classifyNoActivity(foreign, undefined).route, /enable the module/);
  assert.equal(
    classifyNoActivity(entry({ name: 'Zap', activities: ['ddbmacro', 'save'] }), undefined)
      .expected,
    true,
    'one system activity is enough: it does not load empty'
  );
  assert.match(classifyNoActivity(lost, own).why, /own pack has 2 activity/);
  assert.match(classifyNoActivity(lost, own).route, /copy the activities/);
  assert.equal(classifyNoActivity(lost, entry({ name: 'Zap', activities: [] })).expected, true);
  assert.equal(
    classifyNoActivity(entry({ name: 'Zap', activities: [], hints: [] }), undefined).expected,
    true
  );
  const hinted = classifyNoActivity(
    entry({ name: 'Zap', activities: [], hints: ['save', 'damage'] }),
    undefined
  );
  assert.equal(hinted.expected, false);
  assert.match(hinted.why, /mentions save, damage/);
});

test('judgeCast: a spell with no activity is a problem only when it lost one', () => {
  const none = { casts: [{ noActivities: true }], restored: true, drift: [], error: null };
  const zap = entry({ name: 'Zap', level: 2, activities: [] });
  assert.deepEqual(judgeCast(zap, none), []);
  assert.deepEqual(kinds(judgeCast(zap, none, entry({ name: 'Zap', activities: ['save'] }))), [
    'CONTENT the spell has no activity',
  ]);
  assert.deepEqual(kinds(judgeCast(entry({ name: 'Zap', hints: ['attack'] }), none)), [
    'CONTENT the spell has no activity',
  ]);
});

test('refusalOfCast and throwKind classify by what the system said', () => {
  assert.equal(refusalOfCast('No slots left', { slotKey: 'spell1', slotForced: true }).kind, 'KIT');
  assert.equal(refusalOfCast('No slots left', { slotKey: 'spell1' }).kind, 'SYSTEM');
  assert.equal(refusalOfCast('The item could not be found', {}).kind, 'CONTENT');
  assert.equal(throwKind('timed out after 20 s'), 'SYSTEM');
  assert.equal(throwKind('no item abc'), 'CONTENT');
});

/* ---------- the deep checks ---------- */

test('there are at least thirty deep spell checks, each with an id and a spell list', () => {
  assert.ok(DEEP_SPELL_CHECKS.length >= 30, `${DEEP_SPELL_CHECKS.length}`);
  const ids = DEEP_SPELL_CHECKS.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of DEEP_SPELL_CHECKS) {
    assert.ok(c.title && c.spells.length >= 1, c.id);
    for (const name of c.spells)
      assert.ok(
        FAKE_SPELLS.some(s => s.name === name),
        `${c.id}: ${name}`
      );
  }
});

test('runSpellCheck skips a check whose spell the profile lacks, and a throwing check is a KIT problem', async () => {
  const skipped = await runSpellCheck(
    { id: 'x', title: 'x', spells: ['Nope'], run: async () => ({ problems: [], notes: [] }) },
    /** @type {any} */ ({ find: () => undefined })
  );
  assert.match(skipped.skip ?? '', /no example in this profile: Nope/);
  const broken = await runSpellCheck(
    {
      id: 'x',
      title: 'x',
      spells: ['Yes'],
      run: async () => {
        throw new Error('exploded');
      },
    },
    /** @type {any} */ ({ find: () => ({}) })
  );
  assert.equal(broken.problems[0].kind, 'KIT');
  assert.match(broken.problems[0].evidence, /exploded/);
});

/* ---------- the scenarios against the fake ---------- */

/**
 * Builds a kit on the fake, lets `damage` break something, and runs the two spell scenarios.
 * @param {(world: import('../lib/fake/state.mjs').World, manifest: any) => void} damage
 * @param {'smoke' | 'full'} [size]
 */
async function runSpells(damage, size = 'smoke') {
  const fake = await startFake({ world: WORLD });
  try {
    const dashboard = createDashboardClient({ base: fake.base, token: '' });
    const manifest = await buildKit({
      dashboard,
      gm: fake.gm,
      world: WORLD,
      size,
      profile: loadProfile('srd'),
    });
    damage(fake.world, manifest);
    const catalog = await loadToolCatalog(repoRoot);
    const { scenarios } = await loadScenarios([path.join(here, '..', 'scenarios')], {
      size,
      only: ['spells-cast-all', 'spells-deep'],
      catalog,
    });
    const { results } = await runScenariosDetailed(scenarios, {
      dashboard,
      gm: fake.gm,
      manifest,
      fake: true,
      size,
    });
    return Object.fromEntries(results.map(r => [r.id, r]));
  } finally {
    await fake.close();
  }
}

/** @param {any} result @param {string} name */
const attachment = (result, name) =>
  result.attachments.find((/** @type {any} */ a) => a.name === name)?.data;

/** @param {any} result @param {string} id */
const stepOf = (result, id) =>
  result.steps.find((/** @type {any} */ s) => s.label.startsWith(`${id}:`));

test('spells-*: against the fake kit both scenarios pass and say what they covered', async () => {
  const r = await runSpells(() => {});
  assert.equal(
    r['spells-cast-all'].status,
    'pass',
    JSON.stringify(r['spells-cast-all'].steps.filter((/** @type {any} */ s) => s.status !== 'pass'))
  );
  assert.equal(
    r['spells-deep'].status,
    'pass',
    JSON.stringify(r['spells-deep'].steps.filter((/** @type {any} */ s) => s.status !== 'pass'))
  );
  const cast = attachment(r['spells-cast-all'], 'coverage');
  assert.equal(cast.size, 'smoke');
  assert.equal(cast.spellsListed, FAKE_SPELLS.length);
  assert.ok(cast.spellsCast >= 20, `${cast.spellsCast} cast`);
  assert.equal(cast.spellsFailed, 0);
  assert.equal(
    cast.noActivity.expected,
    1,
    'the description-only fake spell is expected, not a failure'
  );
  assert.equal(cast.noActivity.content, 0);
  assert.ok(cast.slotsForced > 0, 'a 9th level spell needs a forced slot at level 5');
  assert.deepEqual(
    cast.packsMissing,
    ['dnd5e.spells24'].filter(() => false)
  );
  const deep = attachment(r['spells-deep'], 'coverage');
  assert.equal(deep.checks, DEEP_SPELL_CHECKS.length);
  assert.equal(deep.checksRun, deep.checks);
  assert.deepEqual(deep.problemsByKind, { KIT: 0, CONTENT: 0, SYSTEM: 0 });
});

test('spells-cast-all: smoke casts a sample, full casts every spell', async () => {
  // The fake has fewer spells than the sample size, so both sizes cast all of them.
  const full = await runSpells(() => {}, 'full');
  const cast = attachment(full['spells-cast-all'], 'coverage');
  assert.equal(cast.size, 'full');
  assert.equal(cast.spellsCast, FAKE_SPELLS.length);
  assert.equal(full['spells-cast-all'].status, 'pass');
});

test('spells-cast-all: a throw, a missing card, a slot not taken, a wrong slot and a hero not put back', async () => {
  const r = await runSpells(world => {
    world.faults.spellQuirks.set('Fireball', 'throws');
    world.faults.spellQuirks.set('Burning Hands', 'noCard');
    world.faults.spellQuirks.set('Thunderwave', 'noSlot');
    world.faults.spellQuirks.set('Cure Wounds', 'wrongSlot');
    world.faults.spellQuirks.set('Wish', 'drift');
  });
  const scenario = r['spells-cast-all'];
  assert.equal(scenario.status, 'fail');
  const cov = attachment(scenario, 'coverage');
  const by = Object.fromEntries(
    cov.failed.map((/** @type {any} */ f) => [f.spell, f.problems.join(' | ')])
  );
  assert.match(by.Fireball, /\[SYSTEM\] the cast threw: Fireball .* Cannot read/);
  assert.match(by['Burning Hands'], /\[SYSTEM\] no chat card/);
  assert.match(by.Thunderwave, /\[SYSTEM\] slot consumed/);
  assert.match(by['Cure Wounds'], /\[SYSTEM\] wrong slot/);
  assert.match(by.Wish, /\[KIT\] the hero was not put back/);
  assert.equal(cov.spellsFailed, 5);
  assert.deepEqual(cov.problemsByKind, { KIT: 1, CONTENT: 0, SYSTEM: 5 });
  // The level steps that hold a failed spell fail with the kind first.
  const level3 = scenario.steps.find((/** @type {any} */ s) => s.label.startsWith('level 3:'));
  assert.equal(level3.status, 'fail');
  assert.match(level3.error.message, /^\[SYSTEM\] the cast threw/);
  const level0 = scenario.steps.find((/** @type {any} */ s) => s.label.startsWith('level 0:'));
  assert.equal(level0.status, 'pass');
});

test('spells-deep: bad data is CONTENT, a wrong roll is SYSTEM, and the other checks still pass', async () => {
  const r = await runSpells(world => {
    // Wrong template size and one die too many in the data; a wrong attack bonus from the system.
    world.faults.spellQuirks.set('Fireball', 'badData');
    world.faults.spellQuirks.set('Fire Bolt', 'badData');
  });
  const deep = r['spells-deep'];
  assert.equal(deep.status, 'fail');
  const failed = deep.steps
    .filter((/** @type {any} */ s) => s.status === 'fail')
    .map((/** @type {any} */ s) => s.label.split(':')[0]);
  assert.deepEqual(
    failed.sort(),
    [
      'attack-ranged',
      'cantrip-scaling',
      'cantrip-no-slot',
      'save-half',
      'scroll',
      'template-sphere',
    ]
      .filter(id => failed.includes(id))
      .sort()
  );
  assert.ok(
    failed.includes('save-half') &&
      failed.includes('template-sphere') &&
      failed.includes('attack-ranged'),
    failed.join(',')
  );
  assert.match(
    stepOf(deep, 'save-half').error.message,
    /\[CONTENT\] Fireball dice: got 9d6, the rules say 8d6/
  );
  assert.match(
    stepOf(deep, 'template-sphere').error.message,
    /\[CONTENT\] Fireball area size: got 1 ft, the rules say 20 ft/
  );
  assert.match(
    stepOf(deep, 'attack-ranged').error.message,
    /\[SYSTEM\] Fire Bolt attack bonus: got \d+, the rules say \d+/
  );
  assert.equal(stepOf(deep, 'attack-melee').status, 'pass');
  assert.equal(stepOf(deep, 'upcast-dice').status, 'pass');
});

test('spells-deep: a refused cast that goes through, a slot that does not scale and a summon that is not cleaned up', async () => {
  const r = await runSpells(world => {
    world.faults.spellQuirks.set('Burning Hands', 'noSlot');
    world.faults.spellQuirks.set('Flaming Sphere', 'drift');
    world.faults.spellQuirks.set('Hex', 'wrongSlot');
  });
  const deep = r['spells-deep'];
  assert.match(stepOf(deep, 'upcast-dice').error.message, /\[SYSTEM\] Burning Hands slot/);
  assert.match(stepOf(deep, 'summon-placed').error.message, /\[KIT\] the hero was not put back/);
  assert.match(stepOf(deep, 'pact-slot').error.message, /\[SYSTEM\] pact slot/);
  assert.equal(stepOf(deep, 'concentration-begin').status, 'pass');
});

test('spells-deep: a spell the profile lacks skips its checks with the reason', async () => {
  const removed = FAKE_SPELLS.findIndex(s => s.name === 'Hex');
  const [hex] = FAKE_SPELLS.splice(removed, 1);
  try {
    const r = await runSpells(() => {});
    const deep = r['spells-deep'];
    const step = stepOf(deep, 'pact-slot');
    assert.equal(step.status, 'pass');
    assert.match(step.detail, /^skipped: no example in this profile: Hex/);
    const cov = attachment(deep, 'coverage');
    assert.equal(cov.checksRun, DEEP_SPELL_CHECKS.length - 1);
    assert.deepEqual(cov.checksSkipped, ['pact-slot: no example in this profile: Hex']);
  } finally {
    FAKE_SPELLS.splice(removed, 0, hex);
  }
});

test('spells-cast-all: a spell whose activities all ask for a dialog is left out and counted, not failed', async () => {
  const r = await runSpells(world => {
    world.faults.spellQuirks.set('Wish', 'skip');
    world.faults.spellQuirks.set('Mind Blank', 'skip');
  });
  const scenario = r['spells-cast-all'];
  assert.equal(scenario.status, 'pass');
  const cov = attachment(scenario, 'coverage');
  assert.deepEqual(cov.leftOut, { 'a transform activity asks which form to take': 2 });
  assert.equal(cov.spellsFailed, 0);
});

test('spells-cast-all: a spell that lost its activity is CONTENT and the breakdown names the pack', async () => {
  const r = await runSpells(world => {
    world.faults.spellQuirks.set('Fireball', 'noActivity');
  });
  const scenario = r['spells-cast-all'];
  assert.equal(scenario.status, 'fail');
  const cov = attachment(scenario, 'coverage');
  assert.deepEqual(cov.noActivity.byPack, { 'dnd5e.spells24': { expected: 1, content: 1 } });
  const lost = cov.noActivity.spells.find((/** @type {any} */ n) => !n.expected);
  assert.match(lost.why, /the system's own pack has 1 activity/);
  assert.equal(cov.problemsByKind.CONTENT, 1);
});
