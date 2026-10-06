/**
 * The coverage pass of the builder, as pure functions. After the normal heroes are built, some
 * options that change how a hero plays (a fighting style, a maneuver, an invocation, a damage
 * resistance) may never have been picked, because the rotation (contract.mjs, createHero) spreads
 * the picks but does not reach every option. This plans extra heroes, role "coverage", that force
 * those options.
 *
 * A coverage hero copies a template hero (class, subclass, level, rotation: a hero that was offered
 * the choice) and carries `prefer`: per choice title, the options to take first. A hero with N picks
 * of a choice takes N unpicked options. The planner is greedy: each round picks the template that
 * covers the most unpicked options, and stops when every option is covered or the cap is reached.
 */
import { mechanicalGroups } from './picks.mjs';

/** The default most coverage heroes one run builds (`--coverage-cap`). */
export const DEFAULT_COVERAGE_CAP = 40;

/** @param {string} a @param {string} b */
const en = (a, b) => a.localeCompare(b, 'en');

/**
 * Takes the first wanted option that the list offers: returns it and removes it from `wanted`.
 * The page code of createHero and the answer pump do the same with their own copy of this rule.
 * @template T
 * @param {T[]} list the options on offer
 * @param {string[]} wanted the options to take first, in order; changed in place
 * @param {(option: T) => string} [label] the name of an option (an item's name, a trait key)
 * @returns {T | undefined}
 */
export function takePreferred(list, wanted, label = x => /** @type {any} */ (x)) {
  for (let i = 0; i < wanted.length; i += 1) {
    const hit = list.find(x => label(x) === wanted[i]);
    if (hit !== undefined) {
      wanted.splice(i, 1);
      return hit;
    }
  }
  return undefined;
}

/**
 * @typedef {object} CoverageHero a manifest hero row, the fields the planner reads
 * @property {string} name
 * @property {'tier'|'subclass'|'coverage'} [role]
 * @property {string} [actorId]
 * @property {string} [buildError]
 * @property {string} [classIdentifier]
 * @property {string} [className]
 * @property {string} [subclassName]
 * @property {string} [classUuid]
 * @property {string} [subclassUuid]
 * @property {number} level
 * @property {number} rotation
 * @property {Record<string, string[]>} [prefer]  a coverage hero's forced options, per choice title
 * @property {import('./picks.mjs').Pick[]} [picks]
 */

/**
 * @typedef {object} CoverageSpec an extra hero to build
 * @property {string} name          "Kit Fighter 3 cov 1"
 * @property {string} template      the name of the hero it copies
 * @property {number} templateIndex index of that hero in the input
 * @property {number} level
 * @property {number} rotation
 * @property {string} classUuid
 * @property {string} [subclassUuid]
 * @property {Record<string, string[]>} prefer   choice title -> options to take first
 * @property {number} options       how many unpicked options this hero is asked to take
 */

/**
 * Plans the coverage heroes from the picks of the heroes built so far. Pure.
 *
 * Template heroes are the tier and subclass heroes that built (a coverage hero is never a
 * template). Per choice, the options still to cover are those offered and never picked, minus the
 * ones an earlier coverage hero was already asked for (an attempt that did not take is not repeated:
 * the option stays "never picked" in the report). Among the templates, the one that covers the most
 * (the sum over its choices of the smaller of its picks and the options it was offered that are
 * still open) goes first; a tie goes to the lower level, then to the earlier hero.
 * @param {{heroes: CoverageHero[], cap?: number}} o  cap: the most specs to return
 * @returns {{specs: CoverageSpec[], remaining: number, capHit: boolean}} remaining: options left
 *   uncovered by the specs (the cap, or no template could take them); capHit: the cap stopped the plan
 */
export function planCoverage({ heroes, cap = DEFAULT_COVERAGE_CAP }) {
  const groups = mechanicalGroups(heroes);
  /** @type {Map<string, Set<string>>} */
  const attempted = new Map();
  for (const h of heroes) {
    if (h.role !== 'coverage') continue;
    for (const [title, options] of Object.entries(h.prefer ?? {})) {
      const key = `${h.classIdentifier ?? ''}\u0000${title}`;
      const set = attempted.get(key) ?? new Set();
      for (const o of options) set.add(o);
      attempted.set(key, set);
    }
  }
  /** @type {Map<string, Set<string>>} */
  const open = new Map();
  for (const [key, g] of groups) {
    const left = new Set(
      [...g.options].filter(o => !g.picked.has(o) && !(attempted.get(key)?.has(o) ?? false))
    );
    if (left.size) open.set(key, left);
  }
  const templates = heroes
    .map((h, index) => ({ h, index }))
    .filter(
      ({ h }) => h.role !== 'coverage' && h.actorId && !h.buildError && h.classUuid && h.picks
    );
  const taken = new Set(heroes.map(h => h.name));
  const perTemplate = new Map();
  /** @type {CoverageSpec[]} */
  const specs = [];

  while (open.size && specs.length < Math.max(0, cap)) {
    let best = null;
    for (const { h, index } of templates) {
      let score = 0;
      for (const [key, left] of open) {
        const mine = groups.get(key)?.heroes.get(index);
        if (!mine) continue;
        let hit = 0;
        for (const o of mine.options) if (left.has(o)) hit += 1;
        score += Math.min(mine.count, hit);
      }
      if (
        score > 0 &&
        (!best || score > best.score || (score === best.score && h.level < best.h.level))
      )
        best = { h, index, score };
    }
    if (!best) break;

    /** @type {Record<string, string[]>} */
    const prefer = {};
    let options = 0;
    for (const [key, left] of [...open]) {
      const g = groups.get(key);
      const mine = g?.heroes.get(best.index);
      if (!g || !mine) continue;
      const take = [...mine.options]
        .filter(o => left.has(o))
        .sort(en)
        .slice(0, mine.count);
      if (!take.length) continue;
      prefer[g.title] = [...(prefer[g.title] ?? []), ...take];
      options += take.length;
      for (const o of take) left.delete(o);
      if (!left.size) open.delete(key);
    }
    let n = perTemplate.get(best.h.name) ?? 0;
    let name;
    do {
      n += 1;
      name = `${best.h.name} cov ${n}`;
    } while (taken.has(name));
    perTemplate.set(best.h.name, n);
    taken.add(name);
    specs.push({
      name,
      template: best.h.name,
      templateIndex: best.index,
      level: best.h.level,
      rotation: best.h.rotation,
      classUuid: /** @type {string} */ (best.h.classUuid),
      ...(best.h.subclassUuid ? { subclassUuid: best.h.subclassUuid } : {}),
      prefer,
      options,
    });
  }
  let remaining = 0;
  for (const left of open.values()) remaining += left.size;
  return { specs, remaining, capHit: remaining > 0 && specs.length >= Math.max(0, cap) };
}
