import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadScenarios } from '../lib/loader.mjs';

function scenarioSource(over = {}) {
  const s = {
    id: 'demo-one',
    title: 'Demo',
    sizes: ['smoke', 'full'],
    tags: ['bridge'],
    needs: [],
    tools: ['get-world-info'],
    ...over,
  };
  return `export default { ...${JSON.stringify(s)}, run: async () => {} };`;
}

function dirWith(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kit-loader-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}

const catalog = { all: new Set(['get-world-info', 'list-journals']) };

test('loads valid scenarios and skips other files', async () => {
  const dir = dirWith({
    'a.scenario.mjs': scenarioSource({ id: 'aa' }),
    'b.scenario.mjs': scenarioSource({ id: 'bb', sizes: ['full'] }),
    'notes.txt': 'ignored',
    'helper.mjs': 'export const x = 1;',
  });
  const r = await loadScenarios([dir], { catalog });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(
    r.scenarios.map(s => s.scenario.id),
    ['aa', 'bb']
  );
  assert.equal(r.scenarios[0].file, 'a.scenario.mjs');
  assert.equal(r.scenarios[0].dir, dir);
});

test('size filter keeps scenarios that list the size', async () => {
  const dir = dirWith({
    'a.scenario.mjs': scenarioSource({ id: 'aa' }),
    'b.scenario.mjs': scenarioSource({ id: 'bb', sizes: ['full'] }),
  });
  const smoke = await loadScenarios([dir], { size: 'smoke' });
  assert.deepEqual(
    smoke.scenarios.map(s => s.scenario.id),
    ['aa']
  );
  const full = await loadScenarios([dir], { size: 'full' });
  assert.equal(full.scenarios.length, 2);
  const long = await loadScenarios([dir], { size: 'long' });
  assert.equal(long.scenarios.length, 0);
});

test('only filters by id and unknown ids are problems', async () => {
  const dir = dirWith({
    'a.scenario.mjs': scenarioSource({ id: 'aa' }),
    'b.scenario.mjs': scenarioSource({ id: 'bb' }),
  });
  const r = await loadScenarios([dir], { only: ['bb'] });
  assert.deepEqual(
    r.scenarios.map(s => s.scenario.id),
    ['bb']
  );
  assert.deepEqual(r.problems, []);
  const bad = await loadScenarios([dir], { only: ['zz'] });
  assert.match(bad.problems[0], /no scenario with id "zz"/);
});

test('shape problems are reported with the file name', async () => {
  const dir = dirWith({
    'a.scenario.mjs': scenarioSource({ id: 'Not Kebab', tags: ['nope'] }),
    'b.scenario.mjs': 'export default 5;',
    'c.scenario.mjs': 'throw new Error("boom");',
  });
  const r = await loadScenarios([dir]);
  assert.equal(r.scenarios.length, 0);
  assert.ok(r.problems.some(p => p.startsWith('a.scenario.mjs: id must be kebab-case')));
  assert.ok(r.problems.some(p => p.startsWith('a.scenario.mjs: tags must come from')));
  assert.ok(r.problems.some(p => p.startsWith('b.scenario.mjs: default export is not an object')));
  assert.ok(r.problems.some(p => p.startsWith('c.scenario.mjs: import failed: boom')));
});

test('an unknown tool is a problem when a catalog is given', async () => {
  const dir = dirWith({
    'a.scenario.mjs': scenarioSource({ tools: ['get-world-info', 'made-up-tool'] }),
  });
  const r = await loadScenarios([dir], { catalog });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /unknown tool "made-up-tool"/);
  const without = await loadScenarios([dir]);
  assert.deepEqual(without.problems, []);
});

test('duplicate ids across folders are rejected', async () => {
  const one = dirWith({ 'a.scenario.mjs': scenarioSource({ id: 'same-id' }) });
  const two = dirWith({ 'b.scenario.mjs': scenarioSource({ id: 'same-id' }) });
  const r = await loadScenarios([one, two]);
  assert.equal(r.scenarios.length, 1);
  assert.match(r.problems[0], /duplicate scenario id "same-id"/);
});

test('a missing folder is a problem', async () => {
  const r = await loadScenarios([path.join(tmpdir(), 'kit-no-such-dir-xyz')]);
  assert.match(r.problems[0], /scenario folder not found/);
});
