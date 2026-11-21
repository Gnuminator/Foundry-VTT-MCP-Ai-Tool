// Pi stage 21, the player vault share (scripts/pi/remote/21-player-vault.sh, player-vault-sync, D-134):
//   node --test scripts/pi/player-vault.test.mjs
// The text checks always run; PI_STAGE21_CONTAINER=1 (needs Docker) runs three real Syncthings in a Debian 13 ARM64 container.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStageContainer } from './container-test/run-stage-container.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(
  path.join(repo, 'scripts', 'pi', 'remote', '21-player-vault.sh'),
  'utf8'
);

describe('21-player-vault.sh as text', () => {
  test('every mode that changes something needs a snapshot from today first', () => {
    assert.match(stage, /if \[ "\$mode" != report \]; then\n {2}require_recent_snapshot\n/);
    // The snapshot check comes before the first Syncthing write and before the dashboard switch.
    const snap = stage.indexOf('require_recent_snapshot');
    assert.ok(snap > 0);
    for (const write of [
      'config folders add',
      'config devices add',
      'ensure_dashboard_switch\n  share_player',
    ]) {
      assert.ok(snap < stage.indexOf(write), write);
    }
  });

  test('a player folder is always Send Only, never send and receive', () => {
    assert.match(stage, /--type sendonly/);
    assert.doesNotMatch(stage, /--type (sendreceive|receiveonly)/);
    assert.match(stage, /type set sendonly/);
  });

  test('a device is never an introducer and never auto-accepts folders', () => {
    assert.match(stage, /auto-accept-folders set false/);
    assert.match(stage, /introducer set false/);
    assert.doesNotMatch(stage, /introducer set true|auto-accept-folders set true/);
  });

  test('never shares the GM vault or the players folder as a whole', () => {
    // Only a path under the players folder is ever given to Syncthing, and only after the marker check.
    assert.doesNotMatch(stage, /--path "\$players_dir"|--path "\$gm/);
    const check = stage.indexOf('check_player_folder "$player"');
    assert.ok(check > 0 && check < stage.indexOf('--path "$dir"'));
    assert.match(stage, /\.aitool-player\.json/);
    assert.match(stage, /is a link: refused/);
  });

  test('refuses a device that is already on another folder, the GM vault included', () => {
    const guard = stage.indexOf('device_on_other_folder "$device_id" "$fid"');
    assert.ok(guard > 0 && guard < stage.indexOf('config devices add --device-id "$device_id"'));
    assert.ok(guard < stage.indexOf('config folders add --id "$fid"'));
  });

  test('never writes, moves or deletes a vault note', () => {
    // The only rm is the dashboard drop-in, with the guarded variable; the only vault file written is Syncthing's .stignore,
    // as the foundry user through a temp file (root must not follow a link in a folder that user owns).
    const rms = stage.match(/\brm\b[^\n]*/g) ?? [];
    assert.deepEqual(
      rms
        .filter(l => !l.includes('${dropin:?}'))
        .filter(l => !l.startsWith('rm -f "$t" && printf')),
      []
    );
    assert.doesNotMatch(stage, /-delete|\bcp\b|rm -rf|\bchown\b/);
    assert.match(
      stage,
      /runuser -u "\$FOUNDRY_USER" -- sh -c 't="\$1\.foundry-tmp"[^\n]*"\$dir\/\.stignore"/
    );
    assert.doesNotMatch(stage, /write_file "\$dir/);
  });

  test('switching off asks for a quiet Pi before it changes anything', () => {
    const off = stage.slice(stage.indexOf('switch_off() {'));
    assert.ok(off.indexOf('require_quiet_if_active') > 0);
    assert.ok(off.indexOf('require_quiet_if_active') < off.indexOf('config folders "$f" delete'));
    assert.ok(off.indexOf('config folders "$f" delete') < off.indexOf('rm -f -- "${dropin:?}"'));
    assert.match(off, /try-restart/);
  });

  test('a change ignores a dropped SSH session and refuses conflicting switches', () => {
    const snap = stage.indexOf('require_recent_snapshot\n  # A dropped');
    assert.ok(snap > 0);
    assert.ok(stage.indexOf("trap '' HUP PIPE") > snap);
    assert.ok(stage.indexOf("trap '' HUP PIPE") < stage.indexOf('config folders add --id'));
    assert.match(stage, /give only one of OFF=1, REMOVE=1 and SETUP=1/);
    assert.match(stage, /OFF=1 takes every player out/);
  });

  test('root does not create the players folder through a link', () => {
    const fn = stage.slice(stage.indexOf('ensure_dashboard_switch() {'));
    assert.ok(fn.indexOf('[ ! -L "$players_dir" ]') > 0);
    assert.ok(fn.indexOf('[ ! -L "$players_dir" ]') < fn.indexOf('install -d'));
  });

  test('an add checks the folder and the device before it touches the dashboard', () => {
    const add = stage.slice(stage.indexOf('add)\n'));
    assert.ok(
      add.indexOf('check_player_folder "$player"') < add.indexOf('ensure_dashboard_switch')
    );
    assert.ok(add.indexOf('device_on_other_folder') < add.indexOf('ensure_dashboard_switch'));
  });

  test('the player name, device id and device name are checked before anything is touched', () => {
    const checks = stage.indexOf('DEVICE_ID is not a Syncthing device ID');
    assert.ok(checks > 0);
    for (const first of ['require_recent_snapshot', 'st show system', 'config folders add']) {
      assert.ok(checks < stage.indexOf(first), first);
    }
    assert.match(stage, /PLAYER must be a folder name/);
    assert.match(stage, /DEVICE_NAME may hold/);
  });

  test('the dashboard switch is a drop-in, not a line in dashboard.env', () => {
    assert.match(stage, /player-vault\.conf/);
    assert.doesNotMatch(stage, /dashboard\.env/);
    assert.match(stage, /enable_unit "\$dashboard_unit" "\$dropin"/);
  });
});

describe('21-player-vault.sh on the container stack (day two)', () => {
  test('uses use_stack, not the cut-over refusal, and drives no unit of the stack directly', () => {
    assert.match(stage, /^use_stack "stage 21 \(player vault\)"$/m);
    assert.doesNotMatch(stage, /refuse_when_cut_over/);
    // The only systemctl calls left are the unit-side daemon-reload and the read of the running process.
    const calls = (stage.match(/systemctl [a-z-]+/g) ?? []).filter(
      c => !['systemctl daemon-reload', 'systemctl show'].includes(c)
    );
    assert.deepEqual(calls, []);
    assert.match(stage, /svc_try_restart dashboard/);
  });

  test('the containers switch lives in deploy/pi/.env and only the dashboard is recreated', () => {
    assert.match(stage, /stack_env_set FOUNDRY_AI_PLAYER_VAULTS_DIR "\$players_dir"/);
    assert.match(stage, /stack_env_set FOUNDRY_AI_PLAYER_VAULTS_DIR ""/);
    const composes = stage.match(/stack_compose [^|\n]*/g) ?? [];
    assert.ok(composes.length >= 3);
    for (const c of composes)
      assert.match(c, /^stack_compose up (-d|--no-start) --no-deps dashboard /, c);
    assert.doesNotMatch(stage, /compose (down|restart|rm)|docker (stop|rm|restart)/);
  });

  test('the quiet check comes before .env is written, and a recreate only when the container differs', () => {
    const on = stage.slice(
      stage.indexOf('stack_dashboard_on() {'),
      stage.indexOf('stack_dashboard_off() {')
    );
    assert.ok(on.indexOf('require_quiet') > 0);
    assert.ok(on.indexOf('require_quiet') < on.indexOf('stack_env_set'));
    assert.ok(on.indexOf('stack_env_set') < on.indexOf('stack_compose'));
    assert.match(on, /not restarted: nothing it uses changed/);
    assert.match(on, /\[ "\$running" = 1 \] && \[ "\$need" = 1 \]/);
  });

  test('switching off asks for quiet before Syncthing and .env are touched', () => {
    const off = stage.slice(stage.indexOf('switch_off() {'));
    const quiet = off.indexOf('require_quiet "switching player vaults off');
    assert.ok(quiet > 0);
    assert.ok(quiet < off.indexOf('config folders "$f" delete'));
    assert.ok(off.indexOf('config folders "$f" delete') < off.indexOf('stack_dashboard_off'));
  });

  test('the report reads .env and the container, not the unit', () => {
    const rep = stage.slice(
      stage.indexOf('report_switch_containers() {'),
      stage.indexOf('report() {')
    );
    assert.match(rep, /stack_switch/);
    assert.match(rep, /dashboard_container_value/);
    assert.match(rep, /stopped/);
    assert.doesNotMatch(rep, /systemctl|dropin/);
  });
});

describe(
  'stage 21 in the ARM64 container',
  { skip: process.env.PI_STAGE21_CONTAINER !== '1' },
  () => {
    // stage21-stack-scenarios.sh (a cut-over Pi, stand-in docker and Syncthing) also runs without a container in Git Bash:
    //   REPO=$PWD bash scripts/pi/container-test/stage21-stack-scenarios.sh
    for (const script of ['stage21-scenarios.sh', 'stage21-stack-scenarios.sh']) {
      test(script, () => {
        const r = runStageContainer(script, { timeout: 900000 });
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
      });
    }
  }
);
