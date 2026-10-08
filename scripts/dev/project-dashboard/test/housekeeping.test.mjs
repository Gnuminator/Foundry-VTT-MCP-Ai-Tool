import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runHousekeeping } from '../housekeeping.mjs';

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-hk-'));
  const calls = [];
  const deps = {
    buildSnapshot: async () => calls.push('snapshot'),
    syncUsageToVault: async ({ state }) => {
      calls.push('sync');
      state.push = { state: 'nothing', detail: 'no changes to push', at: new Date().toISOString() };
    },
  };
  return {
    paths: { dataDir, vaultDir: null },
    deps,
    calls,
    lock: path.join(dataDir, 'housekeeping.lock'),
  };
}

test('runHousekeeping runs once, saves the push state and releases its lock', async () => {
  const { paths, deps, calls, lock } = setup();
  const push = await runHousekeeping({ paths, deps });
  assert.equal(push.state, 'nothing');
  assert.deepEqual(calls, ['snapshot', 'sync']);
  assert.equal(fs.existsSync(lock), false);
  const saved = JSON.parse(fs.readFileSync(path.join(paths.dataDir, 'usage-log.json'), 'utf8'));
  assert.equal(saved.push.state, 'nothing');
});

test('a second run waits while the first holds the lock, and takes over a stale lock', async () => {
  const { paths, deps, calls, lock } = setup();
  fs.writeFileSync(lock, '123');
  const busy = await runHousekeeping({ paths, deps });
  assert.equal(busy.state, 'waiting');
  assert.match(busy.detail, /another housekeeping run/);
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(path.join(paths.dataDir, 'usage-log.json')), false);

  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(lock, old, old);
  const push = await runHousekeeping({ paths, deps });
  assert.equal(push.state, 'nothing');
  assert.deepEqual(calls, ['snapshot', 'sync']);
  assert.equal(fs.existsSync(lock), false);
});

test('the lock is released when a run throws', async () => {
  const { paths, lock } = setup();
  const deps = {
    buildSnapshot: async () => {
      throw new Error('boom');
    },
  };
  await assert.rejects(runHousekeeping({ paths, deps }), /boom/);
  assert.equal(fs.existsSync(lock), false);
});
