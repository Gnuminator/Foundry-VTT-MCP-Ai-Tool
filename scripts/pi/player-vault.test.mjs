// Pi stage 21, the player vault share (scripts/pi/remote/21-player-vault.sh, player-vault-sync, D-134):
//   node --test scripts/pi/player-vault.test.mjs
// The text checks always run; PI_STAGE21_CONTAINER=1 (needs Docker) runs three real Syncthings in a Debian 13 ARM64 container.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(
  path.join(repo, 'scripts', 'pi', 'remote', '21-player-vault.sh'),
  'utf8'
);

describe('21-player-vault.sh as text', () => {
  test('every mode that changes something needs a snapshot from today first', () => {
    assert.match(stage, /if \[ "\$mode" != report \]; then\n {2}require_recent_snapshot\nfi/);
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

describe(
  'stage 21 in the ARM64 container',
  { skip: process.env.PI_STAGE21_CONTAINER !== '1' },
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
          '/repo/scripts/pi/container-test/stage21-scenarios.sh',
        ],
        { encoding: 'utf8', timeout: 900000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } }
      );
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
    });
  }
);
