import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GM_ACTIONS } from '../lib/contract.mjs';
import { createDashboardClient } from '../lib/dashboard.mjs';
import { startFake, FAKE_TOOL_NAMES } from '../lib/fake/index.mjs';
import { FAKE_GM_ACTIONS } from '../lib/fake/gm.mjs';
import { KitToolError } from '../lib/errors.mjs';
import { loadScenarios } from '../lib/loader.mjs';
import { loadToolCatalog } from '../lib/catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const kit = path.join(here, '..', 'kit.mjs');
const repoRoot = path.resolve(here, '..', '..', '..');

/** Runs the kit against the fake with its reports in a temp folder. @param {string[]} args */
function runKit(args) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-fake-'));
  const run = spawnSync(
    process.execPath,
    [kit, ...args, '--fake', '--report-dir', path.join(dir, 'report')],
    { encoding: 'utf8', timeout: 150000, env: { ...process.env, TEST_KIT_HOME: dir } }
  );
  const reportFile = path.join(dir, 'report', 'report.json');
  let report = null;
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8'));
  } catch {
    /* no report */
  }
  return { run, report, dir };
}

test('all --fake builds the kit and every scenario passes', () => {
  const { run, report, dir } = runKit(['all']);
  try {
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.ok(report, 'a report was written');
    assert.equal(report.run.fake, true);
    assert.equal(report.summary.failed, 0);
    assert.equal(report.summary.passed, 18, `passed ${report.summary.passed}`);
    for (const s of report.scenarios) assert.equal(s.status, 'pass', `${s.id}: ${s.status}`);
    assert.equal(report.build.heroes.length, 6); // smoke: one level 5 hero per class
    assert.equal(report.build.monsters.length, 11);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a deliberately broken scenario fails the run', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-broken-'));
  writeFileSync(
    path.join(dir, 'broken.scenario.mjs'),
    `export default {
  id: 'broken',
  title: 'Broken on purpose',
  sizes: ['smoke'],
  tags: ['bridge'],
  needs: ['heroes'],
  tools: ['get-world-info'],
  async run(t) {
    const info = await t.tool('get-world-info', {});
    await t.step('claims the wrong world', async () => {
      t.equal(info.id, 'not-the-kit-world', 'world id');
    });
  },
};
`
  );
  const { run, report, dir: out } = runKit(['all', '--only', 'broken', '--scenarios', dir]);
  try {
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`);
    assert.equal(report.summary.failed, 1);
    assert.equal(report.scenarios[0].id, 'broken');
    assert.equal(report.scenarios[0].status, 'fail');
    assert.match(report.scenarios[0].steps[0].error.message, /world id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('the fake implements every GM action and every tool the scenarios and the builder call', async () => {
  assert.deepEqual([...FAKE_GM_ACTIONS].sort(), Object.keys(GM_ACTIONS).sort());
  const catalog = await loadToolCatalog(repoRoot);
  const { scenarios } = await loadScenarios([path.join(here, '..', 'scenarios')], { catalog });
  const wanted = new Set([
    'list-creatures-by-criteria',
    'get-compendium-item',
    'create-actor-from-compendium',
  ]);
  // A scenario that drives dashboard pages in a real browser (t.browser) skips itself against the fake,
  // so the fake does not need the tools it clicks.
  for (const { scenario, file, dir } of scenarios) {
    if (readFileSync(path.join(dir, file), 'utf8').includes('t.browser')) continue;
    for (const name of scenario.tools) wanted.add(name);
  }
  const missing = [...wanted].filter(name => !FAKE_TOOL_NAMES.includes(name));
  assert.deepEqual(missing, []);
});

test('the fake keeps the dashboard rules: GM Actions switch, confirmation, unknown tools', async () => {
  const fake = await startFake({ world: 'ai-tool-kit-srd' });
  try {
    const client = createDashboardClient({ base: fake.base, token: '' });
    assert.equal((await client.health()).controlChannel, 'connected');
    assert.equal(await client.getGmActions(), false);
    // A write with the switch off is refused, with the switch on but unconfirmed too.
    await assert.rejects(
      client.tool('create-actor-from-compendium', {}),
      e => e instanceof KitToolError && e.status === 403
    );
    await client.setGmActions(true);
    assert.equal(await client.getGmActions(), true);
    const raw = await client.http('/api/tool', {
      method: 'POST',
      body: { name: 'create-actor-from-compendium', args: {} },
    });
    assert.equal(raw.status, 412);
    // A tool the fake has not got is an error, not an empty answer.
    await assert.rejects(client.tool('get-journal-entry', {}), /Unknown tool/);
    // Reads need no confirmation.
    const info = await client.tool('get-world-info', {});
    assert.equal(info.id, 'ai-tool-kit-srd');
  } finally {
    await fake.close();
  }
});
