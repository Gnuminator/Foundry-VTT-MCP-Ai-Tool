import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  resolveTarget,
  kitHome,
  kitWorldsDir,
  foundryDataDir,
  testServer,
  testServerName,
  TEST_SERVERS,
} from '../lib/targets.mjs';
import { KIT_WORLDS, LIVE_BRIDGE_PORTS } from '../lib/contract.mjs';
import { EnvError } from '../lib/errors.mjs';

test('local target defaults', () => {
  const t = resolveTarget({ env: {} });
  assert.deepEqual(t, {
    name: 'local',
    server: 'A',
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

test('FOUNDRY_TEST_SERVER=B points the kit at server B; an unknown server is refused', () => {
  const t = resolveTarget({ env: { FOUNDRY_TEST_SERVER: 'b' } });
  assert.deepEqual(t, {
    name: 'local',
    server: 'B',
    dashboard: 'http://127.0.0.1:3101',
    foundry: 'http://127.0.0.1:30002',
    world: 'ai-tool-kit-srd',
  });
  // server B's dashboard only: A's port is refused there
  assert.throws(
    () => resolveTarget({ env: { FOUNDRY_TEST_SERVER: 'B', COGM_BASE: 'http://127.0.0.1:3100' } }),
    e => e instanceof EnvError && /Only port 3101/.test(e.message)
  );
  assert.equal(testServerName({}), 'A');
  assert.throws(() => testServerName({ FOUNDRY_TEST_SERVER: 'C' }), EnvError);
  assert.equal(testServer('b').linkPort, 31525);
});

test('the test servers never share a port and never use the live or Plan B ports', () => {
  const reserved = [...LIVE_BRIDGE_PORTS, 30000, 30100, 31614, 31615, 3000, 3300, 3200];
  const all = [];
  for (const [name, s] of Object.entries(TEST_SERVERS)) {
    for (const key of ['FoundryPort', 'ControlPort', 'LinkPort', 'DashboardPort']) {
      assert.ok(Number.isInteger(s[key]), `${name}.${key}`);
      assert.ok(!reserved.includes(s[key]), `${name}.${key} ${s[key]} is reserved`);
      all.push(s[key]);
    }
  }
  assert.equal(new Set(all).size, all.length);
});

test('each server keeps its own kit manifests; the kit home is shared', () => {
  const env = { TEST_KIT_HOME: path.join('X:', 'kit') };
  assert.equal(kitWorldsDir(env), path.join('X:', 'kit', 'worlds'));
  assert.equal(
    kitWorldsDir({ ...env, FOUNDRY_TEST_SERVER: 'B' }),
    path.join('X:', 'kit', 'worlds-B')
  );
});

test('foundryDataDir for server B reads Root from local.B.json, else servers.json', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'kit-targets-b-'));
  const env = { FOUNDRY_TEST_SERVER: 'B' };
  assert.equal(foundryDataDir(repo, env), path.join('C:\\FoundryTestB', 'data'));
  mkdirSync(path.join(repo, 'scripts', 'test-env'), { recursive: true });
  writeFileSync(
    path.join(repo, 'scripts', 'test-env', 'local.json'),
    JSON.stringify({ Root: 'D:\\FT' })
  );
  assert.equal(foundryDataDir(repo, env), path.join('C:\\FoundryTestB', 'data'));
  writeFileSync(
    path.join(repo, 'scripts', 'test-env', 'local.B.json'),
    JSON.stringify({ Root: 'D:\\FTB' })
  );
  assert.equal(foundryDataDir(repo, env), path.join('D:\\FTB', 'data'));
});

test('server-b.ps1 copies every kit world', () => {
  const file = new URL('../../test-env/server-b.ps1', import.meta.url);
  const m = /\$KitWorlds = @\(([^)]*)\)/.exec(readFileSync(file, 'utf8'));
  assert.ok(m, 'server-b.ps1 has a $KitWorlds list');
  const listed = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.deepEqual([...listed].sort(), [...KIT_WORLDS].sort());
});
