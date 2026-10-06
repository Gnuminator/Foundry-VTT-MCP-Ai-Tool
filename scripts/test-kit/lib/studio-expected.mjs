/**
 * The findings about Actor Studio that are known and accepted for now (data/studio-expected.json):
 * the heroes-studio scenario counts them in its report and passes; a finding that is not on the
 * list, or that changes kind, still fails. Each entry has an id (see findingId in studio-compare.mjs),
 * a kind and the reason.
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

/** @returns {Array<{id: string, kind: 'KIT'|'CONTENT'|'SYSTEM'|'STUDIO', why: string}>} */
export function loadExpected(file = FILE) {
  const list = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(list)) throw new Error(`${file} must hold a list`);
  const ids = new Set();
  for (const e of list) {
    if (typeof e?.id !== 'string' || !e.id) throw new Error(`${file}: an entry has no id`);
    if (!['KIT', 'CONTENT', 'SYSTEM', 'STUDIO'].includes(e.kind))
      throw new Error(`${file}: ${e.id} has no valid kind`);
    if (ids.has(e.id)) throw new Error(`${file}: ${e.id} is listed twice`);
    ids.add(e.id);
  }
  return list;
}
