// @ts-check
/**
 * Git merge drivers for files that two branches change at once without a real conflict
 * (idea hunt 2026-11-26, idea 1). Wired by `scripts/merge-drivers/install.mjs` (run from `npm ci`'s
 * prepare step) and `.gitattributes`:
 *
 *   node scripts/merge-drivers/merge-drivers.mjs baseline %O %A %B   scripts/line-baseline.json
 *   node scripts/merge-drivers/merge-drivers.mjs generated %O %A %B  docs/reference/tools.md, tools/*.md
 *
 * `baseline` merges the two JSON files entry by entry; the line ratchet still checks the result
 * against the real line counts, so a limit that is too low or too high fails there, not here.
 * `generated` keeps this branch's page: `npm run docs:tools` rewrites it, the merge runner
 * regenerates it when the tool-reference guard says it is stale, and the patch id ignores it.
 * Either driver exits 1 (a conflict, as before) on anything it cannot read.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** @typedef {{ limit?: number, files?: Record<string, number>, exceptions?: unknown[] }} Baseline */

/**
 * Three-way merge of two line baselines. Per file: a side that dropped it wins (the file shrank
 * under the limit); one side changed it, that side wins; both changed it, the lower limit wins.
 * @param {Baseline} base @param {Baseline} ours @param {Baseline} theirs
 * @returns {Baseline}
 */
export function mergeBaselines(base, ours, theirs) {
  const b = base.files ?? {};
  const o = ours.files ?? {};
  const t = theirs.files ?? {};
  /** @type {Record<string, number>} */ const files = {};
  for (const f of new Set([...Object.keys(o), ...Object.keys(t)])) {
    const inBase = f in b;
    if (inBase && (!(f in o) || !(f in t))) continue; // one side dropped it
    const [vo, vt] = [o[f], t[f]];
    if (vo === undefined) files[f] = vt;
    else if (vt === undefined) files[f] = vo;
    else if (vo === vt) files[f] = vo;
    else if (inBase && vo === b[f]) files[f] = vt;
    else if (inBase && vt === b[f]) files[f] = vo;
    else files[f] = Math.min(vo, vt);
  }
  const seen = new Set();
  const exceptions = [...(ours.exceptions ?? []), ...(theirs.exceptions ?? [])].filter(e => {
    const k = JSON.stringify(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    limit: Math.min(ours.limit ?? 1000, theirs.limit ?? 1000),
    files: Object.fromEntries(Object.entries(files).sort(([x], [y]) => x.localeCompare(y))),
    exceptions,
  };
}

/** @param {string} mode @param {string} baseP @param {string} oursP @param {string} theirsP */
export function runDriver(mode, baseP, oursP, theirsP) {
  if (mode === 'generated') return 0; // %A already holds this branch's page
  if (mode !== 'baseline') return 1;
  try {
    const read = (/** @type {string} */ p) => JSON.parse(readFileSync(p, 'utf8'));
    const merged = mergeBaselines(read(baseP), read(oursP), read(theirsP));
    writeFileSync(oursP, `${JSON.stringify(merged, null, 2)}\n`);
    return 0;
  } catch {
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [mode, a, b, c] = process.argv.slice(2);
  process.exit(runDriver(mode, a, b, c));
}
