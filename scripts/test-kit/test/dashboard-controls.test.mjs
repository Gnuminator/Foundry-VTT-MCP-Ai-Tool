/**
 * The dashboard control table (lib/dashboard-controls.mjs) against the generated usage catalog and the
 * front end's own files, and the pure helpers of the sweep driver. No browser is started.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTROLS,
  DASHBOARD_CONTROLS,
  HOWS,
  MODULE_SKIP_REASON,
  PLAYER_CONTROLS,
  countByHow,
  groupOf,
  groupedRows,
  moduleSkips,
  readUsageCatalog,
  surfaceOf,
  unclassified,
} from '../lib/dashboard-controls.mjs';
import {
  NEVER_CLICK,
  Skip,
  selectorOf,
  shotName,
  walkReach,
  wantsShot,
} from '../lib/dashboard-sweep.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pub = path.join(root, 'packages', 'cogm-dashboard', 'public');
const read = (/** @type {string} */ f) => readFileSync(path.join(pub, f), 'utf8');
const catalog = readUsageCatalog();
const byName = new Map(CONTROLS.map(r => [r.name, r]));

test('the catalog is read from the generated file', () => {
  assert.ok(catalog.length > 100, `only ${catalog.length} entries read`);
  assert.ok(catalog.some(c => c.surface === 'dashboard'));
  assert.ok(catalog.some(c => c.surface === 'player'));
  assert.ok(catalog.some(c => c.surface === 'module'));
});

test('every dashboard and player catalog entry is classified, and no row is stale', () => {
  assert.deepEqual(unclassified(catalog), []);
});

test('unclassified() reports a missing and a stale name', () => {
  const extra = [
    ...catalog,
    { name: 'dash.brand.new', kind: 'action', surface: 'dashboard', file: 'x' },
  ];
  assert.deepEqual(unclassified(extra), [{ name: 'dash.brand.new', problem: 'missing' }]);
  const fewer = catalog.filter(c => c.name !== 'dash.party.view');
  assert.deepEqual(unclassified(fewer), [
    { name: 'dash.party.view', problem: 'not in the catalog' },
  ]);
  // A new module entry needs no row.
  assert.deepEqual(
    unclassified([
      ...catalog,
      { name: 'module.x.y', kind: 'action', surface: 'module', file: 'x' },
    ]),
    []
  );
});

test('the table has no duplicate names and each row has a known how', () => {
  const names = CONTROLS.map(r => r.name);
  assert.equal(new Set(names).size, names.length, 'duplicate rows');
  for (const r of CONTROLS) assert.ok(HOWS.includes(r.how), `${r.name}: unknown how "${r.how}"`);
});

test('a row matches the kind of its catalog entry', () => {
  for (const c of catalog) {
    const r = byName.get(c.name);
    if (!r) continue;
    if (c.kind === 'view') assert.equal(r.how, 'view', `${c.name} is a view`);
    else if (c.kind === 'error') assert.equal(r.how, 'error', `${c.name} is an error`);
    else if (c.kind === 'shortcut')
      assert.ok(['shortcut', 'skip'].includes(r.how), `${c.name} is a shortcut`);
    else
      assert.ok(
        !['view', 'error', 'shortcut'].includes(r.how),
        `${c.name} is an action, not ${r.how}`
      );
  }
});

test('the surface of a row matches its table', () => {
  for (const r of DASHBOARD_CONTROLS) assert.equal(surfaceOf(r.name), 'dashboard', r.name);
  for (const r of PLAYER_CONTROLS) assert.equal(surfaceOf(r.name), 'player', r.name);
  for (const c of catalog) {
    if (c.surface === 'module') continue;
    assert.equal(surfaceOf(c.name), c.surface, c.name);
  }
});

test('every reach names a row of the same surface that is not a write, error or skip', () => {
  for (const r of CONTROLS) {
    for (const name of r.reach ?? []) {
      const step = byName.get(name);
      assert.ok(step, `${r.name}: reach "${name}" is not in the table`);
      assert.equal(
        surfaceOf(name),
        surfaceOf(r.name),
        `${r.name}: reach "${name}" is on another page`
      );
      assert.ok(
        !NEVER_CLICK.includes(step.how),
        `${r.name}: reach "${name}" is a ${step.how} row, never clicked`
      );
      assert.notEqual(name, r.name, `${r.name} reaches itself`);
    }
  }
});

test('rows say what they need: reasons, keys and checks', () => {
  for (const r of CONTROLS) {
    if (['write', 'external', 'ai', 'error', 'skip'].includes(r.how))
      assert.ok(r.why, `${r.name}: a ${r.how} row needs a why`);
    if (r.optional) assert.ok(r.why, `${r.name}: an optional row needs a why`);
    if (r.how === 'shortcut') {
      assert.ok(r.key, `${r.name}: a shortcut needs a key`);
      assert.ok(r.gone || r.expect, `${r.name}: a shortcut needs expect or gone`);
    }
    if (r.how === 'view') assert.ok(r.expect, `${r.name}: a view needs expect`);
    if (r.how === 'open')
      assert.ok(
        r.expect || r.gone || r.changes,
        `${r.name}: an open row needs expect, gone or changes`
      );
    if (['write', 'error', 'skip'].includes(r.how))
      assert.ok(!r.reach && !r.expect && !r.gone, `${r.name}: a ${r.how} row is never driven`);
  }
});

test('module entries are skipped with the reason "inside Foundry"', () => {
  const skips = moduleSkips(catalog);
  assert.equal(skips.length, catalog.filter(c => c.surface === 'module').length);
  for (const s of skips) {
    assert.equal(s.how, 'skip');
    assert.equal(s.why, MODULE_SKIP_REASON);
    assert.equal(s.why, 'inside Foundry');
  }
});

test('expect and gone selectors point at ids and classes the front end has', () => {
  const dashboardFiles = read('index.html') + read('app.js');
  const playerFiles = read('player.html') + read('player.js');
  for (const r of CONTROLS) {
    const files = r.name.startsWith('player.') ? playerFiles : dashboardFiles;
    for (const sel of [
      r.expect,
      r.gone,
      r.selector,
      typeof r.changes === 'string' ? r.changes : undefined,
    ]) {
      if (!sel) continue;
      for (const m of sel.matchAll(/#([a-z][a-z0-9-]*)/g)) {
        assert.ok(
          files.includes(`id="${m[1]}"`) ||
            files.includes(`'${m[1]}'`) ||
            files.includes(`$('${m[1]}')`),
          `${r.name}: id "${m[1]}" in "${sel}" is not in the page files`
        );
      }
      for (const m of sel.matchAll(/\.([a-z][a-z0-9-]*)/g)) {
        assert.ok(
          files.includes(m[1]),
          `${r.name}: class "${m[1]}" in "${sel}" is not in the page files`
        );
      }
    }
  }
});

test('a control with a data-track mark in the page is found by it', () => {
  const html = read('index.html') + read('player.html');
  const code = read('app.js') + read('player.js');
  for (const r of CONTROLS) {
    if (r.selector || ['view', 'shortcut', 'write', 'error', 'skip'].includes(r.how)) continue;
    assert.equal(selectorOf(r), `[data-track="${r.name}"]`);
    assert.ok(
      html.includes(`data-track="${r.name}"`) || code.includes(`data-track="${r.name}"`),
      `${r.name}: no element in the page carries this data-track`
    );
  }
});

test('rows are grouped in run order, and the trial runs before the During layouts', () => {
  const groups = groupedRows('dashboard').map(g => g.group);
  assert.ok(groups.indexOf('trial') < groups.indexOf('during'), groups.join(','));
  assert.deepEqual(
    groupedRows('player').map(g => g.group),
    ['main', 'who', 'handouts', 'footer']
  );
  assert.equal(groupOf('dash.tools.close'), 'tools');
  assert.equal(
    groupedRows('dashboard').reduce((n, g) => n + g.rows.length, 0),
    DASHBOARD_CONTROLS.length
  );
});

test('the sweep names screenshots and picks the pages worth one', () => {
  assert.equal(shotName(byName.get('dash.party.view')), 'party-view.png');
  assert.equal(shotName(byName.get('dash.during.layout-auto')), 'during-layout-auto.png');
  assert.equal(shotName(byName.get('player.main.view')), 'main-view.png');
  assert.ok(wantsShot(byName.get('dash.tools.view')));
  assert.ok(wantsShot(byName.get('dash.moment.after')));
  assert.ok(wantsShot(byName.get('dash.during.layout-toggle')));
  assert.ok(!wantsShot(byName.get('dash.tools.close')));
});

test('walkReach: no tool with a Pick button fails a required row and skips an optional one', async () => {
  // A page where every control is there and clickable, but the tool list is empty.
  const locator = {
    first: () => locator,
    nth: () => locator,
    waitFor: async () => {},
    click: async () => {},
    count: async () => 0,
  };
  const page = { locator: () => locator, waitForTimeout: async () => {} };
  const required = byName.get('dash.tools.pick-open');
  const optional = byName.get('dash.shortcut.escape-picker');
  assert.ok(required && !required.optional && optional?.optional);
  await assert.rejects(
    walkReach(page, required),
    e => !(e instanceof Skip) && /Pick button/.test(e.message)
  );
  await assert.rejects(walkReach(page, optional), e => e instanceof Skip);
  // A row with no picker need walks its reach and resolves.
  await walkReach(page, byName.get('dash.tools.back'));
});

test('the counts per how add up', () => {
  const counts = countByHow();
  assert.equal(
    Object.values(counts).reduce((a, b) => a + b, 0),
    CONTROLS.length
  );
  assert.ok(counts.write > 0 && counts.open > 0 && counts.view > 0);
});
