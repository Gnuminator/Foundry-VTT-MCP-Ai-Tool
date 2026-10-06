/**
 * Known findings: CONTENT and SYSTEM problems that are understood and reported, but do not fail a
 * run. A scenario that uses the list (heroes-advancement, heroes-features-use) splits each step's
 * problems into known ones (counted in the step detail and the `known` attachment) and fresh ones
 * (the step fails). A KIT problem is never known: fix the kit instead.
 *
 * The list belongs to a content profile and sits next to its profile file, as `<id>.known.json`:
 * the srd list in the repo (data/profiles/srd.known.json), a licensed list on this PC only
 * (<kit home>/licensed/profiles/<id>.known.json), because it names licensed features. A missing
 * file is an empty list.
 *
 * An entry: {id, scenario, kind, what?, match, why}. A problem is known when the scenario and the
 * kind are equal, `what` is equal when the entry sets it, and the problem's evidence contains
 * `match` (plain text, case-sensitive). An entry that matched nothing in a full run is listed as unseen in
 * the attachment, so the list shrinks when the content is fixed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { profileFile } from './profiles.mjs';

/**
 * @typedef {object} KnownEntry
 * @property {string} id
 * @property {string} scenario
 * @property {'CONTENT'|'SYSTEM'} kind
 * @property {string} [what]
 * @property {string} match
 * @property {string} why
 */

/** Where the known list of a profile lives. @param {string} profileId @param {string} [home] */
export function knownFile(profileId, home) {
  return profileFile(profileId, home).replace(/\.json$/, '.known.json');
}

/**
 * Checks a parsed list; returns the problems, empty when it is fine.
 * @param {unknown} list
 * @returns {string[]}
 */
export function validateKnown(list) {
  if (!Array.isArray(list)) return ['the known list must be a JSON list'];
  const problems = [];
  const ids = new Set();
  for (const [i, e] of list.entries()) {
    const at = `entry ${i + 1}${e?.id ? ` (${e.id})` : ''}`;
    if (typeof e?.id !== 'string' || !e.id) problems.push(`${at} has no id`);
    else if (ids.has(e.id)) problems.push(`${at} is listed twice`);
    else ids.add(e.id);
    if (typeof e?.scenario !== 'string' || !e.scenario) problems.push(`${at} has no scenario`);
    if (!['CONTENT', 'SYSTEM'].includes(e?.kind))
      problems.push(`${at}: kind must be CONTENT or SYSTEM (a KIT problem is fixed, not listed)`);
    if (typeof e?.match !== 'string' || e.match.length < 3)
      problems.push(`${at} needs a match of 3 or more characters`);
    if (typeof e?.why !== 'string' || !e.why) problems.push(`${at} has no why`);
    if (e?.what !== undefined && typeof e.what !== 'string') problems.push(`${at}: what must be text`);
  }
  return problems;
}

/**
 * Loads the known list of a profile. A missing file is an empty list; a broken one throws.
 * @param {string} profileId
 * @param {{home?: string, file?: string}} [opts]
 * @returns {KnownEntry[]}
 */
export function loadKnown(profileId, { home, file } = {}) {
  const where = file ?? knownFile(profileId, home);
  if (!existsSync(where)) return [];
  const list = JSON.parse(readFileSync(where, 'utf8'));
  const problems = validateKnown(list);
  if (problems.length) throw new Error(`${where} is not valid: ${problems.join('; ')}`);
  return list;
}

/**
 * Splits problems into known and fresh ones. Pure.
 * @param {import('./advancement.mjs').Problem[]} problems
 * @param {KnownEntry[]} list
 * @param {string} scenario
 * @returns {{fresh: import('./advancement.mjs').Problem[], known: Array<{problem: import('./advancement.mjs').Problem, id: string}>}}
 */
export function splitKnown(problems, list, scenario) {
  const mine = list.filter(e => e.scenario === scenario);
  /** @type {import('./advancement.mjs').Problem[]} */
  const fresh = [];
  /** @type {Array<{problem: import('./advancement.mjs').Problem, id: string}>} */
  const known = [];
  for (const p of problems) {
    const hit =
      p.kind === 'KIT'
        ? undefined
        : mine.find(
            e =>
              e.kind === p.kind &&
              (e.what === undefined || e.what === p.what) &&
              String(p.evidence ?? '').includes(e.match)
          );
    if (hit) known.push({ problem: p, id: hit.id });
    else fresh.push(p);
  }
  return { fresh, known };
}

/**
 * The attachment a scenario writes: how often each entry matched, and the entries that matched
 * nothing in this run (unseen: in a smoke run that is normal, in a full run the content may be fixed). Pure.
 * @param {KnownEntry[]} list
 * @param {string} scenario
 * @param {Map<string, number>} hits  entry id -> problems it matched in this run
 */
export function knownAttachment(list, scenario, hits) {
  const mine = list.filter(e => e.scenario === scenario);
  return {
    entries: mine.length,
    matched: Object.fromEntries(
      mine.filter(e => hits.get(e.id)).map(e => [e.id, { kind: e.kind, problems: hits.get(e.id), why: e.why }])
    ),
    unseen: mine.filter(e => !hits.get(e.id)).map(e => e.id),
  };
}
