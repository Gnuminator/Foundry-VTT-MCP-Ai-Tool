// Pi stage 31, who the GM vault is shared with (scripts/pi/remote/31-gm-vault-peers.sh, backlog r1-gm-vault, D-139):
//   node --test scripts/pi/gm-vault-peers.test.mjs
// The text checks always run; PI_STAGE31_CONTAINER=1 (needs Docker) runs three real Syncthings in a Debian 13 ARM64 container.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStageContainer } from './container-test/run-stage-container.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(
  path.join(repo, 'scripts', 'pi', 'remote', '31-gm-vault-peers.sh'),
  'utf8'
);

describe('31-gm-vault-peers.sh as text', () => {
  test('is read-only unless ADD=1 or REMOVE=1, and then needs a snapshot first', () => {
    assert.match(stage, /if \[ "\$mode" != report \]; then\n {2}require_recent_snapshot/);
    assert.ok(stage.indexOf('require_recent_snapshot') < stage.indexOf('config devices add'));
    assert.ok(
      stage.indexOf('require_recent_snapshot') < stage.indexOf('devices "$device_id" delete')
    );
  });

  test('never deletes, moves or writes a vault file', () => {
    assert.doesNotMatch(stage, /\brm\b|\bmv\b|-delete|\bcp\b|\bchown\b|\bchmod\b|\binstall\b|tee /);
  });

  test('validates the device ID and name before Syncthing is touched', () => {
    const check = stage.indexOf('is not a Syncthing device ID');
    assert.ok(check > 0 && check < stage.indexOf('st show system'));
  });

  test('a new device is neither an introducer nor auto-accepting, and never a player device', () => {
    assert.match(stage, /auto-accept-folders set false/);
    assert.match(stage, /introducer set false/);
    assert.match(stage, /a player's device never gets the GM vault/);
  });

  test('REMOVE needs another complete device unless FORCE=1, and never prints the API key', () => {
    assert.match(stage, /no other device holds all of the vault yet/);
    assert.match(stage, /\[ "\$force" != 1 \]/);
    assert.doesNotMatch(stage, /(echo|say|ok|warn|out) [^\n]*\$api_key/);
  });
});

describe(
  'stage 31 in the ARM64 container',
  { skip: process.env.PI_STAGE31_CONTAINER !== '1' },
  () => {
    test('scenarios', () => {
      const r = runStageContainer('stage31-scenarios.sh', { timeout: 900000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
    });
  }
);
