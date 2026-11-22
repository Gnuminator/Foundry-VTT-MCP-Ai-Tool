/**
 * Every write and skip row of the control table names what covers it (lib/control-coverage.mjs): a
 * file that mentions the control, "by hand", or "none" (listed as uncovered in the report).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROLS } from '../lib/dashboard-controls.mjs';
import { CONTROL_COVERAGE, coverageOf, coverageReport } from '../lib/control-coverage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const unclicked = CONTROLS.filter(r => r.how === 'write' || r.how === 'skip');

test('every write and skip row has a coverage entry, and no entry is left over', () => {
  const rows = new Set(unclicked.map(r => r.name));
  const missing = [...rows].filter(n => !(n in CONTROL_COVERAGE));
  const extra = Object.keys(CONTROL_COVERAGE).filter(n => !rows.has(n));
  assert.deepEqual(missing, [], 'rows without a coverage entry: add one to lib/control-coverage.mjs');
  assert.deepEqual(extra, [], 'coverage entries for rows that are not write or skip');
});

test('the file a row names exists and mentions the control', () => {
  const bad = [];
  for (const r of unclicked) {
    const c = coverageOf(r.name);
    if (c.kind !== 'file') continue;
    const file = path.join(root, c.file);
    if (!existsSync(file)) bad.push(`${r.name}: ${c.file} does not exist`);
    else if (!readFileSync(file, 'utf8').includes(c.mention))
      bad.push(`${r.name}: ${c.file} does not mention "${c.mention}"`);
  }
  assert.deepEqual(bad, []);
});

test('the report lists the by-hand and uncovered rows', () => {
  const rep = coverageReport(CONTROLS);
  assert.equal(rep.rows, unclicked.length);
  assert.ok(rep.byHand.includes('dash.paper.plan'));
  assert.ok(rep.uncovered.includes('dash.damage.apply'));
  assert.equal(rep.covered + rep.byHand.length + rep.uncovered.length, rep.rows);
  const fake = coverageReport([{ name: 'dash.no.such', how: 'write' }]);
  assert.deepEqual(fake.uncovered, ['dash.no.such']);
});
