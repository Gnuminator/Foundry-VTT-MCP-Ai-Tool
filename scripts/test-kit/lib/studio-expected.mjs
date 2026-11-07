/**
 * The findings about Actor Studio that are known and accepted for now (data/studio-expected.json):
 * the heroes-studio scenario counts them in its report and passes; a finding that is not on the
 * list, or that changes kind, still fails. Each entry has an id (see findingId in studio-compare.mjs),
 * a kind and the reason.
 *
 * The list is version-aware. It holds the findings of upstream Actor Studio (2.10.5). An entry that
 * our fork fixed carries `fixedIn` (for example "2.10.5-aitool.1"): it is not expected on that build
 * or a later build of the fork, so a finding that comes back there is new and fails. Any other
 * version (upstream 2.10.5, an unknown one, none) gets the whole list.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'studio-expected.json'
);

/** The version of the Actor Studio module the run reads from the GM page (set by the scenario). */
let installed = null;

/**
 * Tells the loader which Actor Studio is installed, so loadExpected() and the console groups pick the
 * right list. Pass null to forget it.
 * @param {string | null} version  game.modules.get('foundryvtt-actor-studio').version
 */
export function setStudioVersion(version) {
  installed = version || null;
}

/** @returns {string | null} */
export function studioVersion() {
  return installed;
}

/**
 * A fork build as numbers: "2.10.5-aitool.2" is [2, 10, 5, 2]. Anything else (upstream, an unknown
 * shape, an empty text) is null: it is not a build of the fork.
 * @param {string | null | undefined} text
 * @returns {number[] | null}
 */
export function parseForkVersion(text) {
  const m = /^(\d+)\.(\d+)\.(\d+)-aitool\.(\d+)$/.exec(String(text ?? '').trim());
  return m ? m.slice(1).map(Number) : null;
}

/**
 * True when `version` is a build of the fork at or after `fixedIn`.
 * @param {string | null | undefined} version
 * @param {string} fixedIn
 */
export function isFixedIn(version, fixedIn) {
  const have = parseForkVersion(version);
  const need = parseForkVersion(fixedIn);
  if (!have || !need) return false;
  for (let i = 0; i < 4; i++) {
    if (have[i] !== need[i]) return have[i] > need[i];
  }
  return true;
}

/**
 * Which list a version gets and why, for the report.
 * @param {string | null | undefined} version
 * @returns {{basis: 'fork' | 'upstream' | 'fallback', text: string}}
 */
export function describeBasis(version) {
  if (parseForkVersion(version))
    return { basis: 'fork', text: `the list for the fork build ${version}` };
  if (version === '2.10.5') return { basis: 'upstream', text: 'the list for upstream 2.10.5' };
  return {
    basis: 'fallback',
    text: `Actor Studio version "${version ?? ''}" is not one the list knows: using the upstream 2.10.5 list`,
  };
}

/**
 * @param {string} [file]
 * @param {string | null} [version]  the installed Actor Studio version; defaults to the one set with setStudioVersion
 * @returns {Array<{id: string, kind: 'KIT'|'CONTENT'|'SYSTEM'|'STUDIO', why: string, fixedIn?: string}>}
 */
export function loadExpected(file = FILE, version = installed) {
  const list = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(list)) throw new Error(`${file} must hold a list`);
  const ids = new Set();
  for (const e of list) {
    if (typeof e?.id !== 'string' || !e.id) throw new Error(`${file}: an entry has no id`);
    if (!['KIT', 'CONTENT', 'SYSTEM', 'STUDIO'].includes(e.kind))
      throw new Error(`${file}: ${e.id} has no valid kind`);
    if (e.fixedIn !== undefined && !parseForkVersion(e.fixedIn))
      throw new Error(`${file}: ${e.id} has a fixedIn that is not a fork build (x.y.z-aitool.n)`);
    if (ids.has(e.id)) throw new Error(`${file}: ${e.id} is listed twice`);
    ids.add(e.id);
  }
  return list.filter(e => !e.fixedIn || !isFixedIn(version, e.fixedIn));
}
