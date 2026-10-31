// Pi stage 20, vault sync check and time zone (scripts/pi/remote/20-vault-sync.sh, Obsidian O8):
//   node --test scripts/pi/vault-sync.test.mjs
// The text checks always run; PI_STAGE20_CONTAINER=1 (needs Docker) runs two real Syncthings in a Debian 13 ARM64 container.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(path.join(repo, 'scripts', 'pi', 'remote', '20-vault-sync.sh'), 'utf8');

describe('20-vault-sync.sh as text', () => {
  test('is read-only unless SET_TIMEZONE=1, and then needs a snapshot first', () => {
    assert.match(stage, /if \[ "\$set_tz" = 1 \]; then\n {2}require_recent_snapshot\nfi/);
    assert.ok(
      stage.indexOf('require_recent_snapshot') <
        stage.indexOf('timedatectl set-timezone "$want_tz"')
    );
  });

  test('never deletes, moves or writes a vault file', () => {
    assert.doesNotMatch(stage, /\brm\b|\bmv\b|-delete|\bcp\b|\bchown\b|\bchmod\b|\binstall\b|tee /);
  });

  test('validates the zone name before it reaches a path or a command', () => {
    const check = stage.indexOf('is not a zone name');
    assert.ok(check > 0 && check < stage.indexOf('/usr/share/zoneinfo/$want_tz'));
    assert.ok(check < stage.indexOf('timedatectl set-timezone "$want_tz"'));
  });

  test('lists conflicts without looking inside Syncthing folders', () => {
    assert.match(stage, /-name \.stfolder -o -name \.stversions -o -name \.trash \\\) -prune/);
    assert.match(stage, /'\*\.sync-conflict-\*'/);
  });
});

describe(
  'stage 20 in the ARM64 container',
  { skip: process.env.PI_STAGE20_CONTAINER !== '1' },
  () => {
    test('scenarios', () => {
      const r = spawnSync(
        'docker',
        [
          'run',
          '--rm',
          '--platform',
          'linux/arm64',
          '-v',
          `${repo}:/repo:ro`,
          'debian:13-slim',
          'bash',
          '/repo/scripts/pi/container-test/stage20-scenarios.sh',
        ],
        { encoding: 'utf8', timeout: 900000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } }
      );
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
    });
  }
);
