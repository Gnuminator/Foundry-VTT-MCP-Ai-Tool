// Pi stage 36, DDB Importer switched off in the live world (scripts/pi/remote/36-drop-ddb-importer.sh and its in-browser
// part scripts/pi/remote/module-switch.mjs; backlog drop-ddb-importer):
//   node --test scripts/pi/drop-ddb-importer.test.mjs
// - the in-browser part against a fake `game`: off, on, a second run changing nothing, other modules' entries kept, the
//   blockers and the read-back check;
// - the stage as text: it deletes nothing, starts and stops no unit, checks the snapshot before the browser, and a dry run
//   exits before joining anything; bash -n parses it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { applyState, blockers, mismatch, readState } from './remote/module-switch.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(path.join(repo, 'scripts/pi/remote/36-drop-ddb-importer.sh'), 'utf8');
const code = stage
  .split('\n')
  .filter(l => !l.trim().startsWith('#'))
  .join('\n');

function fakeGlobals({
  config,
  installed = ['ddb-importer', 'dae'],
  world = 'w',
  isGM = true,
} = {}) {
  let cfg = config;
  const sets = [];
  globalThis.game = {
    world: { id: world },
    user: { name: 'GM', isGM },
    modules: new Map(installed.map(id => [id, { active: cfg?.[id] === true }])),
    settings: {
      get: (ns, key) => {
        assert.equal(`${ns}.${key}`, 'core.moduleConfiguration');
        return cfg;
      },
      set: async (ns, key, value) => {
        assert.equal(`${ns}.${key}`, 'core.moduleConfiguration');
        sets.push(value);
        cfg = value;
      },
    },
  };
  globalThis.foundry = { utils: { deepClone: v => JSON.parse(JSON.stringify(v)) } };
  return sets;
}

describe('the in-browser part', () => {
  test('off sets only the one entry and leaves the others', async () => {
    const sets = fakeGlobals({ config: { 'ddb-importer': true, dae: true, other: false } });
    assert.equal(await applyState({ id: 'ddb-importer', enabled: false }), true);
    assert.deepEqual(sets, [{ 'ddb-importer': false, dae: true, other: false }]);
  });

  test('a second run changes nothing', async () => {
    const sets = fakeGlobals({ config: { 'ddb-importer': false, dae: true } });
    assert.equal(await applyState({ id: 'ddb-importer', enabled: false }), false);
    assert.deepEqual(sets, []);
  });

  test('on switches it back and a module with no entry gets one', async () => {
    const sets = fakeGlobals({ config: { dae: true } });
    assert.equal(await applyState({ id: 'ddb-importer', enabled: true }), true);
    assert.deepEqual(sets, [{ dae: true, 'ddb-importer': true }]);
  });

  test('readState reports installed, active and configured', () => {
    fakeGlobals({ config: { 'ddb-importer': true } });
    assert.deepEqual(readState({ id: 'ddb-importer' }), {
      world: 'w',
      user: 'GM',
      isGM: true,
      installed: true,
      active: true,
      configured: true,
    });
    fakeGlobals({ config: {}, installed: [] });
    const s = readState({ id: 'ddb-importer' });
    assert.equal(s.installed, false);
    assert.equal(s.configured, null);
  });

  test('blockers: wrong world, not a GM, module missing', () => {
    fakeGlobals({ config: { 'ddb-importer': true } });
    assert.deepEqual(blockers(readState({ id: 'ddb-importer' }), 'w', 'ddb-importer'), []);
    assert.match(
      blockers(readState({ id: 'ddb-importer' }), 'other', 'ddb-importer').join(),
      /expected other/
    );
    fakeGlobals({ config: {}, isGM: false, installed: [] });
    const p = blockers(readState({ id: 'ddb-importer' }), 'w', 'ddb-importer').join();
    assert.match(p, /not a GM/);
    assert.match(p, /not installed/);
  });

  test('the read-back check', () => {
    assert.equal(mismatch({ configured: false, active: false }, false), null);
    assert.match(mismatch({ configured: true, active: true }, false), /expected false/);
    assert.match(mismatch({ configured: null, active: false }, false), /null/);
    assert.match(mismatch({ configured: false, active: true }, false), /after the reload/);
  });
});

describe('stage 36 as text', () => {
  test('it parses', () => {
    const r = spawnSync(
      'bash',
      ['-n', path.join(repo, 'scripts/pi/remote/36-drop-ddb-importer.sh')],
      {
        encoding: 'utf8',
      }
    );
    if (r.error) return; // no bash here
    assert.equal(r.status, 0, r.stderr);
  });

  test('it deletes nothing and starts, stops or restarts no unit', () => {
    // The one rm removes the uploaded copy of the driver in /root after a real run (as stage 11 does).
    const rest = code.replace('rm -f "${SRC_DRIVER:?}"', '');
    assert.doesNotMatch(rest, /\brm\b|\bmv\b|\bkill\b|systemctl|svc_|docker|enable_unit/);
  });

  test('the snapshot and quiet checks come before the browser, and a dry run exits before it', () => {
    const snap = code.indexOf('require_recent_snapshot');
    const quiet = code.indexOf('require_quiet');
    const dry = code.indexOf('exit 0');
    const run = code.indexOf('runuser');
    assert.ok(snap > 0 && quiet > snap && dry > quiet && run > dry);
  });

  test('the driver gets the login through the environment, not a command line', () => {
    assert.doesNotMatch(code, /GM_PASSWORD=/);
    assert.match(code, /runuser -u "\$FOUNDRY_USER" -- env /);
  });

  test('only the one module id is switched, and the proxy port is only looked at', () => {
    assert.match(stage, /MODULE_ID="\$\{MODULE_ID:-ddb-importer\}"/);
    assert.match(code, /ss -ltnH/);
  });
});
