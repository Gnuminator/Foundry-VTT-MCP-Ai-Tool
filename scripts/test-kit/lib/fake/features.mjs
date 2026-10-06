/**
 * The fake's features: for a few of the fake classes (the ones named like SRD classes) a handful of
 * features with uses, activities and recovery, in the shape of the GM action inspectFeatures, and
 * the fake's twins of inspectFeatures and exerciseActor. Numbers come from the same rules tables
 * the deep checks use (lib/features.mjs), so a clean fake run proves the plumbing, not the rules.
 * A test breaks something by changing the actor's `sheet.features` or by naming a quirk in
 * `world.faults.quirks` ("<actor name>|<feature identifier>" -> a quirk of exerciseActor).
 */
import { RULES, expectedAfterRest, expectedSpend, stepValue } from '../features.mjs';
import { ToolFailure } from './state.mjs';

/** @typedef {import('../features.mjs').FeatureItem} FeatureItem */

/** The default recovery of a class feature: all on a long rest, one on a short rest. */
const LONG_AND_SHORT = [
  { period: 'lr', type: 'recoverAll', formula: '' },
  { period: 'sr', type: 'formula', formula: '1' },
];
const SHORT_ONLY = [{ period: 'sr', type: 'recoverAll', formula: '' }];
const LONG_ONLY = [{ period: 'lr', type: 'recoverAll', formula: '' }];

/**
 * @param {string} actorId
 * @param {string} name
 * @param {string} identifier
 * @param {{uses?: {max: number, recovery: any[]}, activities?: Array<{type: string, name?: string, activation?: string, consumption?: Array<{type: string, target: string, value: string}>}>}} [o]
 * @returns {FeatureItem}
 */
function feat(actorId, name, identifier, o = {}) {
  return {
    id: `${actorId}.${identifier}`,
    name,
    type: 'feat',
    identifier,
    sourceUuid: null,
    equipped: false,
    uses: o.uses ? { max: o.uses.max, spent: 0, recovery: o.uses.recovery } : null,
    activities: (o.activities ?? []).map((a, i) => ({
      id: `act${i}`,
      type: a.type,
      name: a.name ?? '',
      activation: a.activation ?? 'bonus',
      canUse: true,
      consumption: a.consumption ?? [],
    })),
    effects: [],
  };
}

const ONE = [{ type: 'itemUses', target: '', value: '1' }];

/**
 * The features, scale values, armor class, hit dice and proficiency bonus of a fake hero.
 * @param {{identifier: string, name: string, hitDie: number}} k   the fake class
 * @param {number} level
 * @param {string} rules   '2024' or '2014'
 * @param {string} actorId
 */
export function fakeFeatures(k, level, rules, actorId) {
  /** @type {FeatureItem[]} */
  const items = [];
  /** @type {Record<string, unknown>} */
  const scale = {};
  const is2024 = rules === '2024';
  const add = (/** @type {string} */ name, /** @type {string} */ id, /** @type {any} */ o) =>
    items.push(feat(actorId, name, id, o));
  if (k.identifier === 'fighter') {
    const uses = stepValue(RULES.secondWind, level) ?? 2;
    add('Second Wind', 'second-wind', {
      uses: { max: is2024 ? uses : 1, recovery: is2024 ? LONG_AND_SHORT : SHORT_ONLY },
      activities: [{ type: 'heal', consumption: ONE }],
    });
    if (level >= 2) {
      add('Action Surge', 'action-surge', {
        uses: { max: stepValue(RULES.actionSurge, level) ?? 1, recovery: SHORT_ONLY },
        activities: [{ type: 'utility', activation: 'special', consumption: ONE }],
      });
    }
    if (level >= 5) add('Extra Attack', 'extra-attack', {});
    if (level >= 11) add('Two Extra Attacks', 'two-extra-attacks', {});
    if (level >= 20) add('Three Extra Attacks', 'three-extra-attacks', {});
  } else if (k.identifier === 'paladin') {
    add('Lay on Hands', 'lay-on-hands', {
      uses: { max: 5 * level, recovery: LONG_ONLY },
      activities: [
        { type: 'heal', consumption: ONE },
        {
          type: 'utility',
          name: 'Remove Poison',
          consumption: [{ type: 'itemUses', target: '', value: '5' }],
        },
      ],
    });
    if (level >= 2) add("Paladin's Smite", 'paladins-smite', {});
    if (level >= 5) add('Extra Attack', 'extra-attack', {});
    if (level >= 3) {
      add('Channel Divinity', 'channel-divinity-paladin', {
        uses: { max: stepValue(RULES.channelPaladin, level) ?? 2, recovery: LONG_AND_SHORT },
        activities: [{ type: 'utility', activation: 'action', consumption: ONE }],
      });
    }
  } else if (k.identifier === 'rogue') {
    add('Sneak Attack', 'sneak-attack', { activities: [{ type: 'damage', activation: '' }] });
    scale['sneak-attack'] = `${Math.ceil(level / 2)}d6`;
    if (level >= 2) {
      add('Cunning Action', 'cunning-action', {
        activities: [
          { type: 'utility', name: 'Dash' },
          { type: 'utility', name: 'Disengage' },
          { type: 'utility', name: 'Hide' },
        ],
      });
    }
  } else if (k.identifier === 'wizard') {
    add('Arcane Recovery', 'arcane-recovery', {
      uses: { max: 1, recovery: LONG_ONLY },
      activities: [{ type: 'utility', activation: 'special', consumption: ONE }],
    });
  } else if (k.identifier === 'warlock') {
    add('Eldritch Insight', 'eldritch-insight', {
      uses: { max: 1, recovery: SHORT_ONLY },
      activities: [{ type: 'utility', activation: 'action', consumption: ONE }],
    });
  } else if (k.identifier === 'cleric' && level >= 2) {
    add('Channel Divinity', 'channel-divinity-cleric', {
      uses: { max: stepValue(RULES.channelCleric, level) ?? 2, recovery: LONG_AND_SHORT },
      activities: [{ type: 'heal', activation: 'action', consumption: ONE }],
    });
  }
  return {
    prof: 2 + Math.floor((level - 1) / 4),
    ac: { value: 12, calc: 'default', armor: false },
    hd: {
      value: level,
      max: level,
      classes: [
        { identifier: k.identifier, denomination: `d${k.hitDie}`, levels: level, spent: 0 },
      ],
    },
    scale,
    items,
  };
}

/** @typedef {import('./state.mjs').World} World */

/**
 * The fake's inspectFeatures.
 * @param {World} w
 * @param {{actorId: string}} args
 */
export function fakeInspectFeatures(w, args) {
  const actor = w.actors.get(args.actorId);
  if (!actor || !actor.sheet?.features)
    throw new ToolFailure(`inspectFeatures: no actor ${args.actorId}`);
  const f = actor.sheet.features;
  /** @type {Record<string, any>} */
  const spells = {};
  for (const [key, slot] of Object.entries(actor.sheet.spells ?? {})) {
    const s = /** @type {any} */ (slot);
    spells[key] = {
      value: s.max,
      max: s.max,
      level: key === 'pact' ? s.level : Number(key.replace('spell', '')),
      type: key === 'pact' ? 'pact' : 'spell',
    };
  }
  const own = actor.items.map(i => ({
    id: i.id,
    name: i.name,
    type: i.type,
    identifier: i.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    sourceUuid: i.sourceUuid ?? null,
    equipped: false,
    uses: null,
    activities: [],
    effects: [],
  }));
  return {
    name: actor.name,
    level: actor.level,
    prof: f.prof,
    ac: f.ac,
    hd: f.hd,
    hp: { value: actor.hp.value, max: actor.hp.max },
    abilities: actor.sheet.abilities,
    spells,
    scale: {
      ...actor.sheet.scale,
      [actor.sheet.classes[0].identifier]: {
        ...(actor.sheet.scale[actor.sheet.classes[0].identifier] ?? {}),
        ...f.scale,
      },
    },
    items: [
      ...own,
      ...f.items.map((/** @type {FeatureItem} */ i) => ({
        ...i,
        activities: i.activities.map(a => ({
          id: a.id,
          type: a.type,
          name: a.name,
          activation: a.activation,
          canUse: a.canUse,
          consumption: a.consumption,
        })),
      })),
    ],
  };
}

/**
 * The fake's exerciseActor. It never changes the world, so there is nothing to restore; a quirk
 * ("<actor name>|<identifier>") makes a use misbehave for a test.
 * @param {World} w
 * @param {any} args
 */
export function fakeExerciseActor(w, args) {
  const actor = w.actors.get(args.actorId);
  if (!actor || !actor.sheet?.features)
    throw new ToolFailure(`exerciseActor: no actor ${args.actorId}`);
  const f = actor.sheet.features;
  if (args.op === 'use') {
    /** @type {FeatureItem | undefined} */
    const item = f.items.find((/** @type {FeatureItem} */ i) => i.id === args.itemId);
    const activity = item?.activities.find(a => a.id === args.activityId);
    if (!item || !activity)
      throw new ToolFailure(`exerciseActor: no activity ${args.itemId}/${args.activityId}`);
    const quirk = w.faults.quirks.get(`${actor.name}|${item.identifier}`) ?? '';
    const before = item.uses ? item.uses.spent : null;
    const { total } = expectedSpend(item, activity);
    const refused =
      quirk === 'refuse' ||
      (item.uses && item.uses.max !== null && item.uses.spent + total > item.uses.max);
    const base = {
      notes: /** @type {Array<{level: string, message: string}>} */ ([]),
      threw: /** @type {string | null} */ (null),
      spells: {},
      effects: [],
      itemsCreated: 0,
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
    if (refused) {
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
    const after = before === null ? null : before + (quirk === 'noConsume' ? 0 : total);
    return {
      ...base,
      ok: true,
      chatCard: quirk !== 'noCard',
      uses: { before, after, max: item.uses?.max ?? null },
    };
  }
  if (args.op === 'effect') throw new ToolFailure('the fake has no effects to switch on');
  if (args.op === 'rest') {
    const type = args.type === 'long' ? 'long' : 'short';
    /** @type {Record<string, any>} */
    const spells = {};
    for (const [key, slot] of Object.entries(actor.sheet.spells ?? {})) {
      spells[key] = {
        value: 0,
        max: /** @type {any} */ (slot).max,
        type: key === 'pact' ? 'pact' : 'spell',
      };
    }
    const afterSpend = {
      items: f.items
        .filter((/** @type {FeatureItem} */ i) => i.uses && i.uses.recovery.length && i.uses.max)
        .map((/** @type {FeatureItem} */ i) => ({
          id: i.id,
          name: i.name,
          max: /** @type {number} */ (i.uses?.max),
          spent: /** @type {number} */ (i.uses?.max),
          recovery: i.uses?.recovery ?? [],
        })),
      spells,
      hp: { value: 1, max: actor.hp.max },
      hd: { value: 0, max: f.hd.max },
    };
    const want = expectedAfterRest(afterSpend, type);
    const afterRest = {
      items: afterSpend.items.map((/** @type {any} */ i) => ({
        ...i,
        spent: want.items[i.id].spent ?? 0,
      })),
      spells: Object.fromEntries(
        Object.entries(spells).map(([key, s]) => [
          key,
          { ...s, value: w.faults.restNoPact && key === 'pact' ? 0 : want.spells[key] },
        ])
      ),
      hp: { value: want.hp, max: actor.hp.max },
      hd: { value: want.hdRises ? f.hd.max : 0, max: f.hd.max },
    };
    return { type, afterSpend, afterRest, restored: true, drift: [] };
  }
  throw new ToolFailure(`exerciseActor: unknown op "${args.op}"`);
}
