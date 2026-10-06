/**
 * The fake's monster GM actions: listMonsters, createMonster, deleteMonsters, and the monster side
 * of inspectFeatures and exerciseActor. The creatures are the fake compendium's (compendium.mjs);
 * a probe copy is a fake actor with a `sheet.monster` (its items and pools). Like the other fake
 * actions it never changes a probe in a way that needs restoring: a use only reports what it
 * would change. A test breaks something with `world.faults.quirks` ("<actor name>|<item
 * identifier>" -> throws, noCard, noConsume, drift, refuse, noPool, badRecharge).
 */
import { expectedSpend } from '../features.mjs';
import {
  CREATURES,
  SIZE_CODE,
  monsterAc,
  monsterItems,
  monsterResources,
  monsterRow,
} from './compendium.mjs';
import { ToolFailure, newId, roll } from './state.mjs';

/** @typedef {import('./state.mjs').World} World */

/** Packs the fake has monsters in. */
const MONSTER_PACKS = ['dnd5e.actors24', 'dnd5e.monsters'];

/**
 * @param {World} _w
 * @param {{packId: string, from?: number, count?: number}} args
 */
export function fakeListMonsters(_w, args) {
  if (!MONSTER_PACKS.includes(args.packId)) {
    return { packId: args.packId, installed: false, total: 0, skipped: {}, from: 0, entries: [] };
  }
  const here = CREATURES.filter(c => c.pack === args.packId);
  /** @type {Record<string, number>} */
  const skipped = {};
  const npcs = here.filter(c => {
    // The leveled ids are characters in the real pack.
    if (/Lv[0-9]/.test(c.id)) {
      skipped.character = (skipped.character ?? 0) + 1;
      return false;
    }
    return true;
  });
  npcs.sort((a, b) => a.name.localeCompare(b.name, 'en') || (a.id < b.id ? -1 : 1));
  const from = Math.max(0, Number(args.from ?? 0));
  const count = Math.max(1, Number(args.count ?? 100));
  return {
    packId: args.packId,
    installed: true,
    total: npcs.length,
    skipped,
    from,
    entries: npcs.slice(from, from + count).map(monsterRow),
  };
}

/**
 * @param {World} w
 * @param {{packId: string, itemId: string, name?: string}} args
 */
export function fakeCreateMonster(w, args) {
  const c = CREATURES.find(x => x.pack === args.packId && x.id === args.itemId);
  if (!c) throw new ToolFailure(`createMonster: no entry ${args.packId} ${args.itemId}`);
  const id = newId(w, 'prb');
  const items = monsterItems(c, id);
  w.actors.set(id, {
    id,
    name: args.name ?? `Probe ${c.name}`,
    type: 'npc',
    hp: { value: c.hp, max: c.hp, temp: 0 },
    items: items.map(i => ({ id: i.id, name: i.name, type: i.type })),
    cr: c.statBlock ? null : c.cr,
    creatureType: c.statBlock ? 'custom' : c.type,
    size: SIZE_CODE[/** @type {keyof typeof SIZE_CODE} */ (c.size)],
    level: 0,
    sheet: { monster: { creature: c, row: monsterRow(c), items, resources: monsterResources(c) } },
  });
  return { actorId: id, name: w.actors.get(id)?.name };
}

/**
 * @param {World} w
 * @param {{actorIds: string[]}} args
 */
export function fakeDeleteMonsters(w, args) {
  let deleted = 0;
  /** @type {string[]} */
  const refused = [];
  for (const id of args.actorIds ?? []) {
    const actor = w.actors.get(id);
    if (!actor) continue;
    if (!actor.sheet?.monster) {
      refused.push(id);
      continue;
    }
    w.actors.delete(id);
    deleted += 1;
  }
  return { deleted, refused };
}

/**
 * inspectFeatures of a probe copy.
 * @param {World} w
 * @param {{actorId: string}} args
 */
export function fakeInspectMonster(w, args) {
  const actor = w.actors.get(args.actorId);
  const m = actor?.sheet?.monster;
  if (!actor || !m) throw new ToolFailure(`inspectFeatures: no actor ${args.actorId}`);
  const row = m.row;
  const mv = row.movement;
  const speeds = {
    walk: mv.walk,
    fly: mv.fly,
    swim: mv.swim,
    burrow: mv.burrow,
    climb: mv.climb,
    hover: mv.hover,
  };
  return {
    name: actor.name,
    level: 0,
    prof: 2,
    ac: { value: row.ac, calc: 'default', armor: false },
    hd: { value: 0, max: 0, classes: [] },
    hp: { value: actor.hp.value, max: actor.hp.max },
    abilities: {},
    spells: {},
    scale: {},
    items: m.items,
    npc: {
      cr: row.cr,
      creatureType: row.creatureType,
      size: row.size,
      ac: row.ac,
      movement: speeds,
      movementSource: speeds,
      resources: m.resources,
      spell: { ability: row.spell.ability, dc: row.spell.dc },
    },
  };
}

/**
 * exerciseActor on a probe copy: it reports what a use or a recharge roll would do and changes nothing.
 * @param {World} w
 * @param {any} args
 */
export function fakeExerciseMonster(w, args) {
  const actor = w.actors.get(args.actorId);
  const m = actor?.sheet?.monster;
  if (!actor || !m) throw new ToolFailure(`exerciseActor: no actor ${args.actorId}`);
  if (args.op === 'recharge') {
    const item = m.items.find((/** @type {any} */ i) => i.id === args.itemId);
    const recovery = item?.uses?.recovery.find((/** @type {any} */ r) => r.period === 'recharge');
    if (!item || !recovery) throw new ToolFailure(`exerciseActor: no recharge on ${args.itemId}`);
    const target = parseInt(recovery.formula, 10);
    const max = item.uses.max;
    const quirk = w.faults.quirks.get(`${actor.name}|${item.identifier}`) ?? '';
    const rolls = [];
    for (let i = 0; i < Math.max(1, Number(args.rolls ?? 6)); i += 1) {
      const total = roll(w, 6);
      const success = total >= target;
      rolls.push({
        total,
        success,
        spentBefore: max,
        spentAfter: quirk === 'badRecharge' ? max : success ? 0 : max,
      });
    }
    return { target, max, rolls, restored: true, drift: [] };
  }
  if (args.op !== 'use') throw new ToolFailure(`exerciseActor: unknown op "${args.op}"`);
  /** @type {import('../features.mjs').FeatureItem | undefined} */
  const item = m.items.find((/** @type {any} */ i) => i.id === args.itemId);
  const activity = item?.activities.find(a => a.id === args.activityId);
  if (!item || !activity)
    throw new ToolFailure(`exerciseActor: no activity ${args.itemId}/${args.activityId}`);
  const quirk = w.faults.quirks.get(`${actor.name}|${item.identifier}`) ?? '';
  const before = item.uses ? item.uses.spent : null;
  const { total } = expectedSpend(item, activity);
  const base = {
    notes: /** @type {Array<{level: string, message: string}>} */ ([]),
    threw: /** @type {string | null} */ (null),
    spells: {},
    effects: [],
    itemsCreated: 0,
    changed: {},
    restored: quirk !== 'drift',
    drift: quirk === 'drift' ? [`item ${item.name}`] : [],
  };
  if (quirk === 'throws') {
    return {
      ...base,
      ok: false,
      threw: 'Cannot read properties of undefined (reading "uses")',
      chatCard: false,
      uses: { before, after: before, max: item.uses?.max ?? null },
    };
  }
  if (
    quirk === 'refuse' ||
    (item.uses && item.uses.max !== null && (before ?? 0) + total > item.uses.max)
  ) {
    base.notes.push({
      level: 'error',
      message: `${item.name} does not have enough uses available`,
    });
    return {
      ...base,
      ok: false,
      chatCard: false,
      uses: { before, after: before, max: item.uses?.max ?? null },
    };
  }
  /** @type {Record<string, {before: number, after: number}>} */
  const changed = {};
  // A legendary activation with no target of its own spends the pool only when the action is consumed.
  if (
    activity.activation === 'legendary' &&
    args.consumeAction === true &&
    quirk !== 'noPool' &&
    !activity.consumption.some(c => c.target === 'resources.legact.value')
  ) {
    const was = m.resources.legact?.spent ?? 0;
    changed['resources.legact.spent'] = {
      before: was,
      after: was + (activity.activationValue ?? 1),
    };
  }
  for (const c of activity.consumption) {
    const pool = /^resources\.(legact|legres)\.value$/.exec(c.target)?.[1];
    if (c.type !== 'attribute' || !pool || quirk === 'noPool') continue;
    const was = m.resources[pool]?.spent ?? 0;
    changed[`resources.${pool}.spent`] = { before: was, after: was + Number(c.value) };
  }
  return {
    ...base,
    ok: true,
    chatCard: quirk !== 'noCard',
    uses: {
      before,
      after: before === null ? null : before + (quirk === 'noConsume' ? 0 : total),
      max: item.uses?.max ?? null,
    },
    changed,
  };
}

/** The bridge's get-character facts of a probe copy (additive to the fake's basic reply). @param {any} actor */
export function fakeMonsterStats(actor) {
  const m = actor.sheet?.monster;
  if (!m) return {};
  return {
    armorClass: monsterAc(m.creature),
    ...(m.resources.legact
      ? {
          legendaryActions: {
            available: m.resources.legact.max - m.resources.legact.spent,
            max: m.resources.legact.max,
          },
        }
      : {}),
    // Like the real adapter: any spellcasting ability counts, so every npc is shown with spells.
    spellcasting: { hasSpells: true, spellLevel: 0 },
  };
}
