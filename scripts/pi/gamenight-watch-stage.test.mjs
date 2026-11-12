// Pi stage 29, the game-night watch as a service (scripts/pi/remote/29-gamenight-watch.sh, watch-on-pi):
//   node --test scripts/pi/gamenight-watch-stage.test.mjs
// Text checks always run; the scenarios (real lib.sh, runuser, cmp and install in a Debian 13 ARM64 container) run with
// PI_STAGE29_CONTAINER=1 (needs Docker).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStageContainer } from './container-test/run-stage-container.mjs';

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

  test('CHECK passes --env-files (Node reads --env-file itself) and its pipes end in || true', () => {
    assert.match(stage, /--env-files "\$bot_env,\$watch_env"/);
    assert.doesNotMatch(stage, /--env-file "/);
    for (const l of stage.split('\n').filter(x => /\| sed /.test(x) && !x.trim().startsWith('#'))) {
      assert.match(l, /\|\| true/, l);
    }
  });

  test('the start waits for the watching line and fails when it never comes', () => {
    assert.match(stage, /wait_for_watching "\$unit" "\$since"/);
    assert.match(stage, /did not reach its 'watching' line/);
    const lib = readFileSync(path.join(repo, 'scripts/pi/remote/lib.sh'), 'utf8');
    assert.match(lib, /grep -q ' watching '/);
    assert.match(lib, /systemctl is-active --quiet "\$unit" \|\| return 1/);
  });

  test('a newer bot env file also restarts a running watch', () => {
    assert.match(stage, /"\$watch_env" "\$bot_env"; do/);
  });

  test('the header names the restart triggers and the real test overrides', () => {
    assert.match(stage, /settings file changed/);
    assert.match(stage, /newer than the running service/);
    assert.match(stage, /Tests only: SRC_DIR and UNIT_DIR/);
  });

  test('the token and game-server stages restart the watch for changed settings', () => {
    for (const f of ['set-discord-token.sh', '26-discord-game-server.sh']) {
      const s = readFileSync(path.join(repo, 'scripts/pi/remote', f), 'utf8');
      assert.match(s, /restart_gamenight_watch "/, f);
    }
    const lib = readFileSync(path.join(repo, 'scripts/pi/remote/lib.sh'), 'utf8');
    assert.match(lib, /systemctl restart "\$watch_unit"/);
    assert.match(lib, /wait_for_watching "\$watch_unit" "\$since"/);
    // a rerun of stage 26 whose settings are already right still repairs a watch older than the file
    const s26 = readFileSync(
      path.join(repo, 'scripts/pi/remote/26-discord-game-server.sh'),
      'utf8'
    );
    assert.match(s26, /restart_gamenight_watch "[^"]*" "\$env_file"/);
  });

  test('every rm -rf has a guarded variable and the settings file is never removed', () => {
    for (const m of stage.matchAll(/rm -(rf|f) ("[^"]*")/g))
      assert.match(m[2], /\$\{[a-z_]+:\?\}/, m[0]);
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

describe(
  'stage 29 in the ARM64 container',
  { skip: process.env.PI_STAGE29_CONTAINER !== '1' },
  () => {
    test('scenarios', () => {
      const r = runStageContainer('stage29-scenarios.sh', { timeout: 600000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
    });
  }
);
