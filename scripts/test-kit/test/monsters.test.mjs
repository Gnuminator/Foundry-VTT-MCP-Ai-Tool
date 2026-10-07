import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKit } from '../lib/builder.mjs';
import { loadToolCatalog } from '../lib/catalog.mjs';
import { createDashboardClient } from '../lib/dashboard.mjs';
import { startFake } from '../lib/fake/index.mjs';
import { loadScenarios } from '../lib/loader.mjs';
import {
  CR_BANDS,
  ODD_CHECKS,
  crBand,
  fmtCr,
  isStatBlock,
  judgeBridge,
  judgeCopy,
  judgeNoAction,
  judgeRecharge,
  judgeRow,
  matrixOf,
  pickOddRows,
  planMonsterUse,
  readMonsters,
  runOddCheck,
  sampleMonsters,
  spread,
} from '../lib/monsters.mjs';
import { loadProfile } from '../lib/profiles.mjs';
import { runScenariosDetailed } from '../lib/runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const WORLD = 'ai-tool-kit-srd';

/* ---------- builders ---------- */

/** @param {any} o */
function row(o = {}) {
  return {
    packId: 'p.m',
    id: 'id1',
    uuid: 'Compendium.p.m.Actor.id1',
    name: 'Wolf',
    cr: 0.25,
    creatureType: 'beast',
    size: 'med',
    book: 'B',
    rules: '2024',
    hp: 11,
    ac: 13,
    movement: { walk: 40, fly: 0, swim: 0, burrow: 0, climb: 0, hover: false, units: 'ft' },
    senses: { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0, special: false },
    languages: [],
    resist: { dr: [], di: [], dv: [], ci: [], dm: false },
    spell: { spells: 0, ability: 'int', innate: false, dc: 10 },
    legact: 0,
    legres: 0,
    lair: false,
    items: 2,
    activities: 1,
    odd: {
      regeneration: false,
      shapechanger: false,
      damageThreshold: false,
      multiattack: false,
      innateSpellcasting: false,
      recharge: 0,
      summon: 0,
      transform: 0,
      legendaryActivities: 0,
      lairActivities: 0,
    },
    ...o,
  };
}

/** @param {any} o */
function activity(o = {}) {
  return {
    id: 'a1',
    type: 'attack',
    name: '',
    activation: 'action',
    activationValue: null,
    canUse: true,
    consumption: [],
    ...o,
  };
}

/** @param {any} o */
function item(o = {}) {
  return {
    id: 'i1',
    name: 'Bite',
    type: 'weapon',
    identifier: 'bite',
    sourceUuid: null,
    equipped: false,
    uses: null,
    activities: [activity()],
    effects: [],
    ...o,
  };
}

/** @param {any} o */
function facts(o = {}) {
  return {
    name: 'Probe Wolf',
    level: 0,
    prof: 2,
    ac: { value: 13, calc: 'default', armor: false },
    hd: { value: 0, max: 0, classes: [] },
    hp: { value: 11, max: 11 },
    abilities: {},
    spells: {},
    scale: {},
    items: [item()],
    npc: {
      cr: 0.25,
      creatureType: 'beast',
      size: 'med',
      ac: 13,
      movement: { walk: 40, fly: 0, swim: 0, burrow: 0, climb: 0, hover: false },
      movementSource: { walk: 40, fly: 0, swim: 0, burrow: 0, climb: 0, hover: false },
      resources: { legact: null, legres: null, lair: null },
      spell: { ability: 'int', dc: 10 },
    },
    ...o,
  };
}

/* ---------- vocabulary and counting ---------- */

test('crBand and fmtCr: the bands cover every rating, a bad rating is "none"', () => {
  assert.equal(crBand(0), 'cr0');
  assert.equal(crBand(0.125), 'cr1/8');
  assert.equal(crBand(0.25), 'cr1/4');
  assert.equal(crBand(0.5), 'cr1/2');
  assert.equal(crBand(1), 'cr1-4');
  assert.equal(crBand(4), 'cr1-4');
  assert.equal(crBand(5), 'cr5-10');
  assert.equal(crBand(10), 'cr5-10');
  assert.equal(crBand(11), 'cr11-16');
  assert.equal(crBand(17), 'cr17-20');
  assert.equal(crBand(21), 'cr21+');
  assert.equal(crBand(30), 'cr21+');
  assert.equal(crBand(null), 'none');
  assert.equal(crBand(-1), 'none');
  assert.equal(CR_BANDS.length, 9);
  assert.equal(fmtCr(0.125), '1/8');
  assert.equal(fmtCr(14), '14');
  assert.equal(fmtCr(null), '?');
});

test('spread keeps the first and spreads the rest; sampleMonsters takes one per band, type and trait', () => {
  assert.deepEqual(spread([1, 2, 3], 5), [1, 2, 3]);
  assert.deepEqual(spread([1, 2, 3, 4, 5], 1), [1]);
  assert.deepEqual(spread([1, 2, 3, 4, 5], 3), [1, 3, 5]);
  assert.deepEqual(spread([1, 2, 3], Infinity), [1, 2, 3]);
  const rows = [
    row({ id: 'a', name: 'A', cr: 0 }),
    row({ id: 'b', name: 'B', cr: 0 }),
    row({ id: 'c', name: 'C', cr: 14, creatureType: 'dragon', legact: 3 }),
    row({ id: 'd', name: 'D', cr: 14, creatureType: 'dragon' }),
  ];
  const sample = sampleMonsters(rows);
  assert.deepEqual(
    sample.map(m => m.name),
    ['A', 'C']
  );
});

test('matrixOf counts by band, type, size and trait and names the gaps', () => {
  const rows = [
    row({ id: 'a', packId: 'p.1', cr: 0, creatureType: 'beast' }),
    row({
      id: 'b',
      packId: 'p.2',
      name: 'Dragon',
      cr: 14,
      creatureType: 'dragon',
      size: 'huge',
      legact: 3,
      legres: 3,
      lair: true,
      movement: { walk: 40, fly: 80, swim: 0, burrow: 0, climb: 0, hover: false, units: 'ft' },
      resist: { dr: ['fire'], di: ['acid'], dv: [], ci: [], dm: false },
      senses: { darkvision: 60, blindsight: 0, tremorsense: 0, truesight: 0, special: false },
      languages: ['Common'],
    }),
    row({ id: 'c', name: 'Spell', packId: 'p.1', cr: null, creatureType: 'custom' }),
  ];
  const m = matrixOf(rows);
  assert.equal(m.total, 3);
  assert.equal(m.statBlocks, 1);
  assert.deepEqual(m.byPack, { 'p.1': 2, 'p.2': 1 });
  assert.equal(m.byBand.cr0, 1);
  assert.equal(m.byBand.cr11, undefined);
  assert.equal(m.byBand['cr11-16'], 1);
  assert.equal(m.byBand.none, 1);
  assert.equal(m.byType.dragon, 1);
  assert.equal(m.traits.legendaryActions, 1);
  assert.equal(m.traits.fly, 1);
  assert.equal(m.traits.resistance, 1);
  assert.equal(m.traits.noLanguage, 2);
  assert.deepEqual(m.resistances, { fire: 1 });
  const gaps = m.gaps.map(g => `${g.what}: ${g.id}`);
  assert.ok(gaps.includes('challenge rating band: CR 1/8'));
  assert.ok(gaps.includes('creature type: fey'));
  assert.ok(gaps.includes('trait: damage threshold'));
  assert.ok(gaps.includes('size: tiny'));
  assert.ok(!gaps.includes('creature type: dragon'));
  assert.ok(!gaps.includes('trait: flying speed'));
});

test('readMonsters pages through a pack and names missing packs', async () => {
  const pages = [];
  const fetch = async (
    /** @type {string} */ packId,
    /** @type {number} */ from,
    /** @type {number} */ count
  ) => {
    pages.push(`${packId}:${from}`);
    if (packId === 'gone.pack') return { installed: false, total: 0, entries: [] };
    const all = [1, 2, 3, 4, 5].map(n => row({ id: `m${n}` }));
    return {
      installed: true,
      total: 5,
      skipped: { vehicle: 2 },
      entries: all.slice(from, from + count),
    };
  };
  const r = await readMonsters(['a.pack', 'gone.pack'], fetch, 2);
  assert.equal(r.rows.length, 5);
  assert.deepEqual(r.missing, ['gone.pack']);
  assert.deepEqual(pages, ['a.pack:0', 'a.pack:2', 'a.pack:4', 'gone.pack:0']);
  assert.deepEqual(r.perPack['a.pack'], { total: 5, skipped: { vehicle: 2 } });
});

/* ---------- the data every creature needs ---------- */

test('judgeRow: a good creature has no problem, a bad one has CONTENT problems', () => {
  assert.deepEqual(judgeRow(row()), []);
  const bad = judgeRow(
    row({ cr: 31, creatureType: 'blob', size: 'gigantic', hp: 0, ac: 0, items: 0 })
  );
  assert.deepEqual(
    bad.map(p => p.what),
    [
      'no valid challenge rating',
      'unknown creature type',
      'no hit points',
      'no armor class',
      'no items',
      'unknown size',
    ]
  );
  assert.ok(bad.every(p => p.kind === 'CONTENT'));
  // Every evidence ends with the monster's pack, so a known entry can name the pack it covers.
  assert.ok(bad.every(p => p.evidence.endsWith('; in p.m')));
  assert.equal(bad[1].evidence, 'Wolf: "blob"; in p.m');
  // A challenge rating 0 creature may carry nothing at all (a mount); above 0 it is a problem.
  assert.deepEqual(judgeRow(row({ cr: 0, items: 0 })), []);
  assert.deepEqual(
    judgeRow(row({ cr: 0.125, items: 0 })).map(p => p.what),
    ['no items']
  );
});

test('judgeRow: a stat block with no challenge rating is only held to its pools and its movement', () => {
  const block = row({ cr: null, creatureType: 'custom', hp: 0, ac: 0, items: 0 });
  assert.ok(isStatBlock(block));
  // The legacy pack marks them by an empty type and no hit points, with a rating of 0.
  assert.ok(isStatBlock(row({ cr: 0, creatureType: '', hp: 0 })));
  assert.ok(!isStatBlock(row({ cr: 0 })));
  assert.deepEqual(judgeRow(block), []);
  const hover = row({
    cr: null,
    movement: { walk: 0, fly: 0, swim: 0, burrow: 0, climb: 0, hover: true, units: 'ft' },
  });
  assert.deepEqual(judgeRow(hover), []);
  assert.equal(judgeRow(row({ movement: hover.movement }))[0].what, 'hover without a fly speed');
});

test('judgeRow: a legendary pool needs legendary actions and the other way round', () => {
  assert.equal(judgeRow(row({ legact: 3 }))[0].what, 'legendary pool without legendary actions');
  const odd = row().odd;
  assert.equal(
    judgeRow(row({ odd: { ...odd, legendaryActivities: 2 } }))[0].what,
    'legendary actions without a pool'
  );
  assert.deepEqual(judgeRow(row({ legact: 3, odd: { ...odd, legendaryActivities: 2 } })), []);
});

/* ---------- the broad pass ---------- */

test('planMonsterUse prefers an attack on an action, then other attacks, other actions, spells', () => {
  const spell = item({
    id: 's',
    name: 'Fire Bolt',
    type: 'spell',
    activities: [activity({ id: 's1', type: 'attack' })],
  });
  const multi = item({
    id: 'm',
    name: 'Multiattack',
    type: 'feat',
    activities: [activity({ id: 'm1', type: 'utility' })],
  });
  const bite = item({ id: 'b', name: 'Bite' });
  const react = item({
    id: 'r',
    name: 'Parry',
    type: 'feat',
    activities: [activity({ id: 'r1', type: 'attack', activation: 'reaction' })],
  });
  const pick = (/** @type {any[]} */ items) => planMonsterUse(facts({ items })).planned?.item.name;
  assert.equal(pick([spell, multi, bite]), 'Bite');
  assert.equal(pick([spell, multi, react]), 'Parry');
  assert.equal(pick([spell, multi]), 'Multiattack');
  assert.equal(pick([spell]), 'Fire Bolt');
  assert.equal(planMonsterUse(facts({ items: [] })).planned, null);
});

test('planMonsterUse leaves out dialogs, legendary and lair actions, cannot-use and exhaustion', () => {
  const items = [
    item({
      id: 'x',
      name: 'Summoner',
      activities: [
        activity({ id: '1', type: 'summon' }),
        activity({ id: '2', type: 'cast' }),
        activity({ id: '3', canUse: false }),
        activity({ id: '4', activation: 'legendary' }),
        activity({ id: '5', activation: 'lair' }),
        activity({
          id: '6',
          consumption: [{ type: 'attribute', target: 'attributes.exhaustion', value: '1' }],
        }),
      ],
    }),
  ];
  const plan = planMonsterUse(facts({ items }));
  assert.equal(plan.planned, null);
  assert.equal(plan.skipped.length, 6);
  assert.equal(plan.candidates, 0);
});

test('judgeNoAction: nothing usable is CONTENT, except a stat block or a CR 0 creature with no activities at all', () => {
  const none = facts({ items: [item({ id: 'p', name: 'Water Breathing', activities: [] })] });
  const plan = planMonsterUse(none);
  assert.equal(plan.planned, null);
  // A Sea Horse: challenge rating 0 and not one activity: nothing to do by design.
  assert.deepEqual(judgeNoAction(row({ cr: 0 }), none, plan), []);
  // A stat block (no challenge rating) is never held to it.
  assert.deepEqual(judgeNoAction(row({ cr: null }), none, plan), []);
  // The same creature at challenge rating 1 lost its actions on the way in.
  const lost = judgeNoAction(row({ cr: 1, name: 'Wolf' }), none, plan);
  assert.deepEqual(
    lost.map(p => [p.kind, p.what]),
    [['CONTENT', 'no action to use']]
  );
  assert.match(lost[0].evidence, /^Wolf: 1 items, 0 activities left out/);
  // A CR 0 creature whose only activities were all left out is still CONTENT.
  const dialogs = facts({
    items: [item({ id: 'x', name: 'Summon', activities: [activity({ id: '1', type: 'summon' })] })],
  });
  const left = planMonsterUse(dialogs);
  assert.equal(judgeNoAction(row({ cr: 0 }), dialogs, left).length, 1);
  // Planned: never a problem.
  const bite = facts({ items: [item({ id: 'b', name: 'Bite' })] });
  assert.deepEqual(judgeNoAction(row({ cr: 0 }), bite, planMonsterUse(bite)), []);
});

test('judgeCopy: a copy that differs from the compendium entry is SYSTEM; a matching one is clean', () => {
  const r = row({ items: 1 });
  const f = facts();
  assert.deepEqual(judgeCopy(r, f), []);
  const changed = facts({
    hp: { value: 5, max: 5 },
    npc: { ...f.npc, movement: { ...f.npc.movement, fly: 30 } },
  });
  const problems = judgeCopy(r, changed);
  assert.deepEqual(
    problems.map(p => p.kind),
    ['SYSTEM', 'SYSTEM']
  );
  assert.match(problems[0].evidence, /hit point maximum is 5/);
  assert.equal(judgeCopy(r, facts({ npc: undefined }))[0].kind, 'KIT');
});

test('judgeBridge: the bridge must agree; a spell-less monster shown with spells is only a note', () => {
  const r = row();
  const reply = {
    type: 'npc',
    stats: {
      challengeRating: 0.25,
      creatureType: 'beast',
      size: 'med',
      hitPoints: { max: 11 },
      armorClass: 13,
    },
  };
  assert.deepEqual(judgeBridge(r, reply), []);
  const notes = /** @type {string[]} */ ([]);
  assert.deepEqual(
    judgeBridge(
      r,
      { ...reply, stats: { ...reply.stats, spellcasting: { hasSpells: true } } },
      notes
    ),
    []
  );
  assert.equal(notes.length, 1);
  const wrong = judgeBridge(r, { ...reply, stats: { ...reply.stats, hitPoints: { max: 9 } } });
  assert.equal(wrong[0].kind, 'SYSTEM');
  // No creature type at all (the SRD Unseen Servant): "" in Foundry, left out by the bridge: no problem.
  assert.deepEqual(
    judgeBridge(row({ creatureType: '' }), {
      ...reply,
      stats: { ...reply.stats, creatureType: undefined },
    }),
    []
  );
  // Spells the bridge does not show are a problem.
  const caster = row({ spell: { spells: 2, ability: '', innate: false, dc: 0 } });
  assert.match(judgeBridge(caster, reply)[0].evidence, /has spells is false/);
  // The legendary pool.
  const boss = row({ legact: 3 });
  assert.match(judgeBridge(boss, reply)[0].evidence, /legendary actions/);
  const shown = {
    ...reply,
    stats: { ...reply.stats, legendaryActions: { available: 3, max: 3 } },
  };
  assert.deepEqual(judgeBridge(boss, shown), []);
  // A stat block has no rating on the bridge either.
  assert.deepEqual(
    judgeBridge(row({ cr: null }), { type: 'npc', stats: { size: 'med', challengeRating: null } }),
    []
  );
});

/* ---------- the odd checks, on their own ---------- */

/**
 * Runs one check with a stub GM and bridge.
 * @param {string} id @param {any} r @param {any} f
 * @param {{use?: (args: any) => any, recharge?: any, reply?: any}} [stub]
 */
async function runCheck(id, r, f, stub = {}) {
  const check = /** @type {any} */ (ODD_CHECKS.find(c => c.id === id));
  return check.run({
    row: r,
    actorId: 'x1',
    facts: f,
    call: async (/** @type {string} */ action, /** @type {any} */ args) => {
      if (action === 'exerciseActor' && args.op === 'recharge') return stub.recharge;
      if (action === 'exerciseActor') {
        return stub.use
          ? stub.use(args)
          : {
              ok: true,
              chatCard: true,
              uses: { before: 0, after: 0, max: 0 },
              restored: true,
              changed: {},
            };
      }
      throw new Error(`unexpected ${action}`);
    },
    tool: async () => stub.reply ?? {},
  });
}

const bossFacts = (/** @type {any[]} */ acts) =>
  facts({
    items: [item({ id: 'l', name: 'Sweep', type: 'feat', activities: acts })],
    npc: {
      ...facts().npc,
      resources: { legact: { max: 3, spent: 0 }, legres: null, lair: null },
    },
  });
const bossRow = row({
  legact: 3,
  odd: { ...row().odd, legendaryActivities: 1 },
});
const shown = { stats: { legendaryActions: { available: 3, max: 3 } } };

test('legendary-actions: a legendary action that spends the pool is clean', async () => {
  const f = bossFacts([
    activity({
      activation: 'legendary',
      activationValue: 1,
      consumption: [{ type: 'attribute', target: 'resources.legact.value', value: '1' }],
    }),
  ]);
  const r = await runCheck('legendary-actions', bossRow, f, {
    reply: shown,
    use: () => ({
      ok: true,
      chatCard: true,
      uses: { before: 0, after: 0, max: 0 },
      restored: true,
      changed: { 'resources.legact.spent': { before: 0, after: 1 } },
    }),
  });
  assert.deepEqual(r.problems, []);
});

test('legendary-actions: the check asks for action consumption, so a no-target action that spends is clean', async () => {
  const none = bossFacts([activity({ activation: 'legendary', activationValue: 1 })]);
  /** @type {any[]} */
  const calls = [];
  const r = await runCheck('legendary-actions', bossRow, none, {
    reply: shown,
    use: args => {
      calls.push(args);
      return {
        ok: true,
        chatCard: true,
        uses: { before: 0, after: 0, max: 0 },
        restored: true,
        // What the system does when the action is consumed (dnd5e 6, _prepareUsageUpdates).
        changed: args.consumeAction ? { 'resources.legact.spent': { before: 0, after: 1 } } : {},
      };
    },
  });
  assert.deepEqual(r.problems, []);
  assert.equal(calls[0].consumeAction, true);
  assert.match(r.notes[0], /1 spend the pool \(0 by a target, 1 by the action\)/);
});

test('legendary-actions: an action that spends nothing, or the wrong amount, is SYSTEM', async () => {
  const none = bossFacts([activity({ activation: 'legendary', activationValue: 1 })]);
  const r1 = await runCheck('legendary-actions', bossRow, none, { reply: shown });
  assert.equal(r1.problems[0].kind, 'SYSTEM');
  assert.match(r1.problems[0].what, /did not spend the pool/);
  const target = bossFacts([
    activity({
      activation: 'legendary',
      activationValue: 1,
      consumption: [{ type: 'attribute', target: 'resources.legact.value', value: '1' }],
    }),
  ]);
  const r2 = await runCheck('legendary-actions', bossRow, target, { reply: shown });
  assert.equal(r2.problems[0].kind, 'SYSTEM');
  const r3 = await runCheck('legendary-actions', bossRow, target, {
    reply: shown,
    use: () => ({
      ok: true,
      chatCard: true,
      uses: { before: 0, after: 0, max: 0 },
      restored: true,
      changed: { 'resources.legact.spent': { before: 0, after: 2 } },
    }),
  });
  assert.match(r3.problems[0].what, /spent the wrong amount/);
});

test('legendary-actions: the bridge must show the pool, and a pool with no legendary action is CONTENT', async () => {
  const f = bossFacts([]);
  const r = await runCheck('legendary-actions', bossRow, f, {
    reply: { stats: { legendaryActions: { available: 2, max: 3 } } },
  });
  assert.deepEqual(
    r.problems.map(p => `${p.kind} ${p.what}`),
    ['SYSTEM the bridge does not show the pool', 'CONTENT no legendary action to use']
  );
});

test('legendary-resistance: the feature must spend one use', async () => {
  const feature = item({
    id: 'lr',
    name: 'Legendary Resistance (3/Day)',
    type: 'feat',
    activities: [
      activity({
        type: 'utility',
        activation: 'special',
        consumption: [{ type: 'attribute', target: 'resources.legres.value', value: '1' }],
      }),
    ],
  });
  const f = facts({
    items: [feature],
    npc: { ...facts().npc, resources: { legact: null, legres: { max: 3, spent: 0 }, lair: null } },
  });
  const r3 = row({ legres: 3 });
  const ok = await runCheck('legendary-resistance', r3, f, {
    use: () => ({
      ok: true,
      chatCard: true,
      uses: { before: 0, after: 0, max: 0 },
      restored: true,
      changed: { 'resources.legres.spent': { before: 0, after: 1 } },
    }),
  });
  assert.deepEqual(ok.problems, []);
  const none = await runCheck('legendary-resistance', r3, f);
  assert.equal(none.problems[0].kind, 'SYSTEM');
  const missing = await runCheck('legendary-resistance', r3, facts({ items: [], npc: f.npc }));
  assert.equal(missing.problems[0].what, 'no legendary resistance feature');
});

test('lair-actions, regeneration, shapechangers: notes and problems', async () => {
  const lair = await runCheck(
    'lair-actions',
    row({ lair: true }),
    facts({
      npc: {
        ...facts().npc,
        resources: {
          legact: null,
          legres: null,
          lair: { value: true, initiative: 40, inside: false },
        },
      },
    })
  );
  assert.equal(lair.problems[0].what, 'odd lair initiative count');
  const lost = await runCheck('lair-actions', row({ lair: true }), facts());
  assert.equal(lost.problems[0].what, 'the lair flag is lost');
  const regen = await runCheck(
    'regeneration',
    row(),
    facts({ items: [item({ name: 'Regeneration', type: 'feat', activities: [] })] })
  );
  assert.deepEqual(regen.problems, []);
  assert.match(regen.notes[0], /text only/);
  const shape = await runCheck(
    'shapechangers',
    row(),
    facts({
      items: [
        item({
          name: 'Change Shape',
          type: 'feat',
          activities: [activity({ type: 'transform', canUse: false })],
        }),
      ],
    })
  );
  assert.equal(shape.problems[0].what, 'a transform activity cannot be used');
});

test('movement-modes: a speed that changed in the copy is SYSTEM, hover with no fly is CONTENT', async () => {
  const flyer = row({
    movement: { walk: 30, fly: 60, swim: 0, burrow: 0, climb: 0, hover: false, units: 'ft' },
  });
  const f = facts({
    npc: {
      ...facts().npc,
      movement: { walk: 30, fly: 30, swim: 0, burrow: 0, climb: 0, hover: false },
      movementSource: { walk: 30, fly: 60, swim: 0, burrow: 0, climb: 0, hover: false },
    },
  });
  const r = await runCheck('movement-modes', flyer, f);
  assert.deepEqual(
    r.problems.map(p => p.what),
    ['a movement speed changed in the copy']
  );
  const hover = row({
    movement: { walk: 30, fly: 0, swim: 0, burrow: 0, climb: 0, hover: true, units: 'ft' },
  });
  const h = await runCheck(
    'movement-modes',
    hover,
    facts({
      npc: {
        ...facts().npc,
        movement: { walk: 30, fly: 0, swim: 0, burrow: 0, climb: 0, hover: true },
        movementSource: { walk: 30, fly: 0, swim: 0, burrow: 0, climb: 0, hover: true },
      },
    })
  );
  assert.deepEqual(
    h.problems.map(p => p.what),
    ['hover without flying']
  );
});

test('judgeRecharge: a roll must agree with the target and the uses must follow it', () => {
  const good = {
    target: 5,
    max: 1,
    rolls: [
      { total: 6, success: true, spentBefore: 1, spentAfter: 0 },
      { total: 2, success: false, spentBefore: 1, spentAfter: 1 },
    ],
  };
  assert.deepEqual(judgeRecharge('Dragon', 'Breath', good), []);
  const bad = {
    target: 5,
    max: 1,
    rolls: [
      { total: 3, success: true, spentBefore: 1, spentAfter: 0 },
      { total: 5, success: true, spentBefore: 1, spentAfter: 1 },
      { total: null, success: null, spentBefore: 1, spentAfter: 1 },
    ],
  };
  const problems = judgeRecharge('Dragon', 'Breath', bad);
  assert.deepEqual(
    problems.map(p => p.what),
    [
      'the recharge roll disagrees with its target',
      'the uses did not follow the recharge roll',
      'the uses did not follow the recharge roll',
      'no recharge roll',
    ]
  );
});

test('recharge, multiattack and spellcasting checks: the data problems they name', async () => {
  const breath = item({
    id: 'br',
    name: 'Breath',
    type: 'feat',
    uses: {
      max: 0,
      spent: 0,
      recovery: [{ period: 'recharge', type: 'recoverAll', formula: 'x' }],
    },
    activities: [],
  });
  const rc = await runCheck('recharge', row(), facts({ items: [breath] }), {
    recharge: { target: 5, max: 1, rolls: [], restored: true },
  });
  assert.deepEqual(
    rc.problems.map(p => p.what),
    ['odd recharge target', 'a recharge ability with no uses']
  );
  const ma = await runCheck(
    'multiattack',
    row(),
    facts({ items: [item({ name: 'Multiattack', type: 'feat', activities: [] })] })
  );
  assert.deepEqual(
    ma.problems.map(p => p.what),
    ['multiattack and no attack', 'multiattack cannot be used']
  );
  const sc = await runCheck(
    'innate-spellcasting',
    row({ spell: { spells: 1, ability: '', innate: false, dc: 0 } }),
    facts({ npc: { ...facts().npc, spell: { ability: '', dc: 0 } } }),
    { reply: { stats: {} } }
  );
  assert.deepEqual(
    sc.problems.map(p => p.what),
    ['spells and no spellcasting ability', 'spells and no save DC', 'the bridge shows no spells']
  );
});

test('runOddCheck: a probe is always deleted, also when the check throws', async () => {
  const calls = /** @type {string[]} */ ([]);
  const io = {
    call: async (/** @type {string} */ action, /** @type {any} */ args) => {
      calls.push(action);
      if (action === 'createMonster') return { actorId: 'probe1' };
      if (action === 'inspectFeatures') return facts();
      return {};
    },
    tool: async () => ({}),
  };
  const boom = {
    id: 'boom',
    title: '',
    none: '',
    applies: () => true,
    run: async () => {
      throw new Error('kaboom');
    },
  };
  const r = await runOddCheck(boom, [row()], io);
  assert.deepEqual(calls, ['createMonster', 'inspectFeatures', 'deleteMonsters']);
  assert.equal(r.failed[0].problems[0].kind, 'KIT');
  assert.match(r.failed[0].problems[0].evidence, /kaboom/);
  // The monster's pack ends every evidence, for the known list.
  assert.match(r.failed[0].problems[0].evidence, /; in p\.m$/);
  const content = {
    ...boom,
    run: async () => ({
      problems: [{ kind: 'CONTENT', what: 'x', evidence: 'Wolf: the feature has no activity to use' }],
      notes: [],
    }),
  };
  const r2 = await runOddCheck(content, [row()], io);
  assert.equal(r2.failed[0].problems[0].evidence, 'Wolf: the feature has no activity to use; in p.m');
});

test('pickOddRows: smoke takes two per check and one per movement mode; full takes all', () => {
  const rows = [
    row({ id: '1', name: 'A', legres: 3 }),
    row({ id: '2', name: 'B', legres: 3 }),
    row({ id: '3', name: 'C', legres: 3 }),
    row({
      id: '4',
      name: 'D',
      movement: { walk: 30, fly: 30, swim: 20, burrow: 0, climb: 0, hover: true, units: 'ft' },
    }),
    row({
      id: '5',
      name: 'E',
      movement: { walk: 30, fly: 30, swim: 0, burrow: 10, climb: 0, hover: false, units: 'ft' },
    }),
  ];
  const legres = /** @type {any} */ (ODD_CHECKS.find(c => c.id === 'legendary-resistance'));
  assert.deepEqual(
    pickOddRows(legres, rows, 'smoke').map(m => m.name),
    ['A', 'C']
  );
  assert.equal(pickOddRows(legres, rows, 'full').length, 3);
  const move = /** @type {any} */ (ODD_CHECKS.find(c => c.id === 'movement-modes'));
  assert.deepEqual(
    pickOddRows(move, rows, 'smoke').map(m => m.name),
    ['D', 'E']
  );
});

/* ---------- the scenarios against the fake ---------- */

/**
 * Builds a smoke kit on the fake, lets `damage` break something and runs the monster scenarios.
 * @param {(world: import('../lib/fake/state.mjs').World, manifest: any) => void} damage
 * @param {'smoke'|'full'|'long'} [size]
 */
async function runMonsters(damage, size = 'smoke') {
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
      size,
      only: ['monsters-every', 'monsters-matrix', 'monsters-odd'],
      catalog,
    });
    const { results } = await runScenariosDetailed(scenarios, {
      dashboard,
      gm: fake.gm,
      manifest,
      fake: true,
      size,
    });
    return {
      results: Object.fromEntries(results.map(r => [r.id, r])),
      probesLeft: [...fake.world.actors.values()].filter(a => a.name.startsWith('Probe ')).length,
    };
  } finally {
    await fake.close();
  }
}

const coverage = (/** @type {any} */ result) =>
  /** @type {any} */ (
    result.attachments.find((/** @type {any} */ a) => a.name === 'coverage')?.data
  );

test('monsters-*: against the fake all three pass and say what they covered', async () => {
  const { results: r, probesLeft } = await runMonsters(() => {});
  assert.equal(r['monsters-matrix'].status, 'pass');
  assert.equal(r['monsters-every'].status, 'pass');
  assert.equal(r['monsters-odd'].status, 'pass');
  assert.equal(probesLeft, 0, 'every probe copy is deleted again');
  const every = coverage(r['monsters-every']);
  assert.equal(
    every.monstersInProfile,
    20,
    '12 in the first pack, 7 odd ones, one in the legacy pack'
  );
  assert.ok(every.monstersProbed < every.monstersInProfile, 'smoke takes a sample');
  assert.equal(every.monstersFailed, 0);
  assert.equal(every.bridgeChecked, every.monstersProbed);
  const odd = coverage(r['monsters-odd']);
  assert.equal(odd.checks, ODD_CHECKS.length);
  assert.deepEqual(odd.checksSkipped, [
    'damage-threshold: the profile has no monster with a damage threshold',
  ]);
  const matrix = /** @type {any} */ (
    r['monsters-matrix'].attachments.find((/** @type {any} */ a) => a.name === 'matrix')?.data
  );
  assert.equal(matrix.total, 20);
  assert.equal(matrix.statBlocks, 1);
  assert.ok(matrix.gaps.some((/** @type {any} */ g) => g.id === 'damage threshold'));
});

test('monsters-every on full: every monster is probed', async () => {
  const { results: r } = await runMonsters(() => {}, 'full');
  const every = coverage(r['monsters-every']);
  assert.equal(every.monstersProbed, every.monstersInProfile);
  assert.equal(every.monstersFailed, 0);
  assert.equal(r['monsters-every'].status, 'pass');
  assert.equal(r['monsters-odd'].status, 'pass');
});

test('monsters-every: a use that throws, one that is not put back and one with no card each fail with the right class', async () => {
  const { results: r } = await runMonsters(world => {
    world.faults.quirks.set('Probe Troll|bite', 'throws');
    world.faults.quirks.set('Probe Umber Hulk|strike', 'drift');
    world.faults.quirks.set('Probe Water Elemental|strike', 'noCard');
  }, 'full');
  assert.equal(r['monsters-every'].status, 'fail');
  const failed = r['monsters-every'].steps.filter(s => s.status === 'fail');
  assert.deepEqual(failed.map(s => s.label.split(' (')[0]).sort(), [
    'Troll',
    'Umber Hulk',
    'Water Elemental',
  ]);
  const text = (/** @type {string} */ name) =>
    failed.find(s => s.label.startsWith(name))?.error?.message ?? '';
  assert.match(text('Troll'), /\[SYSTEM\] the activity threw/);
  assert.match(text('Umber Hulk'), /\[KIT\] the hero was not put back/);
  assert.match(text('Water Elemental'), /\[SYSTEM\] no chat card/);
  assert.deepEqual(coverage(r['monsters-every']).problemsByKind, { KIT: 1, CONTENT: 0, SYSTEM: 2 });
});

test('monsters-odd: a legendary action that does not spend the pool and a wrong recharge fail', async () => {
  const { results: r } = await runMonsters(world => {
    world.faults.quirks.set('Probe Vampire|tail-sweep', 'noPool');
    world.faults.quirks.set('Probe Young Red Dragon|breath-weapon', 'badRecharge');
  }, 'full');
  const odd = r['monsters-odd'];
  assert.equal(odd.status, 'fail');
  const failed = odd.steps.filter(s => s.status === 'fail').map(s => s.label.split(':')[0]);
  assert.deepEqual(failed.sort(), ['legendary-actions', 'recharge']);
  const legendary = odd.steps.find(s => s.label.startsWith('legendary-actions'));
  assert.match(
    legendary?.error?.message ?? '',
    /Vampire.*\[SYSTEM\] a legendary action did not spend the pool/
  );
  const recharge = odd.steps.find(s => s.label.startsWith('recharge'));
  assert.match(recharge?.error?.message ?? '', /the uses did not follow the recharge roll/);
});

test('the fake: a legendary action with no target spends the pool only when the action is consumed; deleteMonsters refuses a non-probe', async () => {
  const fake = await startFake({ world: WORLD });
  try {
    const list = await fake.gm.call('listMonsters', { packId: 'dnd5e.actors24' });
    const dragon = list.entries.find((/** @type {any} */ e) => e.name === 'Vampire');
    const made = await fake.gm.call('createMonster', { packId: dragon.packId, itemId: dragon.id });
    const facts = await fake.gm.call('inspectFeatures', { actorId: made.actorId });
    const buffet = facts.items.find((/** @type {any} */ i) => i.name === 'Wing Buffet');
    assert.equal(buffet.activities[0].consumption.length, 0);
    const use = (/** @type {any} */ extra) =>
      fake.gm.call('exerciseActor', {
        actorId: made.actorId,
        op: 'use',
        itemId: buffet.id,
        activityId: buffet.activities[0].id,
        ...extra,
      });
    assert.deepEqual((await use({})).changed, {});
    assert.deepEqual((await use({ consumeAction: true })).changed, {
      'resources.legact.spent': { before: 0, after: 1 },
    });
    // A hero (not a probe) is never deleted.
    fake.world.actors.set('hero1', {
      id: 'hero1',
      name: 'Kit Hero',
      type: 'character',
      hp: { value: 1, max: 1, temp: 0 },
      items: [],
      cr: 0,
      creatureType: 'humanoid',
      size: 'med',
      level: 1,
    });
    const gone = await fake.gm.call('deleteMonsters', { actorIds: ['hero1', made.actorId] });
    assert.deepEqual(gone, { deleted: 1, refused: ['hero1'] });
    assert.ok(fake.world.actors.has('hero1'));
  } finally {
    await fake.close();
  }
});
