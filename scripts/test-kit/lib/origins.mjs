/**
 * The checks of the origin scenarios (slice 3c), as pure functions: species, backgrounds, feats and
 * multiclassing. Each takes what the GM actions read (describeOrigin, describeClass, inspectBuild,
 * inspectActor, inspectFeatures, the answers createHero made) and returns problems classified
 * KIT, CONTENT or SYSTEM like the hero checks (advancement.mjs), with evidence.
 *
 * The oracle is the data of the document (what its own advancements say) plus a few rules written
 * down here: the 2024 multiclass spellcaster table (caster level), Pact Magic, hit points, the
 * proficiency bonus. A difference from the data is SYSTEM (the dnd5e system did not do what the
 * data says), a difference between the data and the rules is CONTENT, a mistake of the kit is KIT.
 */
import { RULES, expectedSlots, stepValue } from './features.mjs';
import { findingId } from './studio-compare.mjs';

/** @typedef {import('./advancement.mjs').Problem} Problem */
/** @typedef {import('./advancement.mjs').FailureKind} FailureKind */

export const ABILITY_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** @param {unknown} v */
const text = v => (v === null || v === undefined ? 'none' : String(v));

/**
 * `n` entries spread over a list: the first, the last and evenly in between. Smoke runs use it.
 * @template T
 * @param {T[]} list
 * @param {number} n
 * @returns {T[]}
 */
export function sampleEvenly(list, n) {
  if (list.length <= n) return [...list];
  if (n <= 1) return list.slice(0, 1);
  /** @type {T[]} */
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const at = Math.round((i * (list.length - 1)) / (n - 1));
    if (!out.includes(list[at])) out.push(list[at]);
  }
  return out;
}

/**
 * The entries a profile's selection keeps: rules version, names and id pattern to skip, and one
 * entry per name (the 2024 one when both versions exist, else the first pack's). Sorted by name.
 * @template {{name: string, id: string, rules: string, packId?: string}} E
 * @param {E[]} entries in pack order
 * @param {{rules: string[], skipNames?: string[], skipIds?: string}} select
 * @returns {E[]}
 */
export function selectOrigins(entries, select) {
  const skipNames = new Set((select.skipNames ?? []).map(n => n.toLowerCase()));
  const skipIds = select.skipIds ? new RegExp(select.skipIds) : null;
  const rulesOf = (/** @type {E} */ e) => (e.rules === '2024' ? '2024' : '2014');
  /** @type {Map<string, E>} */
  const byName = new Map();
  for (const e of entries) {
    if (!select.rules.includes(rulesOf(e))) continue;
    if (skipNames.has(e.name.toLowerCase())) continue;
    if (skipIds?.test(e.id)) continue;
    const key = e.name.toLowerCase();
    const have = byName.get(key);
    if (!have || (rulesOf(have) === '2014' && rulesOf(e) === '2024')) byName.set(key, e);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/**
 * Gives each problem a finding id (category and what it says, the same for every document), the
 * key of the expected-findings list.
 * @param {string} category
 * @param {Problem[]} problems
 * @returns {Array<Problem & {id: string}>}
 */
export function withIds(category, problems) {
  return problems.map(p => ({ ...p, id: findingId(category, p.what) }));
}

/* -------------------------------------------- */
/*  Reading what the build left on the actor      */
/* -------------------------------------------- */

/**
 * Whether the actor holds what a Trait key grants: true, false, or null when the kit cannot tell.
 * Keys look like `skills:ath`, `saves:str`, `languages:standard:common`, `weapon:mar`, `armor:lgt`,
 * `tool:art:alchemist`, `dr:fire`, `di:poison`, `ci:charmed`.
 * @param {string} key
 * @param {{skills: Record<string, number>, saves: Record<string, boolean>, proficiencies: {languages: string[],
 *   weapons: string[], armor: string[], tools: string[], damageResistances: string[], damageImmunities: string[],
 *   conditionImmunities: string[]}}} build
 * @returns {boolean | null}
 */
export function traitHeld(key, build) {
  const parts = String(key).split(':');
  const kind = parts[0];
  const last = parts[parts.length - 1];
  if (!last || last === '*') return null;
  const has = (/** @type {string[] | undefined} */ list) => (list ?? []).includes(last);
  switch (kind) {
    case 'skills':
      return Number(build.skills?.[last] ?? 0) >= 1;
    case 'saves':
      return !!build.saves?.[last];
    case 'languages':
      return parts.length >= 3 ? has(build.proficiencies?.languages) : null;
    case 'weapon':
      return has(build.proficiencies?.weapons);
    case 'armor':
      return has(build.proficiencies?.armor);
    case 'tool':
      return parts.length >= 3 ? has(build.proficiencies?.tools) : null;
    case 'dr':
      return has(build.proficiencies?.damageResistances);
    case 'di':
      return has(build.proficiencies?.damageImmunities);
    case 'ci':
      return has(build.proficiencies?.conditionImmunities);
    default:
      return null;
  }
}

/** The item id at the end of an item uuid (the same item in two packs shares it). @param {string} uuid */
function idOf(uuid) {
  return String(uuid).split('.').pop() ?? '';
}

/** True when a Trait pool still had an option the hero did not hold (so a skipped pick was ours). */
function poolHasOpenOption(pool, build) {
  if (!pool.length) return true;
  return pool.some(key => traitHeld(key, build) !== true);
}

/**
 * The ability increases a hero's answers made, `{str: 2, dex: 1}`. Reads the picks of the
 * AbilityScoreImprovement advancements ("str +2").
 * @param {Array<{advancement: string, chosen: string[]}>} picks
 * @param {string} [owner]  only picks whose title starts with "<owner>: "
 * @returns {Record<string, number>}
 */
export function pickedIncreases(picks, owner) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const p of picks ?? []) {
    if (p.advancement !== 'AbilityScoreImprovement') continue;
    if (owner && !String(/** @type {any} */ (p).title ?? '').startsWith(`${owner}: `)) continue;
    for (const c of p.chosen ?? []) {
      const m = /^([a-z]+) \+(\d+)$/.exec(String(c));
      if (m) out[m[1]] = (out[m[1]] ?? 0) + Number(m[2]);
    }
  }
  return out;
}

/**
 * The names of the items an origin item made: itself and everything whose advancement origin leads
 * back to it (a species' features, a background's origin feat and that feat's own grants).
 * @param {{items: Array<{type: string, name: string, origin: {item: string} | null}>}} build
 * @param {string} rootLabel  "race:Name"
 * @returns {Set<string>} labels "type:name"
 */
export function descendants(build, rootLabel) {
  const labels = new Set([rootLabel]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of build.items) {
      const label = `${item.type}:${item.name}`;
      if (labels.has(label)) continue;
      if (item.origin && labels.has(item.origin.item)) {
        labels.add(label);
        grew = true;
      }
    }
  }
  return labels;
}

/**
 * Items of a feature facts list that belong to some labels (by the build's own listing).
 * @template {{name: string, type: string, id: string}} I
 * @param {I[]} items
 * @param {Set<string>} labels
 * @returns {I[]}
 */
export function itemsOfLabels(items, labels) {
  return items.filter(i => labels.has(`${i.type}:${i.name}`));
}

/* -------------------------------------------- */
/*  Species, background, feat                     */
/* -------------------------------------------- */

const ROOT_TYPE = /** @type {const} */ ({
  species: 'race',
  background: 'background',
  feat: 'feat',
});

/**
 * Checks what a species, background or feat did to a hero against its own data.
 * @param {{
 *   kind: 'species'|'background'|'feat',
 *   uuid: string,
 *   desc: any,                               describeOrigin of the document
 *   hero: {picks?: any[], warnings?: string[]},   what createHero answered for this document
 *   build: any,                              inspectBuild after
 *   actor: any,                              inspectActor after
 *   base: Record<string, number>,            ability scores before the document was added
 *   hostBuild?: any,                         inspectBuild before (a feat added to a host)
 *   chosenSize?: string | null,
 *   skipScores?: boolean,                    leave the ability scores to the caller (a feat a background grants)
 * }} input
 * @returns {{problems: Problem[], notes: string[], summary: string}}
 */
export function checkOrigin({
  kind,
  uuid,
  desc,
  hero,
  build,
  actor,
  base,
  hostBuild,
  chosenSize,
  skipScores = false,
}) {
  /** @type {Problem[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  /** @param {FailureKind} k @param {string} what @param {string} evidence */
  const bad = (k, what, evidence) => problems.push({ kind: k, what, evidence });
  const name = String(desc.name);
  const warnings = hero.warnings ?? [];
  const mine = (hero.picks ?? []).filter(p => String(p.title).startsWith(`${name}: `));
  const items = /** @type {Array<{name: string, type: string, sourceUuid: string}>} */ (
    build.items ?? []
  );
  const byName = new Map(items.map(i => [i.name.toLowerCase(), i]));
  const bySource = new Map(items.filter(i => i.sourceUuid).map(i => [i.sourceUuid, i]));
  const present = (/** @type {string} */ itemUuid, /** @type {string} */ itemName) =>
    bySource.has(itemUuid) || (!!itemName && byName.has(itemName.toLowerCase()));

  // The item itself.
  const rootType = ROOT_TYPE[kind];
  const root = items.find(i => i.type === rootType && (i.sourceUuid === uuid || i.name === name));
  if (!root) bad('SYSTEM', `${kind} item missing`, `the actor has no ${rootType} item "${name}"`);
  else if (root.sourceUuid && root.sourceUuid !== uuid) {
    // The same item of another pack (a module's copy of a system item) is not a mix-up: say so.
    if (idOf(root.sourceUuid) === idOf(uuid))
      notes.push(
        `the ${kind} item comes from ${root.sourceUuid}, the data grants ${uuid} (same item id)`
      );
    else bad('KIT', `${kind} item`, `built from ${root.sourceUuid}, planned ${uuid}`);
  }

  const everyAdvancement = /** @type {any[]} */ (desc.advancements ?? []);
  if (!everyAdvancement.length && kind !== 'feat')
    bad('CONTENT', 'no advancements', `the ${kind} has no advancement at all`);
  // An advancement of a higher level (a species feature at level 5, say) waits for the hero to get there.
  const heroLevel = Math.max(
    1,
    Object.values(actor.classes ?? {}).reduce(
      (/** @type {number} */ n, /** @type {any} */ c) => n + Number(c?.levels ?? 0),
      0
    )
  );
  const advancements = everyAdvancement.filter(
    a =>
      !(a.levels ?? []).length || (a.levels ?? []).some((/** @type {number} */ l) => l <= heroLevel)
  );
  for (const a of everyAdvancement)
    if (!advancements.includes(a))
      notes.push(
        `${a.title}: waits for level ${Math.min(...a.levels)} (the hero is level ${heroLevel}), not checked`
      );

  let granted = 0;
  let traitsHeld = 0;
  let choicesAsked = 0;
  for (const adv of advancements) {
    if (adv.classRestriction === 'secondary') continue;
    if (adv.type === 'ItemGrant') {
      for (const g of adv.items ?? []) {
        if (adv.optional || g.optional) continue;
        if (!g.resolved) {
          bad('CONTENT', 'grant does not resolve', `${name}: ${adv.title}: ${g.uuid}`);
          continue;
        }
        if (present(g.uuid, g.name)) granted += 1;
        else
          bad(
            warnings.length ? 'KIT' : 'SYSTEM',
            'grant missing',
            `${name}: ${adv.title}: ${g.name || g.uuid} is not on the actor; warnings: ${warnings.join(' / ') || 'none'}`
          );
      }
    } else if (adv.type === 'Trait') {
      if (adv.mode && adv.mode !== 'default') {
        notes.push(`${adv.title}: a ${adv.mode} trait is not checked`);
        continue;
      }
      for (const key of adv.grants ?? []) {
        const held = traitHeld(key, build);
        if (held === null) notes.push(`${key} cannot be read from the actor`);
        else if (held) traitsHeld += 1;
        else
          bad(
            'SYSTEM',
            'trait grant missing',
            `${name}: ${adv.title}: the actor does not hold ${key}`
          );
      }
      const asked = (adv.choices ?? []).reduce(
        (/** @type {number} */ n, /** @type {any} */ c) => n + Number(c.count ?? 0),
        0
      );
      if (asked) {
        choicesAsked += asked;
        const picks = mine.filter(
          p => p.advancement === 'Trait' && String(p.title) === `${name}: ${adv.title}`
        );
        const chosen = picks.flatMap(p => p.chosen ?? []);
        for (const key of chosen) {
          if (traitHeld(key, build) === false)
            bad(
              'SYSTEM',
              'trait choice missing',
              `${name}: ${adv.title}: ${key} was chosen but is not held`
            );
        }
        if (chosen.length < asked) {
          const pool = (adv.choices ?? []).flatMap((/** @type {any} */ c) => c.pool ?? []);
          // A choice with no pool offers nothing: the system skips it. That is the data's, not the builder's.
          if (!pool.length)
            bad(
              'CONTENT',
              'trait choice with an empty pool',
              `${name}: ${adv.title}: the data asks for ${asked}, the choice has no pool to choose from`
            );
          else if (poolHasOpenOption(pool, build))
            bad(
              'KIT',
              'trait choice not made',
              `${name}: ${adv.title}: the data asks for ${asked}, the builder made ${chosen.length}`
            );
          else notes.push(`${adv.title}: ${asked - chosen.length} choice(s) had no option left`);
        }
      }
    } else if (adv.type === 'ItemChoice') {
      // Only the choices of levels the hero has reached (a feat that learns more spells as you level).
      const asked = (adv.itemChoices ?? [])
        .filter((/** @type {any} */ c) => Number(c.level ?? 0) <= heroLevel)
        .reduce((/** @type {number} */ n, /** @type {any} */ c) => n + Number(c.count ?? 0), 0);
      if (!asked) continue;
      choicesAsked += asked;
      const picks = mine.filter(
        p =>
          p.advancement === 'ItemChoice' &&
          !String(p.title).endsWith('(ability)') &&
          String(p.title) === `${name}: ${adv.title}`
      );
      const chosen = picks.flatMap(p => p.chosen ?? []);
      const lacking = chosen.filter(
        (/** @type {string} */ n) => !byName.has(String(n).toLowerCase())
      );
      if (lacking.length)
        bad(
          'SYSTEM',
          'picked items missing',
          `${name}: ${adv.title}: ${lacking.join(', ')} chosen, not on the actor`
        );
      if (chosen.length < asked) {
        const related = warnings.filter(w => w.startsWith(`${name}: ${adv.title}`));
        /** @type {FailureKind} */
        let k = 'KIT';
        if (related.some(w => /no options offered/.test(w))) k = 'CONTENT';
        else if (related.some(w => /refused/.test(w))) k = 'SYSTEM';
        bad(
          k,
          'item choice not made',
          `${name}: ${adv.title}: the data asks for ${asked}, the builder made ${chosen.length}${related.length ? `; ${related.join(' / ')}` : ''}`
        );
      }
    } else if (adv.type === 'AbilityScoreImprovement') {
      const asi = adv.asi ?? {};
      const made = pickedIncreases(mine, name);
      const sum = Object.values(made).reduce((a, b) => a + b, 0);
      const tookFeat = mine.some(
        p =>
          p.advancement === 'AbilityScoreImprovement' &&
          (p.chosen ?? []).some((/** @type {string} */ c) => /^feat: /.test(c))
      );
      if (asi.points > 0 && !tookFeat) {
        choicesAsked += 1;
        if (!sum)
          bad(
            'KIT',
            'ability score increase not made',
            `${name}: ${adv.title}: ${asi.points} points to spend, none spent`
          );
        else if (sum !== asi.points)
          bad(
            warnings.length ? 'KIT' : 'SYSTEM',
            'ability score points',
            `${name}: ${adv.title}: ${sum} points spent of ${asi.points}`
          );
        for (const [ability, n] of Object.entries(made)) {
          if (n > asi.cap)
            bad(
              'SYSTEM',
              'ability score cap',
              `${name}: ${adv.title}: ${ability} +${n}, the cap is ${asi.cap}`
            );
          if ((asi.locked ?? []).includes(ability))
            bad(
              'SYSTEM',
              'locked ability raised',
              `${name}: ${adv.title}: ${ability} is locked and was raised`
            );
        }
      }
    }
  }

  // Ability scores: the base plus every increase the answers made (all documents), plus this
  // document's own fixed increases, capped at 20 (or the advancement's own maximum).
  const all = pickedIncreases(hero.picks ?? []);
  const fixed = Object.fromEntries(
    advancements
      .filter(a => a.type === 'AbilityScoreImprovement')
      .flatMap(a => Object.entries(a.asi?.fixed ?? {}))
  );
  const cap = Math.max(
    20,
    ...advancements.map(a => (typeof a.asi?.max === 'number' ? a.asi.max : 0))
  );
  for (const id of skipScores ? [] : ABILITY_IDS) {
    const want = Math.min(cap, (base[id] ?? 10) + (all[id] ?? 0) + Number(fixed[id] ?? 0));
    const got = actor.abilities?.[id]?.value;
    if (got !== want)
      bad(
        'SYSTEM',
        'ability score',
        `${id} is ${text(got)}, the base ${text(base[id])} plus the increases is ${want}`
      );
  }

  // Species only: size, speed and movement modes, senses.
  if (kind === 'species') {
    const sizeAdv = advancements.find(a => a.type === 'Size');
    const sizes = /** @type {string[]} */ (sizeAdv?.sizes ?? []);
    if (!sizeAdv) notes.push('the species has no Size advancement');
    else if (!sizes.length) bad('CONTENT', 'size', 'the Size advancement offers no size');
    else if (chosenSize && build.size !== chosenSize)
      bad('SYSTEM', 'size', `the answer was ${chosenSize}, the actor is ${text(build.size)}`);
    else if (!sizes.includes(build.size))
      bad(
        'SYSTEM',
        'size',
        `the actor is ${text(build.size)}, the species allows ${sizes.join(', ')}`
      );
    for (const [mode, v] of Object.entries(desc.movement ?? {})) {
      if (build.movement?.[mode] !== v)
        bad(
          'SYSTEM',
          'movement',
          `${mode}: the species says ${v}, the actor has ${text(build.movement?.[mode])}`
        );
    }
    if (!Object.keys(desc.movement ?? {}).length) notes.push('the species data has no movement');
    for (const [sense, v] of Object.entries(desc.senses ?? {})) {
      if (sense === 'special') continue;
      // A granted feature may raise a sense (a superior darkvision); a lower one is the problem.
      const have = Number(build.senses?.[sense] ?? 0);
      if (have > v)
        notes.push(`${sense}: the species says ${v}, the actor has ${have} (a feature raised it)`);
      else if (have !== v)
        bad(
          'SYSTEM',
          'senses',
          `${sense}: the species says ${v}, the actor has ${text(build.senses?.[sense])}`
        );
    }
  }

  // A feat added to a host: nothing the host had is gone, and the feat itself is new.
  if (kind === 'feat' && hostBuild) {
    const count = (/** @type {any[]} */ list) => {
      const m = new Map();
      for (const i of list) m.set(`${i.type}:${i.name}`, (m.get(`${i.type}:${i.name}`) ?? 0) + 1);
      return m;
    };
    const before = count(hostBuild.items ?? []);
    const after = count(items);
    const lost = [...before].filter(([k, n]) => (after.get(k) ?? 0) < n).map(([k]) => k);
    if (lost.length)
      bad('SYSTEM', 'items lost', `taking the feat removed ${lost.slice(0, 5).join(', ')}`);
    if (root && (before.get(`feat:${name}`) ?? 0) >= (after.get(`feat:${name}`) ?? 0))
      bad('SYSTEM', 'feat not added', `the host already had ${name} or it was not added`);
  }

  const effects = /** @type {any[]} */ (desc.effects ?? []);
  const active = effects.filter(e => e.transfer && !e.disabled).length;
  if (effects.length) notes.push(`${effects.length} effect(s), ${active} always on`);
  if (kind === 'background' && desc.startingEquipment)
    notes.push(
      `${desc.startingEquipment} starting equipment entries: the system adds them only through a dialog, so the kit does not apply them`
    );

  const summary =
    `${granted} grants, ${traitsHeld} trait grants held, ${choicesAsked} choices` +
    `${notes.length ? `; ${notes.join('; ')}` : ''}`;
  return { problems, notes, summary };
}

/* -------------------------------------------- */
/*  Feat hosts                                    */
/* -------------------------------------------- */

/**
 * The hosts a feat may be added to, tried in order. A host is a kit hero of a class at a level; the
 * first one whose scores and level meet the feat's prerequisites takes it. Each host is tried as
 * built, then with every score raised to 15 (a table would do that to take a feat that asks for
 * Charisma 13). A feat no host can take is recorded as unmet, never forced.
 */
export const FEAT_HOSTS = [
  { id: 'fighter-1', classId: 'fighter', level: 1 },
  { id: 'fighter-4', classId: 'fighter', level: 4 },
  { id: 'wizard-4', classId: 'wizard', level: 4 },
  { id: 'fighter-19', classId: 'fighter', level: 19 },
  { id: 'wizard-19', classId: 'wizard', level: 19 },
];

/** The score every ability is raised to on a boosted host. */
export const HOST_FLOOR = 15;

/**
 * The feats a smoke run takes: the first and the last of each feat type.
 * @template {{name: string, featType?: string}} F
 * @param {F[]} feats sorted by name
 * @returns {F[]}
 */
export function sampleFeats(feats) {
  /** @type {Map<string, F[]>} */
  const byType = new Map();
  for (const f of feats) {
    const t = f.featType ?? 'general';
    byType.set(t, [...(byType.get(t) ?? []), f]);
  }
  /** @type {F[]} */
  const out = [];
  for (const list of byType.values()) out.push(...sampleEvenly(list, 2));
  return out;
}

/* -------------------------------------------- */
/*  Multiclass                                    */
/* -------------------------------------------- */

/**
 * The multiclass heroes, by class identifier. A class that the profile does not have skips its
 * combination. `third` takes the first subclass of fighter or rogue that casts as a third caster;
 * the profile may have none.
 * @type {Array<{id: string, why: string, classes: Array<[string, number]>, smoke?: boolean, third?: boolean}>}
 */
export const MULTICLASS_PLAN = [
  {
    id: 'martial-full',
    why: 'a martial class and a full caster',
    classes: [
      ['fighter', 3],
      ['wizard', 3],
    ],
    smoke: true,
  },
  {
    id: 'full-full',
    why: 'two full casters add their levels',
    classes: [
      ['wizard', 4],
      ['cleric', 4],
    ],
  },
  {
    id: 'half-full',
    why: 'a half caster and a full caster',
    classes: [
      ['paladin', 5],
      ['sorcerer', 3],
    ],
    smoke: true,
  },
  {
    id: 'half-half',
    why: 'two half casters',
    classes: [
      ['ranger', 4],
      ['paladin', 4],
    ],
  },
  {
    id: 'pact-full',
    why: 'Pact Magic stays apart from the slot table',
    classes: [
      ['wizard', 3],
      ['warlock', 3],
    ],
    smoke: true,
  },
  {
    id: 'three-way',
    why: 'three classes, one with Pact Magic',
    classes: [
      ['cleric', 2],
      ['druid', 2],
      ['warlock', 2],
    ],
  },
  {
    id: 'no-casters',
    why: 'no spellcasting at all',
    classes: [
      ['barbarian', 3],
      ['monk', 3],
    ],
    smoke: true,
  },
  {
    id: 'skills',
    why: 'a class that gains skills and a half caster',
    classes: [
      ['rogue', 3],
      ['ranger', 3],
    ],
  },
  {
    id: 'half-martial',
    why: 'a half caster and a class that is not one',
    classes: [
      ['paladin', 6],
      ['rogue', 2],
    ],
  },
  {
    id: 'level-one',
    why: 'one level each',
    classes: [
      ['cleric', 1],
      ['wizard', 1],
    ],
  },
  {
    id: 'high-level',
    why: 'a high level hero',
    classes: [
      ['fighter', 11],
      ['wizard', 9],
    ],
  },
  {
    id: 'third-caster',
    why: 'a third caster subclass',
    classes: [
      ['fighter', 6],
      ['wizard', 3],
    ],
    third: true,
  },
];

/**
 * The ability scores of a multiclass hero: the primary abilities the classes ask for at 15, Constitution
 * 13, the rest lower. A class asks for all of its primary abilities or for any one of them.
 * @param {Array<{primaryAbility: string[], primaryAll?: boolean}>} descs
 * @returns {Record<string, number>}
 */
export function multiclassAbilities(descs) {
  /** @type {Set<string>} */
  const need = new Set();
  for (const d of descs) {
    const list = d.primaryAbility ?? [];
    if (!list.length) continue;
    if (d.primaryAll) for (const a of list) need.add(a);
    else if (!list.some(a => need.has(a))) need.add(list[0]);
  }
  /** @type {Record<string, number>} */
  const out = {};
  const rest = [13, 12, 10, 10, 8, 8];
  for (const id of ABILITY_IDS) out[id] = need.has(id) ? 15 : (rest.shift() ?? 8);
  if (!need.has('con')) out.con = 13;
  return out;
}

/**
 * The caster level one class adds to the multiclass table. Full casters add their levels, half casters
 * half of them (rounded up in the 2024 rules, down in the 2014 rules), third casters a third (down).
 * Pact Magic adds nothing: it has its own slots.
 * @param {{progression: string | null, levels: number, rules: string}} c
 * @returns {number}
 */
export function casterLevelOf({ progression, levels, rules }) {
  switch (progression) {
    case 'full':
      return levels;
    case 'half':
    case 'artificer':
      return rules === '2024' ? Math.ceil(levels / 2) : Math.floor(levels / 2);
    case 'third':
      return Math.floor(levels / 3);
    default:
      return 0;
  }
}

/**
 * The slots the multiclass rules give: the leveled slots from the combined caster level and Pact
 * Magic from the warlock levels alone.
 * @param {Array<{progression: string | null, levels: number, rules: string}>} classes
 * @returns {{casterLevel: number, leveled: Record<string, number>, pact: {max: number, level: number} | null}}
 */
export function multiclassSlots(classes) {
  const casterLevel = classes.reduce((n, c) => n + casterLevelOf(c), 0);
  const leveled = casterLevel
    ? (expectedSlots('wizard', '2024', Math.min(casterLevel, 20)) ?? {})
    : {};
  const pactLevels = classes
    .filter(c => c.progression === 'pact')
    .reduce((n, c) => n + c.levels, 0);
  const max = pactLevels ? stepValue(RULES.pactSlots, pactLevels) : null;
  const slotLevel = pactLevels ? stepValue(RULES.pactLevel, pactLevels) : null;
  return {
    casterLevel,
    leveled: { ...leveled },
    pact: max && slotLevel ? { max, level: slotLevel } : null,
  };
}

/**
 * Checks the proficiencies a class gave when it was added as a further class: no saving throw of
 * its own, the multiclass-only advancements applied and nothing of the first-class set.
 * @param {{desc: any, before: any, after: any, picks: any[], className: string, featureGrants?: string[]}} input
 *   desc: describeOrigin of the added class; before/after: inspectBuild; picks: createHero's picks for the addition;
 *   featureGrants: trait keys the features the hero chose carry (a chosen Divine Order's martial weapons)
 * @returns {{problems: Problem[], notes: string[]}}
 */
export function checkMulticlassProficiencies({
  desc,
  before,
  after,
  picks,
  className,
  featureGrants = [],
}) {
  /** @type {Problem[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  const advancements = /** @type {any[]} */ (desc.advancements ?? []).filter(
    a => a.type === 'Trait' && (a.levels ?? []).some((/** @type {number} */ l) => l <= 1)
  );
  const fixed = new Set(
    advancements
      .filter(a => a.classRestriction !== 'primary' && (!a.mode || a.mode === 'default'))
      .flatMap(a => a.grants ?? [])
  );
  const chosen = new Set(
    (picks ?? []).filter(p => p.advancement === 'Trait').flatMap(p => p.chosen ?? [])
  );
  const primaryOnly = new Set(
    advancements.filter(a => a.classRestriction === 'primary').flatMap(a => a.grants ?? [])
  );
  // Saving throws: none gained.
  const gainedSaves = Object.keys(after.saves ?? {}).filter(
    id => after.saves[id] && !before.saves?.[id]
  );
  if (gainedSaves.length)
    problems.push({
      kind: 'SYSTEM',
      what: 'multiclass saving throws',
      evidence: `${className} added saving throw proficiency in ${gainedSaves.join(', ')}; a second class gives none`,
    });
  // Fixed multiclass grants are held.
  for (const key of fixed) {
    if (traitHeld(key, after) === false)
      problems.push({
        kind: 'SYSTEM',
        what: 'multiclass proficiency missing',
        evidence: `${className}: the multiclass advancement grants ${key}, the actor does not hold it`,
      });
  }
  // Nothing gained beyond the multiclass set, the choices made and the class's own non-restricted grants.
  /** @type {string[]} */
  const gained = [];
  const diff = (
    /** @type {string} */ prefix,
    /** @type {string[]} */ a,
    /** @type {string[]} */ b
  ) => {
    for (const x of b ?? []) if (!(a ?? []).includes(x)) gained.push(`${prefix}:${x}`);
  };
  diff('weapon', before.proficiencies?.weapons, after.proficiencies?.weapons);
  diff('armor', before.proficiencies?.armor, after.proficiencies?.armor);
  diff('tool', before.proficiencies?.tools, after.proficiencies?.tools);
  for (const id of Object.keys(after.skills ?? {}))
    if (Number(after.skills[id]) >= 1 && Number(before.skills?.[id] ?? 0) < 1)
      gained.push(`skills:${id}`);
  const allowed = (/** @type {string} */ g) => {
    const [kind, id] = g.split(':');
    const matches = (/** @type {string} */ key) => {
      const parts = key.split(':');
      return parts[0] === kind && parts[parts.length - 1] === id;
    };
    return [...fixed, ...chosen, ...featureGrants].some(k => matches(String(k)));
  };
  const extra = gained.filter(g => !allowed(g));
  if (extra.length) {
    const fromPrimary = extra.filter(g =>
      [...primaryOnly].some(
        k => k.split(':').pop() === g.split(':')[1] && k.split(':')[0] === g.split(':')[0]
      )
    );
    problems.push({
      kind: 'SYSTEM',
      what: 'proficiencies beyond the multiclass set',
      evidence: `${className} added ${extra.slice(0, 8).join(', ')}${fromPrimary.length ? ` (${fromPrimary.join(', ')} belong to the first class only)` : ''}`,
    });
  }
  if (!advancements.some(a => a.classRestriction === 'secondary'))
    notes.push(
      `${className} has no multiclass-only advancement: it gains ${gained.length ? gained.join(', ') : 'no proficiency'}`
    );
  return { problems, notes };
}

/**
 * Checks a finished multiclass hero.
 * @param {{
 *   classes: Array<{identifier: string, name: string, levels: number, rules: string, expected: any, desc: any,
 *     picks: any[]}>,
 *   actor: any,                 inspectActor
 *   facts: any,                 inspectFeatures
 *   build: any,                 inspectBuild
 *   base: Record<string, number>,
 *   warnings: string[],
 * }} input
 * @returns {{problems: Problem[], notes: string[], summary: string}}
 */
export function checkMulticlass({ classes, actor, facts, build, base, warnings }) {
  /** @type {Problem[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  /** @param {FailureKind} k @param {string} what @param {string} evidence */
  const bad = (k, what, evidence) => problems.push({ kind: k, what, evidence });
  const total = classes.reduce((n, c) => n + c.levels, 0);

  // Prerequisites of the ability scores the kit itself set.
  for (const c of classes) {
    const list = /** @type {string[]} */ (c.desc.primaryAbility ?? []);
    if (!list.length) {
      notes.push(`${c.name} names no primary ability`);
      continue;
    }
    const scores = list.map(a => base[a] ?? 0);
    const ok = c.desc.primaryAll ? scores.every(v => v >= 13) : scores.some(v => v >= 13);
    if (!ok)
      bad(
        'KIT',
        'multiclass prerequisite',
        `${c.name} needs 13 in ${list.join(c.desc.primaryAll ? ' and ' : ' or ')}, the kit set ${scores.join('/')}`
      );
  }

  // Class levels and the total.
  for (const c of classes) {
    const have = (actor.classes ?? []).find(
      (/** @type {any} */ x) => x.identifier === c.identifier
    );
    if (!have || have.levels !== c.levels)
      bad(
        'SYSTEM',
        'class level',
        `expected ${c.identifier} ${c.levels}, the actor has ${JSON.stringify(actor.classes)}`
      );
  }
  if (actor.level !== total)
    bad('SYSTEM', 'character level', `expected ${total}, the actor has ${text(actor.level)}`);
  const prof = 2 + Math.floor((total - 1) / 4);
  if (facts.prof !== prof)
    bad(
      'SYSTEM',
      'proficiency bonus',
      `expected +${prof} at level ${total}, the actor has +${text(facts.prof)}`
    );
  for (const c of classes) {
    const hd = (facts.hd?.classes ?? []).find(
      (/** @type {any} */ x) => x.identifier === c.identifier
    );
    if (!hd || hd.levels !== c.levels || hd.denomination !== c.expected.hitDie)
      bad(
        'SYSTEM',
        'hit dice',
        `${c.identifier}: expected ${c.levels}${c.expected.hitDie}, the actor has ${hd ? `${hd.levels}${hd.denomination}` : 'none'}`
      );
  }
  if (facts.hd?.max !== total)
    bad('SYSTEM', 'hit dice total', `expected ${total}, the actor has ${text(facts.hd?.max)}`);

  // Hit points: the first class at full first level, every other level the average.
  const conMod = actor.abilities?.con?.mod ?? 0;
  const bonusLevel = actor.hp?.bonuses?.level ?? 0;
  const bonusOverall = actor.hp?.bonuses?.overall ?? 0;
  const fixed = classes.reduce((n, c) => n + c.expected.hpFixed, 0);
  const hpWant = fixed + conMod * total + bonusLevel * total + bonusOverall;
  if (actor.hp?.max !== hpWant)
    bad(
      'KIT',
      'hit points',
      `max ${text(actor.hp?.max)}, expected ${hpWant} = ${classes.map(c => c.expected.hpFixed).join(' + ')} (die averages) + ${conMod} CON x ${total}${bonusLevel || bonusOverall ? ` + bonuses ${bonusLevel}/level and ${bonusOverall}` : ''}`
    );
  if (actor.hp?.value !== actor.hp?.max)
    bad('KIT', 'current hit points', `${text(actor.hp?.value)} of ${text(actor.hp?.max)}`);

  // Spell slots by the multiclass rules (2024 classes only: the 2014 rounding differs).
  // describeClass already looks at the subclass when its level is reached.
  const casting = classes.map(c => ({
    progression: c.expected.spellcasting?.progression ?? null,
    levels: c.levels,
    rules: c.rules,
  }));
  const halfOld = casting.some(
    c => ['half', 'artificer'].includes(String(c.progression)) && c.rules !== '2024'
  );
  const want = multiclassSlots(casting);
  if (halfOld && casting.length > 1)
    notes.push('a 2014 half caster rounds differently: the slot table is not checked');
  else {
    for (let n = 1; n <= 9; n += 1) {
      const w = want.leveled[String(n)] ?? 0;
      const g = actor.spells?.[`spell${n}`]?.max ?? 0;
      if (w !== g)
        bad(
          'SYSTEM',
          `spell slots, level ${n}`,
          `caster level ${want.casterLevel} gives ${w}, the actor has ${g}`
        );
    }
    const pactGot = actor.spells?.pact?.max
      ? { max: actor.spells.pact.max, level: actor.spells.pact.level }
      : null;
    if (JSON.stringify(want.pact) !== JSON.stringify(pactGot))
      bad(
        'SYSTEM',
        'pact slots',
        `the warlock levels give ${JSON.stringify(want.pact)}, the actor has ${JSON.stringify(pactGot)}`
      );
    if (
      facts.spells &&
      Object.entries(facts.spells).some(
        ([k, s]) => k !== 'pact' && /** @type {any} */ (s).value !== /** @type {any} */ (s).max
      )
    )
      bad('KIT', 'slots start full', 'a new hero should have every slot ready');
  }

  // Features from both classes: every grant the data gives up to that class level is on the actor.
  const items = /** @type {Array<{name: string, sourceUuid: string | null}>} */ (actor.items ?? []);
  const bySource = new Set(items.map(i => i.sourceUuid).filter(Boolean));
  const byName = new Set(items.map(i => i.name.toLowerCase()));
  let granted = 0;
  for (const c of classes) {
    for (const g of c.expected.grants ?? []) {
      if (g.optional) continue;
      if (g.resolved === false) {
        bad(
          'CONTENT',
          'grant does not resolve',
          `${c.name} level ${g.level}: ${g.uuid}${g.why ? ` (${g.why})` : ''}`
        );
        continue;
      }
      if (bySource.has(g.uuid) || (g.name && byName.has(g.name.toLowerCase()))) granted += 1;
      else
        bad(
          warnings.length ? 'KIT' : 'SYSTEM',
          'grant missing',
          `${c.name}: ${g.name || g.uuid} (level ${g.level}) is not on the actor; warnings: ${warnings.join(' / ') || 'none'}`
        );
    }
    // Scale values of each class.
    const have = actor.scale?.[c.identifier] ?? {};
    for (const s of c.expected.scale ?? []) {
      if (!(s.identifier in have))
        bad(
          'SYSTEM',
          `scale value ${s.identifier}`,
          `${c.name}: expected ${text(s.value)}, the actor has none`
        );
      else if (text(have[s.identifier]) !== text(s.value))
        bad(
          'SYSTEM',
          `scale value ${s.identifier}`,
          `${c.name}: expected ${text(s.value)}, the actor has ${text(have[s.identifier])}`
        );
    }
    // Choices: per advancement type, the data asks for N, the builder made N.
    for (const type of ['ItemChoice', 'AbilityScoreImprovement']) {
      const asked = (c.expected.choices ?? [])
        .filter((/** @type {any} */ x) => x.advancement === type)
        .reduce((/** @type {number} */ n, /** @type {any} */ x) => n + x.count, 0);
      const made = (c.picks ?? [])
        .filter(
          p =>
            p.advancement === type && !String(p.title).endsWith('(ability)') && Number(p.level) >= 1
        )
        .reduce(
          (/** @type {number} */ n, p) =>
            n + (type === 'AbilityScoreImprovement' ? 1 : (p.chosen ?? []).length),
          0
        );
      if (made !== asked) {
        const related = warnings.filter(w => w.startsWith(`${c.name}`));
        bad(
          related.some(w => /refused/.test(w)) ? 'SYSTEM' : 'KIT',
          `${type} choices`,
          `${c.name}: the data asks for ${asked}, the builder made ${made}${related.length ? `; ${related.join(' / ')}` : ''}`
        );
      }
    }
  }
  void build;
  const summary =
    `${classes.map(c => `${c.identifier} ${c.levels}`).join(' / ')}: HP ${text(actor.hp?.max)}, ${granted} grants, ` +
    `caster level ${want.casterLevel}${want.pact ? `, pact ${want.pact.max} at level ${want.pact.level}` : ''}` +
    `${notes.length ? `; ${notes.join('; ')}` : ''}`;
  return { problems, notes, summary };
}
