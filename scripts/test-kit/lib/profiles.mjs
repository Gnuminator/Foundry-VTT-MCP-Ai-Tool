/**
 * Content profiles (contract.mjs, ContentProfile): where the builder finds its classes,
 * subclasses, origins, monsters, spells and feats. The `srd` profile ships in the repo
 * (scripts/test-kit/data/profiles/srd.json); any other profile is a local file
 * `<kit home>/licensed/profiles/<id>.json` that never enters a repo. A profile names pack ids
 * and module ids only, never book text.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROFILE, KIT_WORLDS } from './contract.mjs';
import { EnvError } from './errors.mjs';
import { kitHome } from './targets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SRD_PROFILE_FILE = path.join(here, '..', 'data', 'profiles', 'srd.json');

const PROFILE_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const PACK_KINDS = [
  'classes',
  'subclasses',
  'species',
  'backgrounds',
  'monsters',
  'spells',
  'feats',
];
const PACK_ID_RE = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+$/;
const MODULE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Problems with a profile's shape, as strings; empty when it is valid.
 * @param {unknown} p
 * @returns {string[]}
 */
export function validateProfile(p) {
  if (!p || typeof p !== 'object') return ['the profile is not an object'];
  const o = /** @type {Record<string, any>} */ (p);
  const problems = [];
  if (typeof o.id !== 'string' || !PROFILE_ID_RE.test(o.id)) problems.push('id must be kebab-case');
  if (typeof o.world !== 'string' || !KIT_WORLDS.includes(o.world)) {
    problems.push(`world must be one of ${KIT_WORLDS.join(', ')}`);
  }
  if (typeof o.title !== 'string' || !o.title.trim()) problems.push('title is missing');
  if (
    !Array.isArray(o.modules) ||
    o.modules.some(m => typeof m !== 'string' || !MODULE_ID_RE.test(m))
  ) {
    problems.push('modules must be a list of module ids');
  }
  if (!o.packs || typeof o.packs !== 'object') {
    problems.push('packs is missing');
  } else {
    for (const kind of PACK_KINDS) {
      const list = o.packs[kind];
      if (!Array.isArray(list) || list.some(id => typeof id !== 'string' || !PACK_ID_RE.test(id))) {
        problems.push(`packs.${kind} must be a list of pack ids like "dnd5e.classes24"`);
      }
    }
    for (const kind of ['classes', 'subclasses']) {
      if (Array.isArray(o.packs[kind]) && !o.packs[kind].length)
        problems.push(`packs.${kind} is empty`);
    }
  }
  if (o.knownAlso !== undefined) {
    const k = o.knownAlso;
    if (
      !Array.isArray(k) ||
      k.some(/** @param {unknown} id */ id => typeof id !== 'string' || !PROFILE_ID_RE.test(id))
    ) {
      problems.push('knownAlso must be a list of profile ids');
    } else if (k.includes(o.id)) {
      problems.push('knownAlso must not name the profile itself');
    }
  }
  if (o.select !== undefined) {
    const s = o.select;
    if (!s || typeof s !== 'object') problems.push('select must be an object');
    else {
      if (
        !Array.isArray(s.rules) ||
        !s.rules.length ||
        s.rules.some(/** @param {unknown} r */ r => r !== '2024' && r !== '2014')
      ) {
        problems.push('select.rules must be a non-empty list of "2024" and "2014"');
      }
      if (
        s.skipNames !== undefined &&
        (!Array.isArray(s.skipNames) ||
          s.skipNames.some(/** @param {unknown} n */ n => typeof n !== 'string'))
      ) {
        problems.push('select.skipNames must be a list of names');
      }
      if (s.skipIds !== undefined) {
        try {
          new RegExp(s.skipIds);
        } catch {
          problems.push('select.skipIds must be a regular expression');
        }
      }
    }
  }
  return problems;
}

/** Where a profile's file lives. @param {string} id @param {string} [home] */
export function profileFile(id, home = kitHome()) {
  if (id === 'srd') return SRD_PROFILE_FILE;
  return path.join(home, 'licensed', 'profiles', `${id}.json`);
}

/**
 * Loads and validates a profile. Refuses an id that is not a plain name, a file that is not
 * there, a shape that does not validate, and a world that is not a kit world.
 * @param {string} [id]
 * @param {{home?: string}} [opts]
 * @returns {import('./contract.mjs').ContentProfile & {select: {rules: string[], skipNames: string[], skipIds?: string}}}
 */
export function loadProfile(id = DEFAULT_PROFILE, { home } = {}) {
  if (typeof id !== 'string' || !PROFILE_ID_RE.test(id)) {
    throw new EnvError(`REFUSED: "${id}" is not a profile id (letters, digits and dashes).`);
  }
  const file = profileFile(id, home);
  if (!existsSync(file)) {
    throw new EnvError(
      id === 'srd'
        ? `The SRD profile is missing: ${file}`
        : `No profile "${id}": expected ${file} (local only, never in a repo).`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new EnvError(`Profile ${file} is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  const problems = validateProfile(parsed);
  if (parsed && parsed.id !== id)
    problems.push(`id "${parsed.id}" does not match the file name "${id}"`);
  if (problems.length) throw new EnvError(`Profile ${file} is not valid: ${problems.join('; ')}`);
  return {
    ...parsed,
    select: {
      rules: parsed.select?.rules ?? ['2024', '2014'],
      skipNames: parsed.select?.skipNames ?? [],
      ...(parsed.select?.skipIds ? { skipIds: parsed.select.skipIds } : {}),
    },
  };
}
