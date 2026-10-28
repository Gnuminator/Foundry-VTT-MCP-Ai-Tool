// Pi stage 18, NTP time sync (scripts/pi/remote/18-time-sync.sh, backlog pi-ntp):
//   node --test scripts/pi/time-sync.test.mjs
// The stage runs in bash with stand-ins for systemctl, timedatectl and DietPi's dietpi-set_software (a state folder
// holds the mode, whether timesyncd runs and whether the clock counts as synchronized), so no Pi and no systemd.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const remote = path.join(repo, 'scripts', 'pi', 'remote');
const stage = readFileSync(path.join(remote, '18-time-sync.sh'), 'utf8');
const lib = readFileSync(path.join(remote, 'lib.sh'), 'utf8');
const posix = p => p.replace(/\\/g, '/');

const roots = [];
after(() => roots.forEach(d => rmSync(d, { recursive: true, force: true })));

// A fake Pi: dietpi.txt with a mode; timesyncd running or not; `syncs` says whether the clock becomes synchronized
// once timesyncd runs. The fake set_software mirrors what the real one does for mode 4 (enable + start) and 1-3 (stop).
function fakePi({ mode = '2', running = false, syncs = true, snapshot = true } = {}) {
  const d = mkdtempSync(path.join(tmpdir(), 'time-sync-'));
  roots.push(d);
  const bin = path.join(d, 'bin');
  mkdirSync(bin);
  const state = path.join(d, 'state');
  mkdirSync(state);
  writeFileSync(path.join(d, 'dietpi.txt'), `CONFIG_NTP_MODE=${mode}\nCONFIG_NTP_MIRROR=default\n`);
  if (running) {
    writeFileSync(path.join(state, 'enabled'), '');
    writeFileSync(path.join(state, 'active'), '');
  }
  if (syncs) writeFileSync(path.join(state, 'syncs'), '');
  const stub = (name, body) => {
    writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\nS="${posix(state)}"\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  };
  stub(
    'systemctl',
    `echo "systemctl $*" >>"$S/calls"
case "$1" in
  is-enabled) [ -f "$S/enabled" ] && echo enabled || { echo disabled; exit 1; } ;;
  is-active) [ -f "$S/active" ] && echo active || { echo inactive; exit 3; } ;;
esac`,
  );
  stub(
    'timedatectl',
    `if [ "$1" = show ]; then
  case "$3" in
    NTP) [ -f "$S/active" ] && echo yes || echo no ;;
    NTPSynchronized) [ -f "$S/active" ] && [ -f "$S/syncs" ] && echo yes || echo no ;;
  esac
elif [ "$1" = timesync-status ]; then echo "       Server: 192.0.2.1 (0.debian.pool.ntp.org)"
else
  echo "System clock synchronized: yes"
  [ -f "$S/active" ] && echo "NTP service: active" || echo "NTP service: inactive"
fi`,
  );
  const setSoftware = path.join(d, 'dietpi-set_software');
  writeFileSync(
    setSoftware,
    `#!/usr/bin/env bash
S="${posix(state)}"
echo "set_software $*" >>"$S/calls"
sed -i "s/^CONFIG_NTP_MODE=.*/CONFIG_NTP_MODE=$2/" "${posix(path.join(d, 'dietpi.txt'))}"
if [ "$2" = 4 ]; then touch "$S/enabled" "$S/active"; else rm -f "$S/active"; fi
`,
  );
  const dietpiDir = path.join(d, 'dietpi');
  mkdirSync(dietpiDir);
  const stats = path.join(d, 'stats');
  const today = new Date().toLocaleDateString('sv');
  writeFileSync(stats, snapshot ? `${today}_01:25:00  Backup completed\n` : '2020-01-01_01:25:00  Backup completed\n');
  return { d, bin, state, setSoftware, dietpiDir, stats };
}

function run(pi, env = {}) {
  const script = `${lib}\nhave_systemd() { return 0; }\nsleep() { :; }\nid() { echo 0; }\n${stage}`;
  // A file, not `bash -c`: a long script with quotes loses its tail in Windows' argument quoting.
  const file = path.join(pi.d, 'run.sh');
  writeFileSync(file, script);
  const r = spawnSync('bash', [posix(file)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${posix(pi.bin)}:${process.env.PATH}`,
      DIETPI_TXT: posix(path.join(pi.d, 'dietpi.txt')),
      SET_SOFTWARE: posix(pi.setSoftware),
      DIETPI_DIR: posix(pi.dietpiDir),
      DIETPI_BACKUP_STATS: posix(pi.stats),
      WAIT_SECONDS: '6',
      ...env,
    },
  });
  const calls = existsSync(path.join(pi.state, 'calls')) ? readFileSync(path.join(pi.state, 'calls'), 'utf8') : '';
  const mode = /CONFIG_NTP_MODE=(\d)/.exec(readFileSync(path.join(pi.d, 'dietpi.txt'), 'utf8'))?.[1];
  return { status: r.status, out: `${r.stdout}${r.stderr}`, calls, mode };
}

describe('18-time-sync.sh', () => {
  test('is valid bash', t => {
    const res = spawnSync('bash', ['-n', path.join(remote, '18-time-sync.sh')], { encoding: 'utf8' });
    if (res.error) return t.skip('no bash here');
    assert.equal(res.status, 0, res.stderr);
  });

  test('mode 2 with timesyncd stopped: sets mode 4 the DietPi way and the check passes', () => {
    const pi = fakePi();
    const r = run(pi);
    assert.equal(r.status, 0, r.out);
    assert.equal(r.mode, '4');
    assert.match(r.calls, /set_software ntpd-mode 4/);
    assert.match(r.out, /System clock synchronized: yes, NTP service: active/);
  });

  test('already right: changes nothing, runs only the check, safe to run again', () => {
    const pi = fakePi({ mode: '4', running: true });
    const r = run(pi);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /nothing to change/);
    assert.doesNotMatch(r.calls, /set_software/);
    assert.equal(r.mode, '4');
  });

  test('dry run changes nothing, needs no snapshot and says what it would do', () => {
    const pi = fakePi({ snapshot: false });
    const r = run(pi, { DRY_RUN: '1' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /dry run: would run .*ntpd-mode 4/);
    assert.doesNotMatch(r.calls, /set_software|systemctl (start|enable|stop|disable)/);
    assert.equal(r.mode, '2');
  });

  test('a real run without a snapshot from today is refused before anything changes', () => {
    const pi = fakePi({ snapshot: false });
    const r = run(pi);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /no dietpi-backup snapshot completed today/);
    assert.doesNotMatch(r.calls, /set_software/);
    assert.equal(r.mode, '2');
  });

  test('CHECK=1 reads only: fails while NTP is inactive, passes when running, no snapshot needed', () => {
    const off = run(fakePi({ snapshot: false }), { CHECK: '1' });
    assert.notEqual(off.status, 0);
    assert.match(off.out, /not synchronized with NTP active/);
    const on = run(fakePi({ mode: '4', running: true, snapshot: false }), { CHECK: '1' });
    assert.equal(on.status, 0, on.out);
    assert.doesNotMatch(on.calls, /set_software/);
  });

  test('the check fails (and the stage with it) when the clock never synchronizes', () => {
    const pi = fakePi({ syncs: false });
    const r = run(pi);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /not synchronized with NTP active/);
  });

  test('UNDO=1 goes back to mode 2; already in mode 2 is a no-op', () => {
    const undone = run(fakePi({ mode: '4', running: true }), { UNDO: '1' });
    assert.equal(undone.status, 0, undone.out);
    assert.equal(undone.mode, '2');
    const noop = run(fakePi({ mode: '2' }), { UNDO: '1' });
    assert.equal(noop.status, 0, noop.out);
    assert.doesNotMatch(noop.calls, /set_software/);
  });

  test('piped on stdin (bash -s) like the real run: a tool that drains stdin does not eat the rest of the stage', () => {
    const pi = fakePi();
    writeFileSync(
      pi.setSoftware,
      readFileSync(pi.setSoftware, 'utf8').replace('S="', 'cat >/dev/null || true\nS="'),
    );
    const script = `${lib}\nhave_systemd() { return 0; }\nsleep() { :; }\nid() { echo 0; }\n${stage}`;
    const r = spawnSync('bash', ['-s'], {
      input: script,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${posix(pi.bin)}:${process.env.PATH}`,
        DIETPI_TXT: posix(path.join(pi.d, 'dietpi.txt')),
        SET_SOFTWARE: posix(pi.setSoftware),
        DIETPI_DIR: posix(pi.dietpiDir),
        DIETPI_BACKUP_STATS: posix(pi.stats),
        WAIT_SECONDS: '6',
      },
    });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, out);
    assert.match(out, /ok: CONFIG_NTP_MODE=4/);
    assert.match(out, /System clock synchronized: yes, NTP service: active/);
  });

  test('touches nothing but DietPi time sync: no reboot, no other service, no rm', () => {
    const code = stage.replace(/^\s*#.*$/gm, '');
    assert.doesNotMatch(code, /\breboot\b|\brm -|systemctl (restart|stop|disable|mask)/);
  });
});
