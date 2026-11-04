// Tests for Pi stage 25 (scripts/pi/remote/25-modules.sh: the pinned module versions from the PC archive):
//   node --test scripts/pi/modules-stage.test.mjs
// - the stage as text: the guards a Pi stage needs (an EXIT trap, a state file, ${var:?} on every rm -rf, nothing
//   downloaded, no module switched on);
// - with PI_STAGE25_CONTAINER=1 (needs Docker; CI runs it on the ARM runner): the stage itself in a Debian 13 ARM64
//   container with stand-ins for systemd and curl (scripts/pi/container-test/stage25-scenarios.sh): a dry run that
//   changes nothing, the real run, a rerun, UNDO=1 with its read-back, a failed start, a browser that never joins, a
//   failed move and a version mismatch putting the old folders back, a crashed run refusing a new one, and the
//   refusals (a wrong sha256, a "../" entry, a link, a wrong id or version in the zip, an unsafe pin, players online).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(path.join(repo, 'scripts/pi/remote/25-modules.sh'), 'utf8');
const code = stage
  .split('\n')
  .filter(line => !line.trimStart().startsWith('#'))
  .join('\n');

describe('stage 25 as text', () => {
  test('logs through lib.sh STAGE_LOG, reads back with browser_joined, no early-exit grep on a pipe', () => {
    assert.match(code, /STAGE_LOG="\$LOG_FILE"/);
    assert.doesNotMatch(code, /STATE_LOG/);
    assert.match(code, /browser_joined "\$GM_UNIT"/);
    assert.doesNotMatch(code, /(journalctl|unzip|curl)[^\n]*\|\s*grep -q/);
  });

  test('refuses a new run after one that did not finish, and checks the room once before unpacking', () => {
    assert.match(code, /state_get phase\)" = installing/);
    // two checks: the copies of the zips (before the first copy), then the unpacked room (before the first unpack)
    assert.equal(code.match(/check_room "/g).length, 2);
    assert.ok(code.indexOf('check_room "') < code.indexOf('cp -- "$zip"'));
    assert.match(code, /runuser -u "\$FOUNDRY_USER" -- unzip -q "\$work\/\$id\.zip"/);
    assert.ok(code.indexOf('check_room "') < code.indexOf('unzip -q "$work/$id.zip"'));
  });

  test('every rm -rf has a ${var:?} guard', () => {
    const lines = code.split('\n').filter(l => /\brm\s+(-\w*r\w*f|-\w*f\w*r)/.test(l));
    assert.ok(lines.length > 0);
    for (const l of lines) assert.match(l, /\$\{\w+:\?\}/, l);
  });

  test('restores on exit, keeps a state file, checks the snapshot and who is online', () => {
    assert.match(code, /^trap on_exit EXIT/m);
    assert.match(code, /state_get\(\)/);
    assert.match(code, /require_recent_snapshot/);
    assert.match(code, /require_quiet "installing modules"/);
    assert.match(code, /refuse_during_system_trial/);
    assert.match(code, /flock -n 9/);
  });

  test('never downloads and never switches a module on', () => {
    assert.doesNotMatch(code, /\bwget\b|\bcurl\b[^\n]*\s-o\s|https?:\/\/(?!127\.0\.0\.1)/);
    assert.doesNotMatch(code, /moduleConfiguration/);
  });

  test('a dry run (no APPLY) stops before the real run', () => {
    assert.ok(code.indexOf('if [ -z "$APPLY" ]; then') < code.indexOf('stop_services\nundo=1'));
  });
});

describe(
  'stage 25 in the ARM64 container',
  { skip: process.env.PI_STAGE25_CONTAINER !== '1' },
  () => {
    test('scenarios', () => {
      const image =
        'debian:13@sha256:913f6706df59a68922d1dd08f78c2476560a8d367897200a6005b00e5f67c2d5';
      const res = spawnSync(
        'docker',
        [
          'run',
          '--rm',
          '--platform',
          'linux/arm64',
          '-v',
          `${repo}:/repo:ro`,
          image,
          'bash',
          '/repo/scripts/pi/container-test/stage25-scenarios.sh',
        ],
        { encoding: 'utf8' }
      );
      assert.equal(res.status, 0, res.stdout + res.stderr);
      assert.doesNotMatch(res.stdout, /FAIL/);
    });
  }
);
