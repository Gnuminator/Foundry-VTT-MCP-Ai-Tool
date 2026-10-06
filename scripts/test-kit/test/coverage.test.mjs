import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKit } from '../lib/builder.mjs';
import { DEFAULT_COVERAGE_CAP, planCoverage, takePreferred } from '../lib/coverage.mjs';
import { createDashboardClient } from '../lib/dashboard.mjs';
import { FAKE_CLASSES } from '../lib/fake/classes.mjs';
import { startFake } from '../lib/fake/index.mjs';
import {
  fromClassOrSubclass,
  heroOwners,
  mechanicalGroups,
  mechanicalNever,
  mechanicalPick,
  pickCoverage,
} from '../lib/picks.mjs';
import { loadProfile } from '../lib/profiles.mjs';
import { parseArgs } from '../kit.mjs';
import { coverageHeroesLine } from '../lib/report.mjs';
import { chooseHeroes } from '../lib/studio-compare.mjs';

// --- the mechanical filter ---------------------------------------------------------------------

const itemChoice = (extra = {}) => ({
  level: 1,
  advancement: 'ItemChoice',
  title: 'Fighter: Fighting Style',
  chosen: ['Style A'],
  offered: ['Style A', 'Style B', 'Style C'],
  pool: 'feat',
  itemType: 'class',
  ...extra,
});
const trait = (extra = {}) => ({
  level: 3,
  advancement: 'Trait',
  title: 'Wyrm: Resistance',
  chosen: ['dr:fire'],
  offered: ['dr:fire', 'dr:cold', 'skills:ath'],
  itemType: 'subclass',
  ...extra,
});

test('mechanicalPick: a feature pool asked by a class is mechanical, the options include the chosen ones', () => {
  assert.deepEqual(mechanicalPick(itemChoice()), {
    offered: ['Style A', 'Style B', 'Style C'],
    chosen: ['Style A'],
  });
  assert.deepEqual(mechanicalPick(itemChoice({ itemType: 'subclass', offered: undefined })), {
    offered: ['Style A'],
    chosen: ['Style A'],
  });
});

test('mechanicalPick: a class feature (a feat item of type class) counts, an origin or general feat does not', () => {
  assert.ok(mechanicalPick(itemChoice({ itemType: 'feat', featType: 'class' })));
  assert.equal(mechanicalPick(itemChoice({ itemType: 'feat', featType: 'origin' })), null);
  assert.equal(mechanicalPick(itemChoice({ itemType: 'feat', featType: 'general' })), null);
  assert.equal(mechanicalPick(itemChoice({ itemType: 'feat' })), null);
});

test('mechanicalPick: a background, a species or a spell pool is not mechanical', () => {
  assert.equal(mechanicalPick(itemChoice({ itemType: 'background' })), null);
  assert.equal(mechanicalPick(itemChoice({ itemType: 'race' })), null);
  assert.equal(mechanicalPick(itemChoice({ pool: 'spell', title: 'Wizard: Cantrips' })), null);
  assert.equal(mechanicalPick(itemChoice({ title: 'Wizard: Spell Mastery (ability)' })), null);
  assert.equal(
    mechanicalPick({
      advancement: 'AbilityScoreImprovement',
      title: 'Fighter: ASI',
      chosen: ['str +2'],
      itemType: 'class',
    }),
    null
  );
  assert.equal(mechanicalPick(itemChoice({ chosen: [], offered: [] })), null);
});

test('mechanicalPick: a Trait choice is mechanical only for damage resistance, immunity or condition immunity', () => {
  // The offered list is cut to the mechanical keys.
  assert.deepEqual(mechanicalPick(trait()), {
    offered: ['dr:fire', 'dr:cold'],
    chosen: ['dr:fire'],
  });
  for (const key of ['di:poison', 'ci:charmed'])
    assert.ok(mechanicalPick(trait({ chosen: [key], offered: [key] })), key);
  for (const key of [
    'skills:ath',
    'tool:art:alchemist',
    'languages:standard:common',
    'saves:wis',
    'weapon:mar',
    'armor:hvy',
    'expertise:acr',
  ])
    assert.equal(mechanicalPick(trait({ chosen: [key], offered: [key] })), null, key);
});

test('mechanicalPick: a Trait choice of a background or a species is not mechanical', () => {
  assert.equal(mechanicalPick(trait({ itemType: 'race' })), null);
  assert.equal(mechanicalPick(trait({ itemType: 'background' })), null);
  assert.ok(mechanicalPick(trait({ itemType: 'class' })));
});

test('mechanicalPick: with no item type, the title decides: the class or subclass name, and no spell, skill or tool words', () => {
  const old = (extra = {}) => itemChoice({ itemType: undefined, pool: undefined, ...extra });
  assert.equal(mechanicalPick(old()), null, 'no owners given: the source is unknown');
  assert.ok(mechanicalPick(old(), ['Fighter']));
  assert.equal(mechanicalPick(old({ title: 'Soldier: Pick a trait' }), ['Fighter']), null);
  assert.equal(mechanicalPick(old({ title: 'Wizard: Cantrips' }), ['Wizard']), null);
  assert.equal(mechanicalPick(old({ title: 'Rogue: Expertise' }), ['Rogue']), null);
  assert.equal(mechanicalPick(old({ title: 'Fighter: Tool Proficiency' }), ['Fighter']), null);
  assert.ok(mechanicalPick(old({ title: 'Brawler: Maneuvers' }), ['Fighter', 'Brawler']));
  assert.ok(fromClassOrSubclass({ advancement: 'Trait', title: 'Brawler: X' }, ['Brawler']));
  assert.deepEqual(heroOwners({ className: 'Fighter', subclassName: undefined }), ['Fighter']);
});

// --- groups, never picked ------------------------------------------------------------------------

/** @param {object} o */
function hero(o) {
  return {
    name: 'Kit Fighter 1',
    role: 'tier',
    actorId: 'a1',
    classIdentifier: 'fighter',
    className: 'Fighter',
    classUuid: 'Compendium.p.Item.fighter',
    level: 1,
    rotation: 0,
    picks: [itemChoice()],
    ...o,
  };
}

test('mechanicalNever lists the mechanical options no hero picked, and skips the rest', () => {
  const heroes = [
    hero({
      picks: [
        itemChoice(),
        // Not mechanical: skills.
        {
          advancement: 'Trait',
          title: 'Fighter: Skills',
          chosen: ['skills:ath'],
          offered: ['skills:ath', 'skills:acr'],
          itemType: 'class',
        },
      ],
    }),
    hero({
      name: 'Kit Fighter 5',
      level: 5,
      rotation: 1,
      picks: [itemChoice({ chosen: ['Style B'] })],
    }),
    hero({
      name: 'broken',
      actorId: '',
      buildError: 'x',
      picks: [itemChoice({ chosen: ['Style C'] })],
    }),
  ];
  assert.deepEqual(mechanicalNever(heroes), [
    { classIdentifier: 'fighter', title: 'Fighter: Fighting Style', option: 'Style C' },
  ]);
  const groups = mechanicalGroups(heroes);
  assert.equal(groups.size, 1);
  const g = [...groups.values()][0];
  assert.deepEqual([...g.options].sort(), ['Style A', 'Style B', 'Style C']);
  assert.equal(g.heroes.size, 2);
});

test('pickCoverage marks which never-picked options are mechanical', () => {
  const rows = pickCoverage(/** @type {any} */ ([hero({})]));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].never, ['Style B', 'Style C']);
  assert.deepEqual(rows[0].mechanicalNever, ['Style B', 'Style C']);
});

// --- takePreferred -------------------------------------------------------------------------------

test('takePreferred takes the first wanted option on offer and removes it from the wanted list', () => {
  const wanted = ['Gone', 'Style C', 'Style B'];
  assert.equal(takePreferred(['Style A', 'Style B', 'Style C'], wanted), 'Style C');
  assert.deepEqual(wanted, ['Gone', 'Style B']);
  assert.equal(takePreferred(['Style A'], wanted), undefined);
  assert.deepEqual(wanted, ['Gone', 'Style B']);
  const named = [{ n: 'x' }, { n: 'y' }];
  assert.deepEqual(
    takePreferred(named, ['y'], o => o.n),
    { n: 'y' }
  );
});

// --- the planner ---------------------------------------------------------------------------------

test('planCoverage: one hero per unpicked option when each hero makes one pick, no duplicates', () => {
  const heroes = [
    hero({}),
    hero({
      name: 'Kit Fighter 5',
      level: 5,
      rotation: 1,
      picks: [itemChoice({ chosen: ['Style B'] })],
    }),
  ];
  const { specs, remaining, capHit } = planCoverage({ heroes });
  assert.equal(specs.length, 1);
  assert.equal(remaining, 0);
  assert.equal(capHit, false);
  assert.deepEqual(specs[0].prefer, { 'Fighter: Fighting Style': ['Style C'] });
  assert.equal(specs[0].name, 'Kit Fighter 1 cov 1', 'the lower level template wins a tie');
  assert.equal(specs[0].template, 'Kit Fighter 1');
  assert.equal(specs[0].level, 1);
  assert.equal(specs[0].rotation, 0);
  assert.equal(specs[0].classUuid, 'Compendium.p.Item.fighter');
});

test('planCoverage: a hero with N picks of a choice takes N unpicked options', () => {
  const wide = hero({
    name: 'Kit Fighter 17',
    level: 17,
    picks: [
      itemChoice({
        chosen: ['O1', 'O2'],
        offered: ['O1', 'O2', 'O3', 'O4', 'O5', 'O6'],
      }),
    ],
  });
  const { specs } = planCoverage({ heroes: [wide] });
  // O3 to O6 are never picked: two heroes of two picks each.
  assert.equal(specs.length, 2);
  assert.deepEqual(specs[0].prefer['Fighter: Fighting Style'], ['O3', 'O4']);
  assert.deepEqual(specs[1].prefer['Fighter: Fighting Style'], ['O5', 'O6']);
  assert.deepEqual(
    specs.map(s => s.name),
    ['Kit Fighter 17 cov 1', 'Kit Fighter 17 cov 2']
  );
  const all = specs.flatMap(s => Object.values(s.prefer).flat());
  assert.equal(new Set(all).size, all.length, 'no option is asked of two heroes');
});

test('planCoverage: prefers the template that covers the most, one hero can cover several choices', () => {
  const small = hero({
    name: 'Kit Fighter 1',
    level: 1,
    picks: [itemChoice({ chosen: ['Style A'] })],
  });
  const big = hero({
    name: 'Kit Champion 20',
    role: 'subclass',
    level: 20,
    subclassName: 'Champion',
    subclassUuid: 'Compendium.p.Item.champion',
    picks: [
      itemChoice({ chosen: ['Style A'] }),
      itemChoice({
        title: 'Champion: Extra Style',
        itemType: 'subclass',
        chosen: ['X1'],
        offered: ['X1', 'X2'],
      }),
    ],
  });
  const { specs } = planCoverage({ heroes: [small, big] });
  // Style B, Style C and X2 are open. The big hero was offered two of them (one per choice), the small one two (one choice, one pick).
  assert.equal(specs[0].template, 'Kit Champion 20');
  assert.equal(specs[0].subclassUuid, 'Compendium.p.Item.champion');
  assert.equal(specs[0].level, 20);
  assert.deepEqual(specs[0].prefer, {
    'Fighter: Fighting Style': ['Style B'],
    'Champion: Extra Style': ['X2'],
  });
  assert.equal(specs[0].options, 2);
  assert.equal(specs.length, 2);
  assert.deepEqual(specs[1].prefer, { 'Fighter: Fighting Style': ['Style C'] });
  assert.equal(specs[1].template, 'Kit Fighter 1', 'the cheaper hero takes the rest');
});

test('planCoverage: the cap is respected and reported', () => {
  const picks = [
    itemChoice({ chosen: ['O1'], offered: Array.from({ length: 10 }, (_, i) => `O${i + 1}`) }),
  ];
  const { specs, remaining, capHit } = planCoverage({ heroes: [hero({ picks })], cap: 3 });
  assert.equal(specs.length, 3);
  assert.equal(remaining, 6);
  assert.equal(capHit, true);
  assert.equal(planCoverage({ heroes: [hero({ picks })], cap: 0 }).specs.length, 0);
  assert.equal(planCoverage({ heroes: [hero({ picks })], cap: 0 }).capHit, true);
  assert.equal(planCoverage({ heroes: [hero({ picks })] }).specs.length, 9);
  assert.equal(DEFAULT_COVERAGE_CAP, 40);
});

test('planCoverage: nothing to do when every mechanical option was picked, or only non-mechanical ones are open', () => {
  const full = hero({ picks: [itemChoice({ offered: ['Style A'] })] });
  assert.deepEqual(planCoverage({ heroes: [full] }), { specs: [], remaining: 0, capHit: false });
  const skills = hero({
    picks: [
      {
        advancement: 'Trait',
        title: 'Fighter: Skills',
        chosen: ['skills:ath'],
        offered: ['skills:ath', 'skills:acr'],
        itemType: 'class',
      },
    ],
  });
  assert.equal(planCoverage({ heroes: [skills] }).specs.length, 0);
});

test('planCoverage: coverage heroes are never templates, count as picked, and an attempted option is not asked twice', () => {
  const base = hero({});
  const cov = hero({
    name: 'Kit Fighter 1 cov 1',
    role: 'coverage',
    prefer: { 'Fighter: Fighting Style': ['Style B', 'Style C'] },
    picks: [itemChoice({ chosen: ['Style B'] })],
  });
  // Style B was picked by the coverage hero; Style C was asked for but not taken: not asked again.
  const { specs, remaining } = planCoverage({ heroes: [base, cov] });
  assert.equal(specs.length, 0);
  assert.equal(remaining, 0);
  assert.deepEqual(
    mechanicalNever([base, cov]).map(x => x.option),
    ['Style C']
  );
  // A failed coverage hero (no actor) still marks its options as attempted.
  const failed = hero({
    name: 'Kit Fighter 1 cov 1',
    role: 'coverage',
    actorId: '',
    buildError: 'boom',
    picks: undefined,
    prefer: { 'Fighter: Fighting Style': ['Style B', 'Style C'] },
  });
  assert.equal(planCoverage({ heroes: [base, failed] }).specs.length, 0);
  // Names do not collide with an existing "cov 1".
  const next = planCoverage({
    heroes: [base, hero({ name: 'Kit Fighter 1 cov 1', role: 'coverage', prefer: {}, picks: [] })],
  });
  assert.equal(next.specs[0].name, 'Kit Fighter 1 cov 2');
});

test('planCoverage: choices of the same title in two classes stay apart, and the same input plans the same heroes', () => {
  const a = hero({});
  const b = hero({
    name: 'Kit Paladin 1',
    classIdentifier: 'paladin',
    className: 'Paladin',
    classUuid: 'Compendium.p.Item.paladin',
    picks: [itemChoice({ title: 'Paladin: Fighting Style', chosen: ['Style A'] })],
  });
  const plan = planCoverage({ heroes: [a, b] });
  assert.deepEqual(
    plan.specs.map(s => [s.template, Object.keys(s.prefer)[0], s.prefer[Object.keys(s.prefer)[0]]]),
    [
      ['Kit Fighter 1', 'Fighter: Fighting Style', ['Style B']],
      ['Kit Fighter 1', 'Fighter: Fighting Style', ['Style C']],
      ['Kit Paladin 1', 'Paladin: Fighting Style', ['Style B']],
      ['Kit Paladin 1', 'Paladin: Fighting Style', ['Style C']],
    ]
  );
  assert.deepEqual(planCoverage({ heroes: [a, b] }), plan);
});

// --- the options, the report, the studio selection ------------------------------------------------

test('kit options: --no-coverage and --coverage-cap', () => {
  const o = parseArgs(['build']);
  assert.equal(o.coverage, true);
  assert.equal(o.coverageCap, DEFAULT_COVERAGE_CAP);
  const p = parseArgs(['build', '--no-coverage', '--coverage-cap', '7']);
  assert.equal(p.coverage, false);
  assert.equal(p.coverageCap, 7);
  assert.throws(() => parseArgs(['build', '--coverage-cap', 'many']));
  assert.throws(() => parseArgs(['build', '--coverage-cap', '-1']));
});

test('the Picks section says how many coverage heroes were built and how many options are still never picked', () => {
  const built = [
    hero({}),
    hero({
      name: 'Kit Fighter 1 cov 1',
      role: 'coverage',
      prefer: { x: ['Style B'] },
      picks: [itemChoice({ chosen: ['Style B'] })],
    }),
  ];
  const line = (/** @type {any} */ build) => coverageHeroesLine(/** @type {any} */ ({ build }));
  assert.equal(
    line({
      heroes: built,
      coveragePass: { enabled: true, built: 1, cap: 40, capHit: false, rounds: 1 },
    }),
    'Coverage heroes: 1 built, 1 mechanical options still never picked.'
  );
  assert.equal(
    line({
      heroes: built,
      coveragePass: { enabled: true, built: 1, cap: 1, capHit: true, rounds: 1 },
    }),
    'Coverage heroes: 1 built, 1 mechanical options still never picked (cap of 1 reached).'
  );
  assert.match(
    line({
      heroes: [hero({})],
      coveragePass: { enabled: false, built: 0, cap: 40, capHit: false, rounds: 0 },
    }) ?? '',
    /^Coverage heroes: none built \(smoke size or --no-coverage\), 2 mechanical options never picked\.$/
  );
  assert.equal(coverageHeroesLine(/** @type {any} */ ({ build: null })), null);
});

test('chooseHeroes adds the coverage heroes only when asked, each at its own level', () => {
  const row = (
    /** @type {string} */ name,
    /** @type {string} */ role,
    /** @type {number} */ level
  ) => ({
    actorId: `id-${name}`,
    name,
    classIdentifier: 'fighter',
    classUuid: 'c1',
    role,
    level,
  });
  const kit = /** @type {any} */ ({
    heroes: [
      row('Kit Fighter 1', 'tier', 1),
      row('Kit Fighter 5', 'tier', 5),
      row('Kit Fighter 17', 'tier', 17),
      row('Kit Fighter 5 cov 1', 'coverage', 5),
      row('Kit Fighter 17 cov 1', 'coverage', 17),
    ],
  });
  assert.deepEqual(
    chooseHeroes(kit, 5).map(h => h.name),
    ['Kit Fighter 5']
  );
  assert.deepEqual(
    chooseHeroes(kit, 5, [], { coverage: true }).map(h => h.name),
    ['Kit Fighter 5', 'Kit Fighter 5 cov 1', 'Kit Fighter 17 cov 1']
  );
  assert.deepEqual(chooseHeroes(kit, 5, ['wizard'], { coverage: true }), []);
});

// --- the builder on the fake ---------------------------------------------------------------------

/**
 * Builds the Fighter on the fake with a style list so long that the rotation cannot reach every
 * option, then puts the fake class back.
 * @param {{size: 'smoke'|'full'|'long', options?: number, coverage?: boolean, coverageCap?: number}} o
 */
async function buildWithLongList(o) {
  const fighter = FAKE_CLASSES.find(c => c.name === 'Fighter');
  assert.ok(fighter);
  const saved = fighter.itemChoices[0].options;
  fighter.itemChoices[0].options = Array.from(
    { length: o.options ?? 12 },
    (_, i) => `Style ${i + 1}`
  );
  const fake = await startFake({ world: 'ai-tool-kit-srd' });
  try {
    const dashboard = createDashboardClient({ base: fake.base, token: '' });
    return await buildKit({
      dashboard,
      gm: fake.gm,
      world: 'ai-tool-kit-srd',
      size: o.size,
      profile: loadProfile('srd'),
      classes: ['fighter'],
      ...(o.coverage === undefined ? {} : { coverage: o.coverage }),
      ...(o.coverageCap === undefined ? {} : { coverageCap: o.coverageCap }),
    });
  } finally {
    fighter.itemChoices[0].options = saved;
    await fake.close();
  }
}

test('buildKit on the fake: coverage heroes pick the options the rotation missed', async () => {
  const kit = await buildWithLongList({ size: 'full' });
  const normal = kit.heroes.filter(h => h.role !== 'coverage');
  const cov = kit.heroes.filter(h => h.role === 'coverage');
  const styleOf = (/** @type {any} */ h) =>
    /** @type {any[]} */ (h.picks).find(p => p.advancement === 'ItemChoice').chosen[0];
  // The 2024 Fighter heroes have rotations 0 to n-1, so the other long-list options were never picked.
  const longList = normal.map(styleOf).filter(n => /^Style \d+$/.test(n));
  assert.ok(longList.length >= 5 && longList.length < 12);
  // Their template is the level 1 hero (the cheapest one offered the whole list).
  const forLongList = cov.filter(h => h.template === 'Kit Fighter 1');
  assert.equal(forLongList.length, 12 - longList.length);
  assert.deepEqual(
    forLongList.map(h => h.name),
    forLongList.map((_, i) => `Kit Fighter 1 cov ${i + 1}`)
  );
  // The legacy Fighter's own style list (the fake has a second class record) is covered too.
  assert.ok(cov.length > forLongList.length);
  for (const h of cov) {
    assert.ok(h.actorId && !h.buildError);
    assert.ok(h.template);
    assert.equal(h.className, 'Fighter');
    const style = /** @type {any[]} */ (h.picks).find(p => p.advancement === 'ItemChoice');
    assert.deepEqual(style.chosen, h.prefer?.['Fighter: Choose a style']);
  }
  assert.deepEqual(mechanicalNever(/** @type {any} */ (kit.heroes)), []);
  assert.deepEqual(kit.coveragePass, {
    enabled: true,
    built: cov.length,
    cap: 40,
    capHit: false,
    rounds: 1,
  });
  assert.equal(kit.coverage.heroes, kit.heroes.length);
  assert.equal(new Set(kit.heroes.map(h => h.name)).size, kit.heroes.length, 'names are unique');
});

test('buildKit on the fake: the cap stops the pass and the report line says so', async () => {
  const kit = await buildWithLongList({ size: 'long', coverageCap: 2 });
  const cov = kit.heroes.filter(h => h.role === 'coverage');
  assert.equal(cov.length, 2);
  assert.equal(kit.coveragePass?.capHit, true);
  assert.ok(mechanicalNever(/** @type {any} */ (kit.heroes)).length > 0);
  assert.match(
    coverageHeroesLine(/** @type {any} */ ({ build: kit })) ?? '',
    /^Coverage heroes: 2 built, \d+ mechanical options still never picked \(cap of 2 reached\)\.$/
  );
});

test('buildKit on the fake: no coverage at size smoke, none with coverage off', async () => {
  const smoke = await buildWithLongList({ size: 'smoke' });
  assert.equal(smoke.heroes.filter(h => h.role === 'coverage').length, 0);
  assert.equal(smoke.coveragePass?.enabled, false);
  const off = await buildWithLongList({ size: 'full', coverage: false });
  assert.equal(off.heroes.filter(h => h.role === 'coverage').length, 0);
  assert.equal(off.coveragePass?.enabled, false);
});

test('buildKit on the fake: the stock fake class needs no coverage heroes (the rotation reaches every option)', async () => {
  const fake = await startFake({ world: 'ai-tool-kit-srd' });
  try {
    const dashboard = createDashboardClient({ base: fake.base, token: '' });
    const kit = await buildKit({
      dashboard,
      gm: fake.gm,
      world: 'ai-tool-kit-srd',
      size: 'full',
      profile: loadProfile('srd'),
    });
    assert.equal(kit.heroes.filter(h => h.role === 'coverage').length, 0);
    assert.deepEqual(kit.coveragePass, {
      enabled: true,
      built: 0,
      cap: 40,
      capHit: false,
      rounds: 0,
    });
  } finally {
    await fake.close();
  }
});
