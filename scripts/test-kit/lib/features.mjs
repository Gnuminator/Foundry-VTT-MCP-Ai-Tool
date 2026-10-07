/**
 * The checks of the two feature scenarios, as pure functions (no Foundry, no I/O). The GM actions
 * `inspectFeatures` (what an actor has) and `exerciseActor` (use an activity, switch an effect on,
 * take a rest, always put the hero back as it was) are the only things that touch Foundry; the
 * scenarios call them and hand the results to the functions here.
 *
 * - `planUses` and `judgeUse` belong to heroes-features-use (every feature once).
 * - `DEEP_CHECKS` belongs to heroes-features-deep (about twenty rule checks).
 *
 * Every problem is classified like in advancement.mjs: KIT (our code or our check), CONTENT (the
 * imported data differs from the published rules table) or SYSTEM (dnd5e did something other than
 * its own data says). The RULES tables below are the independent oracle of the deep checks: class
 * tables of the 2024 SRD, written down by hand. A check that compares a number with a table only
 * applies to heroes of a 2024 class (`classRules` of the manifest row), because the 2014 tables
 * differ for a few classes.
 */

/** @typedef {import('./advancement.mjs').Problem} Problem */
/** @typedef {import('./advancement.mjs').FailureKind} FailureKind */

/**
 * @typedef {object} FeatureFacts what the GM action inspectFeatures returns
 * @property {string} name
 * @property {number} level
 * @property {number} prof
 * @property {{value: number, calc: string, armor: boolean}} ac
 * @property {{value: number, max: number, classes: Array<{identifier: string, denomination: string, levels: number, spent: number}>}} hd
 * @property {{value: number, max: number}} hp
 * @property {Record<string, {value: number, mod: number}>} abilities
 * @property {Record<string, {value: number, max: number, level?: number, type?: string}>} spells
 * @property {Record<string, Record<string, unknown>>} scale
 * @property {FeatureItem[]} items
 *
 * @typedef {object} FeatureItem
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {string | null} identifier
 * @property {string | null} sourceUuid
 * @property {boolean} equipped
 * @property {{max: number | null, spent: number, recovery: Array<{period: string, type: string, formula: string}>} | null} uses
 * @property {FeatureActivity[]} activities
 * @property {Array<{id: string, name: string, disabled: boolean, transfer: boolean, changes: Array<{key: string, value: string, type: string}>}>} effects
 *
 * @typedef {object} FeatureActivity
 * @property {string} id
 * @property {string} type
 * @property {string} name
 * @property {string} activation
 * @property {number | null} [activationValue]   the number of the activation, 1 for "1 legendary action" (additive)
 * @property {boolean} canUse
 * @property {Array<{type: string, target: string, value: string}>} consumption
 */

/* -------------------------------------------- */
/*  Rules tables (2024 SRD class tables)          */
/* -------------------------------------------- */

/**
 * The value of a step table at a level: the last row whose level is reached, else null.
 * @param {Array<[number, number]>} steps [level, value] rows, ascending
 * @param {number} level
 * @returns {number | null}
 */
export function stepValue(steps, level) {
  /** @type {number | null} */
  let value = null;
  for (const [from, v] of steps) if (level >= from) value = v;
  return value;
}

export const RULES = {
  /** Rages per long rest. */
  rageUses: /** @type {Array<[number, number]>} */ ([
    [1, 2],
    [3, 3],
    [6, 4],
    [12, 5],
    [17, 6],
  ]),
  /** The bonus to melee weapon damage while raging. */
  rageDamage: /** @type {Array<[number, number]>} */ ([
    [1, 2],
    [9, 3],
    [16, 4],
  ]),
  /** The Bardic Inspiration die (faces). */
  bardicDie: /** @type {Array<[number, number]>} */ ([
    [1, 6],
    [5, 8],
    [10, 10],
    [15, 12],
  ]),
  channelCleric: /** @type {Array<[number, number]>} */ ([
    [2, 2],
    [6, 3],
    [18, 4],
  ]),
  channelPaladin: /** @type {Array<[number, number]>} */ ([
    [3, 2],
    [11, 3],
  ]),
  wildShapeUses: /** @type {Array<[number, number]>} */ ([
    [2, 2],
    [6, 3],
    [17, 4],
  ]),
  secondWind: /** @type {Array<[number, number]>} */ ([
    [1, 2],
    [4, 3],
    [10, 4],
  ]),
  actionSurge: /** @type {Array<[number, number]>} */ ([
    [2, 1],
    [17, 2],
  ]),
  /** Pact Magic: slots, and the level of those slots. */
  pactSlots: /** @type {Array<[number, number]>} */ ([
    [1, 1],
    [2, 2],
    [11, 3],
    [17, 4],
  ]),
  pactLevel: /** @type {Array<[number, number]>} */ ([
    [1, 1],
    [3, 2],
    [5, 3],
    [7, 4],
    [9, 5],
  ]),
  /** Superiority dice (a subclass that has them, in both rules versions). */
  superiorityDice: /** @type {Array<[number, number]>} */ ([
    [3, 4],
    [7, 5],
    [15, 6],
  ]),
  /** The hit die of each class (faces). */
  hitDie: /** @type {Record<string, number>} */ ({
    barbarian: 12,
    fighter: 10,
    paladin: 10,
    ranger: 10,
    bard: 8,
    cleric: 8,
    druid: 8,
    monk: 8,
    rogue: 8,
    warlock: 8,
    sorcerer: 6,
    wizard: 6,
  }),
  /** How a class adds to the caster level: all of the level, or half of it. */
  casterKind: /** @type {Record<string, 'full' | 'half'>} */ ({
    bard: 'full',
    cleric: 'full',
    druid: 'full',
    sorcerer: 'full',
    wizard: 'full',
    paladin: 'half',
    ranger: 'half',
  }),
};

/** The slots of a single-class caster by caster level (index 0 is level 1). */
const SLOT_TABLE = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/**
 * The spell slots a single-class caster has: `{"1": n, ...}`. The 2024 half casters (paladin,
 * ranger) cast from level 1 and round up; the 2014 ones start at level 2.
 * @param {string} classId
 * @param {string} rules  '2024' or '2014'
 * @param {number} level
 * @returns {Record<string, number> | null} null for a class that is no caster in the table
 */
export function expectedSlots(classId, rules, level) {
  const kind = RULES.casterKind[classId];
  if (!kind) return null;
  let casterLevel = level;
  if (kind === 'half')
    casterLevel = rules === '2024' ? Math.ceil(level / 2) : level < 2 ? 0 : Math.ceil(level / 2);
  /** @type {Record<string, number>} */
  const out = {};
  (SLOT_TABLE[Math.min(casterLevel, 20) - 1] ?? []).forEach((n, i) => {
    out[String(i + 1)] = n;
  });
  return out;
}

/* -------------------------------------------- */
/*  Small helpers                                 */
/* -------------------------------------------- */

/**
 * @param {Problem[]} problems
 * @param {FailureKind} kind
 * @param {string} what
 * @param {string} evidence
 */
const bad = (problems, kind, what, evidence) => problems.push({ kind, what, evidence });

/** @param {FeatureFacts} facts @param {string} identifier */
export function featureById(facts, identifier) {
  return facts.items.find(i => i.identifier === identifier && i.type === 'feat') ?? null;
}

/**
 * Compares a number the actor has with the rules table. A difference is CONTENT when the actor
 * agrees with the class's own scale value (the imported data differs from the rules table), else
 * SYSTEM (the system did not follow its own data).
 * @param {Problem[]} problems
 * @param {string} what
 * @param {unknown} got
 * @param {unknown} want
 * @param {unknown} [scale]  the advancement's own value, when there is one
 */
function compareRule(problems, what, got, want, scale) {
  if (String(got) === String(want)) return;
  const fromData = scale === undefined || String(scale) === String(got);
  bad(
    problems,
    fromData ? 'CONTENT' : 'SYSTEM',
    what,
    `the actor has ${got}, the rules table says ${want}${scale === undefined ? '' : `; the class scale value is ${scale}`}`
  );
}

/**
 * Dice of a scale value shown as "3d6" or "d8": {number, faces}, or null.
 * @param {unknown} v
 */
export function parseDice(v) {
  const m = /^([0-9]*)d([0-9]+)/.exec(String(v ?? '').trim());
  if (!m) return null;
  return { number: m[1] ? Number(m[1]) : 1, faces: Number(m[2]) };
}

/** @param {FeatureFacts} facts @param {string} classId @param {string} key */
const scaleOf = (facts, classId, key) => facts.scale?.[classId]?.[key];

/**
 * @typedef {object} DeepContext
 * @property {any} hero       the manifest row
 * @property {FeatureFacts} facts
 * @property {(action: string, args?: object) => Promise<any>} call  runs a GM action
 *
 * @typedef {object} DeepOutcome
 * @property {Problem[]} problems
 * @property {string[]} notes
 * @property {string} [skip]   why this hero was not checked
 *
 * @typedef {object} DeepCheck
 * @property {string} id
 * @property {string} title
 * @property {(hero: any) => boolean} applies
 * @property {(heroes: any[]) => any[]} [select]  narrows the heroes that apply (default: all)
 * @property {string} [none]    the reason shown when no hero applies
 * @property {(ctx: DeepContext) => Promise<DeepOutcome>} run
 */

/** @param {any} hero */
const is2024 = hero => hero.classRules === '2024';

/**
 * @param {string} classId
 * @param {number} minLevel
 * @param {boolean} [only2024]
 */
const ofClass =
  (classId, minLevel, only2024 = true) =>
  (/** @type {any} */ hero) =>
    hero.classIdentifier === classId && hero.level >= minLevel && (!only2024 || is2024(hero));

/**
 * A check of one feature's number of uses against a rules table.
 * @param {{id: string, title: string, classId: string, minLevel: number, itemId: string, table: (level: number) => number | null,
 *   scaleKey?: string, extra?: (ctx: DeepContext, item: FeatureItem, outcome: DeepOutcome) => Promise<void>}} o
 * @returns {DeepCheck}
 */
function usesCheck({ id, title, classId, minLevel, itemId, table, scaleKey, extra }) {
  return {
    id,
    title,
    applies: ofClass(classId, minLevel),
    none: `no 2024 ${classId} hero of level ${minLevel} or more in this kit`,
    async run(ctx) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      const item = featureById(ctx.facts, itemId);
      if (!item) {
        bad(
          out.problems,
          'SYSTEM',
          `${itemId} missing`,
          `a level ${ctx.hero.level} ${classId} has no feature "${itemId}"`
        );
        return out;
      }
      const want = table(ctx.hero.level);
      const scale = scaleKey ? scaleOf(ctx.facts, classId, scaleKey) : undefined;
      compareRule(out.problems, `${item.name} uses`, item.uses?.max ?? 'none', want, scale);
      out.notes.push(`${item.name} ${item.uses?.max ?? 'no'} uses`);
      if (extra) await extra(ctx, item, out);
      return out;
    },
  };
}

/** The first activity of an item the use pass would run (no dialog). @param {FeatureItem} item */
const firstUsable = item => item.activities.find(a => a.canUse && !(a.type in SKIP_ACTIVITY_TYPES));

/* -------------------------------------------- */
/*  The broad pass: every feature once            */
/* -------------------------------------------- */

/**
 * Activity types the use pass leaves out: they ask the player for a dialog (a place on the map, a
 * form, a creature, an item) that has no answer in a headless GM page.
 * @type {Record<string, string>}
 */
export const SKIP_ACTIVITY_TYPES = {
  summon: 'a summon activity asks where to place the creature',
  transform: 'a transform activity asks which form to take',
  cast: 'a cast activity creates a spell on the actor',
  order: 'an order activity needs a bastion facility',
};

/**
 * An item whose uses a rest takes away ("loseAll", like a ward whose hit points a rest empties) and that a fresh
 * hero has with every use spent: it is empty until another of its activities fills it. Pure.
 * @param {FeatureItem} item
 */
export function startsEmptyByDesign(item) {
  const u = item.uses;
  return Boolean(
    u &&
      typeof u.max === 'number' &&
      u.max > 0 &&
      u.spent >= u.max &&
      (u.recovery ?? []).some(r => r.type === 'loseAll')
  );
}

/**
 * True when the activity spends (a positive plain number of) its own item's uses. Pure.
 * @param {FeatureItem} item
 * @param {FeatureActivity} activity
 */
export function spendsOwnUses(item, activity) {
  return activity.consumption.some(
    c =>
      c.type === 'itemUses' &&
      (!c.target || c.target === item.id || c.target === item.identifier) &&
      /^[0-9]+$/.test(String(c.value ?? '').trim()) &&
      Number(c.value) > 0
  );
}

/**
 * Which activities of an actor's features the use pass runs, and which it leaves out and why.
 * Only features (items of type feat: class, subclass, species, background and feat features) are
 * used; weapons, equipment and spells are out of this pass.
 * @param {FeatureFacts} facts
 * @returns {{use: Array<{item: FeatureItem, activity: FeatureActivity}>, skipped: Array<{item: string, activity: string, why: string}>, features: number}}
 */
export function planUses(facts) {
  /** @type {Array<{item: FeatureItem, activity: FeatureActivity}>} */
  const use = [];
  /** @type {Array<{item: string, activity: string, why: string}>} */
  const skipped = [];
  let features = 0;
  for (const item of facts.items) {
    if (item.type !== 'feat' || !item.activities.length) continue;
    features += 1;
    for (const activity of item.activities) {
      const why = SKIP_ACTIVITY_TYPES[activity.type]
        ? SKIP_ACTIVITY_TYPES[activity.type]
        : !activity.canUse
          ? 'the system says the activity cannot be used'
          : activity.consumption.some(c => c.type === 'attribute' && /exhaustion/.test(c.target))
            ? 'it removes exhaustion levels, which a fresh hero does not have'
            : startsEmptyByDesign(item) && spendsOwnUses(item, activity)
              ? 'the item starts empty by design (a rest empties it, another activity fills it)'
              : '';
      if (why) skipped.push({ item: item.name, activity: activity.type, why });
      else use.push({ item, activity });
    }
  }
  return { use, skipped, features };
}

/**
 * A hero of level 2 or more must have at least one feature activity the use pass can run; if it
 * has none, the pass would prove nothing about it (the class content has no usable feature, or
 * every one was left out). Level 1 heroes may have none.
 * @param {{level: number}} hero
 * @param {ReturnType<typeof planUses>} plan
 * @returns {Problem[]}
 */
export function judgePlan(hero, plan) {
  /** @type {Problem[]} */
  const problems = [];
  if (hero.level >= 2 && plan.use.length === 0) {
    bad(
      problems,
      'CONTENT',
      'no usable feature',
      `a level ${hero.level} hero has ${plan.features} feature(s) with activities and none can be used without a dialog` +
        `${plan.skipped.length ? ` (left out: ${[...new Set(plan.skipped.map(s => s.activity))].join(', ')})` : ''}`
    );
  }
  return problems;
}

/** dnd5e recovery periods of type "combat" (CONFIG.DND5E.limitedUsePeriods). */
const COMBAT_PERIODS = new Set(['turn', 'turnStart', 'turnEnd']);

/**
 * What using an activity must consume from its own item: the sum of its plain itemUses targets.
 * `exact` is false when a target is a formula or points at another item (then only "something
 * was consumed or not" can be said). Uses that only recover on combat periods (Sneak Attack: once
 * per turn) are spent only during combat, as dnd5e does (ConsumptionTargetData.combatOnly); the kit
 * uses features outside combat unless `inCombat` says otherwise.
 * @param {FeatureItem} item
 * @param {FeatureActivity} activity
 * @param {{inCombat?: boolean}} [opts]
 */
export function expectedSpend(item, activity, { inCombat = false } = {}) {
  const recovery = item.uses?.recovery ?? [];
  const combatOnly = recovery.length > 0 && recovery.every(r => COMBAT_PERIODS.has(r.period));
  let total = 0;
  let exact = true;
  for (const c of activity.consumption) {
    if (c.type !== 'itemUses') continue;
    if (c.target && c.target !== item.id && c.target !== item.identifier) {
      exact = false;
      continue;
    }
    if (combatOnly && !inCombat) continue;
    const text = String(c.value ?? '').trim();
    if (/^[0-9]+$/.test(text)) total += Number(text);
    else exact = false;
  }
  return { total, exact };
}

/**
 * @typedef {object} UseResult what exerciseActor returns for op "use"
 * @property {boolean} ok            the activity ran (the system did not refuse)
 * @property {Array<{level: string, message: string}>} notes   notifications the system raised
 * @property {string | null} threw   the error message when it threw
 * @property {boolean} chatCard      a chat message was posted
 * @property {{before: number | null, after: number | null, max: number | null}} uses
 * @property {Record<string, {before: number, after: number}>} spells   spell slots that changed
 * @property {Array<{name: string, changes: Array<{key: string, value: string}>}>} effects   effects it created
 * @property {number} itemsCreated
 * @property {boolean} restored       the hero is as it was before
 * @property {string[]} drift         what differs when it is not
 */

/**
 * "; from <pack>" for an item that came from a compendium, so a known-list entry can name the
 * content it is about; empty otherwise.
 * @param {FeatureItem} item
 */
export function packOf(item) {
  const m = /^Compendium\.([^.]+\.[^.]+)\./.exec(item.sourceUuid ?? '');
  return m ? `; from ${m[1]}` : '';
}

/**
 * Why the system refused a use, from what it said and what the item looks like:
 * - the activity points at an item the actor does not have: CONTENT,
 * - it needs more uses than the item can ever have, or the item has no uses at all: CONTENT,
 * - the item starts with all its uses spent (the import left it so; the restore check says if the kit did): CONTENT,
 * - anything else: SYSTEM.
 * @param {string} text
 * @param {FeatureItem} item
 * @returns {{kind: FailureKind, note: string}}
 */
export function refusalKind(text, item) {
  const max = item.uses?.max;
  const from = packOf(item);
  if (/could not be found/i.test(text)) {
    return {
      kind: 'CONTENT',
      note: ` (the activity consumes an item the actor does not have${from})`,
    };
  }
  const needs = Number(/([0-9]+) required/i.exec(text)?.[1] ?? 0);
  const usesLimit = /no uses on|not enough uses/i.test(text);
  if (usesLimit && (!item.uses || !max)) {
    return {
      kind: 'CONTENT',
      note: ` (the item has no uses at this level, or none are set${from})`,
    };
  }
  if (usesLimit && needs > (max ?? 0)) {
    return {
      kind: 'CONTENT',
      note: ` (the activity needs ${needs} uses, the item has at most ${max}${from})`,
    };
  }
  if (usesLimit && item.uses && typeof max === 'number' && item.uses.spent >= max) {
    return {
      kind: 'CONTENT',
      note: ` (the imported item starts with ${item.uses.spent} of ${max} uses already spent${from})`,
    };
  }
  return { kind: 'SYSTEM', note: '' };
}

/**
 * Judges one use of one activity.
 * @param {{item: FeatureItem, activity: FeatureActivity}} planned
 * @param {UseResult} result
 * @returns {Problem[]}
 */
export function judgeUse({ item, activity }, result) {
  /** @type {Problem[]} */
  const problems = [];
  const who = `${item.name}${activity.name && activity.name !== item.name ? ` / ${activity.name}` : ''} (${activity.type})`;
  const errors = (result.notes ?? []).filter(n => n.level === 'error').map(n => n.message);
  if (result.threw) {
    bad(problems, 'SYSTEM', 'the activity threw', `${who}: ${result.threw}`);
  } else if (!result.ok) {
    const text = errors.join(' / ') || 'the use returned nothing and gave no message';
    const refusal = refusalKind(text, item);
    bad(problems, refusal.kind, 'the system refused the use', `${who}: ${text}${refusal.note}`);
  } else {
    if (!result.chatCard)
      bad(problems, 'SYSTEM', 'no chat card', `${who}: the use posted no chat message`);
    const { total, exact } = expectedSpend(item, activity);
    const before = result.uses?.before;
    const after = result.uses?.after;
    if (
      exact &&
      typeof before === 'number' &&
      typeof after === 'number' &&
      after - before !== total
    ) {
      const noUses = !item.uses || !item.uses.max;
      bad(
        problems,
        noUses ? 'CONTENT' : 'SYSTEM',
        'uses consumed',
        `${who}: the use consumed ${after - before}, the activity says ${total}${noUses ? ` (the item has no uses at this level, or none are set${packOf(item)})` : ''}`
      );
    }
  }
  if (result.restored === false) {
    bad(
      problems,
      'KIT',
      'the hero was not put back',
      `${who}: ${(result.drift ?? []).slice(0, 4).join(', ') || 'state differs'}`
    );
  }
  return problems;
}

/* -------------------------------------------- */
/*  Rest recovery                                 */
/* -------------------------------------------- */

/**
 * @typedef {object} RestSummary what exerciseActor reports of an actor around a rest
 * @property {Array<{id: string, name: string, max: number, spent: number, recovery: Array<{period: string, type: string, formula: string}>}>} items
 * @property {Record<string, {value: number, max: number, type: string}>} spells
 * @property {{value: number, max: number}} hp
 * @property {{value: number, max: number}} hd
 */

/**
 * What a rest must give back from the state the hero was left in (everything spent), by the
 * system's own rules: a long rest recovers by the periods "lr" then "sr", a short rest by "sr"; the
 * first period that has a profile on the item decides; pact slots return on both, other slots on a
 * long rest; hit points on a long rest; hit dice on a long rest.
 * `spent` is null when a formula could not be worked out (then any value from 0 up to the old one is fine).
 * @param {RestSummary} spent the summary right before the rest
 * @param {'short' | 'long'} type
 */
export function expectedAfterRest(spent, type) {
  const periods = type === 'long' ? ['lr', 'sr'] : ['sr'];
  /** @type {Record<string, {spent: number | null, from: number}>} */
  const items = {};
  for (const item of spent.items) {
    /** @type {number | null} */
    let now = item.spent;
    const profile = (() => {
      for (const p of periods) {
        const found = item.recovery.find(r => r.period === p);
        if (found) return found;
      }
      return null;
    })();
    if (profile) {
      if (profile.type === 'recoverAll') now = 0;
      else if (profile.type === 'loseAll') now = item.max;
      else if (/^[0-9]+$/.test(String(profile.formula).trim()))
        now = Math.max(0, item.spent - Number(profile.formula));
      else now = null;
    }
    items[item.id] = { spent: now, from: item.spent };
  }
  /** @type {Record<string, number>} */
  const spells = {};
  for (const [key, slot] of Object.entries(spent.spells)) {
    const back = slot.type === 'pact' || (slot.type === 'spell' && type === 'long');
    spells[key] = back ? slot.max : slot.value;
  }
  return {
    items,
    spells,
    hp: type === 'long' ? spent.hp.max : spent.hp.value,
    hdRises: type === 'long' && spent.hd.value < spent.hd.max,
  };
}

/* -------------------------------------------- */
/*  The deep checks                               */
/* -------------------------------------------- */

/** @type {DeepCheck[]} */
export const DEEP_CHECKS = [
  // 1. Rage: the number of uses, the effect (damage bonus, resistances) and one use.
  {
    id: 'rage',
    title: 'Rage: uses, damage bonus, resistances and one use',
    applies: ofClass('barbarian', 1),
    none: 'no 2024 barbarian hero in this kit',
    async run({ hero, facts, call }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      const item = featureById(facts, 'rage');
      if (!item) {
        bad(
          out.problems,
          'SYSTEM',
          'rage missing',
          `a level ${hero.level} barbarian has no feature "rage"`
        );
        return out;
      }
      compareRule(
        out.problems,
        'Rage uses',
        item.uses?.max ?? 'none',
        stepValue(RULES.rageUses, hero.level),
        scaleOf(facts, 'barbarian', 'rages')
      );
      // The effect data uses the old key; dnd5e 6 maps it to system.rolls.damage.mwak.bonus.
      const damageKey = 'system.bonuses.mwak.damage';
      const damageRead = 'system.rolls.damage.mwak.bonus';
      const resistKey = 'system.traits.dr.value';
      const effect = item.effects.find(e => e.changes.some(c => c.key === damageKey));
      if (!effect) {
        bad(
          out.problems,
          'CONTENT',
          'rage effect',
          'no effect on Rage changes the melee weapon damage bonus'
        );
      } else {
        const probe = await call('exerciseActor', {
          actorId: hero.actorId,
          op: 'effect',
          itemId: item.id,
          effectId: effect.id,
          enabled: true,
          read: [damageRead, resistKey],
        });
        const want = stepValue(RULES.rageDamage, hero.level);
        const damage = probe.during?.[damageRead]?.resolved;
        compareRule(
          out.problems,
          'Rage damage bonus',
          damage ?? 'none',
          want,
          scaleOf(facts, 'barbarian', 'rage-damage')
        );
        const resist = /** @type {string[]} */ (probe.during?.[resistKey]?.value ?? []);
        const lacking = ['bludgeoning', 'piercing', 'slashing'].filter(x => !resist.includes(x));
        if (lacking.length) {
          bad(
            out.problems,
            'SYSTEM',
            'rage resistances',
            `with the effect on, the actor lacks resistance to ${lacking.join(', ')} (has ${resist.join(', ') || 'none'})`
          );
        }
        if (probe.restored === false) {
          bad(out.problems, 'KIT', 'the hero was not put back', (probe.drift ?? []).join(', '));
        }
        out.notes.push(`+${damage} damage, resists ${resist.join('/')}`);
      }
      const activity = firstUsable(item);
      if (activity) {
        const result = await call('exerciseActor', {
          actorId: hero.actorId,
          op: 'use',
          itemId: item.id,
          activityId: activity.id,
        });
        out.problems.push(...judgeUse({ item, activity }, result));
        if (result.ok && result.uses?.after !== (result.uses?.before ?? 0) + 1) {
          bad(
            out.problems,
            'SYSTEM',
            'rage spends one use',
            `spent went from ${result.uses?.before} to ${result.uses?.after}`
          );
        }
      } else bad(out.problems, 'CONTENT', 'rage activity', 'Rage has no activity that can be used');
      return out;
    },
  },

  // 2. Wild Shape: the uses and the transform activity.
  usesCheck({
    id: 'wild-shape',
    title: 'Wild Shape: uses and its transform activity',
    classId: 'druid',
    minLevel: 2,
    itemId: 'wild-shape',
    table: l => stepValue(RULES.wildShapeUses, l),
    scaleKey: 'wild-shape-uses',
    async extra(_ctx, item, out) {
      if (!item.activities.some(a => a.type === 'transform')) {
        bad(out.problems, 'CONTENT', 'wild shape activity', 'Wild Shape has no transform activity');
      }
    },
  }),

  // 3. Channel Divinity of the cleric and the paladin.
  {
    id: 'channel-divinity',
    title: 'Channel Divinity: uses of the cleric and the paladin',
    applies: hero => ofClass('cleric', 2)(hero) || ofClass('paladin', 3)(hero),
    none: 'no 2024 cleric (level 2 and up) or paladin (level 3 and up) in this kit',
    async run({ hero, facts }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      const cleric = hero.classIdentifier === 'cleric';
      // The SRD names them channel-divinity-cleric and -paladin; other books use other suffixes.
      const wanted = cleric ? 'channel-divinity-cleric' : 'channel-divinity-paladin';
      const item =
        featureById(facts, wanted) ??
        facts.items.find(
          i => i.type === 'feat' && /^channel-divinity/.test(i.identifier ?? '') && i.uses?.max
        ) ??
        null;
      if (!item) {
        bad(
          out.problems,
          'SYSTEM',
          'channel divinity missing',
          `a level ${hero.level} ${hero.classIdentifier} has no Channel Divinity`
        );
        return out;
      }
      compareRule(
        out.problems,
        'Channel Divinity uses',
        item.uses?.max ?? 'none',
        stepValue(cleric ? RULES.channelCleric : RULES.channelPaladin, hero.level),
        scaleOf(facts, hero.classIdentifier, 'channel-divinity')
      );
      if (!item.uses?.recovery.some(r => r.period === 'lr')) {
        bad(
          out.problems,
          'CONTENT',
          'channel divinity recovery',
          'the uses do not come back on a long rest'
        );
      }
      out.notes.push(`${item.uses?.max} uses`);
      return out;
    },
  },

  // 4. Sneak Attack dice by level.
  {
    id: 'sneak-attack',
    title: 'Sneak Attack: dice by level',
    applies: ofClass('rogue', 1),
    none: 'no 2024 rogue hero in this kit',
    async run({ hero, facts }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      const item = featureById(facts, 'sneak-attack');
      if (!item) {
        bad(
          out.problems,
          'SYSTEM',
          'sneak attack missing',
          `a level ${hero.level} rogue has no Sneak Attack`
        );
        return out;
      }
      const raw = scaleOf(facts, 'rogue', 'sneak-attack');
      const dice = parseDice(raw);
      if (!dice) {
        bad(
          out.problems,
          'SYSTEM',
          'sneak attack dice',
          `the actor's scale value is "${raw ?? 'none'}", not a dice term`
        );
        return out;
      }
      compareRule(
        out.problems,
        'Sneak Attack dice',
        `${dice.number}d${dice.faces}`,
        `${Math.ceil(hero.level / 2)}d6`
      );
      out.notes.push(`${dice.number}d${dice.faces}`);
      if (!item.activities.some(a => a.type === 'damage')) {
        bad(
          out.problems,
          'CONTENT',
          'sneak attack activity',
          'Sneak Attack has no damage activity'
        );
      }
      return out;
    },
  },

  // 5. Bardic Inspiration: the die by level and the uses.
  {
    id: 'bardic-inspiration',
    title: 'Bardic Inspiration: die by level and uses',
    applies: ofClass('bard', 1),
    none: 'no 2024 bard hero in this kit',
    async run({ hero, facts }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      const item = featureById(facts, 'bardic-inspiration');
      if (!item) {
        bad(
          out.problems,
          'SYSTEM',
          'bardic inspiration missing',
          `a level ${hero.level} bard has no Bardic Inspiration`
        );
        return out;
      }
      const dice = parseDice(scaleOf(facts, 'bard', 'inspiration'));
      compareRule(
        out.problems,
        'Bardic Inspiration die',
        dice ? `d${dice.faces}` : 'none',
        `d${stepValue(RULES.bardicDie, hero.level)}`
      );
      const charisma = facts.abilities?.cha?.mod ?? 0;
      compareRule(
        out.problems,
        'Bardic Inspiration uses',
        item.uses?.max ?? 'none',
        Math.max(1, charisma)
      );
      out.notes.push(`${dice ? `d${dice.faces}` : '?'}, ${item.uses?.max} uses`);
      return out;
    },
  },

  // 6. Monk's Focus points.
  usesCheck({
    id: 'focus-points',
    title: "Focus points (Monk's Focus): one per level",
    classId: 'monk',
    minLevel: 2,
    itemId: 'monks-focus',
    table: level => level,
    scaleKey: 'focus',
  }),

  // 7. Sorcery points.
  usesCheck({
    id: 'sorcery-points',
    title: 'Sorcery points (Font of Magic): one per level',
    classId: 'sorcerer',
    minLevel: 2,
    itemId: 'font-of-magic',
    table: level => level,
    scaleKey: 'points',
  }),

  // 8. Pact Magic slots: how many and of which level.
  {
    id: 'pact-magic',
    title: 'Pact Magic: slots and their level by warlock level',
    applies: hero => hero.classIdentifier === 'warlock',
    none: 'no warlock hero in this kit',
    async run({ hero, facts }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      const pact = facts.spells?.pact;
      const wantMax = stepValue(RULES.pactSlots, hero.level);
      const wantLevel = stepValue(RULES.pactLevel, hero.level);
      compareRule(out.problems, 'pact slots', pact?.max ?? 0, wantMax);
      compareRule(out.problems, 'pact slot level', pact?.level ?? 0, wantLevel);
      if (pact && pact.value !== pact.max) {
        bad(out.problems, 'KIT', 'pact slots start full', `${pact.value} of ${pact.max}`);
      }
      const leveled = Object.keys(facts.spells ?? {}).filter(
        k => k !== 'pact' && facts.spells[k].max
      );
      if (leveled.length) {
        bad(
          out.problems,
          'SYSTEM',
          'only pact slots',
          `a warlock also has slots ${leveled.join(', ')}`
        );
      }
      out.notes.push(`${pact?.max ?? 0} slots of level ${pact?.level ?? 0}`);
      return out;
    },
  },

  // 9. Action Surge.
  usesCheck({
    id: 'action-surge',
    title: 'Action Surge: uses by level',
    classId: 'fighter',
    minLevel: 2,
    itemId: 'action-surge',
    table: level => stepValue(RULES.actionSurge, level),
    scaleKey: 'action-surge',
  }),

  // 10. Lay on Hands pool.
  usesCheck({
    id: 'lay-on-hands',
    title: 'Lay on Hands: a pool of 5 hit points per level',
    classId: 'paladin',
    minLevel: 1,
    itemId: 'lay-on-hands',
    table: level => 5 * level,
    async extra(_ctx, item, out) {
      if (!item.activities.some(a => a.type === 'heal')) {
        bad(out.problems, 'CONTENT', 'lay on hands activity', 'Lay on Hands has no heal activity');
      }
    },
  }),

  // 11. Second Wind.
  usesCheck({
    id: 'second-wind',
    title: 'Second Wind: uses by level, with its heal activity',
    classId: 'fighter',
    minLevel: 1,
    itemId: 'second-wind',
    table: level => stepValue(RULES.secondWind, level),
    scaleKey: 'second-wind',
    async extra(_ctx, item, out) {
      if (!item.activities.some(a => a.type === 'heal')) {
        bad(out.problems, 'CONTENT', 'second wind activity', 'Second Wind has no heal activity');
      }
    },
  }),

  // 12. Arcane Recovery.
  usesCheck({
    id: 'arcane-recovery',
    title: 'Arcane Recovery: one use, back on a long rest',
    classId: 'wizard',
    minLevel: 1,
    itemId: 'arcane-recovery',
    table: () => 1,
    async extra(_ctx, item, out) {
      if (!item.uses?.recovery.some(r => r.period === 'lr')) {
        bad(
          out.problems,
          'CONTENT',
          'arcane recovery recovery',
          'the use does not come back on a long rest'
        );
      }
    },
  }),

  // 13. Divine Smite.
  {
    id: 'divine-smite',
    title: "Divine Smite: the paladin has Paladin's Smite",
    applies: ofClass('paladin', 2),
    none: 'no 2024 paladin hero of level 2 or more in this kit',
    async run({ facts }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      if (!featureById(facts, 'paladins-smite')) {
        bad(
          out.problems,
          'SYSTEM',
          "paladin's smite missing",
          'the feature "paladins-smite" is not on the actor'
        );
      }
      const spell = facts.items.find(i => i.type === 'spell' && /divine smite/i.test(i.name));
      out.notes.push(
        spell
          ? 'Divine Smite spell on the actor'
          : 'no Divine Smite spell item (the feature has none to grant)'
      );
      return out;
    },
  },

  // 14. Cunning Action.
  {
    id: 'cunning-action',
    title: 'Cunning Action: three bonus action activities',
    applies: ofClass('rogue', 2),
    none: 'no 2024 rogue hero of level 2 or more in this kit',
    async run({ facts }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      const item = featureById(facts, 'cunning-action');
      if (!item) {
        bad(
          out.problems,
          'SYSTEM',
          'cunning action missing',
          'the feature "cunning-action" is not on the actor'
        );
        return out;
      }
      if (item.activities.length !== 3) {
        bad(
          out.problems,
          'CONTENT',
          'cunning action activities',
          `${item.activities.length} activities, the rules give three (dash, disengage, hide)`
        );
      }
      const notBonus = item.activities.filter(a => a.activation !== 'bonus');
      if (notBonus.length) {
        bad(
          out.problems,
          'CONTENT',
          'cunning action activation',
          `${notBonus.map(a => a.name || a.type).join(', ')} is not a bonus action`
        );
      }
      return out;
    },
  },

  // 15. Extra Attack.
  {
    id: 'extra-attack',
    title: 'Extra Attack: from level 5 (fighter: more at 11 and 20)',
    applies: hero =>
      ['barbarian', 'fighter', 'monk', 'paladin', 'ranger'].includes(hero.classIdentifier) &&
      is2024(hero),
    none: 'no 2024 martial hero in this kit',
    async run({ hero, facts }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      /** @type {Array<[string, number]>} */
      const wanted = [['extra-attack', 5]];
      if (hero.classIdentifier === 'fighter')
        wanted.push(['two-extra-attacks', 11], ['three-extra-attacks', 20]);
      for (const [identifier, from] of wanted) {
        const has = !!featureById(facts, identifier);
        if (hero.level >= from && !has) {
          bad(
            out.problems,
            'SYSTEM',
            `${identifier} missing`,
            `level ${hero.level} reaches ${from}, the actor has no "${identifier}"`
          );
        } else if (hero.level < from && has) {
          bad(
            out.problems,
            'SYSTEM',
            `${identifier} too early`,
            `the actor has it at level ${hero.level}, it comes at ${from}`
          );
        }
      }
      return out;
    },
  },

  // 16. Superiority dice (only where a subclass has them; the srd profile has none).
  {
    id: 'superiority-dice',
    title: 'Superiority dice: count by level',
    applies: hero => hero.classIdentifier === 'fighter' && hero.level >= 3,
    none: 'no hero in this kit has a feature with superiority dice',
    async run({ hero, facts }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      const item = facts.items.find(
        i => i.type === 'feat' && /superiority/.test(i.identifier ?? '')
      );
      if (!item)
        return { problems: [], notes: [], skip: 'this fighter has no superiority dice feature' };
      compareRule(
        out.problems,
        'superiority dice',
        item.uses?.max ?? 'none',
        stepValue(RULES.superiorityDice, hero.level)
      );
      return out;
    },
  },

  // 17. Unarmored Defense: AC with no armor.
  {
    id: 'unarmored-defense',
    title: 'Unarmored Defense: armor class of a barbarian and a monk',
    applies: hero => ['barbarian', 'monk'].includes(hero.classIdentifier) && is2024(hero),
    none: 'no 2024 barbarian or monk hero in this kit',
    async run({ hero, facts }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      if (facts.ac?.armor) return { problems: [], notes: [], skip: 'the hero wears armor' };
      const barbarian = hero.classIdentifier === 'barbarian';
      const dex = facts.abilities?.dex?.mod ?? 0;
      const other = facts.abilities?.[barbarian ? 'con' : 'wis']?.mod ?? 0;
      const want = 10 + dex + other;
      const calc = barbarian ? 'unarmoredBarb' : 'unarmoredMonk';
      // The system names the best formula, and the plain unarmored one wins a tie.
      const tie = other <= 0 && facts.ac?.calc === 'unarmored';
      if (facts.ac?.calc !== calc && !tie) {
        bad(
          out.problems,
          'SYSTEM',
          'armor class calculation',
          `calc is "${facts.ac?.calc}", expected "${calc}"`
        );
      }
      compareRule(out.problems, 'armor class', facts.ac?.value ?? 'none', want);
      out.notes.push(
        `AC ${facts.ac?.value} = 10 + ${dex} DEX + ${other} ${barbarian ? 'CON' : 'WIS'}`
      );
      return out;
    },
  },

  // 18. Spell slots by level, against the independent table.
  {
    id: 'spell-slots',
    title: 'Spellcasting: slots of every caster against the rules table',
    applies: hero => hero.classIdentifier in RULES.casterKind,
    none: 'no full or half caster in this kit',
    async run({ hero, facts }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      const want = expectedSlots(hero.classIdentifier, hero.classRules, hero.level) ?? {};
      for (let n = 1; n <= 9; n += 1) {
        const got = facts.spells?.[`spell${n}`]?.max ?? 0;
        const rule = want[String(n)] ?? 0;
        if (got !== rule) {
          bad(
            out.problems,
            'SYSTEM',
            `spell slots, level ${n}`,
            `the actor has ${got}, the rules table gives ${rule}`
          );
        }
        const slot = facts.spells?.[`spell${n}`];
        if (slot && slot.value !== slot.max) {
          bad(out.problems, 'KIT', `level ${n} slots start full`, `${slot.value} of ${slot.max}`);
        }
      }
      out.notes.push(Object.values(want).join('/') || 'no slots');
      return out;
    },
  },

  // 19. Hit dice.
  {
    id: 'hit-dice',
    title: 'Hit Dice: one per level, the die of the class, all unspent',
    applies: hero => hero.classIdentifier in RULES.hitDie,
    none: 'no hero of a known class in this kit',
    async run({ hero, facts }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      const row = facts.hd?.classes?.find(c => c.identifier === hero.classIdentifier);
      if (!row) {
        bad(
          out.problems,
          'SYSTEM',
          'hit dice',
          `the actor has no hit dice for ${hero.classIdentifier}`
        );
        return out;
      }
      const faces = String(row.denomination).replace(/[^0-9]/g, '');
      compareRule(out.problems, 'hit die', `d${faces}`, `d${RULES.hitDie[hero.classIdentifier]}`);
      compareRule(out.problems, 'hit dice', facts.hd.max, hero.level);
      if (facts.hd.value !== facts.hd.max) {
        bad(out.problems, 'KIT', 'hit dice start unspent', `${facts.hd.value} of ${facts.hd.max}`);
      }
      out.notes.push(`${facts.hd.max}d${faces}`);
      return out;
    },
  },

  // 20. Short and long rest recovery, on the highest hero of each class.
  {
    id: 'rest-recovery',
    title: 'Short and long rest: what comes back (the top hero of each class)',
    applies: () => true,
    select: heroes => {
      /** @type {Map<string, any>} */
      const top = new Map();
      for (const h of heroes) {
        const was = top.get(h.classIdentifier);
        if (!was || h.level > was.level) top.set(h.classIdentifier, h);
      }
      return [...top.values()];
    },
    none: 'no hero in this kit',
    async run({ hero, call }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      for (const type of /** @type {const} */ (['short', 'long'])) {
        const probe = await call('exerciseActor', { actorId: hero.actorId, op: 'rest', type });
        if (probe.restored === false) {
          bad(
            out.problems,
            'KIT',
            'the hero was not put back',
            `${type} rest: ${(probe.drift ?? []).join(', ')}`
          );
        }
        problemsOfRest(out.problems, type, probe);
        out.notes.push(`${type}: ${probe.afterSpend.items.length} features`);
      }
      return out;
    },
  },

  // 21. Proficiency bonus.
  {
    id: 'proficiency-bonus',
    title: 'Proficiency bonus by level',
    applies: () => true,
    none: 'no hero in this kit',
    async run({ hero, facts }) {
      /** @type {DeepOutcome} */
      const out = { problems: [], notes: [] };
      compareRule(
        out.problems,
        'proficiency bonus',
        facts.prof,
        2 + Math.floor((hero.level - 1) / 4)
      );
      out.notes.push(`+${facts.prof}`);
      return out;
    },
  },
];

/**
 * The problems of one rest probe: what the system gave back against what its own rules say.
 * @param {Problem[]} problems
 * @param {'short' | 'long'} type
 * @param {{afterSpend: RestSummary, afterRest: RestSummary}} probe
 */
export function problemsOfRest(problems, type, probe) {
  const want = expectedAfterRest(probe.afterSpend, type);
  const names = new Map(probe.afterRest.items.map(i => [i.id, i.name]));
  for (const item of probe.afterRest.items) {
    const rule = want.items[item.id];
    if (!rule) continue;
    const ok =
      rule.spent === null ? item.spent >= 0 && item.spent <= rule.from : item.spent === rule.spent;
    if (!ok) {
      bad(
        problems,
        'SYSTEM',
        `${type} rest, ${names.get(item.id)}`,
        `uses spent ${rule.from} -> ${item.spent}, the recovery data gives ${rule.spent === null ? 'a formula result' : rule.spent}`
      );
    }
  }
  for (const [key, slot] of Object.entries(probe.afterRest.spells)) {
    if (want.spells[key] !== undefined && slot.value !== want.spells[key]) {
      bad(
        problems,
        'SYSTEM',
        `${type} rest, ${key} slots`,
        `${slot.value} of ${slot.max} back, expected ${want.spells[key]}`
      );
    }
  }
  if (probe.afterRest.hp.value !== want.hp) {
    bad(
      problems,
      'SYSTEM',
      `${type} rest, hit points`,
      `${probe.afterRest.hp.value} of ${probe.afterRest.hp.max}, expected ${want.hp}`
    );
  }
  if (want.hdRises && probe.afterRest.hd.value <= probe.afterSpend.hd.value) {
    bad(
      problems,
      'SYSTEM',
      `${type} rest, hit dice`,
      `${probe.afterSpend.hd.value} before, ${probe.afterRest.hd.value} after: none came back`
    );
  }
  if (type === 'short' && probe.afterRest.hd.value !== probe.afterSpend.hd.value) {
    bad(
      problems,
      'SYSTEM',
      'short rest, hit dice',
      `a short rest changed the hit dice from ${probe.afterSpend.hd.value} to ${probe.afterRest.hd.value}`
    );
  }
}

/**
 * Runs one deep check over the heroes it applies to.
 * @param {DeepCheck} check
 * @param {any[]} heroes   built heroes of the manifest
 * @param {(hero: any) => Promise<FeatureFacts>} factsOf
 * @param {(action: string, args?: object) => Promise<any>} call
 * @returns {Promise<{checked: any[], skipped: Array<{hero: string, why: string}>, failed: Array<{hero: any, problems: Problem[]}>, notes: Array<{hero: string, note: string}>}>}
 */
export async function runDeepCheck(check, heroes, factsOf, call) {
  const applicable = heroes.filter(h => check.applies(h));
  const picked = check.select ? check.select(applicable) : applicable;
  /** @type {any[]} */
  const checked = [];
  /** @type {Array<{hero: string, why: string}>} */
  const skipped = [];
  /** @type {Array<{hero: any, problems: Problem[]}>} */
  const failed = [];
  /** @type {Array<{hero: string, note: string}>} */
  const notes = [];
  for (const hero of picked) {
    let outcome;
    try {
      outcome = await check.run({ hero, facts: await factsOf(hero), call });
    } catch (e) {
      outcome = {
        problems: [
          {
            kind: /** @type {FailureKind} */ ('KIT'),
            what: 'the check could not run',
            evidence: e instanceof Error ? e.message : String(e),
          },
        ],
        notes: [],
      };
    }
    if (outcome.skip) {
      skipped.push({ hero: hero.name, why: outcome.skip });
      continue;
    }
    checked.push(hero);
    if (outcome.problems.length) failed.push({ hero, problems: outcome.problems });
    if (outcome.notes.length) notes.push({ hero: hero.name, note: outcome.notes.join('; ') });
  }
  return { checked, skipped, failed, notes };
}
