/**
 * Compares a hero built in Actor Studio with the raw kit hero of the same class, level and
 * choices. Pure functions, no Foundry: the inputs are what the GM actions returned for each hero
 * (inspectActor, inspectFeatures, inspectBuild) and the picks each build made.
 *
 * Every difference is a problem with a kind and its evidence:
 * - STUDIO: Actor Studio made something other than the plain system route does, with the same
 *   choices (a missing feature, a different hit point total, an advancement left unset).
 * - KIT: our side is wrong or the comparison is not fair: the two heroes made different choices
 *   (the answer pump was asked in another order), or the pump reported an error. A KIT problem
 *   about the choices explains the differences that depend on them, which are then only notes.
 * - SYSTEM, CONTENT: a difference traced to the dnd5e system or to the imported data. The
 *   comparison cannot tell these apart by itself; `classify` is the place to say so when a
 *   finding is understood (see KNOWN).
 */

import { builtHeroes } from './helpers.mjs';

/** @typedef {'KIT'|'CONTENT'|'SYSTEM'|'STUDIO'} StudioKind */
/**
 * @typedef {{kind: StudioKind, what: string, evidence: string, category?: string, id?: string}} StudioProblem
 *   `id` names the finding independent of the class and the hero ("advancement values:advancement-value-of-size"),
 *   so a list of expected findings can match it.
 */

export const STUDIO_KINDS = /** @type {const} */ (['KIT', 'CONTENT', 'SYSTEM', 'STUDIO']);

/** Advancement types whose items are the player's choice, not a grant. */
const CHOICE_TYPES = new Set(['ItemChoice', 'AbilityScoreImprovement', 'Trait']);

/** @param {unknown} v */
const str = v => (v === null || v === undefined ? 'none' : String(v));

/**
 * One pick as a comparable line. The subclass is picked by Actor Studio's own drop-down, so it is
 * not part of the pump's picks; the "(ability)" picks are kept.
 * @param {{level: number, advancement: string, title: string, chosen: string[]}} p
 */
export function pickLine(p) {
  return `${p.advancement} | ${p.title} | ${[...p.chosen].sort().join(', ')}`;
}

/**
 * The picks that can be compared: the level of a pick is not (the two builds count levels the same
 * way, but an answer given at another time is still the same answer), the subclass is Studio's own.
 * @param {Array<{level: number, advancement: string, title: string, chosen: string[]}> | undefined} picks
 */
export function comparablePicks(picks) {
  return (picks ?? []).filter(p => p.advancement !== 'Subclass').map(pickLine);
}

/** @param {string} text */
const slug = text =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/**
 * The name of a finding, the same for every class: its category and what it says.
 * @param {string} category
 * @param {string} what
 */
export function findingId(category, what) {
  return `${slug(category)}:${slug(what)}`;
}

/**
 * The id of a feature problem that only the Studio hero has. A feature that cannot run for want of a
 * spell slot is one finding (the empty slots), whatever the feature.
 * @param {string} line
 */
export function featureProblemId(line) {
  return /slots? available to spend/.test(line)
    ? 'feature-problems:no-slot-to-spend'
    : findingId('feature problems', line.slice(0, 70));
}

/**
 * The id of a console error: the hook it names, else the file it failed to load.
 * @param {string} message
 * @param {string} source
 */
export function consoleFindingId(message, source) {
  const hook = /for hook '([^']+)'/.exec(message)?.[1];
  if (hook) return `console:${hook}`;
  const file = String(source).split('?')[0].replace(/:\d+$/, '').split('/').pop();
  return `console:${file || slug(message)}`;
}

/**
 * Splits problems into the ones a list of expected findings names (same id and same kind) and the
 * new ones. A finding that changes kind is new.
 * @param {StudioProblem[]} problems
 * @param {Array<{id: string, kind: StudioKind, why?: string}>} expected
 * @returns {{expected: StudioProblem[], fresh: StudioProblem[], counts: Record<string, number>}}
 */
export function splitExpected(problems, expected) {
  const known = new Map(expected.map(e => [`${e.id}|${e.kind}`, e]));
  /** @type {StudioProblem[]} */
  const seen = [];
  /** @type {StudioProblem[]} */
  const fresh = [];
  /** @type {Record<string, number>} */
  const counts = {};
  for (const p of problems) {
    if (p.id && known.has(`${p.id}|${p.kind}`)) {
      seen.push(p);
      counts[p.id] = (counts[p.id] ?? 0) + 1;
    } else fresh.push(p);
  }
  return { expected: seen, fresh, counts };
}

/**
 * Multiset difference of two string lists.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {{onlyA: string[], onlyB: string[]}}
 */
export function multisetDiff(a, b) {
  const count = new Map();
  for (const x of b) count.set(x, (count.get(x) ?? 0) + 1);
  const onlyA = [];
  for (const x of a) {
    const n = count.get(x) ?? 0;
    if (n > 0) count.set(x, n - 1);
    else onlyA.push(x);
  }
  const onlyB = [];
  for (const [x, n] of count) for (let i = 0; i < n; i += 1) onlyB.push(x);
  return { onlyA, onlyB };
}

/** @param {string[]} list @param {number} [max] */
const brief = (list, max = 6) =>
  list.length > max
    ? `${list.slice(0, max).join('; ')}; and ${list.length - max} more`
    : list.join('; ');

/**
 * Differences that are understood, with the kind they belong to. A rule matches on the category
 * and a substring of the evidence; the first match wins. Add a rule when a live finding is traced.
 * @type {Array<{category: string, match: RegExp, kind: StudioKind, why: string}>}
 */
export const KNOWN = [
  {
    category: 'feature problems',
    match: /slots? available to spend/,
    kind: 'SYSTEM',
    why: 'a hero from Actor Studio has no slot to spend until a long rest (see spell slots a new hero can spend)',
  },
  {
    category: 'spell slots available',
    match: /the Studio hero has (spell|pact)/,
    kind: 'SYSTEM',
    why: 'the system leaves the slots of a new actor empty until a long rest; the raw builder fills them, and Actor Studio does not',
  },
  {
    category: 'advancement values',
    match: /"Size" \(Size\)/,
    kind: 'SYSTEM',
    why: 'the Human species offers Medium or Small and the system shows Small first; the raw route leaves the choice unset and both heroes are Small',
  },
];

/**
 * The kind of a problem: a known rule first, else the one the comparison gave.
 * @param {string} category
 * @param {StudioKind} kind
 * @param {string} evidence
 * @returns {{kind: StudioKind, why: string}}
 */
export function classify(category, kind, evidence) {
  for (const rule of KNOWN) {
    if (rule.category === category && rule.match.test(evidence))
      return { kind: rule.kind, why: rule.why };
  }
  return { kind, why: '' };
}

/**
 * Compare two heroes.
 * @param {{
 *   raw: Hero, studio: Hero, pumpErrors?: string[]
 * }} o
 * @typedef {{
 *   picks?: Array<{level: number, advancement: string, title: string, chosen: string[]}>,
 *   actor: any, features: any, build: any, spells?: {cantrips: number, spells: number} | null
 * }} Hero
 * @returns {{problems: StudioProblem[], notes: string[], sameChoices: boolean, summary: string,
 *   checked: Record<string, number>}}
 */
export function compareHeroes({ raw, studio, pumpErrors = [] }) {
  /** @type {StudioProblem[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {Record<string, number>} */
  const checked = {};
  /** @param {string} category @param {StudioKind} kind @param {string} what @param {string} evidence */
  const bad = (category, kind, what, evidence, idWhat = what) => {
    const c = classify(category, kind, evidence);
    problems.push({
      kind: c.kind,
      what,
      evidence: c.why ? `${evidence} (${c.why})` : evidence,
      category,
      id: findingId(category, idWhat),
    });
  };
  const tick = name => {
    checked[name] = (checked[name] ?? 0) + 1;
  };

  // 1. The choices. Without the same choices the choice-dependent checks only make notes.
  const picksDiff = multisetDiff(comparablePicks(raw.picks), comparablePicks(studio.picks));
  const sameChoices = !picksDiff.onlyA.length && !picksDiff.onlyB.length;
  tick('choices');
  if (!sameChoices) {
    bad(
      'choices',
      'KIT',
      'the two heroes made different choices',
      `only the raw hero: ${brief(picksDiff.onlyA, 4) || 'none'} | only the Studio hero: ${brief(picksDiff.onlyB, 4) || 'none'}`
    );
  }
  for (const e of pumpErrors) bad('pump', 'KIT', 'the answer pump reported an error', e);

  /** @param {string} category @param {string} what @param {string} evidence */
  const dependent = (category, what, evidence) => {
    if (sameChoices) bad(category, 'STUDIO', what, evidence);
    else notes.push(`${what}: ${evidence} (follows from the different choices)`);
  };

  // 2. What the class decides alone: classes, levels, subclass, hit dice, proficiency bonus.
  tick('classes');
  const classLine = a =>
    (a.actor.classes ?? [])
      .map(c => `${c.identifier} ${c.levels}${c.subclass ? ` (${c.subclass})` : ''}`)
      .sort()
      .join(', ');
  if (classLine(raw) !== classLine(studio))
    bad(
      'classes',
      'STUDIO',
      'class levels or subclass',
      `raw ${classLine(raw)}, Studio ${classLine(studio)}`
    );
  tick('level');
  if (raw.actor.level !== studio.actor.level)
    bad(
      'level',
      'STUDIO',
      'character level',
      `raw ${raw.actor.level}, Studio ${studio.actor.level}`
    );
  tick('hit dice');
  const hd = a =>
    `${a.features.hd?.max ?? 0}: ${(a.features.hd?.classes ?? []).map(c => `${c.levels}${c.denomination}`).join('+')}`;
  if (hd(raw) !== hd(studio))
    bad('hit dice', 'STUDIO', 'hit dice', `raw ${hd(raw)}, Studio ${hd(studio)}`);
  tick('proficiency bonus');
  if (raw.features.prof !== studio.features.prof)
    bad(
      'proficiency bonus',
      'STUDIO',
      'proficiency bonus',
      `raw ${raw.features.prof}, Studio ${studio.features.prof}`
    );

  // 3. Spell slots and scale values come from the class and the level, not from choices.
  tick('spell slots');
  const slots = a =>
    Object.entries(a.features.spells ?? {})
      .filter(([, s]) => s.max)
      .map(([k, s]) => `${k}:${s.max}${k === 'pact' ? `@${s.level}` : ''}`)
      .sort()
      .join(' ');
  if (slots(raw) !== slots(studio))
    bad(
      'spell slots',
      'STUDIO',
      'spell slots',
      `raw ${slots(raw) || 'none'}, Studio ${slots(studio) || 'none'}`
    );
  // A new hero is whole: full hit points and every spell slot ready. Against the hero itself, not the
  // raw twin: the scenarios that ran before may have hurt the raw hero.
  tick('spell slots available');
  const slotsLeft = a =>
    Object.entries(a.features.spells ?? {})
      .filter(([, s]) => s.max)
      .map(([k, s]) => `${k}:${s.value ?? 0}/${s.max}`)
      .sort();
  const emptySlots = slotsLeft(studio).filter(
    x => x.split(':')[1].split('/')[0] !== x.split('/')[1]
  );
  if (emptySlots.length)
    bad(
      'spell slots available',
      'STUDIO',
      'spell slots a new hero can spend',
      `the Studio hero has ${emptySlots.join(' ')}`
    );
  tick('current hit points');
  if (studio.actor.hp?.value !== studio.actor.hp?.max)
    // An effect that adds to the maximum (Draconic Resilience) raises the maximum, not the current value.
    bad(
      'current hit points',
      (studio.actor.hp?.sources ?? []).length ? 'SYSTEM' : 'STUDIO',
      'a new hero does not start at full hit points',
      `the Studio hero has ${studio.actor.hp?.value}/${studio.actor.hp?.max}` +
        ((studio.actor.hp?.sources ?? []).length
          ? ` (the system raises the maximum for an effect, not the current value: ${studio.actor.hp.sources.map(x => x.item).join(', ')})`
          : '')
    );
  tick('hit dice spent');
  const spentDice = (studio.features.hd?.classes ?? []).filter(c => (c.spent ?? 0) > 0);
  if (spentDice.length)
    bad(
      'hit dice spent',
      'STUDIO',
      'hit dice spent on a new hero',
      spentDice.map(c => `${c.identifier} ${c.spent}`).join(', ')
    );
  tick('scale values');
  const scale = a =>
    JSON.stringify(a.features.scale ?? {}, Object.keys(a.features.scale ?? {}).sort());
  const scaleLines = a =>
    Object.entries(a.features.scale ?? {}).flatMap(([cls, vals]) =>
      Object.entries(vals ?? {}).map(([id, v]) => `${cls}.${id}=${str(v)}`)
    );
  if (scale(raw) !== scale(studio) || scaleLines(raw).join() !== scaleLines(studio).join()) {
    const d = multisetDiff(scaleLines(raw), scaleLines(studio));
    bad(
      'scale values',
      'STUDIO',
      'scale values',
      `only raw: ${brief(d.onlyA) || 'none'} | only Studio: ${brief(d.onlyB) || 'none'}`
    );
  }
  tick('saving throws');
  const saves = a =>
    Object.entries(a.build.saves ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort()
      .join(',');
  if (saves(raw) !== saves(studio))
    bad(
      'saving throws',
      'STUDIO',
      'saving throw proficiencies',
      `raw ${saves(raw)}, Studio ${saves(studio)}`
    );

  // 4. What depends on the choices: abilities, hit points, armor class, skills, proficiencies.
  tick('ability scores');
  const abilities = a =>
    Object.entries(a.actor.abilities ?? {})
      .map(([k, v]) => `${k}${v.value}`)
      .join(' ');
  if (abilities(raw) !== abilities(studio))
    dependent(
      'ability scores',
      'ability scores',
      `raw ${abilities(raw)}, Studio ${abilities(studio)}`
    );
  tick('hit points');
  if (raw.actor.hp?.max !== studio.actor.hp?.max) {
    // Items whose effects add to the maximum (a feat, a subclass feature) decide the total: when the
    // two heroes carry different ones the system did it, from the items they have.
    const sources = a =>
      (a.actor.hp?.sources ?? [])
        .map(x => x.item)
        .sort()
        .join(', ');
    const evidence = `raw ${raw.actor.hp?.max}, Studio ${studio.actor.hp?.max}`;
    if (sources(raw) !== sources(studio)) {
      const why = `hit point effects differ: raw ${sources(raw) || 'none'}, Studio ${sources(studio) || 'none'}`;
      if (sameChoices) bad('hit points', 'SYSTEM', 'maximum hit points', `${evidence} (${why})`);
      else
        notes.push(`maximum hit points: ${evidence} (${why}; follows from the different choices)`);
    } else dependent('hit points', 'maximum hit points', evidence);
  }
  tick('armor class');
  const ac = a => `${str(a.features.ac?.value)} ${a.features.ac?.calc ?? ''}`.trim();
  if (ac(raw) !== ac(studio))
    dependent('armor class', 'armor class', `raw ${ac(raw)}, Studio ${ac(studio)}`);
  tick('skills');
  const skills = a =>
    Object.entries(a.build.skills ?? {})
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}${v}`)
      .sort()
      .join(',');
  if (skills(raw) !== skills(studio))
    dependent('skills', 'skill proficiencies', `raw ${skills(raw)}, Studio ${skills(studio)}`);
  for (const key of [
    'languages',
    'weapons',
    'armor',
    'tools',
    'damageResistances',
    'damageImmunities',
    'conditionImmunities',
  ]) {
    tick('proficiencies');
    const a = (raw.build.proficiencies?.[key] ?? []).join(',');
    const b = (studio.build.proficiencies?.[key] ?? []).join(',');
    if (a !== b) {
      const d = multisetDiff(
        raw.build.proficiencies?.[key] ?? [],
        studio.build.proficiencies?.[key] ?? []
      );
      dependent(
        'proficiencies',
        `${key}`,
        `only raw: ${brief(d.onlyA) || 'none'} | only Studio: ${brief(d.onlyB) || 'none'}`
      );
    }
  }
  tick('size and movement');
  const body = a =>
    `${a.build.size} ${JSON.stringify(a.build.movement ?? {}, Object.keys(a.build.movement ?? {}).sort())} ${JSON.stringify(a.build.senses ?? {}, Object.keys(a.build.senses ?? {}).sort())}`;
  if (body(raw) !== body(studio))
    bad(
      'size and movement',
      'STUDIO',
      'size, movement or senses',
      `raw ${body(raw)}, Studio ${body(studio)}`
    );

  // 5. Items. A grant is what an advancement gives with no choice; a choice item comes from a
  // choice (a skill, a feat, a spell). Spells are compared by count: Actor Studio picks them in
  // its own tab, the raw hero through the class's advancement.
  const advType = (hero, origin) => {
    if (!origin) return '';
    return (
      hero.build.advancements?.find(x => x.item === origin.item && x.id === origin.advancement)
        ?.type ?? ''
    );
  };
  const isSpell = i => i.type === 'spell';
  const nonSpellLines = (hero, wantChoice) =>
    (hero.build.items ?? [])
      .filter(i => !isSpell(i))
      .filter(i => CHOICE_TYPES.has(advType(hero, i.origin)) === wantChoice)
      .map(i => `${i.type}:${i.name}`);
  tick('granted items');
  {
    const d = multisetDiff(nonSpellLines(raw, false), nonSpellLines(studio, false));
    if (d.onlyA.length || d.onlyB.length)
      bad(
        'granted items',
        'STUDIO',
        'granted items',
        `only raw: ${brief(d.onlyA) || 'none'} | only Studio: ${brief(d.onlyB) || 'none'}`
      );
  }
  tick('chosen items');
  {
    const d = multisetDiff(nonSpellLines(raw, true), nonSpellLines(studio, true));
    if (d.onlyA.length || d.onlyB.length)
      dependent(
        'chosen items',
        'items from choices',
        `only raw: ${brief(d.onlyA) || 'none'} | only Studio: ${brief(d.onlyB) || 'none'}`
      );
  }
  tick('spells');
  {
    const spellsOf = hero => (hero.build.items ?? []).filter(isSpell);
    const d = multisetDiff(
      spellsOf(raw).map(i => i.name),
      spellsOf(studio).map(i => i.name)
    );
    const studioExtra = spellsOf(studio).filter(i => d.onlyB.includes(i.name));
    const cantrips = studioExtra.filter(i => (i.level ?? 0) === 0).length;
    if (d.onlyA.length) {
      // The raw hero has spells the Studio hero does not: the choices decide, or Studio lost them.
      dependent('spells', 'spells missing from the Studio hero', brief(d.onlyA, 6));
    }
    if (d.onlyB.length) {
      // The raw builder answers only the system's own advancement questions. A caster's class
      // spells (cantrips known, spellbook, prepared spells) are not asked there, so the raw hero
      // has none of them; Actor Studio's Spells tab adds them.
      bad(
        'spells',
        'KIT',
        'the raw hero has no class spells',
        `Actor Studio's Spells tab added ${d.onlyB.length} spells (${cantrips} cantrips, ${d.onlyB.length - cantrips} leveled): ${brief(d.onlyB, 5)}`
      );
    }
  }

  // 6. Advancement flags: where each item came from, and what each advancement holds.
  tick('item origins');
  {
    const originLine = (hero, i) =>
      `${i.type}:${i.name} <- ${i.origin ? `${i.origin.item} / ${i.origin.title}` : 'none'}${i.root ? ` [root ${i.root}]` : ''}`;
    const grants = hero =>
      (hero.build.items ?? [])
        .filter(i => !isSpell(i))
        .filter(i => !CHOICE_TYPES.has(advType(hero, i.origin)))
        .map(i => originLine(hero, i));
    const d = multisetDiff(grants(raw), grants(studio));
    if (d.onlyA.length || d.onlyB.length)
      bad(
        'item origins',
        'STUDIO',
        'advancement origin of items',
        `only raw: ${brief(d.onlyA, 3) || 'none'} | only Studio: ${brief(d.onlyB, 3) || 'none'}`
      );
  }
  tick('advancement values');
  {
    const byKey = hero =>
      new Map((hero.build.advancements ?? []).map(a => [`${a.item}#${a.title}#${a.level}`, a]));
    const ra = byKey(raw);
    const sa = byKey(studio);
    for (const [key, a] of ra) {
      const b = sa.get(key);
      if (!b) {
        bad(
          'advancement values',
          'STUDIO',
          'an advancement is missing',
          `${key} (${a.type}) is only on the raw hero`
        );
        continue;
      }
      const va = JSON.stringify(a.value);
      const vb = JSON.stringify(b.value);
      if (va === vb) continue;
      const evidence = `${a.item} "${a.title}" (${a.type}): raw ${va.slice(0, 160)} | Studio ${vb.slice(0, 160)}`;
      if (CHOICE_TYPES.has(a.type))
        dependent('advancement values', `advancement value of ${a.title}`, evidence);
      else {
        // A subclass advancement is titled after the class (Martial Archetype, Artificer Specialist):
        // name the finding by the advancement type, so it is the same for every class.
        const byType = ['Subclass', 'Size'].includes(a.type);
        bad(
          'advancement values',
          'STUDIO',
          `advancement value of ${a.title}`,
          evidence,
          byType ? `advancement value of ${a.type}` : undefined
        );
      }
    }
    for (const [key, b] of sa)
      if (!ra.has(key))
        bad(
          'advancement values',
          'STUDIO',
          'an advancement is extra',
          `${key} (${b.type}) is only on the Studio hero`
        );
  }

  const counts = { KIT: 0, CONTENT: 0, SYSTEM: 0, STUDIO: 0 };
  for (const p of problems) counts[p.kind] += 1;
  const summary =
    `${Object.values(checked).reduce((n, x) => n + x, 0)} checks, ` +
    `${sameChoices ? 'same choices' : 'different choices'}, ` +
    `${problems.length} differences (${STUDIO_KINDS.map(k => `${k} ${counts[k]}`).join(', ')})`;
  return { problems, notes, sameChoices, summary, checked };
}

/**
 * Counts problems by kind, with STUDIO.
 * @param {StudioProblem[]} problems
 */
export function countStudioKinds(problems) {
  const out = { KIT: 0, CONTENT: 0, SYSTEM: 0, STUDIO: 0 };
  for (const p of problems) out[p.kind] += 1;
  return out;
}

/** @param {{rules?: string}} e */
const rulesOf = e => (e.rules === '2024' ? '2024' : '2014');

/**
 * One hero per class: the tier hero at the wanted level, else the highest tier hero below it. With
 * `coverage` (the scenario passes it at size long only: each Studio hero costs minutes) the coverage
 * heroes follow, each at its own level, because the options they were built for are picked at
 * levels the wanted level may not reach.
 * @param {import('./contract.mjs').KitManifest} kit
 * @param {number} level
 * @param {string[]} [only] class identifiers, empty for all
 * @param {{coverage?: boolean}} [opts]
 */
export function chooseHeroes(kit, level, only = [], { coverage = false } = {}) {
  const tiers = builtHeroes(kit).filter(h => h.role === 'tier' && h.classUuid);
  /** @type {Map<string, any>} */
  const byClass = new Map();
  for (const hero of tiers) {
    if (only.length && !only.includes(hero.classIdentifier)) continue;
    if (hero.level > level) continue;
    const best = byClass.get(hero.classUuid);
    if (!best || hero.level > best.level) byClass.set(hero.classUuid, hero);
  }
  const chosen = [...byClass.values()];
  if (coverage) {
    for (const hero of builtHeroes(kit)) {
      if (hero.role !== 'coverage' || !hero.classUuid) continue;
      if (only.length && !only.includes(hero.classIdentifier)) continue;
      chosen.push(hero);
    }
  }
  return chosen;
}

/**
 * The species or background the builder used for the raw heroes: the named one of the 2024
 * entries, else the first 2024 one.
 * @param {Array<{uuid: string, name: string, rules?: string}>} entries
 * @param {string} name
 * @returns {string | undefined} the uuid
 */
export function pickOrigin(entries, name) {
  const byName = (/** @type {{name: string}} */ a, /** @type {{name: string}} */ b) =>
    a.name.localeCompare(b.name, 'en');
  const modern = entries.filter(e => rulesOf(e) === '2024').sort(byName);
  return (modern.find(e => e.name === name) ?? entries.find(e => e.name === name) ?? modern[0])
    ?.uuid;
}
