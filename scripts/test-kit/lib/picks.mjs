/**
 * Pick coverage: for every choice a class's heroes were asked (a skill list, a fighting style, an
 * invocation), the options the system offered, how often each was picked, and the options no hero
 * of the build picked. The builder's rotation spreads the picks; this says how far it got, so a
 * feature that no hero has (and that heroes-features-use therefore never used) stands out. Pure.
 *
 * Some choices change how a hero plays (a fighting style, a maneuver, an invocation, a damage
 * resistance); most do not (a skill, a tool, a language). `mechanicalPick` tells the two apart, and
 * the coverage pass of the builder (coverage.mjs) builds extra heroes for the mechanical options
 * nobody picked.
 */

/**
 * @typedef {object} PickHero a manifest hero row, the fields this file reads
 * @property {string} [classIdentifier]
 * @property {string} [className]       the class item's name (the owner of "Fighter: Fighting Style")
 * @property {string} [subclassName]
 * @property {string} [buildError]
 * @property {Array<Pick>} [picks]
 */

/**
 * One recorded choice, as createHero returns it. `itemType` (the type of the item whose advancement
 * asked: class, subclass, feat, race, background), `featType` (a feat item's type value: class,
 * origin, general) and `pool` (an ItemChoice's item type: feat, spell) are additive; an old
 * manifest has none of them and the filter falls back to the title.
 * @typedef {{level?: number, advancement: string, title: string, chosen?: string[], offered?: string[],
 *   itemType?: string, featType?: string, pool?: string}} Pick
 */

/**
 * @typedef {object} PickRow
 * @property {string} classIdentifier
 * @property {string} title          the advancement title the builder recorded ("Bard: Skills")
 * @property {string} advancement    Trait or ItemChoice
 * @property {number} heroes         heroes of the class that made this choice
 * @property {number} offered        options offered (the union over those heroes)
 * @property {Record<string, number>} picked   option -> times picked
 * @property {string[]} never        offered options no hero picked, sorted
 * @property {string[]} mechanicalNever  the part of `never` that changes how a hero plays (see mechanicalPick)
 */

/** Trait keys that are mechanical: damage resistance, damage immunity, condition immunity. */
export const MECHANICAL_TRAIT_PREFIXES = ['dr:', 'di:', 'ci:'];

/**
 * An ItemChoice with no recorded pool (an old manifest, the fake) is judged by its title: a pick of
 * spells, proficiencies or equipment is not mechanical.
 */
const NOT_A_FEATURE_TITLE =
  /spell|cantrip|language|tool|skill|proficien|expertise|mastery|equipment|armor|armour|weapon/i;

/** @param {string} a @param {string} b */
const en = (a, b) => a.localeCompare(b, 'en');

/** The names of the items a hero's class and subclass picks start with. @param {PickHero} hero */
export function heroOwners(hero) {
  return [hero.className, hero.subclassName].filter(
    /** @returns {n is string} */ n => typeof n === 'string' && n !== ''
  );
}

/**
 * Whether the item whose advancement asked is a class, a subclass or a class feature (a feat item of
 * type "class", such as an invocation), and not a background, a species or an origin or general feat.
 * @param {Pick} pick
 * @param {string[]} owners  class and subclass names, used when the pick records no item type
 */
export function fromClassOrSubclass(pick, owners = []) {
  if (pick.itemType) {
    if (pick.itemType === 'class' || pick.itemType === 'subclass') return true;
    if (pick.itemType === 'feat') return pick.featType === 'class';
    return false;
  }
  const title = String(pick.title ?? '');
  return owners.some(name => name && title.startsWith(`${name}: `));
}

/**
 * The mechanical filter. A pick is mechanical when it was asked by a class or subclass (or a class
 * feature) and is either an ItemChoice whose pool is feature items (a fighting style, a maneuver, an
 * invocation, a shot, a rune, a favored enemy, a feat that is a class feature) or a Trait choice of
 * damage resistances or immunities and condition immunities (`dr:`, `di:`, `ci:`). Skills, tools,
 * languages, saving throws, weapon mastery, armor, spells and expertise are not, and neither is
 * anything a background, a species or an origin feat asks.
 * @param {Pick} pick
 * @param {string[]} [owners]
 * @returns {{offered: string[], chosen: string[]} | null} the mechanical options offered (the
 *   chosen ones included) and chosen, or null when the pick is not mechanical
 */
export function mechanicalPick(pick, owners = []) {
  if (!fromClassOrSubclass(pick, owners)) return null;
  const chosen = pick.chosen ?? [];
  const offered = [...new Set([...(pick.offered ?? []), ...chosen])];
  if (pick.advancement === 'Trait') {
    const mech = (/** @type {string} */ key) =>
      MECHANICAL_TRAIT_PREFIXES.some(prefix => String(key).startsWith(prefix));
    const options = offered.filter(mech);
    return options.length ? { offered: options, chosen: chosen.filter(mech) } : null;
  }
  if (pick.advancement === 'ItemChoice') {
    const title = String(pick.title ?? '');
    if (title.endsWith('(ability)')) return null;
    if (pick.pool !== undefined) {
      if (pick.pool !== 'feat') return null;
    } else if (NOT_A_FEATURE_TITLE.test(title)) return null;
    return offered.length ? { offered, chosen } : null;
  }
  return null;
}

/**
 * The mechanical choices of a build, per class and choice: every option offered, how often each was
 * picked, and what each hero was offered and asked for. Heroes that did not build are left out.
 * @param {PickHero[]} heroes manifest hero rows
 * @returns {Map<string, {classIdentifier: string, title: string, options: Set<string>,
 *   picked: Map<string, number>, heroes: Map<number, {options: Set<string>, count: number}>}>}
 *   keyed by class identifier and title (the title starts with the class or subclass name, so a
 *   subclass's choice is its own entry)
 */
export function mechanicalGroups(heroes) {
  const groups = new Map();
  heroes.forEach((hero, index) => {
    if (hero.buildError) return;
    const owners = heroOwners(hero);
    for (const p of hero.picks ?? []) {
      const m = mechanicalPick(p, owners);
      if (!m) continue;
      const classIdentifier = hero.classIdentifier ?? '';
      const key = `${classIdentifier}\u0000${p.title}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          classIdentifier,
          title: p.title,
          options: new Set(),
          picked: new Map(),
          heroes: new Map(),
        };
        groups.set(key, g);
      }
      let h = g.heroes.get(index);
      if (!h) {
        h = { options: new Set(), count: 0 };
        g.heroes.set(index, h);
      }
      for (const o of m.offered) {
        g.options.add(o);
        h.options.add(o);
      }
      for (const c of m.chosen) {
        g.picked.set(c, (g.picked.get(c) ?? 0) + 1);
        h.count += 1;
      }
    }
  });
  return groups;
}

/**
 * The mechanical options no hero of the build picked.
 * @param {PickHero[]} heroes
 * @returns {Array<{classIdentifier: string, title: string, option: string}>} sorted by class, title, option
 */
export function mechanicalNever(heroes) {
  const out = [];
  for (const g of mechanicalGroups(heroes).values())
    for (const option of g.options)
      if (!g.picked.has(option))
        out.push({ classIdentifier: g.classIdentifier, title: g.title, option });
  return out.sort(
    (a, b) =>
      en(a.classIdentifier, b.classIdentifier) || en(a.title, b.title) || en(a.option, b.option)
  );
}

/**
 * @param {PickHero[]} heroes
 *   manifest hero rows (coverage heroes count like any other)
 * @returns {PickRow[]} sorted by class, then title
 */
export function pickCoverage(heroes) {
  /** @type {Map<string, {classIdentifier: string, title: string, advancement: string, heroes: Set<number>, offered: Set<string>, picked: Map<string, number>, mechanical: Set<string>}>} */
  const rows = new Map();
  heroes.forEach((hero, i) => {
    const owners = heroOwners(hero);
    for (const p of hero.picks ?? []) {
      if (!['Trait', 'ItemChoice'].includes(p.advancement) || !Array.isArray(p.offered)) continue;
      const cls = hero.classIdentifier ?? '';
      const key = `${cls}\u0000${p.title}`;
      let row = rows.get(key);
      if (!row) {
        row = {
          classIdentifier: cls,
          title: p.title,
          advancement: p.advancement,
          heroes: new Set(),
          offered: new Set(),
          picked: new Map(),
          mechanical: new Set(),
        };
        rows.set(key, row);
      }
      row.heroes.add(i);
      for (const o of p.offered) row.offered.add(o);
      for (const c of p.chosen ?? []) {
        row.offered.add(c);
        row.picked.set(c, (row.picked.get(c) ?? 0) + 1);
      }
      for (const o of mechanicalPick(p, owners)?.offered ?? []) row.mechanical.add(o);
    }
  });
  return [...rows.values()]
    .map(r => {
      const never = [...r.offered].filter(o => !r.picked.has(o)).sort(en);
      return {
        classIdentifier: r.classIdentifier,
        title: r.title,
        advancement: r.advancement,
        heroes: r.heroes.size,
        offered: r.offered.size,
        picked: Object.fromEntries([...r.picked.entries()].sort((a, b) => en(a[0], b[0]))),
        never,
        mechanicalNever: never.filter(o => r.mechanical.has(o)),
      };
    })
    .sort((a, b) => en(a.classIdentifier, b.classIdentifier) || en(a.title, b.title));
}

/**
 * The one-line summary of a coverage: choices, options offered, options picked at least once.
 * @param {PickRow[]} rows
 */
export function pickSummary(rows) {
  let offered = 0;
  let never = 0;
  for (const r of rows) {
    offered += r.offered;
    never += r.never.length;
  }
  return `${rows.length} choices, ${offered - never} of ${offered} offered options picked at least once`;
}
