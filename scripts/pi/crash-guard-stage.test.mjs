// Pi stage 32, the crash-loop guard and clock check (scripts/pi/remote/32-crash-guard.sh, pi-crash-loops-clock):
//   node --test scripts/pi/crash-guard-stage.test.mjs
// Text checks always run; the scenarios (real lib.sh in a Debian 13 ARM64 container) run with PI_STAGE32_CONTAINER=1 (needs Docker).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(path.join(repo, 'scripts/pi/remote/32-crash-guard.sh'), 'utf8');
const code = stage
  .split('\n')
  .filter(l => !l.trim().startsWith('#'))
  .join('\n');

describe('stage 32 as text', () => {
  test('bash parses it', () => {
    const r = spawnSync('bash', ['-n', path.join(repo, 'scripts/pi/remote/32-crash-guard.sh')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });

  test('the snapshot check comes after the mode check and before the first write; DRY_RUN, CHECK and UNDO exist', () => {
    const modes = stage.indexOf('use one of DRY_RUN=1, CHECK=1 and UNDO=1');
    const snap = stage.indexOf('require_recent_snapshot');
    const write = stage.indexOf('install -d -m 0755 -o root -g root "$dest"');
    assert.ok(modes > 0 && snap > modes && write > snap);
    assert.match(stage, /if \[ "\$dry" != 1 \] && \[ "\$check" != 1 \]; then require_recent_snapshot/);
  });

  test('it restarts and stops nothing but its own timer: no require_quiet, no enable_unit', () => {
    assert.doesNotMatch(code, /require_quiet|enable_unit/);
    const noText = code
      .split('\n')
      .filter(l => !l.includes('text="') && !/^\s*(ok|warn|say|die) /.test(l))
      .join('\n');
    for (const r of noText.match(/systemctl (restart|stop|start|enable|disable)[^\n]*/g) ?? []) {
      assert.match(r, /"\$clock_timer"|"\$clock_service"|alert@crash-guard-test/, r);
    }
  });

  test('no unit file of an earlier stage is edited: only drop-ins and new units', () => {
    assert.doesNotMatch(code, /sed -i/);
    assert.match(stage, /10-crash-guard\.conf/);
  });

  test('every guarded drop-in has a start limit and OnFailure, and only Foundry gets Restart=always', () => {
    assert.match(stage, /StartLimitIntervalSec=%s\\nStartLimitBurst=%s\\nOnFailure=foundry-ai-tool-alert@%%n\.service/);
    assert.match(stage, /if \[ "\$1" = foundry\.service \]/);
    assert.equal((code.match(/printf '[^\n]*Restart=always/g) ?? []).length, 1);
  });

  test('automatic restarts do not fire OnFailure: RestartMode=direct, and the alert wants start-limit-hit', () => {
    assert.match(stage, /RestartMode=direct\\n/);
    assert.match(stage, /!= start-limit-hit/);
    assert.match(stage, /crash-guard-test/);
    assert.match(stage, /\[ -n "\$result" \] && \[ "\$result" != start-limit-hit \]/);
  });

  test('the install read-back stops on a failed test post before it accepts "no token" as a warning', () => {
    const failed = stage.indexOf('*"post failed"*');
    const noToken = stage.indexOf('*"no Discord token"*');
    assert.ok(failed > 0 && noToken > failed);
    assert.match(stage, /\*"post failed"\* \| \*"looks wrong"\*\) die/);
  });

  test('the alert never puts the token on a command line and the units hold no secret', () => {
    assert.match(stage, /curl[^\n]* -K -/);
    assert.doesNotMatch(code, /^(Environment|ExecStart)=[^\n]*(TOKEN|SECRET)/m);
    assert.doesNotMatch(code, /curl[^\n]*Authorization: Bot/);
    assert.match(stage, /\^\[A-Za-z0-9@:\._-\]\{1,100\}\$/);
  });

  test('the alert units are hardened services of the foundry user', () => {
    assert.match(stage, /User=\$FOUNDRY_USER\nGroup=\$FOUNDRY_USER/);
    assert.match(stage, /^NoNewPrivileges=true$/m);
    assert.match(stage, /^ProtectSystem=strict$/m);
    assert.match(stage, /^StateDirectory=\$state_name$/m);
  });

  test('every rm -rf has a guarded variable', () => {
    for (const m of code.matchAll(/rm -(rf|f) ("[^"]*")/g)) assert.match(m[2], /\$\{[a-z_]+:\?\}/, m[0]);
  });

  test('the header names the test override and what a tripped unit needs', () => {
    assert.match(stage, /Tests only: UNIT_DIR/);
    assert.match(stage, /systemctl reset-failed <unit> && systemctl start <unit>/);
  });
});

describe('stage 32 in the ARM64 container', { skip: process.env.PI_STAGE32_CONTAINER !== '1' }, () => {
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
        '/repo/scripts/pi/container-test/stage32-scenarios.sh',
      ],
      { encoding: 'utf8', timeout: 600000 }
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
  });
});
