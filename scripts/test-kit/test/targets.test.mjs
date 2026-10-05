import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveTarget, kitHome, foundryDataDir } from '../lib/targets.mjs';
import { EnvError } from '../lib/errors.mjs';

test('local target defaults', () => {
  const t = resolveTarget({ env: {} });
  assert.deepEqual(t, {
    name: 'local',
    dashboard: 'http://127.0.0.1:3100',
    foundry: 'http://127.0.0.1:30001',
    world: 'ai-tool-kit-srd',
  });
});

test('COGM_BASE may name localhost or [::1] on 3100 only', () => {
  assert.equal(
    resolveTarget({ env: { COGM_BASE: 'http://localhost:3100' } }).dashboard,
    'http://127.0.0.1:3100'
  );
  assert.equal(
    resolveTarget({ env: { COGM_BASE: 'http://[::1]:3100' } }).dashboard,
    'http://[::1]:3100'
  );
  for (const bad of [
    'http://127.0.0.1:3101',
    'http://example.com:3100',
    'http://192.168.1.5:3100',
    'not a url',
  ]) {
    assert.throws(() => resolveTarget({ env: { COGM_BASE: bad } }), EnvError, bad);
  }
});

test('the live bridge ports are refused, also in fake mode', () => {
  for (const port of [31414, 31415, 31416]) {
    assert.throws(
      () => resolveTarget({ env: { COGM_BASE: `http://127.0.0.1:${port}` } }),
      /live bridge/
    );
    assert.throws(
      () => resolveTarget({ fake: true, fakeBase: `http://127.0.0.1:${port}` }),
      /live bridge/
    );
  }
});

test('fake mode takes any loopback port', () => {
  const t = resolveTarget({ fake: true, fakeBase: 'http://127.0.0.1:45123' });
  assert.equal(t.name, 'fake');
  assert.equal(t.dashboard, 'http://127.0.0.1:45123');
  assert.throws(() => resolveTarget({ fake: true, fakeBase: 'http://10.0.0.2:45123' }), EnvError);
  assert.throws(() => resolveTarget({ fake: true }), EnvError);
});

test('only kit worlds are allowed', () => {
  assert.equal(resolveTarget({ world: 'ai-tool-kit-srd', env: {} }).world, 'ai-tool-kit-srd');
  for (const w of ['ai-tool-test', 'ai-tool-kit', 'strahd', '']) {
    assert.throws(() => resolveTarget({ world: w, env: {} }), /not a kit world/, w);
  }
  assert.throws(
    () => resolveTarget({ world: 'strahd', fake: true, fakeBase: 'http://127.0.0.1:4000' }),
    EnvError
  );
});

test('an unknown target name is refused (pi is not implemented)', () => {
  assert.throws(() => resolveTarget({ name: 'pi', env: {} }), /unknown target/);
});

test('kitHome honours TEST_KIT_HOME', () => {
  assert.equal(kitHome({ TEST_KIT_HOME: 'X:\\kit' }), 'X:\\kit');
  assert.equal(kitHome({}), 'C:\\FoundryTest\\test-kit');
});

test('foundryDataDir reads Root from local.json and nothing else', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'kit-targets-'));
  assert.equal(foundryDataDir(repo), path.join('C:\\FoundryTest', 'data'));
  mkdirSync(path.join(repo, 'scripts', 'test-env'), { recursive: true });
  writeFileSync(
    path.join(repo, 'scripts', 'test-env', 'local.json'),
    JSON.stringify({ Root: 'D:\\FT', AdminPassword: 'secret' })
  );
  assert.equal(foundryDataDir(repo), path.join('D:\\FT', 'data'));
  writeFileSync(path.join(repo, 'scripts', 'test-env', 'local.json'), '{not json');
  assert.equal(foundryDataDir(repo), path.join('C:\\FoundryTest', 'data'));
});
