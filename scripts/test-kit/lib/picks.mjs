/**
 * Pick coverage: for every choice a class's heroes were asked (a skill list, a fighting style, an
 * invocation), the options the system offered, how often each was picked, and the options no hero
 * of the build picked. The builder's rotation spreads the picks; this says how far it got, so a
 * feature that no hero has (and that heroes-features-use therefore never used) stands out. Pure.
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
 */

/**
 * @param {Array<{classIdentifier?: string, picks?: Array<{advancement: string, title: string, chosen?: string[], offered?: string[]}>}>} heroes
 *   manifest hero rows
 * @returns {PickRow[]} sorted by class, then title
 */
export function pickCoverage(heroes) {
  /** @type {Map<string, {classIdentifier: string, title: string, advancement: string, heroes: Set<number>, offered: Set<string>, picked: Map<string, number>}>} */
  const rows = new Map();
  heroes.forEach((hero, i) => {
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
        };
        rows.set(key, row);
      }
      row.heroes.add(i);
      for (const o of p.offered) row.offered.add(o);
      for (const c of p.chosen ?? []) {
        row.offered.add(c);
        row.picked.set(c, (row.picked.get(c) ?? 0) + 1);
      }
    }
  });
  return [...rows.values()]
    .map(r => ({
      classIdentifier: r.classIdentifier,
      title: r.title,
      advancement: r.advancement,
      heroes: r.heroes.size,
      offered: r.offered.size,
      picked: Object.fromEntries([...r.picked.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'))),
      never: [...r.offered].filter(o => !r.picked.has(o)).sort((a, b) => a.localeCompare(b, 'en')),
    }))
    .sort(
      (a, b) =>
        a.classIdentifier.localeCompare(b.classIdentifier, 'en') || a.title.localeCompare(b.title, 'en')
    );
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
