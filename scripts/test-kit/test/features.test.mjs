import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKit } from '../lib/builder.mjs';
import { loadToolCatalog } from '../lib/catalog.mjs';
import { createDashboardClient } from '../lib/dashboard.mjs';
import {
  DEEP_CHECKS,
  RULES,
  expectedAfterRest,
  expectedSlots,
  expectedSpend,
  judgePlan,
  refusalKind,
  judgeUse,
  parseDice,
  planUses,
  problemsOfRest,
  runDeepCheck,
  stepValue,
} from '../lib/features.mjs';
import { startFake } from '../lib/fake/index.mjs';
import { loadScenarios } from '../lib/loader.mjs';
import { loadProfile } from '../lib/profiles.mjs';
import { runScenariosDetailed } from '../lib/runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const WORLD = 'ai-tool-kit-srd';

/* ---------- builders for facts ---------- */

/** @param {any} o */
function item(o) {
  return {
    id: o.identifier,
    name: o.name ?? o.identifier,
    type: 'feat',
    sourceUuid: null,
    equipped: false,
    uses: null,
    activities: [],
    effects: [],
    ...o,
  };
}

/** @param {any} o */
function facts(o = {}) {
  return {
    name: 'Hero',
    level: 5,
    prof: 3,
    ac: { value: 13, calc: 'default', armor: false },
    hd: { value: 5, max: 5, classes: [] },
    hp: { value: 40, max: 40 },
    abilities: {
      str: { value: 15, mod: 2 },
      dex: { value: 14, mod: 2 },
      con: { value: 13, mod: 1 },
      int: { value: 12, mod: 1 },
      wis: { value: 10, mod: 0 },
      cha: { value: 8, mod: -1 },
    },
    spells: {},
    scale: {},
    items: [],
    ...o,
  };
}

const check = (/** @type {string} */ id) => {
  const c = DEEP_CHECKS.find(x => x.id === id);
  assert.ok(c, `deep check ${id}`);
  return c;
};

/**
 * Runs one deep check on one hero with the given facts and a stubbed GM action.
 * @param {string} id
 * @param {any} hero
 * @param {any} f
 * @param {(action: string, args: any) => any} [call]
 */
async function runOne(id, hero, f, call = async () => ({})) {
  const h = { name: 'Hero', actorId: 'a1', classRules: '2024', ...hero };
  return runDeepCheck(
    check(id),
    [h],
    async () => f,
    async (a, args) => call(a, args)
  );
}

/* ---------- the rules tables ---------- */

test('rules tables: step values read the last row that is reached', () => {
  assert.equal(stepValue(RULES.rageUses, 1), 2);
  assert.equal(stepValue(RULES.rageUses, 5), 3);
  assert.equal(stepValue(RULES.rageUses, 17), 6);
  assert.equal(stepValue(RULES.rageDamage, 8), 2);
  assert.equal(stepValue(RULES.rageDamage, 9), 3);
  assert.equal(stepValue(RULES.rageDamage, 16), 4);
  assert.equal(stepValue(RULES.actionSurge, 1), null);
  assert.equal(stepValue(RULES.pactSlots, 11), 3);
  assert.equal(stepValue(RULES.pactLevel, 9), 5);
});

test('spell slot table: 2024 half casters cast from level 1, 2014 ones from level 2', () => {
  assert.deepEqual(expectedSlots('wizard', '2024', 5), { 1: 4, 2: 3, 3: 2 });
  assert.deepEqual(expectedSlots('paladin', '2024', 1), { 1: 2 });
  assert.deepEqual(expectedSlots('paladin', '2014', 1), {});
  assert.deepEqual(expectedSlots('paladin', '2014', 2), { 1: 2 });
  assert.equal(expectedSlots('fighter', '2024', 5), null);
});

test('parseDice reads 3d6 and d8', () => {
  assert.deepEqual(parseDice('3d6'), { number: 3, faces: 6 });
  assert.deepEqual(parseDice('d8'), { number: 1, faces: 8 });
  assert.equal(parseDice('4'), null);
  assert.equal(parseDice(undefined), null);
});

test('there are at least twenty deep checks with distinct ids', () => {
  const ids = DEEP_CHECKS.map(c => c.id);
  assert.ok(ids.length >= 20, `${ids.length} checks`);
  assert.equal(new Set(ids).size, ids.length);
});

/* ---------- the broad pass ---------- */

test('planUses uses features with activities and leaves out the ones that need a dialog', () => {
  const f = facts({
    items: [
      item({
        identifier: 'a',
        activities: [{ id: '1', type: 'utility', name: '', canUse: true, consumption: [] }],
      }),
      item({
        identifier: 'b',
        activities: [{ id: '2', type: 'summon', name: '', canUse: true, consumption: [] }],
      }),
      item({
        identifier: 'c',
        activities: [{ id: '3', type: 'heal', name: '', canUse: false, consumption: [] }],
      }),
      item({
        identifier: 'x',
        activities: [
          {
            id: '5',
            type: 'utility',
            name: '',
            canUse: true,
            consumption: [
              { type: 'attribute', target: 'system.attributes.exhaustion', value: '1' },
            ],
          },
        ],
      }),
      item({ identifier: 'd' }),
      item({
        identifier: 'e',
        type: 'weapon',
        activities: [{ id: '4', type: 'attack', name: '', canUse: true, consumption: [] }],
      }),
    ],
  });
  const plan = planUses(f);
  assert.equal(plan.features, 4);
  assert.deepEqual(
    plan.use.map(u => u.item.identifier),
    ['a']
  );
  assert.deepEqual(
    plan.skipped.map(s => s.activity),
    ['summon', 'heal', 'utility']
  );
  assert.match(plan.skipped[0].why, /asks where to place/);
  assert.match(plan.skipped[1].why, /cannot be used/);
});

test('planUses leaves out spending an item that starts empty by design (Arcane Ward), not filling it', () => {
  const act = (/** @type {string} */ id, /** @type {string} */ value) => ({
    id,
    type: 'utility',
    name: id,
    canUse: true,
    consumption: [{ type: 'itemUses', target: '', value }],
  });
  const ward = item({
    identifier: 'ward',
    uses: { max: 11, spent: 11, recovery: [{ period: 'lr', type: 'loseAll', formula: '' }] },
    activities: [act('create', '-@item.uses.max'), act('damage', '1'), act('restore', '-2')],
  });
  const plan = planUses(facts({ items: [ward] }));
  assert.deepEqual(
    plan.use.map(u => u.activity.id),
    ['create', 'restore']
  );
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].why, /starts empty by design/);
  // An item that recovers normally and starts spent is not left out (that is a CONTENT finding).
  const spent = item({
    identifier: 'spent',
    uses: { max: 2, spent: 2, recovery: [{ period: 'lr', type: 'recoverAll', formula: '' }] },
    activities: [act('use', '1')],
  });
  assert.equal(planUses(facts({ items: [spent] })).use.length, 1);
});

test('expectedSpend adds the plain item uses of its own item and flags the rest', () => {
  const it = item({ identifier: 'x', id: 'x1' });
  const act = (/** @type {any[]} */ consumption) => ({
    id: 'a',
    type: 'utility',
    name: '',
    activation: 'bonus',
    canUse: true,
    consumption,
  });
  assert.deepEqual(expectedSpend(it, act([{ type: 'itemUses', target: '', value: '1' }])), {
    total: 1,
    exact: true,
  });
  assert.deepEqual(
    expectedSpend(
      it,
      act([
        { type: 'itemUses', target: 'x', value: '2' },
        { type: 'attribute', target: 'hp', value: '1' },
      ])
    ),
    { total: 2, exact: true }
  );
  assert.deepEqual(expectedSpend(it, act([{ type: 'itemUses', target: '', value: '@scaling' }])), {
    total: 0,
    exact: false,
  });
  assert.deepEqual(expectedSpend(it, act([{ type: 'itemUses', target: 'other', value: '1' }])), {
    total: 0,
    exact: false,
  });
});

test('expectedSpend spends once-per-turn uses only in combat, as dnd5e does', () => {
  const perTurn = item({
    identifier: 'sneak-attack',
    id: 's1',
    uses: { max: 1, spent: 0, recovery: [{ period: 'turn', type: 'recoverAll', formula: '' }] },
  });
  const act = {
    id: 'a',
    type: 'damage',
    name: '',
    activation: 'special',
    canUse: true,
    consumption: [{ type: 'itemUses', target: '', value: '1' }],
  };
  assert.deepEqual(expectedSpend(perTurn, act), { total: 0, exact: true });
  assert.deepEqual(expectedSpend(perTurn, act, { inCombat: true }), { total: 1, exact: true });
  const mixed = item({
    identifier: 'x',
    id: 'x1',
    uses: {
      max: 1,
      spent: 0,
      recovery: [
        { period: 'turn', type: 'recoverAll', formula: '' },
        { period: 'lr', type: 'recoverAll', formula: '' },
      ],
    },
  });
  assert.deepEqual(expectedSpend(mixed, act), { total: 1, exact: true });
});

test('judgePlan fails a level 2 or higher hero with nothing the pass can use, but not a level 1 hero', () => {
  const none = { use: [], skipped: [{ item: 'x', activity: 'summon', why: 'w' }], features: 1 };
  assert.deepEqual(judgePlan({ level: 1 }, none), []);
  const problems = judgePlan({ level: 2 }, none);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'CONTENT');
  assert.match(problems[0].evidence, /none can be used without a dialog \(left out: summon\)/);
  assert.deepEqual(judgePlan({ level: 5 }, { use: [{}], skipped: [], features: 1 }), []);
});

/** A feature the use pass can run. */
const planned = () => ({
  item: item({
    identifier: 'second-wind',
    name: 'Second Wind',
    uses: { max: 3, spent: 0, recovery: [] },
  }),
  activity: {
    id: 'a',
    type: 'heal',
    name: '',
    activation: 'bonus',
    canUse: true,
    consumption: [{ type: 'itemUses', target: '', value: '1' }],
  },
});
const good = () => ({
  ok: true,
  notes: [],
  threw: null,
  chatCard: true,
  uses: { before: 0, after: 1, max: 3 },
  spells: {},
  effects: [],
  itemsCreated: 0,
  restored: true,
  drift: [],
});

test('judgeUse: a clean use has no problems', () => {
  assert.deepEqual(judgeUse(planned(), good()), []);
});

test('judgeUse classifies a throw, a refusal, a missing card, a wrong consumption and a drift', () => {
  const p = planned();
  const threw = judgeUse(p, { ...good(), ok: false, threw: 'Cannot read properties of undefined' });
  assert.equal(threw[0].kind, 'SYSTEM');
  assert.match(threw[0].evidence, /Second Wind.*Cannot read/);

  const refused = judgeUse(p, {
    ...good(),
    ok: false,
    notes: [{ level: 'error', message: 'not enough uses available' }],
  });
  assert.equal(refused[0].kind, 'SYSTEM');

  const dry = judgeUse(
    {
      ...p,
      item: item({ identifier: 'x', name: 'Rage', uses: { max: 0, spent: 0, recovery: [] } }),
    },
    {
      ...good(),
      ok: false,
      notes: [{ level: 'error', message: 'No uses on Rage available to spend, 1 required.' }],
    }
  );
  assert.equal(dry[0].kind, 'CONTENT');
  assert.match(dry[0].evidence, /has no uses at this level/);

  const noCard = judgeUse(p, { ...good(), chatCard: false });
  assert.deepEqual(
    noCard.map(x => [x.kind, x.what]),
    [['SYSTEM', 'no chat card']]
  );

  const wrong = judgeUse(p, { ...good(), uses: { before: 0, after: 2, max: 3 } });
  assert.equal(wrong[0].kind, 'SYSTEM');
  assert.match(wrong[0].evidence, /consumed 2, the activity says 1/);

  const drift = judgeUse(p, { ...good(), restored: false, drift: ['item Second Wind'] });
  assert.deepEqual(
    drift.map(x => x.kind),
    ['KIT']
  );
});

/* ---------- rests ---------- */

/** A hero with everything spent, as exerciseActor leaves it before the rest. */
const spentSummary = () => ({
  items: [
    {
      id: 'i1',
      name: 'Rage',
      max: 3,
      spent: 3,
      recovery: [
        { period: 'lr', type: 'recoverAll', formula: '' },
        { period: 'sr', type: 'formula', formula: '1' },
      ],
    },
    {
      id: 'i2',
      name: 'Action Surge',
      max: 1,
      spent: 1,
      recovery: [{ period: 'sr', type: 'recoverAll', formula: '' }],
    },
    {
      id: 'i3',
      name: 'Lay on Hands',
      max: 25,
      spent: 25,
      recovery: [{ period: 'lr', type: 'recoverAll', formula: '' }],
    },
  ],
  spells: { spell1: { value: 0, max: 4, type: 'spell' }, pact: { value: 0, max: 2, type: 'pact' } },
  hp: { value: 1, max: 40 },
  hd: { value: 0, max: 5 },
});

test('expectedAfterRest follows the recovery profiles, periods, slots and hit points', () => {
  const short = expectedAfterRest(spentSummary(), 'short');
  assert.deepEqual(short.items.i1, { spent: 2, from: 3 });
  assert.deepEqual(short.items.i2, { spent: 0, from: 1 });
  assert.deepEqual(short.items.i3, { spent: 25, from: 25 });
  assert.deepEqual(short.spells, { spell1: 0, pact: 2 });
  assert.equal(short.hp, 1);
  assert.equal(short.hdRises, false);
  const long = expectedAfterRest(spentSummary(), 'long');
  assert.deepEqual(long.items.i1, { spent: 0, from: 3 });
  assert.deepEqual(long.items.i2, { spent: 0, from: 1 });
  assert.deepEqual(long.spells, { spell1: 4, pact: 2 });
  assert.equal(long.hp, 40);
  assert.equal(long.hdRises, true);
});

/** The result the system should give for a rest, built from the rules. @param {'short'|'long'} type */
function restProbe(type) {
  const afterSpend = spentSummary();
  const want = expectedAfterRest(afterSpend, type);
  return {
    type,
    afterSpend,
    afterRest: {
      items: afterSpend.items.map(i => ({ ...i, spent: want.items[i.id].spent ?? 0 })),
      spells: Object.fromEntries(
        Object.entries(afterSpend.spells).map(([k, s]) => [k, { ...s, value: want.spells[k] }])
      ),
      hp: { value: want.hp, max: 40 },
      hd: { value: want.hdRises ? 5 : 0, max: 5 },
    },
  };
}

test('problemsOfRest accepts the system rules and names what a rest forgot', () => {
  for (const type of /** @type {const} */ (['short', 'long'])) {
    const problems = /** @type {any[]} */ ([]);
    problemsOfRest(problems, type, restProbe(type));
    assert.deepEqual(problems, [], type);
  }
  const broken = restProbe('long');
  broken.afterRest.spells.pact.value = 0;
  broken.afterRest.items[0].spent = 2;
  broken.afterRest.hp.value = 20;
  broken.afterRest.hd.value = 0;
  const problems = /** @type {any[]} */ ([]);
  problemsOfRest(problems, 'long', broken);
  assert.deepEqual(
    problems.map(p => p.what),
    ['long rest, Rage', 'long rest, pact slots', 'long rest, hit points', 'long rest, hit dice']
  );
  assert.ok(problems.every(p => p.kind === 'SYSTEM'));
});

/* ---------- deep checks on hand-made facts ---------- */

const rageItem = (/** @type {number} */ max = 3) =>
  item({
    identifier: 'rage',
    name: 'Rage',
    uses: { max, spent: 0, recovery: [{ period: 'lr', type: 'recoverAll', formula: '' }] },
    activities: [
      {
        id: 'a',
        type: 'utility',
        name: 'Expend Rage',
        activation: 'bonus',
        canUse: true,
        consumption: [{ type: 'itemUses', target: '', value: '1' }],
      },
    ],
    effects: [
      {
        id: 'e1',
        name: 'Rage',
        disabled: true,
        transfer: true,
        changes: [
          {
            key: 'system.bonuses.mwak.damage',
            value: '+@scale.barbarian.rage-damage',
            type: 'add',
          },
        ],
      },
    ],
  });

/** What the GM page answers for the Rage probes, with an optional break. @param {any} [o] */
const rageCall =
  (o = {}) =>
  async (/** @type {string} */ action, /** @type {any} */ args) => {
    if (args.op === 'effect') {
      return {
        before: {
          'system.rolls.damage.mwak.bonus': { value: null },
          'system.traits.dr.value': { value: [] },
        },
        during: {
          'system.rolls.damage.mwak.bonus': { value: '+2', resolved: o.damage ?? 2 },
          'system.traits.dr.value': { value: o.resist ?? ['bludgeoning', 'piercing', 'slashing'] },
        },
        restored: o.restored ?? true,
        drift: ['item Rage'],
      };
    }
    return { ...good(), uses: { before: 0, after: o.spend ?? 1, max: 3 } };
  };

test('deep check rage passes for a barbarian that follows the table', async () => {
  const f = facts({ items: [rageItem()], scale: { barbarian: { rages: 3, 'rage-damage': 2 } } });
  const r = await runOne('rage', { classIdentifier: 'barbarian', level: 5 }, f, rageCall());
  assert.deepEqual(r.failed, []);
  assert.equal(r.checked.length, 1);
  assert.match(r.notes[0].note, /\+2 damage/);
});

test('deep check rage names a wrong bonus, missing resistances, wrong uses and a hero not put back', async () => {
  const f = facts({ items: [rageItem(4)], scale: { barbarian: { rages: 3, 'rage-damage': 2 } } });
  const r = await runOne(
    'rage',
    { classIdentifier: 'barbarian', level: 5 },
    f,
    rageCall({ damage: 3, resist: ['slashing'], restored: false, spend: 2 })
  );
  const whats = r.failed[0].problems.map(p => `${p.kind} ${p.what}`);
  // 4 uses: the actor does not follow its own scale value (3), so the system is at fault.
  assert.ok(whats.includes('SYSTEM Rage uses'), whats.join(' | '));
  assert.ok(whats.includes('SYSTEM Rage damage bonus'), whats.join(' | '));
  assert.ok(whats.includes('SYSTEM rage resistances'));
  assert.ok(whats.includes('KIT the hero was not put back'));
  assert.ok(whats.includes('SYSTEM rage spends one use'));
});

test('deep check rage: a table difference that matches the class scale is CONTENT', async () => {
  const f = facts({ items: [rageItem(4)], scale: { barbarian: { rages: 4, 'rage-damage': 2 } } });
  const r = await runOne('rage', { classIdentifier: 'barbarian', level: 5 }, f, rageCall());
  assert.deepEqual(
    r.failed[0].problems.map(p => `${p.kind} ${p.what}`),
    ['CONTENT Rage uses']
  );
});

test('deep checks only look at heroes of a 2024 class when they use a number table', async () => {
  const f = facts();
  const r = await runOne('rage', { classIdentifier: 'barbarian', level: 5, classRules: '2014' }, f);
  assert.equal(r.checked.length, 0);
  assert.equal(r.failed.length, 0);
});

test('deep check unarmored defense: 10 + DEX + CON for a barbarian, 10 + DEX + WIS for a monk', async () => {
  const ok = await runOne(
    'unarmored-defense',
    { classIdentifier: 'barbarian', level: 5 },
    facts({ ac: { value: 13, calc: 'unarmoredBarb', armor: false } })
  );
  assert.deepEqual(ok.failed, []);
  const monk = await runOne(
    'unarmored-defense',
    { classIdentifier: 'monk', level: 5 },
    facts({ ac: { value: 12, calc: 'unarmoredMonk', armor: false } })
  );
  assert.deepEqual(monk.failed, []);
  const wrong = await runOne(
    'unarmored-defense',
    { classIdentifier: 'barbarian', level: 5 },
    facts({ ac: { value: 12, calc: 'default', armor: false } })
  );
  assert.deepEqual(
    wrong.failed[0].problems.map(p => p.what),
    ['armor class calculation', 'armor class']
  );
  const armored = await runOne(
    'unarmored-defense',
    { classIdentifier: 'barbarian', level: 5 },
    facts({ ac: { value: 17, calc: 'default', armor: true } })
  );
  assert.equal(armored.checked.length, 0);
  assert.equal(armored.skipped.length, 1);
});

test('deep check bardic inspiration, focus points and sorcery points read the table', async () => {
  const bard = await runOne(
    'bardic-inspiration',
    { classIdentifier: 'bard', level: 5 },
    facts({
      items: [
        item({
          identifier: 'bardic-inspiration',
          name: 'Bardic Inspiration',
          uses: { max: 1, spent: 0, recovery: [] },
        }),
      ],
      scale: { bard: { inspiration: 'd8' } },
    })
  );
  assert.deepEqual(bard.failed, []);
  const slow = await runOne(
    'bardic-inspiration',
    { classIdentifier: 'bard', level: 5 },
    facts({
      items: [
        item({
          identifier: 'bardic-inspiration',
          name: 'Bardic Inspiration',
          uses: { max: 1, spent: 0, recovery: [] },
        }),
      ],
      scale: { bard: { inspiration: 'd6' } },
    })
  );
  assert.equal(slow.failed[0].problems[0].what, 'Bardic Inspiration die');
  const monk = await runOne(
    'focus-points',
    { classIdentifier: 'monk', level: 5 },
    facts({
      items: [item({ identifier: 'monks-focus', uses: { max: 5, spent: 0, recovery: [] } })],
      scale: { monk: { focus: 5 } },
    })
  );
  assert.deepEqual(monk.failed, []);
  const sorcerer = await runOne(
    'sorcery-points',
    { classIdentifier: 'sorcerer', level: 5 },
    facts({
      items: [item({ identifier: 'font-of-magic', uses: { max: 4, spent: 0, recovery: [] } })],
      scale: { sorcerer: { points: 4 } },
    })
  );
  assert.equal(sorcerer.failed[0].problems[0].kind, 'CONTENT');
});

test('deep check druid wild shape and extra attack', async () => {
  const druid = await runOne(
    'wild-shape',
    { classIdentifier: 'druid', level: 6 },
    facts({
      items: [
        item({
          identifier: 'wild-shape',
          name: 'Wild Shape',
          uses: { max: 3, spent: 0, recovery: [] },
          activities: [
            {
              id: 'a',
              type: 'transform',
              name: '',
              activation: 'bonus',
              canUse: true,
              consumption: [],
            },
          ],
        }),
      ],
    })
  );
  assert.deepEqual(druid.failed, []);
  const early = await runOne(
    'extra-attack',
    { classIdentifier: 'fighter', level: 4 },
    facts({ items: [item({ identifier: 'extra-attack' })] })
  );
  assert.equal(early.failed[0].problems[0].what, 'extra-attack too early');
  const late = await runOne(
    'extra-attack',
    { classIdentifier: 'fighter', level: 11 },
    facts({ items: [item({ identifier: 'extra-attack' })] })
  );
  assert.equal(late.failed[0].problems[0].what, 'two-extra-attacks missing');
});

test('deep check superiority dice is skipped without the feature and checked with it', async () => {
  const none = await runOne('superiority-dice', { classIdentifier: 'fighter', level: 7 }, facts());
  assert.equal(none.checked.length, 0);
  assert.equal(none.skipped.length, 1);
  const some = await runOne(
    'superiority-dice',
    { classIdentifier: 'fighter', level: 7 },
    facts({
      items: [item({ identifier: 'combat-superiority', uses: { max: 4, spent: 0, recovery: [] } })],
    })
  );
  assert.equal(some.failed[0].problems[0].what, 'superiority dice');
});

test('deep check pact magic, spell slots, hit dice and proficiency', async () => {
  const pact = await runOne(
    'pact-magic',
    { classIdentifier: 'warlock', level: 5, classRules: '2014' },
    facts({ spells: { pact: { value: 2, max: 2, level: 3, type: 'pact' } } })
  );
  assert.deepEqual(pact.failed, []);
  const pactBad = await runOne(
    'pact-magic',
    { classIdentifier: 'warlock', level: 11, classRules: '2014' },
    facts({ spells: { pact: { value: 2, max: 2, level: 5, type: 'pact' } } })
  );
  assert.equal(pactBad.failed[0].problems[0].what, 'pact slots');
  const slots = await runOne(
    'spell-slots',
    { classIdentifier: 'paladin', level: 5 },
    facts({
      spells: {
        spell1: { value: 4, max: 4, level: 1, type: 'spell' },
        spell2: { value: 2, max: 2, level: 2, type: 'spell' },
      },
    })
  );
  assert.deepEqual(slots.failed, []);
  const dice = await runOne(
    'hit-dice',
    { classIdentifier: 'wizard', level: 5 },
    facts({
      hd: {
        value: 5,
        max: 5,
        classes: [{ identifier: 'wizard', denomination: 'd8', levels: 5, spent: 0 }],
      },
    })
  );
  assert.equal(dice.failed[0].problems[0].what, 'hit die');
  const prof = await runOne(
    'proficiency-bonus',
    { classIdentifier: 'wizard', level: 9 },
    facts({ prof: 3 })
  );
  assert.equal(prof.failed[0].problems[0].what, 'proficiency bonus');
  const profOk = await runOne(
    'proficiency-bonus',
    { classIdentifier: 'wizard', level: 9 },
    facts({ prof: 4 })
  );
  assert.deepEqual(profOk.failed, []);
});

test('deep check rest recovery runs a short and a long rest on the top hero of each class', async () => {
  const heroes = [
    { name: 'A5', actorId: 'a', classIdentifier: 'fighter', level: 5, classRules: '2024' },
    { name: 'A11', actorId: 'b', classIdentifier: 'fighter', level: 11, classRules: '2024' },
    { name: 'W5', actorId: 'c', classIdentifier: 'wizard', level: 5, classRules: '2024' },
  ];
  /** @type {string[]} */
  const calls = [];
  const r = await runDeepCheck(
    check('rest-recovery'),
    heroes,
    async () => facts(),
    async (_action, args) => {
      calls.push(`${args.actorId}:${args.type}`);
      return { ...restProbe(args.type), restored: true, drift: [] };
    }
  );
  assert.deepEqual(r.failed, []);
  assert.deepEqual(calls, ['b:short', 'b:long', 'c:short', 'c:long']);
});

test('runDeepCheck: a GM action that throws is a KIT problem, not a crash', async () => {
  const f = facts({ items: [rageItem()], scale: { barbarian: { rages: 3, 'rage-damage': 2 } } });
  const r = await runOne('rage', { classIdentifier: 'barbarian', level: 5 }, f, async () => {
    throw new Error('evaluate failed');
  });
  assert.equal(r.failed[0].problems[0].kind, 'KIT');
  assert.match(r.failed[0].problems[0].evidence, /evaluate failed/);
});

/* ---------- the scenarios against the fake ---------- */

/**
 * Builds a smoke kit on the fake, lets `damage` break something, and runs the two feature scenarios.
 * @param {(world: import('../lib/fake/state.mjs').World, manifest: any) => void} damage
 */
async function runFeatures(damage) {
  const fake = await startFake({ world: WORLD });
  try {
    const dashboard = createDashboardClient({ base: fake.base, token: '' });
    const manifest = await buildKit({
      dashboard,
      gm: fake.gm,
      world: WORLD,
      size: 'smoke',
      profile: loadProfile('srd'),
    });
    damage(fake.world, manifest);
    const catalog = await loadToolCatalog(repoRoot);
    const { scenarios } = await loadScenarios([path.join(here, '..', 'scenarios')], {
      size: 'smoke',
      only: ['heroes-features-use', 'heroes-features-deep'],
      catalog,
    });
    const { results } = await runScenariosDetailed(scenarios, {
      dashboard,
      gm: fake.gm,
      manifest,
      fake: true,
    });
    return Object.fromEntries(results.map(r => [r.id, r]));
  } finally {
    await fake.close();
  }
}

const hero = (/** @type {any} */ manifest, /** @type {string} */ name) =>
  manifest.heroes.find((/** @type {any} */ h) => h.name === name);

test('heroes-features-*: against the fake kit both scenarios pass and say what they covered', async () => {
  const r = await runFeatures(() => {});
  assert.equal(r['heroes-features-use'].status, 'pass');
  assert.equal(r['heroes-features-deep'].status, 'pass');
  const use = /** @type {any} */ (
    r['heroes-features-use'].attachments.find(a => a.name === 'coverage')?.data
  );
  assert.equal(use.heroes, 6);
  assert.ok(use.activitiesUsed >= 10, `${use.activitiesUsed} activities`);
  assert.equal(use.heroesFailed, 0);
  const deep = /** @type {any} */ (
    r['heroes-features-deep'].attachments.find(a => a.name === 'coverage')?.data
  );
  assert.equal(deep.checks, DEEP_CHECKS.length);
  assert.ok(deep.checksRun >= 12, `${deep.checksRun} checks ran`);
  // The fake has no barbarian, so rage is skipped with its reason in the step detail.
  const rage = r['heroes-features-deep'].steps.find(s => s.label.startsWith('rage:'));
  assert.equal(rage?.status, 'pass');
  assert.match(rage?.detail ?? '', /^skipped: no 2024 barbarian/);
});

test('heroes-features-use: a use that throws, one with no card, one that consumes nothing and one that is not put back', async () => {
  const r = await runFeatures((world, manifest) => {
    world.faults.quirks.set(`${hero(manifest, 'Kit Fighter 5').name}|second-wind`, 'throws');
    world.faults.quirks.set(`${hero(manifest, 'Kit Paladin 5').name}|lay-on-hands`, 'noCard');
    world.faults.quirks.set(
      `${hero(manifest, 'Kit Cleric 5').name}|channel-divinity-cleric`,
      'noConsume'
    );
    world.faults.quirks.set(`${hero(manifest, 'Kit Wizard 5').name}|arcane-recovery`, 'drift');
  });
  const use = r['heroes-features-use'];
  assert.equal(use.status, 'fail');
  const failed = Object.fromEntries(
    use.steps
      .filter(s => s.status === 'fail')
      .map(s => [s.label.split(':')[0], s.error?.message ?? ''])
  );
  assert.deepEqual(Object.keys(failed).sort(), [
    'Kit Cleric 5',
    'Kit Fighter 5',
    'Kit Paladin 5',
    'Kit Wizard 5',
  ]);
  assert.match(
    failed['Kit Fighter 5'],
    /^\[SYSTEM\] the activity threw: Second Wind \(heal\): Cannot read/
  );
  assert.match(failed['Kit Paladin 5'], /\[SYSTEM\] no chat card/);
  assert.match(
    failed['Kit Cleric 5'],
    /\[SYSTEM\] uses consumed: Channel Divinity .* consumed 0, the activity says 1/
  );
  assert.match(
    failed['Kit Wizard 5'],
    /^\[KIT\] the hero was not put back: Arcane Recovery .*item Arcane Recovery/
  );
  const coverage = /** @type {any} */ (use.attachments.find(a => a.name === 'coverage')?.data);
  assert.deepEqual(coverage.problemsByKind, { KIT: 1, CONTENT: 0, SYSTEM: 4 });
});

test('heroes-features-deep: a rest that forgets the pact slots and a wrong sneak attack are named', async () => {
  const r = await runFeatures((world, manifest) => {
    world.faults.restNoPact = true;
    const rogue = world.actors.get(hero(manifest, 'Kit Rogue 5').actorId);
    assert.ok(rogue?.sheet);
    rogue.sheet.features.scale['sneak-attack'] = '2d6';
    const fighter = world.actors.get(hero(manifest, 'Kit Fighter 5').actorId);
    assert.ok(fighter?.sheet);
    const wind = fighter.sheet.features.items.find(
      (/** @type {any} */ i) => i.identifier === 'second-wind'
    );
    wind.uses.max = 2;
  });
  const deep = r['heroes-features-deep'];
  assert.equal(deep.status, 'fail');
  const failed = Object.fromEntries(
    deep.steps
      .filter(s => s.status === 'fail')
      .map(s => [s.label.split(':')[0], s.error?.message ?? ''])
  );
  assert.deepEqual(Object.keys(failed).sort(), ['rest-recovery', 'second-wind', 'sneak-attack']);
  assert.match(
    failed['rest-recovery'],
    /Kit Warlock 5: \[SYSTEM\] short rest, pact slots.*\[SYSTEM\] long rest, pact slots/
  );
  assert.match(
    failed['sneak-attack'],
    /Kit Rogue 5: \[CONTENT\] Sneak Attack dice: the actor has 2d6, the rules table says 3d6/
  );
  assert.match(
    failed['second-wind'],
    /Kit Fighter 5: \[CONTENT\] Second Wind uses: the actor has 2, the rules table says 3/
  );
});

test('heroes-features-use: a hero whose features cannot be used at all fails as CONTENT', async () => {
  const r = await runFeatures((world, manifest) => {
    const wizard = world.actors.get(hero(manifest, 'Kit Wizard 5').actorId);
    assert.ok(wizard?.sheet);
    wizard.sheet.features.items = [];
  });
  const use = r['heroes-features-use'];
  const failed = use.steps.filter(s => s.status === 'fail');
  assert.equal(failed.length, 1);
  assert.match(failed[0].label, /^Kit Wizard 5:/);
  assert.match(
    failed[0].error?.message ?? '',
    /^\[CONTENT\] no usable feature: a level 5 hero has 0 feature/
  );
});

test('refusalKind tells the imported data from the system', () => {
  const withUses = (/** @type {number | null} */ max, spent = 0) =>
    item({ identifier: 'x', uses: { max, spent, recovery: [] } });
  assert.equal(
    refusalKind('Item configured to be consumed by X could not be found.', withUses(1)).kind,
    'CONTENT'
  );
  assert.equal(
    refusalKind('No uses on X available to spend, 1 required.', item({ identifier: 'x' })).kind,
    'CONTENT'
  );
  assert.equal(
    refusalKind('No uses on X available to spend, 1 required.', withUses(0)).kind,
    'CONTENT'
  );
  assert.equal(
    refusalKind(
      'Not enough uses on X available to spend, 5 required and only 1 available.',
      withUses(1)
    ).kind,
    'CONTENT'
  );
  assert.equal(
    refusalKind('No uses on X available to spend, 1 required.', withUses(1, 1)).kind,
    'CONTENT'
  );
  assert.equal(
    refusalKind('No uses on X available to spend, 1 required.', withUses(3, 0)).kind,
    'SYSTEM'
  );
  assert.equal(refusalKind('something else happened', withUses(3, 0)).kind, 'SYSTEM');
  const imported = { ...item({ identifier: 'x' }), sourceUuid: 'Compendium.some-module.classes.Item.abc' };
  assert.equal(
    refusalKind('No uses on X available to spend, 1 required.', imported).note,
    ' (the item has no uses at this level, or none are set; from some-module.classes)'
  );
});

test('the feature scenarios run after the others (order), and a bad order is refused', async () => {
  const catalog = await loadToolCatalog(repoRoot);
  const { scenarios } = await loadScenarios([path.join(here, '..', 'scenarios')], {
    size: 'full',
    catalog,
  });
  const ids = scenarios.map(s => s.scenario.id);
  assert.deepEqual(ids.slice(-4).sort(), [
    'heroes-features-deep',
    'heroes-features-use',
    'monsters-every',
    'monsters-odd',
  ]);
  assert.ok(ids.indexOf('scripted-fight') < ids.indexOf('heroes-features-use'));
  const { validateScenario } = await import('../lib/contract.mjs');
  const base = scenarios[0].scenario;
  assert.deepEqual(validateScenario({ ...base, order: 5 }), []);
  assert.deepEqual(validateScenario({ ...base, order: 'last' }), ['order must be a number']);
});
