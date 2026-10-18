// Game-night safety in the Pi stage scripts (backlog pi-stage-safety, deep review r37 S1 to S5, R8; D-126 q26, q28):
//   node --test scripts/pi/pi-stage-safety.test.mjs
// The helpers in scripts/pi/remote/lib.sh run in bash with systemctl, curl and sleep replaced by shell functions
// (no systemd, no Pi needed), and the stages are checked as text for what they must and must not contain.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const remote = join(repo, 'scripts', 'pi', 'remote');
const posix = p => p.replace(/\\/g, '/');
const read = rel => readFileSync(join(repo, rel), 'utf8');
const lib = posix(join(remote, 'lib.sh'));

const roots = [];
after(() => roots.forEach(d => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'pi-safety-'));
  roots.push(d);
  return d;
};

// Replaces the things that need a Pi. STATE is a space separated list of active units; `systemctl` logs its calls.
// `users` and `readable` stand in for Foundry's /api/status.
const stubs = ({ active = '', users = 0, readable = true } = {}) => `
source "${lib}"
CALLS=""
ACTIVE=" ${active} "
have_systemd() { return 0; }
sleep() { :; }
systemctl() {
  CALLS="$CALLS|$*"
  case "$1" in
    is-active) case "$ACTIVE" in *" \${@: -1} "*) return 0 ;; esac; return 1 ;;
    start | restart) ACTIVE="$ACTIVE\${@: -1} " ;;
    show) printf '%s\\n' "\${SHOW_TS:-}" ;;
  esac
  return 0
}
curl() { ${readable ? `echo '{"active":true,"users":${users}}'` : 'return 22'}; }
NODE_DIR="${posix(process.execPath.replace(/[\\/]node(\.exe)?$/, ''))}/.."
mkdir -p "$NODE_DIR/bin" 2>/dev/null || true
`;

// The node the helper calls is NODE_DIR/bin/node: make a small folder with a link to the running node.
function nodeDir() {
  const d = tmp();
  mkdirSync(join(d, 'bin'));
  // A script that forwards to this node works on Windows (Git bash) and Linux alike.
  writeFileSync(join(d, 'bin', 'node'), `#!/usr/bin/env bash\nexec "${posix(process.execPath)}" "$@"\n`, { mode: 0o755 });
  return posix(d);
}

function run(body, opts = {}, env = {}) {
  const nd = nodeDir();
  const script = stubs(opts).replace(/NODE_DIR=.*\nmkdir.*\n/, `NODE_DIR="${nd}"\n`) + body;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('enable_unit restarts only when something changed (S1)', () => {
  const unit = 'foo.service';
  const path = `/etc/systemd/system/${unit}`;
  const restarts = out => (out.match(/\|restart /g) || []).length;
  const calls = out => out.split('CALLS:')[1] || '';

  test('a running unit with nothing changed is not restarted', () => {
    const r = run(`enable_unit ${unit}; echo "CALLS:$CALLS"`, { active: unit });
    assert.equal(r.status, 0, r.out);
    assert.equal(restarts(calls(r.out)), 0, r.out);
    assert.match(r.out, /not restarted/);
  });

  test('a changed unit file restarts it', () => {
    const r = run(`mark_changed ${path}; enable_unit ${unit}; echo "CALLS:$CALLS"`, { active: unit });
    assert.equal(r.status, 0, r.out);
    assert.equal(restarts(calls(r.out)), 1, r.out);
  });

  test('a changed dependency file (its EnvironmentFile) restarts it, an unchanged one does not', () => {
    const changed = run(`mark_changed /etc/x.env; enable_unit ${unit} /etc/x.env; echo "CALLS:$CALLS"`, { active: unit });
    assert.equal(restarts(calls(changed.out)), 1, changed.out);
    const same = run(`enable_unit ${unit} /etc/x.env; echo "CALLS:$CALLS"`, { active: unit });
    assert.equal(restarts(calls(same.out)), 0, same.out);
  });

  test('write_file marks a file as changed only when its content changed', () => {
    const d = tmp();
    const f = posix(join(d, 'a.conf'));
    const r = run(
      `write_file ${f} 0644 hello; file_changed ${f} && echo FIRST_CHANGED
       LIB_CHANGED=" "; write_file ${f} 0644 hello || true; file_changed ${f} && echo SECOND_CHANGED || echo SECOND_SAME`,
    );
    assert.match(r.out, /FIRST_CHANGED/);
    assert.match(r.out, /SECOND_SAME/);
    assert.doesNotMatch(r.out, /SECOND_CHANGED/);
  });

  test('a file written after the service started still restarts it on a later run (H1)', () => {
    const d = tmp();
    const env = posix(join(d, 'x.env'));
    writeFileSync(join(d, 'x.env'), 'A=1\n'); // written now, e.g. by an earlier run whose restart was refused
    const past = new Date(Date.now() - 3600_000).toISOString();
    const newer = run(`enable_unit ${unit} ${env}; echo "CALLS:$CALLS"`, { active: unit }, { SHOW_TS: past });
    assert.equal(restarts(calls(newer.out)), 1, newer.out);
    assert.match(newer.out, /newer than the running service/);
    const future = new Date(Date.now() + 3600_000).toISOString();
    const older = run(`enable_unit ${unit} ${env}; echo "CALLS:$CALLS"`, { active: unit }, { SHOW_TS: future });
    assert.equal(restarts(calls(older.out)), 0, older.out);
  });

  test('a stopped unit is started, and RESTART_UNITS=1 restarts a running one', () => {
    const stopped = run(`enable_unit ${unit}; echo "CALLS:$CALLS"`);
    assert.match(calls(stopped.out), /\|start foo\.service/, stopped.out);
    const forced = run(`enable_unit ${unit}; echo "CALLS:$CALLS"`, { active: unit }, { RESTART_UNITS: '1' });
    assert.equal(restarts(calls(forced.out)), 1, forced.out);
  });

  test('a restart is refused while players are online (FORCE=1 goes on)', () => {
    const body = `mark_changed ${path}; enable_unit ${unit}; echo "CALLS:$CALLS"`;
    const refused = run(body, { active: `${unit} foundry.service`, users: 3 });
    assert.notEqual(refused.status, 0, refused.out);
    assert.match(refused.out, /3 player\(s\) are online/);
    assert.equal(restarts(calls(refused.out)), 0);
    const forced = run(body, { active: `${unit} foundry.service`, users: 3 }, { FORCE: '1' });
    assert.equal(forced.status, 0, forced.out);
    assert.equal(restarts(calls(forced.out)), 1, forced.out);
  });
});

describe('require_quiet: players online and active recordings (S2, R8)', () => {
  test('nobody online passes', () => {
    const r = run('require_quiet "the test"; echo PASSED', { active: 'foundry.service', users: 0 });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /PASSED/);
  });

  test('players online refuse, and the message names the count', () => {
    const r = run('require_quiet "the test"; echo PASSED', { active: 'foundry.service', users: 2 });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /2 player\(s\) are online/);
    assert.match(r.out, /FORCE=1/);
    assert.doesNotMatch(r.out, /PASSED/);
  });

  test('the Assistant GM browser counts as one user while its service runs', () => {
    const only = run('require_quiet "the test"; echo PASSED', { active: 'foundry.service foundry-ai-tool-gm-browser.service', users: 1 });
    assert.equal(only.status, 0, only.out);
    const plusPlayer = run('require_quiet "the test"; echo PASSED', { active: 'foundry.service foundry-ai-tool-gm-browser.service', users: 2 });
    assert.notEqual(plusPlayer.status, 0);
    assert.match(plusPlayer.out, /1 player\(s\) are online/);
  });

  test('an unreadable /api/status refuses unless FORCE=1', () => {
    const refused = run('require_quiet "the test"; echo PASSED', { active: 'foundry.service', readable: false });
    assert.notEqual(refused.status, 0);
    assert.match(refused.out, /cannot read who is online/);
    const forced = run('require_quiet "the test"; echo PASSED', { active: 'foundry.service', readable: false }, { FORCE: '1' });
    assert.equal(forced.status, 0, forced.out);
    assert.match(forced.out, /FORCE=1: going on/);
  });

  test('a Foundry that is not running has no players to drop', () => {
    const r = run('require_quiet "the test"; echo PASSED', { active: '', readable: false });
    assert.equal(r.status, 0, r.out);
  });

  test('recording_active: a fresh raw/ without session.json is a recording; a finished or old one is not', () => {
    const d = tmp();
    const fresh = join(d, '2026-10-18-2000', 'raw');
    mkdirSync(fresh, { recursive: true });
    writeFileSync(join(fresh, '1-gnu.rec'), 'x');
    const done = join(d, 'done', 'raw');
    mkdirSync(done, { recursive: true });
    writeFileSync(join(done, '1-gnu.rec'), 'x');
    writeFileSync(join(done, 'session.json'), '{}');
    const old = join(d, 'crashed', 'raw');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, '1-gnu.rec'), 'x');
    const longAgo = new Date(Date.now() - 3 * 3600 * 1000);
    utimesSync(join(old, '1-gnu.rec'), longAgo, longAgo);
    utimesSync(old, longAgo, longAgo);

    const only = name => {
      const dir = tmp();
      const src = join(d, name);
      // Link-free copy: one session folder per case.
      mkdirSync(join(dir, name, 'raw'), { recursive: true });
      const files = { fresh: '1-gnu.rec', done: '1-gnu.rec', crashed: '1-gnu.rec' };
      writeFileSync(join(dir, name, 'raw', files[name]), 'x');
      if (name === 'done') writeFileSync(join(dir, name, 'raw', 'session.json'), '{}');
      if (name === 'crashed') utimesSync(join(dir, name, 'raw', files[name]), longAgo, longAgo);
      void src;
      return posix(dir);
    };
    const probe = dir => run(`recording_active ${dir} && echo ACTIVE || echo QUIET`).out;
    assert.match(probe(only('fresh')), /ACTIVE/);
    assert.match(probe(only('done')), /QUIET/);
    assert.match(probe(only('crashed')), /QUIET/);
    assert.match(probe(posix(join(d, 'nothing-here'))), /QUIET/);
  });

  test('a long break in a recording still counts while the bot runs since before the session (M2)', () => {
    const mk = () => {
      const d = tmp();
      const raw = join(d, 'night', 'raw');
      mkdirSync(raw, { recursive: true });
      writeFileSync(join(raw, '1-gnu.rec'), 'x');
      const t = new Date(Date.now() - 30 * 60_000); // quiet for 30 minutes
      utimesSync(join(raw, '1-gnu.rec'), t, t);
      utimesSync(raw, t, t);
      return posix(d);
    };
    const bot = 'foundry-ai-tool-discord-bot.service';
    const before = new Date(Date.now() - 3600_000).toISOString(); // the bot started an hour ago, session 30 minutes ago
    const running = run(`recording_active ${mk()} && echo ACTIVE || echo QUIET`, { active: bot }, { SHOW_TS: before });
    assert.match(running.out, /ACTIVE/, running.out);
    const after = new Date(Date.now() - 10 * 60_000).toISOString(); // bot restarted after the folder: a crash leftover
    const leftover = run(`recording_active ${mk()} && echo ACTIVE || echo QUIET`, { active: bot }, { SHOW_TS: after });
    assert.match(leftover.out, /QUIET/, leftover.out);
    const stopped = run(`recording_active ${mk()} && echo ACTIVE || echo QUIET`, {}, { SHOW_TS: before });
    assert.match(stopped.out, /QUIET/, stopped.out);
    // A session the bot converted after a crash (or failed to) is finished, whatever it changed after the start.
    for (const marker of ['convert-report.json', 'convert-failed.json']) {
      const d = mk();
      writeFileSync(join(d, 'night', 'raw', marker), '{}');
      const done = run(`recording_active ${d} && echo ACTIVE || echo QUIET`, { active: bot }, { SHOW_TS: before });
      assert.match(done.out, /QUIET/, `${marker}: ${done.out}`);
    }
  });

  test('a running recording refuses a stop or restart, FORCE=1 goes on', () => {
    const d = tmp();
    mkdirSync(join(d, 'night', 'raw'), { recursive: true });
    writeFileSync(join(d, 'night', 'raw', '1-gnu.rec'), 'x');
    // TOOL_DATA/recordings is where the helper looks.
    mkdirSync(join(d, 'recordings'));
    mkdirSync(join(d, 'recordings', 'night', 'raw'), { recursive: true });
    writeFileSync(join(d, 'recordings', 'night', 'raw', '1-gnu.rec'), 'x');
    const body = `TOOL_DATA=${posix(d)}; require_no_recording "stopping the bot"; echo PASSED`;
    const refused = run(body);
    assert.notEqual(refused.status, 0, refused.out);
    assert.match(refused.out, /recording is in progress/);
    const forced = run(body, {}, { FORCE: '1' });
    assert.equal(forced.status, 0, forced.out);
    assert.match(forced.out, /PASSED/);
  });
});

describe('require_recent_snapshot (S4)', () => {
  // `lines` are the stats file's content, in dietpi-backup's format: "2026-10-18_09:46:24  Backup completed".
  const snap = (lines, env = {}) => {
    const d = tmp();
    const dir = join(d, 'dietpi');
    mkdirSync(dir);
    const stats = join(d, 'stats');
    if (lines !== null) writeFileSync(stats, lines);
    return run('require_recent_snapshot; echo PASSED', {}, { DIETPI_DIR: posix(dir), DIETPI_BACKUP_STATS: posix(stats), ...env });
  };
  const day = offsetDays => {
    const t = new Date(Date.now() - offsetDays * 86400_000);
    const p = n => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
  };

  test('a snapshot that completed today passes', () => {
    const r = snap(`${day(0)}_01:25:19  Backup starting\n${day(0)}_01:25:28  Backup completed\n`);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /snapshot from today/);
  });

  test('yesterday refuses and says how to take one', () => {
    const r = snap(`${day(1)}_01:25:19  Backup starting\n${day(1)}_01:25:28  Backup completed\n`);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /no dietpi-backup snapshot completed today/);
    assert.match(r.out, /dietpi-backup 1/);
  });

  test('a backup that started or was cancelled today does not count (M1)', () => {
    const r = snap(`${day(1)}_01:25:28  Backup completed\n${day(0)}_09:00:00  Backup starting\n${day(0)}_09:00:01  Backup cancelled: Insufficient free space\n`);
    assert.notEqual(r.status, 0, r.out);
  });

  test('no snapshot at all refuses; only NO_SNAPSHOT=1 goes on, FORCE=1 does not (M3)', () => {
    const none = snap(null);
    assert.notEqual(none.status, 0);
    assert.match(none.out, /no dietpi-backup snapshot completed today/);
    assert.notEqual(snap(null, { FORCE: '1' }).status, 0);
    const skipped = snap(null, { NO_SNAPSHOT: '1' });
    assert.equal(skipped.status, 0, skipped.out);
    assert.match(skipped.out, /NO_SNAPSHOT=1/);
  });

  test('off DietPi (a test container) the check is skipped', () => {
    const r = run('require_recent_snapshot; echo PASSED', {}, { DIETPI_DIR: '/nonexistent-dietpi-dir' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /skipped/);
  });
});

describe('warn_dashboard_split (S3)', () => {
  const split = content => {
    const d = tmp();
    if (content !== null) writeFileSync(join(d, 'dashboard-access.env'), content);
    return run(`TOOL_ETC=${posix(d)}; warn_dashboard_split && echo SPLIT_ON || echo SPLIT_OFF`);
  };

  test('warns when the access file is missing or has neither a token nor emails', () => {
    for (const c of [null, 'CF_ACCESS_AUD=abc\n', 'GM_DASHBOARD_TOKEN=\n']) {
      const r = split(c);
      assert.match(r.out, /split is OFF/, r.out);
      assert.match(r.out, /SPLIT_OFF/);
    }
  });

  test('says nothing alarming when a token or emails are set, and never prints them', () => {
    for (const c of ['GM_DASHBOARD_TOKEN=s3cretvalue\n', 'GM_EMAILS=gm@example.com\n']) {
      const r = split(c);
      assert.match(r.out, /SPLIT_ON/, r.out);
      assert.doesNotMatch(r.out, /s3cretvalue|gm@example\.com/);
      assert.doesNotMatch(r.out, /WARNING/);
    }
  });
});

describe('the stages', () => {
  const stages = [
    '1-health', '2-node', '3-foundry', '4-tailscale', '5-tool', '5-check-world', '6-backup', '7-vault',
    '8-recorder', '9-ssh-log', '10-space-check', '11-world', '12-tunnel', '13-player-creation', '15-ssh-keys-only',
  ];

  test('every stage checks for a snapshot from today right after require_root', () => {
    for (const s of stages) {
      const text = read(`scripts/pi/remote/${s}.sh`);
      assert.match(text, /^require_root\nrequire_recent_snapshot$/m, `${s}.sh`);
    }
  });

  test('stages that stop or restart a service check first', () => {
    const quiet = {
      '3-foundry': 'require_quiet',
      '5-tool': 'require_quiet',
      '5-check-world': 'require_quiet',
      '6-backup': 'require_quiet',
      '7-vault': 'enable_unit foundry-ai-tool-bridge.service', // enable_unit calls require_quiet before a restart
      '8-recorder': 'require_no_recording',
      '11-world': 'require_quiet',
      '12-tunnel': 'require_quiet',
    };
    for (const [s, fn] of Object.entries(quiet)) {
      assert.ok(read(`scripts/pi/remote/${s}.sh`).includes(fn), `${s}.sh calls ${fn}`);
    }
  });

  test('2-node.sh pins a Node version and swaps instead of emptying /opt/node24', () => {
    const text = read('scripts/pi/remote/2-node.sh');
    assert.match(text, /NODE_VERSION="\$\{NODE_VERSION:-v24\.\d+\.\d+\}"/);
    assert.doesNotMatch(text, /latest-v24/);
    assert.doesNotMatch(text, /rm -rf "\$\{NODE_DIR:\?\}"\/\*/);
    assert.match(text, /mv "\$new" "\$NODE_DIR"/);
  });

  test('3-foundry.sh no longer empties the program folder before the copy', () => {
    const text = read('scripts/pi/remote/3-foundry.sh');
    assert.doesNotMatch(text, /rm -rf "\$\{FOUNDRY_APP:\?\}"\/\*/);
    assert.match(text, /mv "\$new" "\$FOUNDRY_APP"/);
    assert.ok(text.indexOf('require_quiet') < text.indexOf('systemctl stop foundry.service'));
  });

  test('stage 5 and 12 warn when the dashboard split is off', () => {
    assert.match(read('scripts/pi/remote/5-tool.sh'), /warn_dashboard_split/);
    assert.match(read('scripts/pi/remote/12-tunnel.sh'), /warn_dashboard_split/);
  });

  test('stage 8 keeps the recordings out of dietpi-backup, once', () => {
    const text = read('scripts/pi/remote/8-recorder.sh');
    assert.match(text, /dietpi_filter=\/boot\/dietpi\/\.dietpi-backup_inc_exc/);
    assert.match(text, /exclude_line="- \$rec_dir\/"/);
    assert.match(text, /grep -qxF -- "\$exclude_line"/);
  });

  test('the Syncthing ignore list on the Pi and on the PC drops Obsidian plugins (D-126 q28)', () => {
    const pi = read('scripts/pi/remote/7-vault.sh');
    const pc = read('scripts/pi/setup-syncthing-pc.ps1');
    for (const line of ['.obsidian/plugins', '.obsidian/community-plugins.json']) {
      assert.ok(pi.includes(`\n${line}\n`), `7-vault.sh ignores ${line}`);
      assert.ok(pc.includes(`'${line}'`), `setup-syncthing-pc.ps1 ignores ${line}`);
    }
  });

  test('the token script restarts the bot because its settings file changed', () => {
    const text = read('scripts/pi/remote/set-discord-token.sh');
    assert.match(text, /mark_changed "\$env_file"\nenable_unit "\$unit" "\$env_file"/);
  });
});
