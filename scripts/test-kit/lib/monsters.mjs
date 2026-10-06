/**
 * The monster checks of the test kit, as pure functions over the facts the GM actions return
 * (listMonsters, inspectFeatures, exerciseActor). No Foundry in here, so the unit tests and the
 * fake can run every rule.
 *
 * Three scenarios use it:
 * - monsters-every: every monster of every pack of the profile is copied into the kit world, uses
 *   one action and is deleted again (`planMonsterUse`, `judgeCopy`, `judgeBridge`, `judgeUse`).
 * - monsters-matrix: the counts by challenge rating, creature type, size and trait, and the gaps
 *   (`matrixOf`, `judgeRow`).
 * - monsters-odd: the odd mechanics, one check each (`ODD_CHECKS`).
 *
 * Failures are classified like the hero checks (lib/advancement.mjs): KIT (our check is wrong),
 * CONTENT (the imported data is wrong or incomplete) and SYSTEM (the dnd5e system or the bridge
 * did something other than the data says).
 */
import { SKIP_ACTIVITY_TYPES, judgeUse } from './features.mjs';

/** @typedef {import('./advancement.mjs').Problem} Problem */
/** @typedef {import('./advancement.mjs').FailureKind} FailureKind */
/** @typedef {import('./features.mjs').FeatureItem} FeatureItem */
/** @typedef {import('./features.mjs').FeatureActivity} FeatureActivity */

/**
 * One monster as listMonsters returns it.
 * @typedef {object} MonsterRow
 * @property {string} packId
 * @property {string} id
 * @property {string} uuid
 * @property {string} name
 * @property {number | null} cr
 * @property {string} creatureType
 * @property {string} size            dnd5e's short code: tiny, sm, med, lg, huge, grg
 * @property {string} book
 * @property {string} rules
 * @property {number} hp
 * @property {number} ac
 * @property {{walk: number, fly: number, swim: number, burrow: number, climb: number, hover: boolean, units: string}} movement
 * @property {{darkvision: number, blindsight: number, tremorsense: number, truesight: number, special: boolean}} senses
 * @property {string[]} languages
 * @property {{dr: string[], di: string[], dv: string[], ci: string[], dm: boolean}} resist
 * @property {{spells: number, ability: string, innate: boolean, dc: number}} spell
 * @property {number} legact
 * @property {number} legres
 * @property {boolean} lair
 * @property {number} items
 * @property {number} activities
 * @property {{regeneration: boolean, shapechanger: boolean, damageThreshold: boolean, multiattack: boolean, innateSpellcasting: boolean,
 *   recharge: number, summon: number, transform: number, legendaryActivities: number, lairActivities: number}} odd
 */

/** @param {Problem[]} problems @param {FailureKind} kind @param {string} what @param {string} evidence */
const bad = (problems, kind, what, evidence) => problems.push({ kind, what, evidence });

/* -------------------------------------------- */
/*  Vocabulary                                   */
/* -------------------------------------------- */

/** The 14 creature types of dnd5e. */
export const CREATURE_TYPES = [
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
];

/** dnd5e's size codes, smallest first. */
export const SIZES = ['tiny', 'sm', 'med', 'lg', 'huge', 'grg'];

/** Challenge rating bands, in order. `test` gets the numeric rating. */
export const CR_BANDS = [
  { id: 'cr0', label: 'CR 0', test: (/** @type {number} */ cr) => cr === 0 },
  { id: 'cr1/8', label: 'CR 1/8', test: (/** @type {number} */ cr) => cr === 0.125 },
  { id: 'cr1/4', label: 'CR 1/4', test: (/** @type {number} */ cr) => cr === 0.25 },
  { id: 'cr1/2', label: 'CR 1/2', test: (/** @type {number} */ cr) => cr === 0.5 },
  { id: 'cr1-4', label: 'CR 1 to 4', test: (/** @type {number} */ cr) => cr >= 1 && cr < 5 },
  { id: 'cr5-10', label: 'CR 5 to 10', test: (/** @type {number} */ cr) => cr >= 5 && cr < 11 },
  { id: 'cr11-16', label: 'CR 11 to 16', test: (/** @type {number} */ cr) => cr >= 11 && cr < 17 },
  { id: 'cr17-20', label: 'CR 17 to 20', test: (/** @type {number} */ cr) => cr >= 17 && cr < 21 },
  { id: 'cr21+', label: 'CR 21 and up', test: (/** @type {number} */ cr) => cr >= 21 },
];

/** The band id of a challenge rating, or "none" when it is not a number. @param {unknown} cr */
export function crBand(cr) {
  if (typeof cr !== 'number' || !Number.isFinite(cr) || cr < 0) return 'none';
  return CR_BANDS.find(b => b.test(cr))?.id ?? 'none';
}

/** A challenge rating as the books write it. @param {unknown} cr */
export function fmtCr(cr) {
  if (typeof cr !== 'number') return '?';
  return { 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' }[/** @type {0.125} */ (cr)] ?? String(cr);
}

/** The movement modes besides walking. */
export const MOVE_MODES = /** @type {const} */ (['fly', 'swim', 'burrow', 'climb']);

/* -------------------------------------------- */
/*  Reading the rows                             */
/* -------------------------------------------- */

/**
 * Every monster of the packs, in the profile's pack order, from `fetch(packId, from, count)`
 * (the GM action listMonsters). Also says which packs are not installed and what each pack left out.
 * @param {string[]} packIds
 * @param {(packId: string, from: number, count: number) => Promise<any>} fetch
 * @param {number} [chunk]
 * @returns {Promise<{rows: MonsterRow[], missing: string[], perPack: Record<string, {total: number, skipped: Record<string, number>}>}>}
 */
export async function readMonsters(packIds, fetch, chunk = 100) {
  /** @type {MonsterRow[]} */
  const rows = [];
  /** @type {string[]} */
  const missing = [];
  /** @type {Record<string, {total: number, skipped: Record<string, number>}>} */
  const perPack = {};
  for (const packId of packIds) {
    let from = 0;
    for (;;) {
      const reply = await fetch(packId, from, chunk);
      if (!reply.installed) {
        missing.push(packId);
        break;
      }
      perPack[packId] = { total: reply.total, skipped: reply.skipped ?? {} };
      rows.push(...reply.entries);
      from += chunk;
      if (from >= reply.total) break;
    }
  }
  return { rows, missing, perPack };
}

/**
 * A stat block that is no monster: an actor of the pack without a challenge rating, or with no type and no
 * hit points (what a spell summons or creates, a steed, an animated object, a familiar). It is still copied and used
 * in the broad pass, but it is not held to the data every creature needs.
 * @param {MonsterRow} m
 */
export const isStatBlock = m =>
  m.cr === null || m.cr === undefined || (!m.creatureType && !(m.hp > 0));

/**
 * The data problems of one monster: what the import must have for every creature. All CONTENT.
 * A stat block (no challenge rating) only has its pools and movement checked.
 * @param {MonsterRow} m
 * @returns {Problem[]}
 */
export function judgeRow(m) {
  /** @type {Problem[]} */
  const problems = [];
  const who = m.name;
  const block = isStatBlock(m);
  if (!block) {
    if (typeof m.cr !== 'number' || !Number.isFinite(m.cr) || m.cr < 0 || m.cr > 30)
      bad(problems, 'CONTENT', 'no valid challenge rating', `${who}: ${JSON.stringify(m.cr)}`);
    if (!CREATURE_TYPES.includes(m.creatureType))
      bad(problems, 'CONTENT', 'unknown creature type', `${who}: "${m.creatureType}"`);
    if (!(m.hp > 0)) bad(problems, 'CONTENT', 'no hit points', `${who}: ${m.hp}`);
    if (!(m.ac > 0)) bad(problems, 'CONTENT', 'no armor class', `${who}: ${m.ac}`);
    if (!(m.items > 0)) bad(problems, 'CONTENT', 'no items', `${who} has no features or attacks`);
  }
  if (!SIZES.includes(m.size)) bad(problems, 'CONTENT', 'unknown size', `${who}: "${m.size}"`);
  if (m.legact > 0 && m.odd.legendaryActivities === 0)
    bad(
      problems,
      'CONTENT',
      'legendary pool without legendary actions',
      `${who}: ${m.legact} uses and no activity with the legendary activation`
    );
  if (m.legact === 0 && m.odd.legendaryActivities > 0)
    bad(
      problems,
      'CONTENT',
      'legendary actions without a pool',
      `${who}: ${m.odd.legendaryActivities} legendary activities and no legendary action uses`
    );
  for (const key of /** @type {const} */ (['legact', 'legres'])) {
    if (!Number.isInteger(m[key]) || m[key] < 0 || m[key] > 9)
      bad(problems, 'CONTENT', `odd ${key} pool`, `${who}: ${m[key]}`);
  }
  const mv = m.movement;
  for (const key of ['walk', ...MOVE_MODES]) {
    const v = /** @type {any} */ (mv)[key];
    if (typeof v !== 'number' || !(v >= 0))
      bad(problems, 'CONTENT', 'bad movement speed', `${who}: ${key} ${v}`);
  }
  if (!block && mv.hover && !(mv.fly > 0))
    bad(
      problems,
      'CONTENT',
      'hover without a fly speed',
      `${who}: hover is set and fly is ${mv.fly}`
    );
  return problems;
}

/* -------------------------------------------- */
/*  The matrix                                   */
/* -------------------------------------------- */

/** @param {Record<string, number>} counts @param {string} key @param {number} [by] */
const bump = (counts, key, by = 1) => {
  counts[key] = (counts[key] ?? 0) + by;
};

/** The traits the matrix counts, each with the test a monster must pass. @type {Array<{id: string, label: string, has: (m: MonsterRow) => boolean}>} */
export const TRAITS = [
  { id: 'resistance', label: 'damage resistance', has: m => m.resist.dr.length > 0 },
  { id: 'immunity', label: 'damage immunity', has: m => m.resist.di.length > 0 },
  { id: 'vulnerability', label: 'damage vulnerability', has: m => m.resist.dv.length > 0 },
  { id: 'conditionImmunity', label: 'condition immunity', has: m => m.resist.ci.length > 0 },
  { id: 'damageModification', label: 'damage modification', has: m => m.resist.dm },
  { id: 'darkvision', label: 'darkvision', has: m => m.senses.darkvision > 0 },
  { id: 'blindsight', label: 'blindsight', has: m => m.senses.blindsight > 0 },
  { id: 'tremorsense', label: 'tremorsense', has: m => m.senses.tremorsense > 0 },
  { id: 'truesight', label: 'truesight', has: m => m.senses.truesight > 0 },
  { id: 'noLanguage', label: 'no language', has: m => m.languages.length === 0 },
  { id: 'languages', label: 'at least one language', has: m => m.languages.length > 0 },
  { id: 'spellcasting', label: 'spells', has: m => m.spell.spells > 0 },
  { id: 'innateSpellcasting', label: 'innate spellcasting', has: m => m.spell.innate },
  { id: 'legendaryActions', label: 'legendary actions', has: m => m.legact > 0 },
  { id: 'legendaryResistance', label: 'legendary resistance', has: m => m.legres > 0 },
  { id: 'lair', label: 'a lair', has: m => m.lair },
  { id: 'lairActions', label: 'lair actions', has: m => m.odd.lairActivities > 0 },
  { id: 'fly', label: 'flying speed', has: m => m.movement.fly > 0 },
  { id: 'hover', label: 'hover', has: m => m.movement.hover },
  { id: 'swim', label: 'swimming speed', has: m => m.movement.swim > 0 },
  { id: 'burrow', label: 'burrowing speed', has: m => m.movement.burrow > 0 },
  { id: 'climb', label: 'climbing speed', has: m => m.movement.climb > 0 },
  { id: 'regeneration', label: 'regeneration', has: m => m.odd.regeneration },
  { id: 'shapechanger', label: 'shapechanger', has: m => m.odd.shapechanger },
  { id: 'damageThreshold', label: 'damage threshold', has: m => m.odd.damageThreshold },
  { id: 'multiattack', label: 'multiattack', has: m => m.odd.multiattack },
  { id: 'recharge', label: 'a recharge ability', has: m => m.odd.recharge > 0 },
  { id: 'summon', label: 'a summon activity', has: m => m.odd.summon > 0 },
  { id: 'transform', label: 'a transform activity', has: m => m.odd.transform > 0 },
];

/**
 * The counts of a list of monsters, by pack, book, challenge rating band, creature type, size,
 * trait, damage type, condition and language, and the gaps: bands, types, sizes and traits that
 * nobody in the list has.
 * @param {MonsterRow[]} rows
 */
export function matrixOf(rows) {
  /** @type {Record<string, number>} */ const byPack = {};
  /** @type {Record<string, number>} */ const byBook = {};
  /** @type {Record<string, number>} */ const byRules = {};
  /** @type {Record<string, number>} */ const byBand = {};
  /** @type {Record<string, number>} */ const byType = {};
  /** @type {Record<string, number>} */ const bySize = {};
  /** @type {Record<string, Record<string, number>>} */ const bandByType = {};
  /** @type {Record<string, number>} */ const traits = {};
  /** @type {Record<string, number>} */ const resistances = {};
  /** @type {Record<string, number>} */ const immunities = {};
  /** @type {Record<string, number>} */ const vulnerabilities = {};
  /** @type {Record<string, number>} */ const conditions = {};
  /** @type {Record<string, number>} */ const languages = {};
  for (const m of rows) {
    bump(byPack, m.packId);
    bump(byBook, m.book || '(no book)');
    bump(byRules, m.rules || '(none)');
    const band = crBand(m.cr);
    bump(byBand, band);
    bump(byType, m.creatureType || '(none)');
    bump(bySize, m.size || '(none)');
    bandByType[band] ??= {};
    bump(bandByType[band], m.creatureType || '(none)');
    for (const t of TRAITS) if (t.has(m)) bump(traits, t.id);
    for (const x of m.resist.dr) bump(resistances, x);
    for (const x of m.resist.di) bump(immunities, x);
    for (const x of m.resist.dv) bump(vulnerabilities, x);
    for (const x of m.resist.ci) bump(conditions, x);
    for (const x of m.languages) bump(languages, x);
  }
  /** @type {Array<{what: string, id: string}>} */
  const gaps = [];
  for (const b of CR_BANDS)
    if (!byBand[b.id]) gaps.push({ what: 'challenge rating band', id: b.label });
  for (const t of CREATURE_TYPES) if (!byType[t]) gaps.push({ what: 'creature type', id: t });
  for (const s of SIZES) if (!bySize[s]) gaps.push({ what: 'size', id: s });
  for (const t of TRAITS) if (!traits[t.id]) gaps.push({ what: 'trait', id: t.label });
  const names = new Set(rows.map(m => m.name.toLowerCase()));
  return {
    total: rows.length,
    statBlocks: rows.filter(isStatBlock).length,
    distinctNames: names.size,
    byPack,
    byBook,
    byRules,
    byBand,
    byType,
    bySize,
    bandByType,
    traits,
    resistances,
    immunities,
    vulnerabilities,
    conditions,
    languages,
    gaps,
  };
}

/**
 * A short line of counts, largest first. @param {Record<string, number>} counts @param {number} [max]
 */
export function countsLine(counts, max = 12) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = entries.slice(0, max).map(([k, v]) => `${k} ${v}`);
  return shown.join(', ') + (entries.length > max ? `, and ${entries.length - max} more` : '');
}

/* -------------------------------------------- */
/*  Sampling                                     */
/* -------------------------------------------- */

/**
 * `n` rows spread evenly over the list (the first always in), so a cap keeps the variety of a
 * sorted list. @template T @param {T[]} list @param {number} n
 */
export function spread(list, n) {
  if (!Number.isFinite(n) || list.length <= n) return list;
  if (n <= 1) return list.slice(0, 1);
  /** @type {T[]} */
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return [...new Set(out)];
}

/**
 * The smoke sample: the first monster of every challenge rating band, of every creature type and
 * of every trait of the matrix, in list order, each once. A few dozen creatures that between them
 * show every kind the profile has.
 * @param {MonsterRow[]} rows
 */
export function sampleMonsters(rows) {
  /** @type {Set<MonsterRow>} */
  const picked = new Set();
  const firstWhere = (/** @type {(m: MonsterRow) => boolean} */ test) => {
    const m = rows.find(test);
    if (m) picked.add(m);
  };
  for (const b of CR_BANDS) firstWhere(m => crBand(m.cr) === b.id);
  for (const t of CREATURE_TYPES) firstWhere(m => m.creatureType === t);
  for (const s of SIZES) firstWhere(m => m.size === s);
  for (const t of TRAITS) firstWhere(t.has);
  return rows.filter(m => picked.has(m));
}

/* -------------------------------------------- */
/*  The broad pass: one action each              */
/* -------------------------------------------- */

/**
 * What inspectFeatures returns for an npc.
 * @typedef {import('./features.mjs').FeatureFacts & {npc?: any}} MonsterFacts
 */

/**
 * The tier of an activity as the monster's one action: lower goes first. An attack on an action
 * of a weapon or feature is the best, a spell the last resort.
 * @param {FeatureItem} item @param {FeatureActivity} activity
 */
function tierOf(item, activity) {
  const isSpell = item.type === 'spell';
  const act = activity.activation;
  if (!isSpell && activity.type === 'attack' && act === 'action') return 0;
  if (!isSpell && activity.type === 'attack') return 1;
  if (!isSpell && ['action', 'bonus', 'reaction'].includes(act)) return 2;
  if (!isSpell) return 3;
  return 4;
}

/**
 * The one action a monster uses in the broad pass, and what it leaves out and why. Same
 * exclusions as the hero pass (a dialog, an activity the system says cannot be used, removing
 * exhaustion), plus: nothing is used from the legendary or lair pool in this pass.
 * @param {MonsterFacts} facts
 * @returns {{planned: {item: FeatureItem, activity: FeatureActivity} | null, skipped: Array<{item: string, activity: string, why: string}>, candidates: number}}
 */
export function planMonsterUse(facts) {
  /** @type {Array<{item: FeatureItem, activity: FeatureActivity, tier: number, order: number}>} */
  const candidates = [];
  /** @type {Array<{item: string, activity: string, why: string}>} */
  const skipped = [];
  let order = 0;
  for (const item of facts.items) {
    for (const activity of item.activities) {
      const why = SKIP_ACTIVITY_TYPES[activity.type]
        ? SKIP_ACTIVITY_TYPES[activity.type]
        : !activity.canUse
          ? 'the system says the activity cannot be used'
          : activity.consumption.some(c => c.type === 'attribute' && /exhaustion/.test(c.target))
            ? 'it removes exhaustion levels'
            : ['legendary', 'lair'].includes(activity.activation)
              ? 'a legendary or lair action is checked in monsters-odd'
              : '';
      if (why) skipped.push({ item: item.name, activity: activity.type, why });
      else candidates.push({ item, activity, tier: tierOf(item, activity), order: order++ });
    }
  }
  candidates.sort((a, b) => a.tier - b.tier || a.order - b.order);
  const best = candidates[0];
  return {
    planned: best ? { item: best.item, activity: best.activity } : null,
    skipped,
    candidates: candidates.length,
  };
}

/**
 * The world copy against the compendium row it came from: what create-from-compendium must keep.
 * A difference is SYSTEM (Foundry or the system changed the data on the way).
 * @param {MonsterRow} row
 * @param {MonsterFacts} facts
 * @returns {Problem[]}
 */
export function judgeCopy(row, facts) {
  /** @type {Problem[]} */
  const problems = [];
  const npc = facts.npc;
  if (!npc) {
    bad(
      problems,
      'KIT',
      'the copy is not an npc',
      `${row.name}: inspectFeatures gave no npc facts`
    );
    return problems;
  }
  /** @param {string} what @param {unknown} got @param {unknown} want */
  const same = (what, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want))
      bad(
        problems,
        'SYSTEM',
        'the copy differs from the compendium entry',
        `${row.name}: ${what} is ${JSON.stringify(got)}, the entry says ${JSON.stringify(want)}`
      );
  };
  same('challenge rating', npc.cr, row.cr);
  same('creature type', npc.creatureType, row.creatureType);
  same('size', npc.size, row.size);
  same('hit point maximum', facts.hp.max, row.hp);
  same('armor class', npc.ac, row.ac);
  same(
    'movement',
    { ...npc.movement },
    {
      walk: row.movement.walk,
      fly: row.movement.fly,
      swim: row.movement.swim,
      burrow: row.movement.burrow,
      climb: row.movement.climb,
      hover: row.movement.hover,
    }
  );
  same('legendary action uses', npc.resources?.legact?.max ?? 0, row.legact);
  same('legendary resistance uses', npc.resources?.legres?.max ?? 0, row.legres);
  same('lair', npc.resources?.lair?.value === true, row.lair);
  same('item count', facts.items.length, row.items);
  return problems;
}

/**
 * The bridge's view of the monster (the tool get-character) against Foundry's: a difference is
 * SYSTEM. One thing is only noted: dnd5e 6 gives every npc a spellcasting ability, and the bridge
 * reports `hasSpells` for any ability, so a monster with no spells can be shown as having them
 * (`notes` gets a line); a monster with spells the bridge does not show is a problem.
 * @param {MonsterRow} row
 * @param {any} reply   the tool result
 * @param {string[]} [notes]
 * @returns {Problem[]}
 */
export function judgeBridge(row, reply, notes = []) {
  /** @type {Problem[]} */
  const problems = [];
  const stats = reply?.stats ?? {};
  /** @param {string} what @param {unknown} got @param {unknown} want */
  const same = (what, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want))
      bad(
        problems,
        'SYSTEM',
        'the bridge disagrees with Foundry',
        `${row.name}: get-character ${what} is ${JSON.stringify(got)}, Foundry has ${JSON.stringify(want)}`
      );
  };
  same('type', reply?.type, 'npc');
  if (!isStatBlock(row)) {
    same('challenge rating', stats.challengeRating, row.cr);
    same('creature type', stats.creatureType, row.creatureType);
    same('hit point maximum', stats.hitPoints?.max, row.hp);
    same('armor class', stats.armorClass, row.ac);
  }
  same('size', stats.size, row.size);
  if (row.legact > 0) {
    same('legendary actions', stats.legendaryActions, { available: row.legact, max: row.legact });
  } else if (stats.legendaryActions && stats.legendaryActions.max > 0) {
    same('legendary actions', stats.legendaryActions, undefined);
  }
  const shown = Boolean(stats.spellcasting?.hasSpells);
  if (row.spell.spells > 0 && !shown) same('has spells', shown, true);
  else if (row.spell.spells === 0 && shown)
    notes.push(
      'the bridge says hasSpells and the monster has no spells (it has a spellcasting ability)'
    );
  return problems;
}

/* -------------------------------------------- */
/*  The odd mechanics                            */
/* -------------------------------------------- */

/**
 * @typedef {object} OddContext
 * @property {MonsterRow} row
 * @property {string} actorId           the probe copy
 * @property {MonsterFacts} facts       inspectFeatures of the copy
 * @property {(action: string, args?: object) => Promise<any>} call   a GM action
 * @property {(name: string, args?: object) => Promise<any>} tool     a bridge tool
 */

/**
 * @typedef {object} OddOutcome
 * @property {Problem[]} problems
 * @property {string[]} notes
 * @property {string} [skip]    why this monster does not apply after all
 */

/**
 * @typedef {object} OddCheck
 * @property {string} id
 * @property {string} title
 * @property {string} none           why the check is skipped when no monster applies
 * @property {(m: MonsterRow) => boolean} applies
 * @property {(ctx: OddContext) => Promise<OddOutcome>} run
 */

/** All activities of a monster with their items. @param {MonsterFacts} facts */
function allActivities(facts) {
  return facts.items.flatMap(item => item.activities.map(activity => ({ item, activity })));
}

/** Can the activity be used with no dialog? @param {FeatureActivity} a */
const usable = a => a.canUse && !(a.type in SKIP_ACTIVITY_TYPES);

/**
 * Uses one activity and judges it the way the broad pass does.
 * @param {OddContext} ctx @param {FeatureItem} item @param {FeatureActivity} activity
 */
async function useOnce(ctx, item, activity) {
  const result = await ctx.call('exerciseActor', {
    actorId: ctx.actorId,
    op: 'use',
    itemId: item.id,
    activityId: activity.id,
  });
  return { result, problems: judgeUse({ item, activity }, result) };
}

/** How many of a pool were spent by a use. @param {any} result @param {'legact' | 'legres'} key */
function spentBy(result, key) {
  const c = result.changed?.[`resources.${key}.spent`];
  return c ? Number(c.after) - Number(c.before) : 0;
}

/** Does an activity consume from a pool? @param {FeatureActivity} a @param {'legact' | 'legres'} key */
const consumesPool = (a, key) =>
  a.consumption.some(c => c.type === 'attribute' && c.target === `resources.${key}.value`);

/** @type {OddCheck[]} */
export const ODD_CHECKS = [
  {
    id: 'legendary-actions',
    title: 'The pool is there, the bridge shows it and a legendary action spends it',
    none: 'the profile has no monster with legendary actions',
    applies: m => m.legact > 0,
    async run(ctx) {
      /** @type {Problem[]} */
      const problems = [];
      /** @type {string[]} */
      const notes = [];
      const pool = ctx.facts.npc?.resources?.legact;
      if (!pool || pool.max !== ctx.row.legact || pool.spent !== 0)
        bad(
          problems,
          'SYSTEM',
          'the legendary pool is not full',
          `${ctx.row.name}: ${JSON.stringify(pool)}, the entry has ${ctx.row.legact} uses`
        );
      const reply = await ctx.tool('get-character', { identifier: ctx.actorId });
      const shown = reply?.stats?.legendaryActions;
      if (!shown || shown.max !== ctx.row.legact || shown.available !== ctx.row.legact)
        bad(
          problems,
          'SYSTEM',
          'the bridge does not show the pool',
          `${ctx.row.name}: get-character says ${JSON.stringify(shown)}, Foundry has ${ctx.row.legact}`
        );
      const legendary = allActivities(ctx.facts).filter(x => x.activity.activation === 'legendary');
      if (!legendary.length) {
        bad(
          problems,
          'CONTENT',
          'no legendary action to use',
          `${ctx.row.name} has a pool of ${ctx.row.legact} and no activity with the legendary activation`
        );
      }
      let spendsPool = 0;
      let noSpend = 0;
      let leftOut = 0;
      for (const { item, activity } of legendary) {
        if (!usable(activity)) {
          leftOut += 1;
          continue;
        }
        const { result, problems: own } = await useOnce(ctx, item, activity);
        problems.push(...own);
        if (own.length) continue;
        const cost = activity.activationValue ?? 1;
        const spent = spentBy(result, 'legact');
        if (consumesPool(activity, 'legact')) {
          if (spent !== cost)
            bad(
              problems,
              'SYSTEM',
              'a legendary action did not spend the pool',
              `${ctx.row.name} / ${item.name}: it consumes the pool and the pool changed by ${spent}, cost ${cost}`
            );
          else spendsPool += 1;
        } else if (spent === cost) {
          spendsPool += 1;
        } else if (spent === 0) {
          noSpend += 1;
          bad(
            problems,
            'CONTENT',
            'a legendary action does not spend the pool',
            `${ctx.row.name} / ${item.name}: costs ${cost} and consumes nothing from the pool, so using it in Foundry leaves the pips as they are`
          );
        } else {
          bad(
            problems,
            'SYSTEM',
            'a legendary action spent the wrong amount',
            `${ctx.row.name} / ${item.name}: cost ${cost}, the pool changed by ${spent}`
          );
        }
      }
      notes.push(
        `${legendary.length} legendary activities: ${spendsPool} spend the pool, ${noSpend} do not, ${leftOut} need a dialog`
      );
      return { problems, notes };
    },
  },
  {
    id: 'legendary-resistance',
    title: 'The legendary resistance feature spends one use of the pool',
    none: 'the profile has no monster with legendary resistance',
    applies: m => m.legres > 0,
    async run(ctx) {
      /** @type {Problem[]} */
      const problems = [];
      const pool = ctx.facts.npc?.resources?.legres;
      if (!pool || pool.max !== ctx.row.legres || pool.spent !== 0)
        bad(
          problems,
          'SYSTEM',
          'the legendary resistance pool is not full',
          `${ctx.row.name}: ${JSON.stringify(pool)}, the entry has ${ctx.row.legres} uses`
        );
      const feature = ctx.facts.items.find(i => /legendary resistance/i.test(i.name));
      if (!feature) {
        bad(
          problems,
          'CONTENT',
          'no legendary resistance feature',
          `${ctx.row.name} has a pool of ${ctx.row.legres} and no feature of that name`
        );
        return { problems, notes: [] };
      }
      const activity = feature.activities.find(usable);
      if (!activity) {
        bad(
          problems,
          'CONTENT',
          'legendary resistance cannot be used',
          `${ctx.row.name}: the feature has no activity to use`
        );
        return { problems, notes: [] };
      }
      const { result, problems: own } = await useOnce(ctx, feature, activity);
      problems.push(...own);
      if (!own.length) {
        const spent = spentBy(result, 'legres');
        if (consumesPool(activity, 'legres') ? spent !== 1 : spent === 0)
          bad(
            problems,
            consumesPool(activity, 'legres') ? 'SYSTEM' : 'CONTENT',
            'legendary resistance did not spend the pool',
            `${ctx.row.name}: the pool changed by ${spent}, expected 1${consumesPool(activity, 'legres') ? '' : ' (the activity consumes nothing from it)'}`
          );
      }
      return { problems, notes: [`pool of ${ctx.row.legres}`] };
    },
  },
  {
    id: 'lair-actions',
    title: 'The lair flag and the lair count are set; a lair action can be used',
    none: 'the profile has no monster with a lair',
    applies: m => m.lair,
    async run(ctx) {
      /** @type {Problem[]} */
      const problems = [];
      const lair = ctx.facts.npc?.resources?.lair;
      if (!lair || lair.value !== true)
        bad(
          problems,
          'SYSTEM',
          'the lair flag is lost',
          `${ctx.row.name}: ${JSON.stringify(lair)}`
        );
      else if (lair.initiative !== null && !(lair.initiative >= 1 && lair.initiative <= 30))
        bad(
          problems,
          'CONTENT',
          'odd lair initiative count',
          `${ctx.row.name}: ${lair.initiative}`
        );
      const own = allActivities(ctx.facts).filter(x => x.activity.activation === 'lair');
      if (!own.length)
        return {
          problems,
          notes: ['the lair has no lair action as an activity (the text only)'],
        };
      const first = own.find(x => usable(x.activity));
      if (first) problems.push(...(await useOnce(ctx, first.item, first.activity)).problems);
      return { problems, notes: [`${own.length} lair actions as activities`] };
    },
  },
  {
    id: 'regeneration',
    title: 'The regeneration feature is there, and what it can do in Foundry',
    none: 'the profile has no monster with regeneration',
    applies: m => m.odd.regeneration,
    async run(ctx) {
      /** @type {Problem[]} */
      const problems = [];
      const feature = ctx.facts.items.find(i => /regenerat/i.test(i.name));
      if (!feature) {
        bad(
          problems,
          'KIT',
          'the feature is missing',
          `${ctx.row.name}: no item named regeneration`
        );
        return { problems, notes: [] };
      }
      const activity = feature.activities.find(usable);
      if (activity) problems.push(...(await useOnce(ctx, feature, activity)).problems);
      return {
        problems,
        notes: [
          activity
            ? 'the feature has an activity'
            : 'the feature is text only: Foundry does not heal the monster by itself, the GM does',
        ],
      };
    },
  },
  {
    id: 'damage-threshold',
    title: 'A damage threshold is in the data',
    none: 'the profile has no monster with a damage threshold',
    applies: m => m.odd.damageThreshold,
    async run(ctx) {
      /** @type {Problem[]} */
      const problems = [];
      const feature = ctx.facts.items.find(i => /damage threshold/i.test(i.name));
      if (!feature)
        return { problems, notes: ['the threshold is a number on the actor, not a feature'] };
      const activity = feature.activities.find(usable);
      if (activity) problems.push(...(await useOnce(ctx, feature, activity)).problems);
      return {
        problems,
        notes: [activity ? 'the feature has an activity' : 'the feature is text only'],
      };
    },
  },
  {
    id: 'shapechangers',
    title:
      "A shapechanger has a feature that can be used, and its transform activities are the system's",
    none: 'the profile has no shapechanger',
    applies: m => m.odd.shapechanger,
    async run(ctx) {
      /** @type {Problem[]} */
      const problems = [];
      const features = ctx.facts.items.filter(i =>
        /shapechang|change shape|shape-?shift/i.test(i.name)
      );
      const transforms = allActivities(ctx.facts).filter(x => x.activity.type === 'transform');
      const refused = transforms.filter(x => !x.activity.canUse);
      for (const x of refused)
        bad(
          problems,
          'CONTENT',
          'a transform activity cannot be used',
          `${ctx.row.name} / ${x.item.name}: the system says it cannot be used`
        );
      const pick = features
        .flatMap(item => item.activities.map(activity => ({ item, activity })))
        .find(x => usable(x.activity));
      if (pick) problems.push(...(await useOnce(ctx, pick.item, pick.activity)).problems);
      return {
        problems,
        notes: [
          `${features.length} shape features, ${transforms.length} transform activities (a dialog, left out), ${pick ? 'one used' : 'no other activity to use (text only)'}`,
        ],
      };
    },
  },
  {
    id: 'movement-modes',
    title: "Fly, swim, burrow, climb and hover on the copy are the compendium's",
    none: 'the profile has no monster with a movement mode besides walking',
    applies: m => MOVE_MODES.some(k => m.movement[k] > 0) || m.movement.hover,
    async run(ctx) {
      /** @type {Problem[]} */
      const problems = [];
      const copy = ctx.facts.npc?.movement ?? {};
      const stored = ctx.facts.npc?.movementSource ?? {};
      for (const key of ['walk', ...MOVE_MODES, 'hover']) {
        const want = /** @type {any} */ (ctx.row.movement)[key];
        if (copy[key] !== want)
          bad(
            problems,
            'SYSTEM',
            'a movement speed changed in the copy',
            `${ctx.row.name}: ${key} is ${copy[key]}, the entry has ${want}`
          );
        if (stored[key] !== want)
          bad(
            problems,
            'SYSTEM',
            'a stored movement speed changed in the copy',
            `${ctx.row.name}: ${key} is stored as ${stored[key]}, the entry has ${want}`
          );
      }
      if (copy.hover && !(copy.fly > 0) && !isStatBlock(ctx.row))
        bad(
          problems,
          'CONTENT',
          'hover without flying',
          `${ctx.row.name}: hover with fly ${copy.fly}`
        );
      const modes = [...MOVE_MODES, 'hover'].filter(k =>
        k === 'hover' ? ctx.row.movement.hover : /** @type {any} */ (ctx.row.movement)[k] > 0
      );
      return { problems, notes: [modes.join(', ')] };
    },
  },
  {
    id: 'recharge',
    title: 'A recharge ability is used, and its recharge roll agrees with its target',
    none: 'the profile has no monster with a recharge ability',
    applies: m => m.odd.recharge > 0,
    async run(ctx) {
      /** @type {Problem[]} */
      const problems = [];
      const feature = ctx.facts.items.find(i =>
        (i.uses?.recovery ?? []).some(r => r.period === 'recharge')
      );
      if (!feature) {
        bad(problems, 'KIT', 'the recharge item is missing', `${ctx.row.name}: none in the copy`);
        return { problems, notes: [] };
      }
      const recovery = /** @type {any} */ (feature.uses).recovery.find(
        (/** @type {any} */ r) => r.period === 'recharge'
      );
      const target = parseInt(recovery.formula, 10);
      if (!(target >= 2 && target <= 6))
        bad(
          problems,
          'CONTENT',
          'odd recharge target',
          `${ctx.row.name} / ${feature.name}: "${recovery.formula}"`
        );
      if (!(feature.uses?.max && feature.uses.max >= 1))
        bad(
          problems,
          'CONTENT',
          'a recharge ability with no uses',
          `${ctx.row.name} / ${feature.name}: max ${feature.uses?.max}`
        );
      const activity = feature.activities.find(usable);
      if (activity) problems.push(...(await useOnce(ctx, feature, activity)).problems);
      const probe = await ctx.call('exerciseActor', {
        actorId: ctx.actorId,
        op: 'recharge',
        itemId: feature.id,
      });
      problems.push(...judgeRecharge(ctx.row.name, feature.name, probe));
      if (probe.restored === false)
        bad(
          problems,
          'KIT',
          'the monster was not put back',
          `${ctx.row.name}: ${(probe.drift ?? []).slice(0, 4).join(', ')}`
        );
      const wins = (probe.rolls ?? []).filter((/** @type {any} */ r) => r.success).length;
      return {
        problems,
        notes: [
          `recharge ${probe.target}: ${wins} of ${(probe.rolls ?? []).length} rolls recharged`,
        ],
      };
    },
  },
  {
    id: 'multiattack',
    title: 'Multiattack can be used and the monster has an attack to go with it',
    none: 'the profile has no monster with multiattack',
    applies: m => m.odd.multiattack,
    async run(ctx) {
      /** @type {Problem[]} */
      const problems = [];
      const feature = ctx.facts.items.find(i => /^multiattack/i.test(i.name));
      if (!feature) {
        bad(problems, 'KIT', 'the feature is missing', `${ctx.row.name}: no multiattack item`);
        return { problems, notes: [] };
      }
      const attacks = allActivities(ctx.facts).filter(x => x.activity.type === 'attack');
      if (!attacks.length)
        bad(
          problems,
          'CONTENT',
          'multiattack and no attack',
          `${ctx.row.name} has no activity of type attack`
        );
      const activity = feature.activities.find(usable);
      if (activity) problems.push(...(await useOnce(ctx, feature, activity)).problems);
      else
        bad(
          problems,
          'CONTENT',
          'multiattack cannot be used',
          `${ctx.row.name}: the feature has no activity to use`
        );
      return { problems, notes: [`${attacks.length} attack activities`] };
    },
  },
  {
    id: 'innate-spellcasting',
    title:
      'A spellcaster has an ability and a save DC, shows spells on the bridge, and a spell can be used',
    none: 'the profile has no monster with spells',
    applies: m => m.spell.spells > 0 || m.odd.innateSpellcasting,
    async run(ctx) {
      /** @type {Problem[]} */
      const problems = [];
      const spell = ctx.facts.npc?.spell ?? {};
      if (!spell.ability)
        bad(
          problems,
          'CONTENT',
          'spells and no spellcasting ability',
          `${ctx.row.name}: the ability is empty`
        );
      if (!(spell.dc > 0))
        bad(problems, 'CONTENT', 'spells and no save DC', `${ctx.row.name}: DC ${spell.dc}`);
      if (ctx.row.spell.spells > 0) {
        const reply = await ctx.tool('get-character', { identifier: ctx.actorId });
        if (!reply?.stats?.spellcasting?.hasSpells)
          bad(
            problems,
            'SYSTEM',
            'the bridge shows no spells',
            `${ctx.row.name}: get-character has hasSpells ${reply?.stats?.spellcasting?.hasSpells}, Foundry has ${ctx.row.spell.spells} spells`
          );
      }
      const pick = ctx.facts.items
        .filter(i => i.type === 'spell')
        .flatMap(item => item.activities.map(activity => ({ item, activity })))
        .find(x => usable(x.activity) && x.activity.activation !== 'legendary');
      if (pick) problems.push(...(await useOnce(ctx, pick.item, pick.activity)).problems);
      return {
        problems,
        notes: [
          `${ctx.row.spell.spells} spells, ${ctx.row.spell.innate ? 'innate' : 'prepared'}${pick ? ', one used' : ', no spell to use without a dialog'}`,
        ],
      };
    },
  },
];

/**
 * Judges the recharge probe: each roll must agree with the target, and a success puts the uses
 * back to 0 while a failure leaves them spent.
 * @param {string} who @param {string} feature @param {any} probe  the reply of exerciseActor op "recharge"
 * @returns {Problem[]}
 */
export function judgeRecharge(who, feature, probe) {
  /** @type {Problem[]} */
  const problems = [];
  for (const r of probe.rolls ?? []) {
    if (typeof r.total !== 'number') {
      bad(problems, 'SYSTEM', 'no recharge roll', `${who} / ${feature}: the system rolled nothing`);
      continue;
    }
    const want = r.total >= probe.target;
    if (r.success !== want)
      bad(
        problems,
        'SYSTEM',
        'the recharge roll disagrees with its target',
        `${who} / ${feature}: rolled ${r.total}, target ${probe.target}, success ${r.success}`
      );
    const spent = want ? 0 : probe.max;
    if (r.spentAfter !== spent)
      bad(
        problems,
        'SYSTEM',
        'the uses did not follow the recharge roll',
        `${who} / ${feature}: rolled ${r.total}, target ${probe.target}, spent ${r.spentAfter} of ${probe.max} (expected ${spent})`
      );
  }
  return problems;
}

/**
 * Runs one odd check over the monsters it applies to: for each, a probe copy is made, inspected,
 * handed to the check and always deleted again.
 * @param {OddCheck} check
 * @param {MonsterRow[]} rows           the monsters to probe (already capped)
 * @param {{call: (action: string, args?: object) => Promise<any>, tool: (name: string, args?: object) => Promise<any>, folderId?: string}} io
 * @returns {Promise<{checked: MonsterRow[], failed: Array<{row: MonsterRow, problems: Problem[]}>, notes: Array<{name: string, note: string}>}>}
 */
export async function runOddCheck(check, rows, io) {
  /** @type {MonsterRow[]} */
  const checked = [];
  /** @type {Array<{row: MonsterRow, problems: Problem[]}>} */
  const failed = [];
  /** @type {Array<{name: string, note: string}>} */
  const notes = [];
  for (const row of rows) {
    /** @type {OddOutcome} */
    let outcome;
    /** @type {string | null} */
    let actorId = null;
    try {
      const made = await io.call('createMonster', {
        packId: row.packId,
        itemId: row.id,
        ...(io.folderId ? { folderId: io.folderId } : {}),
      });
      actorId = made.actorId;
      const facts = await io.call('inspectFeatures', { actorId });
      outcome = await check.run({
        row,
        actorId: /** @type {string} */ (actorId),
        facts,
        call: io.call,
        tool: io.tool,
      });
    } catch (e) {
      outcome = {
        problems: [
          {
            kind: /** @type {FailureKind} */ ('KIT'),
            what: 'the check could not run',
            evidence: `${row.name}: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        notes: [],
      };
    } finally {
      if (actorId) await io.call('deleteMonsters', { actorIds: [actorId] }).catch(() => {});
    }
    if (outcome.skip) continue;
    checked.push(row);
    if (outcome.problems.length) failed.push({ row, problems: outcome.problems });
    if (outcome.notes.length) notes.push({ name: row.name, note: outcome.notes.join('; ') });
  }
  return { checked, failed, notes };
}

/* -------------------------------------------- */
/*  Which monsters a size probes                  */
/* -------------------------------------------- */

/** How many monsters of one odd check each size probes: a few, then all of them. */
export const ODD_CAPS = { smoke: 2, full: Infinity, long: Infinity };

/**
 * The monsters one odd check probes at a kit size: spread over the ones it applies to. The
 * movement check takes the cap for each mode, so every mode has an example.
 * @param {OddCheck} check
 * @param {MonsterRow[]} rows
 * @param {'smoke'|'full'|'long'} size
 */
export function pickOddRows(check, rows, size) {
  const cap = ODD_CAPS[size] ?? ODD_CAPS.smoke;
  const applicable = rows.filter(check.applies);
  if (check.id !== 'movement-modes') return spread(applicable, cap);
  const per = size === 'smoke' ? 1 : cap;
  /** @type {Set<MonsterRow>} */
  const picked = new Set();
  for (const mode of [...MOVE_MODES, 'hover']) {
    const has = (/** @type {MonsterRow} */ m) =>
      mode === 'hover' ? m.movement.hover : /** @type {any} */ (m.movement)[mode] > 0;
    for (const m of spread(applicable.filter(has), per)) picked.add(m);
  }
  return applicable.filter(m => picked.has(m));
}

/** @type {Map<string, Awaited<ReturnType<typeof readMonsters>>>} */
const listCache = new Map();

/**
 * The monsters of a profile's packs, read once per build and shared by the three monster scenarios.
 * @param {{kit: any, gm: (action: string, args?: object) => Promise<any>}} t
 * @param {string[]} packIds
 */
export async function monstersOf(t, packIds) {
  const key = `${t.kit?.world}|${t.kit?.profile}|${t.kit?.builtAt}|${packIds.join(',')}`;
  const hit = listCache.get(key);
  if (hit) return hit;
  const read = await readMonsters(packIds, (packId, from, count) =>
    t.gm('listMonsters', { packId, from, count })
  );
  listCache.clear();
  listCache.set(key, read);
  return read;
}
