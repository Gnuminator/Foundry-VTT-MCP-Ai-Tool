/**
 * The checks of the two spell scenarios, as pure functions (no Foundry, no I/O). The GM actions
 * `listSpells` and `exerciseSpell` (lib/gm-spells.mjs) are the only things that touch Foundry; the
 * scenarios call them and hand the results to the functions here.
 *
 * - `selectSpells`, `sampleSpells`, `casterCandidates`, `casterFor` and `judgeCast` belong to
 *   spells-cast-all (every spell cast once).
 * - `DEEP_SPELL_CHECKS` (in lib/spells-deep.mjs) belongs to spells-deep (about thirty rule checks).
 *
 * Every problem is classified like in advancement.mjs: KIT (our code or our check), CONTENT (the
 * imported data differs from the published rules) or SYSTEM (dnd5e did something other than its
 * own data says).
 */

/** @typedef {import('./advancement.mjs').Problem} Problem */
/** @typedef {import('./advancement.mjs').FailureKind} FailureKind */

/**
 * @typedef {object} SpellEntry what the GM action listSpells returns per spell
 * @property {string} packId
 * @property {string} id
 * @property {string} uuid
 * @property {string} name
 * @property {number} level
 * @property {string} school
 * @property {string} rules
 * @property {string} book
 * @property {boolean} ritual
 * @property {boolean} concentration
 * @property {string[]} activities
 * @property {string} template
 * @property {string[]} [hints]  for a spell with no activity: what its description says it does (save, attack, damage, heal, summon)
 */

/** Pushes one problem. @param {Problem[]} problems @param {FailureKind} kind @param {string} what @param {string} evidence */
export const bad = (problems, kind, what, evidence) => problems.push({ kind, what, evidence });

/* -------------------------------------------- */
/*  Which spells                                  */
/* -------------------------------------------- */

/**
 * The spells the profile counts: its rules versions only, and each name once per rules version (the
 * first pack that has it wins, like the builder does for classes).
 * @param {SpellEntry[]} entries
 * @param {{rules: string[], skipNames?: string[]}} [select]
 * @returns {SpellEntry[]}
 */
export function selectSpells(entries, select = { rules: ['2024', '2014'] }) {
  const seen = new Set();
  const skip = new Set((select.skipNames ?? []).map(n => n.toLowerCase()));
  /** @type {SpellEntry[]} */
  const out = [];
  for (const e of entries) {
    if (e.rules && !select.rules.includes(e.rules)) continue;
    if (skip.has(e.name.toLowerCase())) continue;
    const key = `${e.name.toLowerCase()}|${e.rules}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * A small, repeatable sample of the spells for the smoke size: the first and last spell of every
 * level, the first spell of every kind of first activity and of every area shape, a concentration
 * spell, a ritual, then an even stride up to `max`. Sorted by level and name.
 * @param {SpellEntry[]} entries
 * @param {number} [max]
 * @returns {SpellEntry[]}
 */
export function sampleSpells(entries, max = 30) {
  const sorted = [...entries].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  /** @type {Map<string, SpellEntry>} */
  const picked = new Map();
  const take = (/** @type {SpellEntry | undefined} */ e) => {
    if (e && !picked.has(e.uuid)) picked.set(e.uuid, e);
  };
  for (let level = 0; level <= 9; level += 1) {
    const ofLevel = sorted.filter(e => e.level === level);
    take(ofLevel[0]);
    take(ofLevel[ofLevel.length - 1]);
  }
  for (const type of new Set(sorted.map(e => e.activities[0]).filter(Boolean)))
    take(sorted.find(e => e.activities[0] === type));
  for (const shape of new Set(sorted.map(e => e.template).filter(Boolean)))
    take(sorted.find(e => e.template === shape));
  take(sorted.find(e => e.concentration));
  take(sorted.find(e => e.ritual));
  const stride = Math.max(1, Math.floor(sorted.length / max));
  for (let i = 0; picked.size < max && i < sorted.length; i += stride) take(sorted[i]);
  return sorted.filter(e => picked.has(e.uuid));
}

/** The classes that cast spells, in the order the kit prefers them as the caster. */
export const CASTER_CLASSES = [
  'wizard',
  'sorcerer',
  'cleric',
  'druid',
  'bard',
  'warlock',
  'paladin',
  'ranger',
  'artificer',
];

/**
 * The best hero of each spellcasting class (the highest level; the first on a tie), best first.
 * @param {Array<{classIdentifier: string, level: number, actorId?: string}>} heroes
 */
export function casterCandidates(heroes) {
  /** @type {Map<string, any>} */
  const best = new Map();
  for (const h of heroes) {
    if (!CASTER_CLASSES.includes(h.classIdentifier)) continue;
    const have = best.get(h.classIdentifier);
    if (!have || h.level > have.level) best.set(h.classIdentifier, h);
  }
  return [...best.values()].sort(
    (a, b) =>
      b.level - a.level ||
      CASTER_CLASSES.indexOf(a.classIdentifier) - CASTER_CLASSES.indexOf(b.classIdentifier)
  );
}

/**
 * The caster for a spell of a level: the first candidate that has slots of that level by its own
 * class table (so the cast takes a real slot), else the first candidate (the cast forces a slot).
 * @template {{hero: any, facts: {spells: Record<string, {max: number}>}}} C
 * @param {number} level
 * @param {C[]} candidates
 * @returns {C | undefined}
 */
export function casterFor(level, candidates) {
  if (level === 0) return candidates[0];
  return candidates.find(c => (c.facts.spells[`spell${level}`]?.max ?? 0) > 0) ?? candidates[0];
}

/* -------------------------------------------- */
/*  The broad pass: every spell once              */
/* -------------------------------------------- */

/**
 * @typedef {object} CastResponse what the GM action exerciseSpell returns
 * @property {any[]} casts
 * @property {{ability: string, abilityMod: number | null, attack: number | null, dc: number | null, mod: number | null, prof: number | null, level: number | null}} [caster]
 * @property {string | null} error
 * @property {boolean} restored
 * @property {string[]} drift
 */

/**
 * Why the system refused a cast, from what it said:
 * - a slot problem when the kit forced a slot is the kit's: KIT,
 * - an activity that uses an item or a resource the actor does not have is bad data: CONTENT,
 * - anything else: SYSTEM.
 * @param {string} text
 * @param {{slotKey?: string | null, slotForced?: boolean}} cast
 * @returns {{kind: FailureKind, note: string}}
 */
export function refusalOfCast(text, cast) {
  if (/slot/i.test(text) && cast.slotKey && cast.slotForced)
    return { kind: 'KIT', note: ' (the kit forced a slot and the system still found none)' };
  if (/could not be found|not enough uses|no uses on/i.test(text))
    return { kind: 'CONTENT', note: ' (the spell consumes something the actor does not have)' };
  return { kind: 'SYSTEM', note: '' };
}

/**
 * The kind of an error a cast threw.
 * @param {string} message
 * @returns {FailureKind}
 */
export function throwKind(message) {
  return /could not be found|no spell |no item/i.test(message) ? 'CONTENT' : 'SYSTEM';
}

/** The activity types the dnd5e system has. Any other type in an imported spell is dropped when the item loads. */
export const SYSTEM_ACTIVITY_TYPES = [
  'attack',
  'cast',
  'check',
  'damage',
  'enchant',
  'forward',
  'heal',
  'order',
  'save',
  'summon',
  'teleport',
  'transform',
  'utility',
];

/**
 * What a spell with no activity is: nothing to roll, or data that lost its activity.
 * - `foreign`: every activity in the pack is of a type the system does not have (an importer's macro
 *   activity, say), so the item loads with none: CONTENT; the fix is the system spell of the same
 *   name when there is one, else the module that provides the type, or a re-import;
 * - `lost`: the same spell in the system's own pack (`reference`) has activities and this one has
 *   none: CONTENT, copy them from there;
 * - `described`: the system ships it with no activity too, or there is no counterpart and the
 *   description has nothing to roll: expected, not a problem;
 * - `rollable`: no counterpart and the description mentions a save, an attack, damage, healing or a
 *   summon: CONTENT, add the activity or re-import.
 * @param {SpellEntry} entry
 * @param {SpellEntry | undefined} reference the same spell (by name) in the system's own spell pack
 * @returns {{expected: boolean, kind: 'foreign' | 'lost' | 'described' | 'rollable', why: string, route: string}}
 */
export function classifyNoActivity(entry, reference) {
  const types = entry.activities ?? [];
  const foreign = types.filter(t => !SYSTEM_ACTIVITY_TYPES.includes(t));
  const own = reference?.activities?.length ?? 0;
  if (types.length && foreign.length === types.length) {
    return {
      expected: false,
      kind: 'foreign',
      why: `every activity is of a type the system does not have (${[...new Set(foreign)].join(', ')}), so the item loads with none`,
      route: own
        ? 'copy the activities from the system spell of the same name'
        : 'enable the module that provides the activity type, or re-import the spell',
    };
  }
  if (own) {
    return {
      expected: false,
      kind: 'lost',
      why: `the system's own pack has ${own} activity(ies) (${[...new Set(reference?.activities)].join(', ')}) for this spell`,
      route: 'copy the activities from the system spell of the same name',
    };
  }
  if (reference) {
    return {
      expected: true,
      kind: 'described',
      why: 'the system ships this spell with no activity either',
      route: '',
    };
  }
  const hints = entry.hints ?? [];
  if (hints.length) {
    return {
      expected: false,
      kind: 'rollable',
      why: `no system counterpart; the description mentions ${hints.join(', ')}`,
      route: 'add the activity by hand or re-import from a source that has it',
    };
  }
  return {
    expected: true,
    kind: 'described',
    why: 'a description-only spell (nothing in it to roll)',
    route: '',
  };
}

/**
 * Judges one cast of the broad pass.
 * @param {SpellEntry} entry
 * @param {CastResponse} res
 * @param {SpellEntry} [reference] the same spell in the system's own pack, when there is one
 * @returns {Problem[]}
 */
export function judgeCast(entry, res, reference) {
  /** @type {Problem[]} */
  const problems = [];
  const who = `${entry.name} (level ${entry.level})`;
  const cast = res.casts?.[0];
  if (res.error) {
    bad(problems, 'KIT', 'the GM action failed', `${who}: ${res.error}`);
  } else if (!cast) {
    bad(problems, 'KIT', 'the GM action returned no cast', who);
  } else if (cast.skipped) {
    // Left out with a reason (every activity of the spell asks for a dialog): not a problem.
  } else if (cast.noActivities) {
    // A description-only spell is expected; one that lost its activity is CONTENT, with the reason.
    const kind = classifyNoActivity(entry, reference);
    if (!kind.expected)
      bad(problems, 'CONTENT', 'the spell has no activity', `${who}: ${kind.why}`);
  } else if (cast.threw) {
    bad(problems, throwKind(cast.threw), 'the cast threw', `${who}: ${cast.threw}`);
  } else if (!cast.ok) {
    const errors = (cast.notes ?? [])
      .filter((/** @type {any} */ n) => n.level === 'error')
      .map((/** @type {any} */ n) => n.message);
    const text = errors.join(' / ') || 'the cast returned nothing and gave no message';
    const refusal = refusalOfCast(text, cast);
    bad(problems, refusal.kind, 'the system refused the cast', `${who}: ${text}${refusal.note}`);
  } else {
    if (!cast.chatCard) bad(problems, 'SYSTEM', 'no chat card', `${who}: the cast posted no card`);
    // A slot is taken when the activity consumes one and the spell has a level; never for a cantrip.
    const changed = Object.entries(cast.spells ?? {});
    const wantSlot = cast.facts?.consumesSlot && cast.level > 0 && cast.method === 'spell';
    if (wantSlot) {
      const slot = cast.slotKey;
      const before = cast.slotBefore?.value;
      const after = cast.slotAfter?.value;
      if (typeof before === 'number' && typeof after === 'number' && after !== before - 1) {
        bad(
          problems,
          'SYSTEM',
          'slot consumed',
          `${who}: ${slot} went from ${before} to ${after}, one slot should go`
        );
      }
      const others = changed.filter(([k]) => k !== slot).map(([k]) => k);
      if (others.length)
        bad(
          problems,
          'SYSTEM',
          'wrong slot',
          `${who}: ${others.join(', ')} changed besides ${slot}`
        );
    } else if (changed.length) {
      bad(
        problems,
        'SYSTEM',
        'slot consumed',
        `${who}: ${changed.map(([k, v]) => `${k} ${v.before} to ${v.after}`).join(', ')} although it should take none`
      );
    }
    if (cast.facts?.concentration && !(cast.concentrating?.length > 0)) {
      bad(
        problems,
        'SYSTEM',
        'no concentration',
        `${who}: the activity needs concentration and no concentration effect was made`
      );
    }
  }
  if (res.restored === false) {
    bad(
      problems,
      'KIT',
      'the hero was not put back',
      `${who}: ${(res.drift ?? []).slice(0, 4).join(', ') || 'state differs'}`
    );
  }
  return problems;
}
