// Pi stage 37, world switches set from the Pi with no bundle (scripts/pi/remote/37-world-switches.sh, driver
// scripts/pi/remote/world-switches.mjs; backlog stage11-clean-world-route):
//   node --test scripts/pi/stage37-world-switches.test.mjs
// - selectProfile narrows the driver's list to the named entries and refuses a name it does not know;
// - the stage as text: it deletes nothing, touches no unit, checks the snapshot and the quiet world before the browser, a dry
//   run exits before it, and CHECK=1 asks the driver for a read-only run; bash -n parses it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PROFILE, selectProfile } from './remote/world-switches.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = path.join(repo, 'scripts/pi/remote/37-world-switches.sh');
const stage = readFileSync(file, 'utf8');
const code = stage
  .split('\n')
  .filter(l => !l.trim().startsWith('#'))
  .join('\n');

describe('selectProfile', () => {
  test('no names keeps the whole list', () => {
    assert.equal(selectProfile(undefined), PROFILE);
    assert.equal(selectProfile(''), PROFILE);
    assert.equal(selectProfile(' , '), PROFILE);
  });

  test('names narrow it to those entries only', () => {
    const only = selectProfile('item-piles.enableTrading');
    assert.deepEqual(
      only.map(p => `${p.ns}.${p.key}`),
      ['item-piles.enableTrading']
    );
    assert.equal(selectProfile('dnd5e.autoApplyDowned, item-piles.enableTrading').length, 2);
  });

  test('an unknown name is refused', () => {
    assert.throws(() => selectProfile('item-piles.nope'), /no known switch: item-piles\.nope/);
  });

  test('the stage default is a real switch', () => {
    const def = /SWITCHES="\$\{SWITCHES:-([^}]+)\}"/.exec(stage)?.[1];
    assert.ok(def, 'the stage names a default');
    assert.equal(selectProfile(def).length, def.split(',').length);
  });
});

describe('stage 37 as text', () => {
  test('it parses', () => {
    const r = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
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

  test('the snapshot is required for APPLY only, and CHECK is read only', () => {
    assert.match(code, /if \[ -n "\$APPLY" \]; then\n\s+require_recent_snapshot/);
    assert.match(code, /read_only=1/);
    assert.match(code, /SWITCH_READ_ONLY="\$read_only"/);
  });

  test('the driver gets the login through the environment, not a command line', () => {
    assert.doesNotMatch(code, /GM_PASSWORD=/);
    assert.match(code, /runuser -u "\$FOUNDRY_USER" -- env /);
  });

  test('it needs no bundle', () => {
    assert.doesNotMatch(code, /BUNDLE|REPLACE_WORLD|tar /);
  });
});
