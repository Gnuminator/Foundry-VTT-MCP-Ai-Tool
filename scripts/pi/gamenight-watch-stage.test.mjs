// Pi stage 29, the game-night watch as a service (scripts/pi/remote/29-gamenight-watch.sh, watch-on-pi):
//   node --test scripts/pi/gamenight-watch-stage.test.mjs
// Text checks always run; the scenarios (real lib.sh, runuser, cmp and install in a Debian 13 ARM64 container) run with
// PI_STAGE29_CONTAINER=1 (needs Docker).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(path.join(repo, 'scripts/pi/remote/29-gamenight-watch.sh'), 'utf8');
const watchPi = readFileSync(path.join(repo, 'scripts/gamenight-watch-pi.mjs'), 'utf8');

describe('stage 29 as text', () => {
  test('the snapshot check comes before the first write and DRY_RUN, CHECK and UNDO exist', () => {
    const snap = stage.indexOf('require_recent_snapshot');
    const write = stage.indexOf('install -d -m 0755');
    assert.ok(snap > 0 && write > snap);
    for (const m of ['DRY_RUN', 'CHECK', 'UNDO']) assert.match(stage, new RegExp(m));
  });

  test('it restarts only its own unit: no require_quiet, no other service touched', () => {
    assert.doesNotMatch(stage, /require_quiet|enable_unit/);
    const code = stage
      .split('\n')
      .filter(l => !l.startsWith('#'))
      .join('\n');
    const restarts = code.match(/systemctl (restart|stop|start) [^\n]*/g) ?? [];
    for (const r of restarts) assert.match(r, /"\$unit"/, r);
  });

  test('a running watch is also restarted when a file is newer than the service (a cut-off upgrade)', () => {
    assert.match(stage, /unit_started_epoch "\$unit"/);
    assert.match(stage, /stat -c %Y "\$f"\)" -gt "\$started"/);
  });

  test('every rm -rf has a guarded variable and the settings file is never removed', () => {
    for (const m of stage.matchAll(/rm -(rf|f) ("[^"]*")/g)) assert.match(m[2], /\$\{[a-z_]+:\?\}/, m[0]);
    assert.doesNotMatch(stage, /rm [^\n]*watch_env/);
  });

  test('secrets are only checked by name and the unit holds none', () => {
    assert.match(stage, /has_key\(\)/);
    assert.doesNotMatch(stage, /echo[^\n]*\$(token|secret|DISCORD_TOKEN|CF_ACCESS)/i);
    assert.doesNotMatch(stage, /^(Environment|ExecStart)=[^\n]*(TOKEN|SECRET)/m);
    assert.match(stage, /chmod 0640 "\$watch_env"/);
  });

  test('the unit is a hardened foundry-user service that waits for nothing it must not outlive', () => {
    assert.match(stage, /^User=\$FOUNDRY_USER$/m);
    assert.match(stage, /^NoNewPrivileges=true$/m);
    assert.match(stage, /^ProtectSystem=strict$/m);
    assert.match(stage, /^Restart=always$/m);
    assert.doesNotMatch(stage, /^(Requires|BindsTo)=/m);
  });
});

describe('the watch script as text', () => {
  test('it posts no address: alert texts are built from labels, and every post goes through scrubUrls', () => {
    assert.doesNotMatch(watchPi, /formatAlert\(/);
    assert.match(watchPi, /scrubUrls\(formatCheckAlert/);
    assert.doesNotMatch(watchPi, /(log|console\.\w+)\([^)\n]*\$\{(token|secret|headers|channelId)/);
  });
});

describe('stage 29 in the ARM64 container', { skip: process.env.PI_STAGE29_CONTAINER !== '1' }, () => {
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
        '/repo/scripts/pi/container-test/stage29-scenarios.sh',
      ],
      { encoding: 'utf8', timeout: 600000 }
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
  });
});
