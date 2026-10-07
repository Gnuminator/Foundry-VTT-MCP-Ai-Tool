import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKit } from '../lib/builder.mjs';
import { loadToolCatalog } from '../lib/catalog.mjs';
import { createDashboardClient } from '../lib/dashboard.mjs';
import { startFake } from '../lib/fake/index.mjs';
import { loadScenarios } from '../lib/loader.mjs';
import { loadProfile } from '../lib/profiles.mjs';
import { runScenariosDetailed } from '../lib/runner.mjs';
import { loadExpected } from '../lib/studio-expected.mjs';
import { ORIGINS_EXPECTED_FILE, newLedger } from '../lib/origins-flow.mjs';
import {
  FEAT_HOSTS,
  MULTICLASS_PLAN,
  casterLevelOf,
  checkMulticlass,
  checkMulticlassProficiencies,
  checkOrigin,
  descendants,
  multiclassAbilities,
  multiclassSlots,
  pickedIncreases,
  sampleEvenly,
  sampleFeats,
  selectOrigins,
  traitHeld,
  withIds,
} from '../lib/origins.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const WORLD = 'ai-tool-kit-srd';
const IDS = ['origins-species', 'origins-backgrounds', 'origins-feats', 'heroes-multiclass'];

/**
 * Runs the origin scenarios against the fake, with quirks switched on.
 * @param {{size?: 'smoke'|'full', faults?: string[], only?: string[]}} [o]
 */
async function run({ size = 'full', faults = [], only = IDS } = {}) {
  const fake = await startFake({ world: WORLD });
  try {
    for (const f of faults) fake.world.faults.origin.add(f);
    const dashboard = createDashboardClient({ base: fake.base, token: '' });
    const manifest = await buildKit({
      dashboard,
      gm: fake.gm,
      world: WORLD,
      size: 'smoke',
      profile: loadProfile('srd'),
    });
    const catalog = await loadToolCatalog(repoRoot);
    const { scenarios } = await loadScenarios([path.join(here, '..', 'scenarios')], {
      size,
      only,
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

const failedSteps = (/** @type {any} */ r) =>
  r.steps.filter((/** @type {any} */ s) => s.status === 'fail');
const coverage = (/** @type {any} */ r) =>
  r.attachments.find((/** @type {any} */ a) => a.name === 'coverage').data;

/* -------------------------------------------- */
/*  Pure helpers                                  */
/* -------------------------------------------- */

test('sampleEvenly takes the first, the last and some in between', () => {
  assert.deepEqual(sampleEvenly([1, 2, 3], 5), [1, 2, 3]);
  assert.deepEqual(sampleEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9], 3), [1, 5, 9]);
  assert.deepEqual(sampleEvenly([1, 2, 3, 4], 1), [1]);
  assert.deepEqual(sampleEvenly([1, 2], 2), [1, 2]);
});

test('sampleFeats takes two of each feat type', () => {
  const feats = [
    ...['a', 'b', 'c'].map(name => ({ name, featType: 'origin' })),
    ...['d'].map(name => ({ name, featType: 'epicBoon' })),
    ...['e', 'f'].map(name => ({ name, featType: 'general' })),
  ];
  assert.deepEqual(
    sampleFeats(feats).map(f => f.name),
    ['a', 'c', 'd', 'e', 'f']
  );
});

test('selectOrigins keeps the rules asked for, skips names and ids, and prefers 2024 on a name', () => {
  const rows = [
    { name: 'Elf', id: 'a1', rules: '2014' },
    { name: 'Elf', id: 'a2', rules: '2024' },
    { name: 'Dwarf', id: 'b1', rules: '2014' },
    { name: 'Gnome', id: 'skipme1', rules: '2024' },
    { name: 'Orc', id: 'c1', rules: '2024' },
    { name: 'Human', id: 'd1', rules: '' },
  ];
  const kept = selectOrigins(rows, {
    rules: ['2024', '2014'],
    skipNames: ['orc'],
    skipIds: '^skipme',
  });
  assert.deepEqual(
    kept.map(r => `${r.name}:${r.id}`),
    ['Dwarf:b1', 'Elf:a2', 'Human:d1']
  );
  assert.deepEqual(
    selectOrigins(rows, { rules: ['2024'] }).map(r => r.name),
    ['Elf', 'Gnome', 'Orc']
  );
});

test('traitHeld reads each kind of trait key from the build, and says null when it cannot', () => {
  const build = {
    skills: { ath: 1, ste: 0 },
    saves: { str: true, dex: false },
    proficiencies: {
      languages: ['common'],
      weapons: ['sim'],
      armor: ['lgt'],
      tools: ['alchemist'],
      damageResistances: ['poison'],
      damageImmunities: [],
      conditionImmunities: [],
    },
  };
  assert.equal(traitHeld('skills:ath', build), true);
  assert.equal(traitHeld('skills:ste', build), false);
  assert.equal(traitHeld('saves:str', build), true);
  assert.equal(traitHeld('languages:standard:common', build), true);
  assert.equal(traitHeld('languages:standard:elvish', build), false);
  assert.equal(traitHeld('weapon:sim', build), true);
  assert.equal(traitHeld('armor:med', build), false);
  assert.equal(traitHeld('tool:art:alchemist', build), true);
  assert.equal(traitHeld('dr:poison', build), true);
  assert.equal(traitHeld('di:fire', build), false);
  assert.equal(traitHeld('tool:art:*', build), null);
  assert.equal(traitHeld('weird:thing', build), null);
});

test('pickedIncreases adds the "x +n" picks, of one owner or of all', () => {
  const picks = [
    { advancement: 'AbilityScoreImprovement', title: 'Soldier: ASI', chosen: ['str +2', 'con +1'] },
    { advancement: 'AbilityScoreImprovement', title: 'Fighter: ASI', chosen: ['str +1'] },
    { advancement: 'AbilityScoreImprovement', title: 'Fighter: ASI', chosen: ['feat: Alert'] },
    { advancement: 'Trait', title: 'Soldier: Skills', chosen: ['skills:ath'] },
  ];
  assert.deepEqual(pickedIncreases(picks), { str: 3, con: 1 });
  assert.deepEqual(pickedIncreases(picks, 'Soldier'), { str: 2, con: 1 });
});

test('descendants follows the advancement origins from an origin item', () => {
  const build = {
    items: [
      { type: 'race', name: 'Elf', origin: null },
      { type: 'feat', name: 'Trance', origin: { item: 'race:Elf' } },
      { type: 'background', name: 'Soldier', origin: null },
      { type: 'feat', name: 'Savage Blow', origin: { item: 'background:Soldier' } },
      { type: 'feat', name: 'Sub Feature', origin: { item: 'feat:Savage Blow' } },
    ],
  };
  assert.deepEqual([...descendants(build, 'race:Elf')].sort(), ['feat:Trance', 'race:Elf']);
  assert.deepEqual([...descendants(build, 'background:Soldier')].sort(), [
    'background:Soldier',
    'feat:Savage Blow',
    'feat:Sub Feature',
  ]);
});

test('the multiclass slot table: full, half rounded up, third rounded down, Pact Magic apart', () => {
  const c = (
    /** @type {string | null} */ progression,
    /** @type {number} */ levels,
    rules = '2024'
  ) => ({
    progression,
    levels,
    rules,
  });
  assert.equal(casterLevelOf(c('full', 5)), 5);
  assert.equal(casterLevelOf(c('half', 5)), 3);
  assert.equal(casterLevelOf(c('half', 5, '2014')), 2);
  assert.equal(casterLevelOf(c('third', 8)), 2);
  assert.equal(casterLevelOf(c('pact', 8)), 0);
  assert.equal(casterLevelOf(c(null, 8)), 0);
  const two = multiclassSlots([c(null, 3), c('full', 3)]);
  assert.equal(two.casterLevel, 3);
  assert.deepEqual(two.leveled, { 1: 4, 2: 2 });
  assert.equal(two.pact, null);
  const mixed = multiclassSlots([c('half', 5), c('full', 3)]);
  assert.equal(mixed.casterLevel, 6);
  assert.deepEqual(mixed.leveled, { 1: 4, 2: 3, 3: 3 });
  const pact = multiclassSlots([c('full', 3), c('pact', 3)]);
  assert.equal(pact.casterLevel, 3);
  assert.deepEqual(pact.pact, { max: 2, level: 2 });
  const none = multiclassSlots([c(null, 3), c(null, 3)]);
  assert.deepEqual(none, { casterLevel: 0, leveled: {}, pact: null });
});

test('multiclassAbilities puts 15 in every primary ability a class asks for and 13 in Constitution', () => {
  const any = { primaryAbility: ['str', 'dex'] };
  const all = { primaryAbility: ['str', 'cha'], primaryAll: true };
  const one = { primaryAbility: ['int'] };
  const a = multiclassAbilities([any, one]);
  assert.equal(a.str, 15);
  assert.equal(a.int, 15);
  assert.equal(a.con, 13);
  assert.ok(a.dex < 15 && a.dex >= 8);
  const b = multiclassAbilities([all, any]);
  assert.equal(b.str, 15);
  assert.equal(b.cha, 15);
  assert.ok(b.dex < 15, 'the "any" class is already satisfied by Strength');
});

test('the plan: twelve combinations, unique ids, four in a smoke run, every class a lower case identifier', () => {
  assert.equal(MULTICLASS_PLAN.length, 12);
  assert.equal(new Set(MULTICLASS_PLAN.map(c => c.id)).size, 12);
  assert.equal(MULTICLASS_PLAN.filter(c => c.smoke).length, 4);
  for (const c of MULTICLASS_PLAN) {
    assert.ok(c.classes.length >= 2 && c.classes.length <= 3, c.id);
    for (const [id, level] of c.classes)
      assert.ok(/^[a-z]+$/.test(id) && level >= 1 && level <= 20, c.id);
  }
  // The caster cases the plan has to cover.
  const ids = new Set(MULTICLASS_PLAN.flatMap(c => c.classes.map(([id]) => id)));
  for (const need of ['wizard', 'warlock', 'paladin', 'ranger', 'barbarian', 'monk'])
    assert.ok(ids.has(need), need);
  assert.deepEqual(
    FEAT_HOSTS.map(h => h.id),
    ['fighter-1', 'fighter-4', 'wizard-4', 'fighter-19', 'wizard-19']
  );
});

test('the ledger splits findings by the expected list: same id and kind is accepted, a changed kind is new', () => {
  const expected = [{ id: 'species:size', kind: /** @type {const} */ ('SYSTEM'), why: 'known' }];
  const ledger = newLedger('species', expected);
  const none = ledger.file('Elf', [{ kind: 'SYSTEM', what: 'size', evidence: 'x' }]);
  assert.equal(none.length, 0);
  assert.deepEqual(ledger.expectedCounts, { 'species:size': 1 });
  const fresh = ledger.file('Dwarf', [
    { kind: 'CONTENT', what: 'size', evidence: 'y' },
    { kind: 'SYSTEM', what: 'movement', evidence: 'z' },
  ]);
  assert.equal(fresh.length, 2);
  assert.equal(ledger.failed.length, 1);
  assert.deepEqual(ledger.byKind(), { KIT: 0, CONTENT: 1, SYSTEM: 2 });
  assert.equal(
    withIds('feats', [{ kind: 'KIT', what: 'Ability score cap', evidence: '' }])[0].id,
    'feats:ability-score-cap'
  );
});

test('the ledger counts a problem on the profile known list as known, not failed', () => {
  const list = [
    {
      id: 'pack-uses-not-set',
      scenario: 'origins-species',
      kind: /** @type {const} */ ('CONTENT'),
      what: 'the system refused the use',
      match: 'none are set; from some-pack.',
      why: 'test',
    },
  ];
  const ledger = newLedger('species', [], { list, scenario: 'origins-species' });
  const fresh = ledger.file('Goblin', [
    {
      kind: 'CONTENT',
      what: 'the system refused the use',
      evidence: 'Nimble Escape: none are set; from some-pack.species',
    },
    { kind: 'KIT', what: 'the GM action failed', evidence: 'none are set; from some-pack.species' },
  ]);
  assert.deepEqual(
    fresh.map(p => p.kind),
    ['KIT']
  );
  assert.deepEqual(ledger.known(), {
    entries: 1,
    matched: { 'pack-uses-not-set': { kind: 'CONTENT', problems: 1, why: 'test' } },
    unseen: [],
  });
  const other = newLedger('feats', [], { list, scenario: 'origins-feats' });
  assert.equal(
    other.file('Lucky', [{ kind: 'CONTENT', what: 'x', evidence: 'none are set; from some-pack.' }])
      .length,
    1
  );
});

test('the shipped expected-findings list loads', () => {
  assert.ok(Array.isArray(loadExpected(ORIGINS_EXPECTED_FILE)));
});

/* -------------------------------------------- */
/*  checkOrigin and the multiclass checks         */
/* -------------------------------------------- */

const BASE = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
const abilitiesOf = (/** @type {Record<string, number>} */ v) =>
  Object.fromEntries(
    Object.entries(v).map(([k, n]) => [k, { value: n, mod: Math.floor((n - 10) / 2) }])
  );

/** A clean species hero's facts. */
function speciesFacts() {
  return {
    kind: /** @type {const} */ ('species'),
    uuid: 'U.elf',
    desc: {
      name: 'Elf',
      movement: { walk: 30 },
      senses: { darkvision: 60 },
      effects: [],
      advancements: [
        { type: 'Size', title: 'Size', sizes: ['med'], classRestriction: '' },
        {
          type: 'Trait',
          title: 'Keen',
          mode: 'default',
          grants: ['languages:standard:elvish'],
          choices: [{ count: 1, pool: ['skills:prc', 'skills:ins'] }],
          classRestriction: '',
        },
        {
          type: 'ItemGrant',
          title: 'Features',
          optional: false,
          items: [{ uuid: 'U.trance', name: 'Trance', resolved: true, optional: false }],
          classRestriction: '',
        },
      ],
    },
    hero: {
      picks: [{ level: 0, advancement: 'Trait', title: 'Elf: Keen', chosen: ['skills:prc'] }],
      warnings: [],
    },
    build: {
      items: [
        { type: 'race', name: 'Elf', sourceUuid: 'U.elf' },
        { type: 'feat', name: 'Trance', sourceUuid: 'U.trance' },
      ],
      skills: { prc: 1 },
      saves: {},
      proficiencies: {
        languages: ['elvish'],
        weapons: [],
        armor: [],
        tools: [],
        damageResistances: [],
        damageImmunities: [],
        conditionImmunities: [],
      },
      movement: { walk: 30 },
      senses: { darkvision: 60 },
      size: 'med',
    },
    actor: { abilities: abilitiesOf(BASE) },
    base: BASE,
  };
}

test('checkOrigin: a clean species passes; each wrong fact is named with its kind', () => {
  const clean = checkOrigin(speciesFacts());
  assert.deepEqual(clean.problems, []);
  /** @param {(f: any) => void} change */
  const broken = change => {
    const f = speciesFacts();
    change(f);
    return checkOrigin(f).problems.map(p => `${p.kind} ${p.what}`);
  };
  assert.deepEqual(
    broken(f => (f.build.movement.walk = 35)),
    ['SYSTEM movement']
  );
  assert.deepEqual(
    broken(f => (f.build.senses.darkvision = 0)),
    ['SYSTEM senses']
  );
  assert.deepEqual(
    broken(f => (f.build.size = 'lg')),
    ['SYSTEM size']
  );
  assert.deepEqual(
    broken(f => (f.build.items = f.build.items.slice(0, 1))),
    ['SYSTEM grant missing']
  );
  assert.deepEqual(
    broken(f => (f.build.proficiencies.languages = [])),
    ['SYSTEM trait grant missing']
  );
  assert.deepEqual(
    broken(f => (f.build.skills = {})),
    ['SYSTEM trait choice missing']
  );
  assert.deepEqual(
    broken(f => (f.hero.picks = [])),
    ['KIT trait choice not made']
  );
  assert.deepEqual(
    broken(f => (f.desc.advancements[2].items[0].resolved = false)),
    ['CONTENT grant does not resolve']
  );
  assert.deepEqual(
    broken(f => (f.build.items = [])),
    ['SYSTEM species item missing', 'SYSTEM grant missing']
  );
  assert.deepEqual(
    broken(f => (f.actor.abilities.str.value = 16)),
    ['SYSTEM ability score']
  );
});

test('checkOrigin: a pool with nothing left is a note, an answered size must match', () => {
  const f = speciesFacts();
  f.hero.picks = [];
  f.build.skills = { prc: 1, ins: 1 };
  const r = checkOrigin(f);
  assert.deepEqual(r.problems, []);
  assert.ok(r.notes.some(n => /no option left/.test(n)));
  const g = speciesFacts();
  assert.deepEqual(
    checkOrigin({ ...g, chosenSize: 'sm' }).problems.map(p => p.what),
    ['size']
  );
});

/** A background hero's facts: three points, none on a locked ability. */
function backgroundFacts() {
  return {
    kind: /** @type {const} */ ('background'),
    uuid: 'U.soldier',
    desc: {
      name: 'Soldier',
      startingEquipment: 4,
      effects: [],
      advancements: [
        {
          type: 'AbilityScoreImprovement',
          title: 'ASI',
          classRestriction: '',
          asi: { points: 3, cap: 2, fixed: {}, locked: ['int', 'wis', 'cha'], max: null },
        },
      ],
    },
    hero: {
      picks: [
        {
          level: 0,
          advancement: 'AbilityScoreImprovement',
          title: 'Soldier: ASI',
          chosen: ['str +2', 'dex +1'],
        },
      ],
      warnings: [],
    },
    build: {
      items: [{ type: 'background', name: 'Soldier', sourceUuid: 'U.soldier' }],
      skills: {},
      saves: {},
      proficiencies: {},
    },
    actor: { abilities: abilitiesOf({ ...BASE, str: 17, dex: 15 }) },
    base: BASE,
  };
}

test('checkOrigin: background ability score increases follow the points, the cap and the locked list', () => {
  const clean = checkOrigin(backgroundFacts());
  assert.deepEqual(clean.problems, []);
  assert.ok(clean.notes.some(n => /starting equipment/.test(n)));
  const spend = backgroundFacts();
  spend.hero.picks[0].chosen = ['str +2'];
  spend.actor = { abilities: abilitiesOf({ ...BASE, str: 17 }) };
  assert.deepEqual(
    checkOrigin(spend).problems.map(p => `${p.kind} ${p.what}`),
    ['SYSTEM ability score points']
  );
  const locked = backgroundFacts();
  locked.hero.picks[0].chosen = ['str +2', 'int +1'];
  locked.actor = { abilities: abilitiesOf({ ...BASE, str: 17, int: 13 }) };
  assert.deepEqual(
    checkOrigin(locked).problems.map(p => p.what),
    ['locked ability raised']
  );
  const cap = backgroundFacts();
  cap.hero.picks[0].chosen = ['str +3'];
  cap.actor = { abilities: abilitiesOf({ ...BASE, str: 18 }) };
  assert.ok(checkOrigin(cap).problems.some(p => p.what === 'ability score cap'));
  const none = backgroundFacts();
  none.hero.picks = [];
  none.actor = { abilities: abilitiesOf(BASE) };
  assert.deepEqual(
    checkOrigin(none).problems.map(p => `${p.kind} ${p.what}`),
    ['KIT ability score increase not made']
  );
});

test('checkOrigin: a feat added to a host must not lose anything, and must be new', () => {
  const host = {
    items: [
      { type: 'feat', name: 'Alert' },
      { type: 'class', name: 'Fighter' },
    ],
  };
  const base = {
    kind: /** @type {const} */ ('feat'),
    uuid: 'U.hardy',
    desc: { name: 'Hardy', advancements: [], effects: [] },
    hero: { picks: [], warnings: [] },
    build: { items: [...host.items, { type: 'feat', name: 'Hardy', sourceUuid: 'U.hardy' }] },
    actor: { abilities: abilitiesOf(BASE) },
    base: BASE,
    hostBuild: host,
  };
  assert.deepEqual(checkOrigin(base).problems, []);
  const lost = {
    ...base,
    build: { items: [{ type: 'feat', name: 'Hardy', sourceUuid: 'U.hardy' }] },
  };
  assert.deepEqual(
    checkOrigin(lost).problems.map(p => p.what),
    ['items lost']
  );
  const same = { ...base, hostBuild: { items: [...host.items, { type: 'feat', name: 'Hardy' }] } };
  assert.deepEqual(
    checkOrigin(same).problems.map(p => p.what),
    ['feat not added']
  );
});

test('checkMulticlassProficiencies: no saving throw, the multiclass set held, nothing beyond it', () => {
  const desc = {
    advancements: [
      {
        type: 'Trait',
        levels: [1],
        classRestriction: 'primary',
        mode: 'default',
        grants: ['saves:wis', 'armor:hvy'],
        choices: [],
      },
      {
        type: 'Trait',
        levels: [1],
        classRestriction: 'secondary',
        mode: 'default',
        grants: ['armor:lgt'],
        choices: [],
      },
    ],
  };
  const empty = { skills: {}, saves: {}, proficiencies: { weapons: [], armor: [], tools: [] } };
  const good = { skills: {}, saves: {}, proficiencies: { weapons: [], armor: ['lgt'], tools: [] } };
  assert.deepEqual(
    checkMulticlassProficiencies({
      desc,
      before: empty,
      after: good,
      picks: [],
      className: 'Cleric',
    }).problems,
    []
  );
  const wrong = {
    skills: {},
    saves: { wis: true },
    proficiencies: { weapons: [], armor: ['lgt', 'hvy'], tools: [] },
  };
  const bad = checkMulticlassProficiencies({
    desc,
    before: empty,
    after: wrong,
    picks: [],
    className: 'Cleric',
  }).problems;
  assert.deepEqual(
    bad.map(p => p.what),
    ['multiclass saving throws', 'proficiencies beyond the multiclass set']
  );
  assert.match(bad[1].evidence, /belong to the first class only/);
  const missing = checkMulticlassProficiencies({
    desc,
    before: empty,
    after: empty,
    picks: [],
    className: 'Cleric',
  }).problems;
  assert.deepEqual(
    missing.map(p => p.what),
    ['multiclass proficiency missing']
  );
});

/** A fighter 3 / wizard 3 hero's facts. */
function multiclassFacts() {
  const grant = (/** @type {string} */ name, /** @type {number} */ level) => ({
    level,
    uuid: `U.${name}`,
    name,
    resolved: true,
    optional: false,
  });
  return {
    classes: [
      {
        identifier: 'fighter',
        name: 'Fighter',
        levels: 3,
        rules: '2024',
        expected: {
          hpFixed: 10 + 6 + 6,
          hitDie: 'd10',
          grants: [grant('Second Wind', 1)],
          scale: [],
          choices: [],
          spellcasting: null,
          subclassAt: 3,
        },
        desc: { primaryAbility: ['str', 'dex'] },
        picks: [],
      },
      {
        identifier: 'wizard',
        name: 'Wizard',
        levels: 3,
        rules: '2024',
        expected: {
          hpFixed: 4 * 3,
          hitDie: 'd6',
          grants: [grant('Arcane Recovery', 1)],
          scale: [],
          choices: [],
          spellcasting: { progression: 'full' },
          subclassAt: 3,
        },
        desc: { primaryAbility: ['int'] },
        picks: [],
      },
    ],
    actor: {
      level: 6,
      classes: [
        { identifier: 'fighter', levels: 3 },
        { identifier: 'wizard', levels: 3 },
      ],
      abilities: abilitiesOf({ ...BASE, int: 15 }),
      hp: { value: 22 + 12 + 6 * 1, max: 22 + 12 + 6 * 1, bonuses: { level: 0, overall: 0 } },
      spells: { spell1: { max: 4 }, spell2: { max: 2 } },
      scale: {},
      items: [
        { name: 'Second Wind', sourceUuid: 'U.Second Wind' },
        { name: 'Arcane Recovery', sourceUuid: 'U.Arcane Recovery' },
      ],
    },
    facts: {
      prof: 3,
      hd: {
        max: 6,
        classes: [
          { identifier: 'fighter', levels: 3, denomination: 'd10' },
          { identifier: 'wizard', levels: 3, denomination: 'd6' },
        ],
      },
      spells: { spell1: { value: 4, max: 4 }, spell2: { value: 2, max: 2 } },
    },
    build: {},
    base: { ...BASE, int: 15 },
    warnings: [],
  };
}

test('checkMulticlass: a clean fighter and wizard passes; each wrong number is named', () => {
  assert.deepEqual(checkMulticlass(multiclassFacts()).problems, []);
  /** @param {(f: any) => void} change */
  const broken = change => {
    const f = multiclassFacts();
    change(f);
    return checkMulticlass(f).problems.map(p => `${p.kind} ${p.what}`);
  };
  assert.deepEqual(
    broken(f => (f.actor.spells.spell2.max = 3)),
    ['SYSTEM spell slots, level 2']
  );
  assert.deepEqual(
    broken(f => (f.actor.spells.pact = { max: 1, level: 1 })),
    ['SYSTEM pact slots']
  );
  assert.deepEqual(
    broken(f => (f.facts.prof = 2)),
    ['SYSTEM proficiency bonus']
  );
  assert.deepEqual(
    broken(f => (f.actor.level = 5)),
    ['SYSTEM character level']
  );
  assert.deepEqual(
    broken(f => (f.actor.classes[1].levels = 2)),
    ['SYSTEM class level']
  );
  assert.deepEqual(
    broken(f => (f.facts.hd.classes[1].denomination = 'd8')),
    ['SYSTEM hit dice']
  );
  assert.deepEqual(
    broken(f => {
      f.actor.hp.max = 80;
      f.actor.hp.value = 80;
    }),
    ['KIT hit points']
  );
  assert.deepEqual(
    broken(f => (f.actor.items = f.actor.items.slice(0, 1))),
    ['SYSTEM grant missing']
  );
  assert.deepEqual(
    broken(f => (f.base.int = 12)),
    ['KIT multiclass prerequisite']
  );
  assert.deepEqual(
    broken(f => (f.classes[0].expected.grants[0].resolved = false)),
    ['CONTENT grant does not resolve']
  );
});

test('checkMulticlass: Pact Magic is its own table and a half caster rounds up', () => {
  const f = multiclassFacts();
  f.classes[1].expected.spellcasting = { progression: 'pact' };
  f.actor.spells = { pact: { max: 2, level: 2 } };
  f.facts.spells = { pact: { value: 2, max: 2 } };
  assert.deepEqual(checkMulticlass(f).problems, []);
  const half = multiclassFacts();
  half.classes[0].levels = 5;
  half.classes[0].expected.spellcasting = { progression: 'half' };
  half.actor.classes[0].levels = 5;
  half.actor.level = 8;
  half.facts.hd.max = 8;
  half.facts.hd.classes[0].levels = 5;
  half.facts.prof = 3;
  // paladin-like 5 (caster level 3) plus a full caster 3: caster level 6, so 4/3/3.
  half.actor.spells = { spell1: { max: 4 }, spell2: { max: 3 }, spell3: { max: 3 } };
  half.facts.spells = {
    spell1: { value: 4, max: 4 },
    spell2: { value: 3, max: 3 },
    spell3: { value: 3, max: 3 },
  };
  half.classes[0].expected.hpFixed = 10 + 4 * 6;
  half.actor.hp = { value: 34 + 12 + 8, max: 34 + 12 + 8, bonuses: { level: 0, overall: 0 } };
  assert.deepEqual(checkMulticlass(half).problems, []);
});

/* -------------------------------------------- */
/*  The scenarios against the fake                */
/* -------------------------------------------- */

test('against the fake all four origin scenarios pass and say what they covered', async () => {
  const r = await run();
  for (const id of IDS)
    assert.equal(
      r[id].status,
      'pass',
      `${id}: ${JSON.stringify(failedSteps(r[id]).map((/** @type {any} */ s) => s.error?.message))}`
    );
  const species = coverage(r['origins-species']);
  assert.equal(species.found, 3);
  assert.equal(species.checked, 3);
  assert.equal(species.activitiesUsed, 3);
  assert.deepEqual(species.problemsByKind, { KIT: 0, CONTENT: 0, SYSTEM: 0 });
  const backgrounds = coverage(r['origins-backgrounds']);
  assert.equal(backgrounds.checked, 2);
  assert.ok(backgrounds.notes.some((/** @type {string} */ n) => /starting equipment/.test(n)));
  const feats = coverage(r['origins-feats']);
  assert.equal(feats.found, 10);
  assert.equal(feats.taken, 9);
  assert.deepEqual(
    feats.unmetPrerequisites.map((/** @type {any} */ u) => u.name),
    ['Mighty Charisma']
  );
  assert.match(feats.unmetPrerequisites[0].why, /cha 17/);
  // Hosts used: a level 1 fighter for the origin feats, level 4 for general feats, a wizard for the caster feat, level 19 for the boon.
  assert.deepEqual(Object.keys(feats.takenOnHost).sort(), [
    'fighter-1',
    'fighter-19',
    'fighter-4',
    'wizard-4',
  ]);
  const multi = coverage(r['heroes-multiclass']);
  assert.equal(multi.combinations, 12);
  assert.equal(multi.built, 6);
  assert.ok(multi.skippedCombinations.some((/** @type {any} */ s) => /no ranger/.test(s.why)));
  assert.deepEqual(multi.problemsByKind, { KIT: 0, CONTENT: 0, SYSTEM: 0 });
});

test('a smoke run takes samples: three species, two backgrounds, two of each feat type, four combinations', async () => {
  const r = await run({ size: 'smoke' });
  assert.equal(coverage(r['origins-species']).checked, 3);
  assert.equal(coverage(r['origins-backgrounds']).checked, 2);
  assert.equal(coverage(r['origins-feats']).checked, 6);
  assert.equal(coverage(r['heroes-multiclass']).combinations, 4);
  for (const id of IDS) assert.equal(r[id].status, 'pass', id);
});

/** The one failed step of a scenario, with its message. @param {any} result */
const oneFailure = result => {
  const failed = failedSteps(result);
  assert.equal(failed.length, 1, JSON.stringify(failed.map((/** @type {any} */ s) => s.label)));
  return /** @type {{label: string, message: string}} */ ({
    label: failed[0].label,
    message: failed[0].error?.message ?? '',
  });
};

test('species faults: a wrong speed, a wrong size and a missing feature are named with their kind', async () => {
  const r = await run({
    faults: ['speed:Elf', 'size:Dwarf', 'noGrant:Human'],
    only: ['origins-species'],
  });
  const result = r['origins-species'];
  assert.equal(result.status, 'fail');
  const steps = Object.fromEntries(
    failedSteps(result).map((/** @type {any} */ s) => [s.label.split(' ')[0], s.error.message])
  );
  assert.match(steps.Elf, /^\[SYSTEM\] movement: walk: the species says 30, the actor has 35/);
  assert.match(steps.Dwarf, /^\[SYSTEM\] size: the actor is grg, the species allows med/);
  assert.match(steps.Human, /^\[SYSTEM\] grant missing: Human: Features: Resourceful/);
  assert.equal(failedSteps(result).length, 3);
  assert.equal(coverage(result).failed.length, 3);
});

test('species faults: a trait that is not held', async () => {
  const r = await run({ faults: ['noTrait:Dwarf'], only: ['origins-species'] });
  const { label, message } = oneFailure(r['origins-species']);
  assert.match(label, /^Dwarf/);
  assert.match(
    message,
    /\[SYSTEM\] trait grant missing: Dwarf: Proficiencies: the actor does not hold dr:poison/
  );
});

test('background faults: too many points spent and a missing origin feat are named', async () => {
  const r = await run({ faults: ['asiTooMuch:Soldier'], only: ['origins-backgrounds'] });
  const { label, message } = oneFailure(r['origins-backgrounds']);
  assert.match(label, /^Soldier/);
  assert.match(
    message,
    /SYSTEM\] ability score points: Soldier: Ability Score Improvement: 4 points spent of 3/
  );
  const r2 = await run({ faults: ['noGrant:Initiate'], only: ['origins-backgrounds'] });
  const second = oneFailure(r2['origins-backgrounds']);
  assert.equal(second.label.split(' ')[0], 'Acolyte');
  assert.match(second.message, /\[SYSTEM\] grant missing: Initiate: Features: Initiate Cantrip/);
});

test('feat faults: a feat that removes an item the host had fails; the feats the hosts cannot take are listed, not forced', async () => {
  const r = await run({ faults: ['dropItem:Wrestler'], only: ['origins-feats'] });
  const { label, message } = oneFailure(r['origins-feats']);
  assert.match(label, /^Wrestler \(general/);
  assert.match(message, /\[SYSTEM\] items lost: taking the feat removed/);
});

test('multiclass faults: saves from a second class, a wrong slot table and merged Pact Magic', async () => {
  const saves = await run({ faults: ['saves:wizard'], only: ['heroes-multiclass'] });
  const failedSaves = failedSteps(saves['heroes-multiclass']);
  assert.ok(failedSaves.length >= 1);
  assert.ok(
    failedSaves.every((/** @type {any} */ s) =>
      /\[SYSTEM\] multiclass saving throws: Wizard added saving throw proficiency in (int|wis|int, wis);/.test(
        s.error.message
      )
    ),
    JSON.stringify(failedSaves.map((/** @type {any} */ s) => s.error.message))
  );
  const slots = await run({ faults: ['slots'], only: ['heroes-multiclass'] });
  const failedSlots = failedSteps(slots['heroes-multiclass']);
  assert.ok(failedSlots.length >= 4);
  assert.ok(
    failedSlots.every(
      (/** @type {any} */ s) =>
        /^\[SYSTEM\] spell slots, level 1/.test(s.error.message) ||
        /spell slots/.test(s.error.message)
    )
  );
  const pact = await run({ faults: ['pact'], only: ['heroes-multiclass'] });
  const { label, message } = oneFailure(pact['heroes-multiclass']);
  assert.match(label, /^pact-full/);
  assert.match(message, /\[SYSTEM\] spell slots, level 1: caster level 3 gives 4, the actor has 6/);
});
