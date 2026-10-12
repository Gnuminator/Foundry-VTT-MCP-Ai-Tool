/**
 * The Foundry control table (lib/foundry-controls.mjs) against the generated usage catalog and the
 * sweep's own source. No browser is started.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUsageCatalog } from '../lib/dashboard-controls.mjs';
import {
  AREAS,
  ERROR_COUNTER_WHY,
  FOUNDRY_CONTROLS,
  HOWS,
  countHows,
  errorCounterRows,
  rowsOf,
  unclassifiedModule,
} from '../lib/foundry-controls.mjs';

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = readUsageCatalog();
const areaIds = AREAS.map(a => a[0]);

test('the table has unique names, a known how, a known player rule and a known area', () => {
  const names = FOUNDRY_CONTROLS.map(r => r.name);
  assert.equal(new Set(names).size, names.length, 'duplicate rows');
  for (const r of FOUNDRY_CONTROLS) {
    assert.ok(HOWS.includes(r.how), `${r.name}: unknown how "${r.how}"`);
    assert.ok(['hidden', 'works', 'none'].includes(r.player), `${r.name}: unknown player rule`);
    assert.ok(areaIds.includes(r.area), `${r.name}: unknown area "${r.area}"`);
    assert.ok(r.label, `${r.name}: no label`);
  }
});

test('the areas are unique and every area but the error counters has a row', () => {
  assert.equal(new Set(areaIds).size, areaIds.length);
  for (const id of areaIds) {
    if (id === 'errors') continue;
    assert.ok(rowsOf(id).length > 0, `area "${id}" has no row`);
  }
});

test('a skip row says why', () => {
  const skips = FOUNDRY_CONTROLS.filter(r => r.how === 'skip');
  assert.ok(skips.length > 0);
  for (const r of skips) assert.ok(r.why, `${r.name}: a skip row needs a why`);
});

test('every module control of the usage catalog has a row, and no module row is stale', () => {
  assert.deepEqual(unclassifiedModule(catalog), []);
});

test('unclassifiedModule() reports a missing and a stale name', () => {
  const extra = [
    ...catalog,
    { name: 'module.brand.new', kind: 'action', surface: 'module', file: 'x' },
  ];
  assert.deepEqual(unclassifiedModule(extra), [{ name: 'module.brand.new', problem: 'missing' }]);
  const fewer = catalog.filter(c => c.name !== 'module.settings.save');
  assert.deepEqual(unclassifiedModule(fewer), [
    { name: 'module.settings.save', problem: 'not in the catalog' },
  ]);
  // An error counter needs no row.
  assert.deepEqual(
    unclassifiedModule([
      ...catalog,
      { name: 'module.error.new', kind: 'error', surface: 'module', file: 'x' },
    ]),
    []
  );
});

test('the counts per how add up to the row count', () => {
  const counts = countHows(FOUNDRY_CONTROLS);
  assert.deepEqual(Object.keys(counts).sort(), [...HOWS].sort());
  assert.equal(
    Object.values(counts).reduce((a, b) => a + b, 0),
    FOUNDRY_CONTROLS.length
  );
  assert.ok(counts.write > 0 && counts.open > 0 && counts.skip > 0);
});

test('every module.error.* name of the catalog becomes one skip row', () => {
  const names = catalog
    .filter(c => c.surface === 'module' && c.name.startsWith('module.error.'))
    .map(c => c.name);
  assert.ok(names.length > 0, 'the catalog has no module error counters');
  const rows = errorCounterRows(catalog);
  assert.deepEqual(
    rows.map(r => r.name),
    names
  );
  for (const r of rows) {
    assert.equal(r.how, 'skip');
    assert.equal(r.area, 'errors');
    assert.equal(r.why, ERROR_COUNTER_WHY);
  }
  assert.equal(errorCounterRows([]).length, 0);
});

test('every control of the table is named in the sweep or the scenario, so a new row is not forgotten', () => {
  const libDir = path.join(kit, 'lib');
  const files = [
    ...readdirSync(libDir)
      .filter(f => /^foundry-sweep.*\.mjs$/.test(f))
      .map(f => path.join(libDir, f)),
    path.join(kit, 'scenarios', 'foundry-controls.scenario.mjs'),
  ];
  assert.ok(files.length >= 2, 'no sweep files found');
  const source = files.map(f => readFileSync(f, 'utf8')).join('\n');
  // A skip row is listed by the scenario from the table itself. A name built in a template literal
  // (`foundry.scene.${tool}`) counts when the tool's last part is named in the source as well.
  const escapeRe = (/** @type {string} */ text) => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  const named = (/** @type {string} */ name) => {
    if (new RegExp(`['"\`]${escapeRe(name)}['"\`]`).test(source)) return true;
    const cut = name.lastIndexOf('.');
    const prefix = escapeRe(name.slice(0, cut + 1));
    const last = name.slice(cut + 1);
    return new RegExp(`\`${prefix}\\$\\{`).test(source) && source.includes(last);
  };
  const missing = FOUNDRY_CONTROLS.filter(r => r.how !== 'skip' && !named(r.name)).map(r => r.name);
  assert.deepEqual(missing, [], `rows no sweep file names: ${missing.join(', ')}`);
});
