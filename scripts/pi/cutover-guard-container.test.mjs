// The cut-over guard in front of every stage that starts a stack unit (scripts/pi/remote/lib.sh refuse_when_cut_over),
// run for each guarded stage in a Debian 13 ARM64 container with stand-ins for systemctl and docker:
//   PI_CUTOVER_CONTAINER=1 node --test scripts/pi/cutover-guard-container.test.mjs
// The unit tests of the guard and the check that no stage is missing one are in cutover-guard.test.mjs. The scenarios also
// run without a container in Git Bash:  REPO=$PWD bash scripts/pi/container-test/cutover-guard-scenarios.sh
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('cut-over guard in the ARM64 container', { skip: process.env.PI_CUTOVER_CONTAINER !== '1' }, () => {
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
        '/repo/scripts/pi/container-test/cutover-guard-scenarios.sh',
      ],
      { encoding: 'utf8', timeout: 900000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } }
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
  });
});
