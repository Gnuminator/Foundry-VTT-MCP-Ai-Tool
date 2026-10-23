// Game-night safety in the Pi stage scripts (backlog pi-stage-safety, deep review r37 S1 to S5, R8; D-126 q26, q28):
//   node --test scripts/pi/pi-stage-safety.test.mjs
// The helpers in scripts/pi/remote/lib.sh run in bash with systemctl, curl and sleep replaced by shell functions
// (no systemd, no Pi needed), and the stages are checked as text for what they must and must not contain.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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
    stop) ACTIVE="\${ACTIVE/ \${@: -1} / }" ;;
    start | restart) ACTIVE="$ACTIVE\${@: -1} " ;;
    show)
      case "$*" in
        *InvocationID*) printf '%s\\n' "\${INVOCATION:-}" ;;
        *) printf '%s\\n' "\${SHOW_TS:-}" ;;
      esac ;;
  esac
  return 0
}
# JOURNAL is the log of the run with invocation id JOURNAL_ID; asking for any other run gives nothing.
journalctl() { case "$*" in *"_SYSTEMD_INVOCATION_ID=\${JOURNAL_ID:-none}"*) printf '%s\\n' "\${JOURNAL:-}" ;; esac; }
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

  // The Assistant GM user is subtracted only once it has joined in its current run: the journal of the unit's current
  // systemd invocation has "[assistant-gm] joined world" (backlog pi-stage-safety-2, PR #432 L6; PR #446 L5). The
  // Kit GM browser of a kit session is the same program and counts the same way.
  const gmActive = 'foundry.service foundry-ai-tool-gm-browser.service';
  const kitActive = 'foundry.service foundry-ai-tool-kit-gm-browser.service';
  const thisRun = { INVOCATION: 'run-2', JOURNAL_ID: 'run-2' };
  const joinedLine = '[assistant-gm] joined world curse-of-strahd as Assistant GM (GM: true, module active: true)';
  const quiet = (users, env, active = gmActive) => run('require_quiet "the test"; echo PASSED', { active, users }, env);

  test('the Assistant GM browser counts as one user once it has joined', () => {
    const env = { ...thisRun, JOURNAL: joinedLine };
    const only = quiet(1, env);
    assert.equal(only.status, 0, only.out);
    const plusPlayer = quiet(2, env);
    assert.notEqual(plusPlayer.status, 0);
    assert.match(plusPlayer.out, /1 player\(s\) are online/);
  });

  test('the Kit GM browser counts the same way, and both together are two users', () => {
    const env = { ...thisRun, JOURNAL: joinedLine };
    assert.equal(quiet(1, env, kitActive).status, 0);
    const both = 'foundry.service foundry-ai-tool-gm-browser.service foundry-ai-tool-kit-gm-browser.service';
    assert.equal(quiet(2, env, both).status, 0);
    const three = quiet(3, env, both);
    assert.notEqual(three.status, 0);
    assert.match(three.out, /1 player\(s\) are online/);
  });

  test('an Assistant GM that runs but has not joined (no world, login failing) is not subtracted', () => {
    const waiting = quiet(1, { ...thisRun, JOURNAL: '[assistant-gm] no world is running at http://127.0.0.1:30000; trying again in 30 s' });
    assert.notEqual(waiting.status, 0, waiting.out);
    assert.match(waiting.out, /1 player\(s\) are online/);
    const empty = quiet(1, thisRun);
    assert.notEqual(empty.status, 0, empty.out);
  });

  test('a join from an earlier run of the service does not count: only the current invocation does', () => {
    // The browser left the game and systemd started it again (invocation run-2); the line belongs to run-1.
    const r = quiet(1, { INVOCATION: 'run-2', JOURNAL_ID: 'run-1', JOURNAL: joinedLine });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /1 player\(s\) are online/);
  });

  test('when the invocation id cannot be read the Assistant GM is not subtracted (errs towards refusing)', () => {
    const r = quiet(1, { JOURNAL_ID: 'run-2', JOURNAL: joinedLine });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /1 player\(s\) are online/);
  });

  test('a service that is stopped is not subtracted even if its journal once said it joined', () => {
    const r = run('require_quiet "the test"; echo PASSED', { active: 'foundry.service', users: 1 }, { ...thisRun, JOURNAL: joinedLine });
    assert.notEqual(r.status, 0, r.out);
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
    '16-board-status',
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
    // The stop in the install flow comes after the check (the rollback in stage3_exit stops it too, and sits above).
    assert.ok(text.indexOf('require_quiet') < text.indexOf('systemctl stop foundry.service\n    foundry_stopped=1'));
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

  test('7-vault.sh has no unused bridge_changed / dashboard_changed (PR #432 round 3 L2)', () => {
    const text = read('scripts/pi/remote/7-vault.sh');
    assert.doesNotMatch(text, /bridge_changed|dashboard_changed/);
    assert.match(text, /write_file "\$TOOL_ETC\/bridge\.env" 0640 "\$bridge_env" \|\| true/);
  });
});

// A stage's swap of a program folder (stages 2 and 3) must never leave the folder missing or empty, whichever rename
// fails (PR #432 Opus review L3, L8). The stage text runs after lib.sh in bash, with the things that need a Pi replaced.
describe('the swaps in stages 2 and 3 survive a failing mv', () => {
  const failMv = `
rm() {
  case "$*" in
    *"$FOUNDRY_APP.prev"*) if [ "\${FAIL_RM_PREV:-0}" = 1 ]; then return 1; fi ;;
    *"$FOUNDRY_APP.failed"*) if [ "\${FAIL_RM_FAILED:-0}" = 1 ]; then return 1; fi ;;
  esac
  command rm "$@"
}
mv() {
  if [ "\${FAIL_MV:-0}" = 1 ] && [ "$1" = "$NEW_PATH" ] && [ "$2" = "$TARGET_PATH" ]; then echo "mv: simulated failure" >&2; return 1; fi
  command mv "$@"
}
`;

  describe('stage 2 (Node)', () => {
    const setup = () => {
      const root = tmp();
      mkdirSync(join(root, 'node24', 'bin'), { recursive: true });
      writeFileSync(join(root, 'node24', 'bin', 'node'), '#!/bin/sh\necho v24.20.0\n', { mode: 0o755 });
      const prelude = `
NODE_DIR=${posix(root)}/node24
NEW_PATH="$NODE_DIR.new"; TARGET_PATH="$NODE_DIR"
require_root() { :; }; require_recent_snapshot() { :; }; require_arm64() { :; }
ln() { :; }
node() { echo v24.21.0; }; npm() { echo 11.0.0; }
sha256sum() { echo "abc123  -"; }
curl() {
  local out=""
  while [ $# -gt 0 ]; do if [ "$1" = -o ]; then out="$2"; shift; fi; shift; done
  if [ -n "$out" ]; then echo x >"$out"; else echo "abc123  node-v24.21.0-linux-arm64.tar.xz"; fi
}
tar() {
  local dir=""
  while [ $# -gt 0 ]; do if [ "$1" = -C ]; then dir="$2"; fi; shift; done
  mkdir -p "$dir/bin"; printf '#!/bin/sh\\necho v24.21.0\\n' >"$dir/bin/node"; chmod +x "$dir/bin/node"
}
${failMv}
`;
      return { root, prelude };
    };
    const stage2 = read('scripts/pi/remote/2-node.sh');
    const go = (fail, root, prelude) =>
      spawnSync('bash', ['-c', `source "${lib}"\n${prelude}\n${stage2}`], { encoding: 'utf8', env: { ...process.env, FAIL_MV: fail ? '1' : '0' } });
    const version = file => readFileSync(file, 'utf8').match(/v24\.\d+\.\d+/)?.[0];

    test('control: without a failure the new Node is in place and the old one is kept as .prev', () => {
      const { root, prelude } = setup();
      const r = go(false, root, prelude);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(version(join(root, 'node24', 'bin', 'node')), 'v24.21.0');
      assert.equal(version(join(root, 'node24.prev', 'bin', 'node')), 'v24.20.0');
    });

    test('the second rename failing puts the old Node back: /opt/node24 is never missing or empty', () => {
      const { root, prelude } = setup();
      const r = go(true, root, prelude);
      assert.notEqual(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stderr, /the old one is back in place/);
      assert.equal(version(join(root, 'node24', 'bin', 'node')), 'v24.20.0', r.stdout + r.stderr);
      assert.ok(!existsSync(join(root, 'node24.prev')), 'the .prev folder was moved back, not copied');
    });
  });

  describe('stage 3 (Foundry)', () => {
    const stage3 = read('scripts/pi/remote/3-foundry.sh');
    const setup = () => {
      const root = tmp();
      mkdirSync(join(root, 'foundry'));
      writeFileSync(join(root, 'foundry', 'main.js'), 'old');
      writeFileSync(join(root, 'foundryvtt.zip'), 'zip');
      const prelude = `
FOUNDRY_APP=${posix(root)}/foundry; FOUNDRY_ZIP=${posix(root)}/foundryvtt.zip
NEW_PATH="$FOUNDRY_APP.new"; TARGET_PATH="$FOUNDRY_APP"
require_root() { :; }; require_recent_snapshot() { :; }; require_arm64() { :; }
write_file() { return 0; }; chown() { :; }; hostname() { echo pi; }
unzip() { printf new >"$4/main.js"; printf '{"version":"14.999"}' >"$4/package.json"; }
systemctl() {
  printf '|%s' "$*" >>"$CALLS_LOG"
  local u="\${@: -1}"
  case "$1" in
    is-active) case "$ACTIVE" in *" $u "*) return 0 ;; esac; return 1 ;;
    stop) ACTIVE="\${ACTIVE/ $u / }" ;;
    start | restart)
      # A Foundry program that does not start: the new one (its main.js says "new") when FAIL_NEW_START=1.
      if [ "$u" = foundry.service ] && [ "\${FAIL_NEW_START:-0}" = 1 ] && [ "$(cat "$FOUNDRY_APP/main.js")" = new ]; then return 1; fi
      ACTIVE="$ACTIVE$u " ;;
    show) printf '\\n' ;;
  esac
  return 0
}
${failMv}
`;
      return { root, prelude };
    };
    const go = (root, prelude, env) => {
      const nd = nodeDir();
      const script = stubs({ active: 'foundry.service', users: 0 }).replace(/NODE_DIR=.*\nmkdir.*\n/, `NODE_DIR="${nd}"\n`) + prelude + stage3;
      // The systemctl calls go to a file: the stage may exit (its EXIT trap rolls back) before it could print them.
      const callsLog = join(root, 'calls.log');
      writeFileSync(callsLog, '');
      const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, CALLS_LOG: posix(callsLog), ...env } });
      return { status: r.status, out: `${r.stdout}${r.stderr}`, calls: readFileSync(callsLog, 'utf8') };
    };

    test('control: without a failure the new program runs, the old one is .prev and the zip is removed', () => {
      const { root, prelude } = setup();
      const r = go(root, prelude, {});
      assert.equal(r.status, 0, r.out);
      assert.equal(readFileSync(join(root, 'foundry', 'main.js'), 'utf8'), 'new');
      assert.equal(readFileSync(join(root, 'foundry.prev', 'main.js'), 'utf8'), 'old');
      assert.ok(!existsSync(join(root, 'foundryvtt.zip')), 'the zip is removed once the new program runs');
    });

    test('the second rename failing puts the old program back and starts Foundry again', () => {
      const { root, prelude } = setup();
      const r = go(root, prelude, { FAIL_MV: '1' });
      assert.notEqual(r.status, 0, r.out);
      assert.match(r.out, /putting the old program back/);
      assert.equal(readFileSync(join(root, 'foundry', 'main.js'), 'utf8'), 'old', r.out);
      assert.ok(!existsSync(join(root, 'foundry.prev')), 'moved back');
      assert.ok(!existsSync(join(root, 'foundry.failed')));
      assert.ok(!existsSync(join(root, 'foundry.new')), 'the staged copy is removed');
      assert.ok(existsSync(join(root, 'foundryvtt.zip')), 'the zip stays so the stage can be run again');
      assert.match(r.calls, /\|stop foundry\.service.*\|stop foundry\.service\|start foundry\.service$/, 'stopped for the swap, then Foundry is started again last');
    });

    test('a new program that does not start is replaced by the old one, and Foundry is started again', () => {
      const { root, prelude } = setup();
      const r = go(root, prelude, { FAIL_NEW_START: '1' });
      assert.notEqual(r.status, 0, r.out);
      assert.equal(readFileSync(join(root, 'foundry', 'main.js'), 'utf8'), 'old', r.out);
      assert.ok(!existsSync(join(root, 'foundry.failed')), 'the failed program is removed');
      assert.ok(existsSync(join(root, 'foundryvtt.zip')));
      // stop (the swap), start (the new one, fails), stop (the rollback), start (the old one, works)
      assert.match(r.out, /the old Foundry program is back/);
      assert.match(r.calls, /\|stop foundry\.service.*\|start foundry\.service\|stop foundry\.service\|start foundry\.service\s*$/);
    });

    test('a failing rm inside the rollback does not end it halfway (no set -e in the trap)', () => {
      const { root, prelude } = setup();
      const r = go(root, prelude, { FAIL_MV: '1', FAIL_RM_FAILED: '1' });
      assert.notEqual(r.status, 0, r.out);
      assert.equal(readFileSync(join(root, 'foundry', 'main.js'), 'utf8'), 'old', r.out);
      assert.match(r.calls, /\|start foundry\.service\s*$/, 'Foundry is started again');
    });

    test('.prev that cannot be removed: the running program stays and is not swapped for a half-deleted .prev', () => {
      const { root, prelude } = setup();
      mkdirSync(join(root, 'foundry.prev'));
      writeFileSync(join(root, 'foundry.prev', 'main.js'), 'stale prev');
      const r = go(root, prelude, { FAIL_RM_PREV: '1' });
      assert.notEqual(r.status, 0, r.out);
      assert.equal(readFileSync(join(root, 'foundry', 'main.js'), 'utf8'), 'old', r.out);
      assert.equal(readFileSync(join(root, 'foundry.prev', 'main.js'), 'utf8'), 'stale prev');
      assert.match(r.calls, /\|start foundry\.service\s*$/, 'Foundry is started again');
    });

    test('the zip is kept when Foundry has started but does not answer yet', () => {
      const { root, prelude } = setup();
      const r = go(root, prelude.replace('write_file() { return 0; }', `write_file() { return 0; }; curl() { case "$*" in *api/status*) echo '{"active":true,"users":0}' ;; *) return 22 ;; esac; }`), {});
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /the zip is kept until it answers/);
      assert.ok(existsSync(join(root, 'foundryvtt.zip')));
    });

    test('a failure before Foundry was stopped changes nothing (no rollback, no stop)', () => {
      const { root, prelude } = setup();
      const r = go(root, prelude.replace('unzip() {', 'unzip() { return 9;'), {});
      assert.notEqual(r.status, 0, r.out);
      assert.doesNotMatch(r.out, /putting the old program back/);
      assert.equal(readFileSync(join(root, 'foundry', 'main.js'), 'utf8'), 'old');
      assert.ok(existsSync(join(root, 'foundryvtt.zip')));
    });
  });
});

// The nightly backup (the script 6-backup.sh writes to the Pi) waits for players to leave instead of stopping Foundry
// under them (r37 S7). The script is cut out of the stage and run with fake systemctl, curl, sleep, restic and journalctl.
describe('the nightly backup waits while players are online (r37 S7)', () => {
  const stage6 = read('scripts/pi/remote/6-backup.sh');
  const body = stage6.match(/<<'BACKUP_SCRIPT'\n([\s\S]*?)\nBACKUP_SCRIPT\n/)?.[1];

  // The script dates its marker with `date +%F` and `date -d yesterday +%F`; the test's fake date answers with a fixed
  // calendar day (the 15th, "n days ago" counts back from it), so no test depends on the real clock.
  const dayAgo = (n) => `2026-03-${String(15 - n).padStart(2, '0')}`;

  // users: the number curl reports per look (the list is consumed by each sleep; the last one stays).
  // marker: the text of an existing skip marker ('' is one from an earlier version of the script), or null for none.
  // midnightAfterFirstSleep: the fake clock moves on one day when the first sleep ends (a run that waits past midnight).
  function nightly({ users = [0], active = 'foundry.service', env = {}, curlFails = false, marker = null, midnightAfterFirstSleep = false } = {}) {
    const d = tmp();
    const bin = join(d, 'bin');
    mkdirSync(bin);
    if (marker !== null) {
      mkdirSync(join(d, 'marker'));
      writeFileSync(join(d, 'marker', 'skipped-last-night'), marker);
    }
    const log = join(d, 'calls.log');
    const seq = join(d, 'users.seq');
    writeFileSync(seq, users.join('\n') + '\n');
    writeFileSync(log, '');
    const tool = (name, text) => writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${text}\n`, { mode: 0o755 });
    tool('systemctl', `echo "systemctl $*" >>"$LOG"
case "$1" in
  is-active) case " $ACTIVE " in *" \${@: -1} "*) exit 0 ;; esac; exit 1 ;;
  show) case "$*" in *InvocationID*) echo "\${INVOCATION:-}" ;; *) echo "\${SHOW_TS:-}" ;; esac ;;
esac
exit 0`);
    tool('curl', `if [ "\${CURL_FAILS:-0}" = 1 ]; then exit 22; fi
echo "{\\"active\\":true,\\"users\\":$(head -n 1 "$SEQ")}"`);
    // The fake date: today and yesterday come from two files; the first sleep may move the clock past midnight.
    const days = join(d, 'days');
    mkdirSync(days);
    writeFileSync(join(days, 'today'), dayAgo(0));
    writeFileSync(join(days, 'yesterday'), dayAgo(1));
    if (midnightAfterFirstSleep) {
      writeFileSync(join(days, 'today.next'), `2026-03-16`);
      writeFileSync(join(days, 'yesterday.next'), dayAgo(0));
    }
    tool('date', `case "$*" in
  "+%F") cat "$DAYS/today" ;;
  "-d yesterday +%F") if [ "\${FAKE_NO_YESTERDAY:-0}" = 1 ]; then exit 1; fi; cat "$DAYS/yesterday" ;;
  *) exec /usr/bin/date "$@" ;;
esac`);
    tool('sleep', `echo "sleep $*" >>"$LOG"
for f in today yesterday; do if [ -f "$DAYS/$f.next" ]; then mv "$DAYS/$f.next" "$DAYS/$f"; fi; done
tail -n +2 "$SEQ" >"$SEQ.next"; if [ -s "$SEQ.next" ]; then mv "$SEQ.next" "$SEQ"; else rm -f "$SEQ.next"; fi`);
    tool('restic', 'echo "restic $*" >>"$LOG"');
    // JOURNAL is the log of the run with invocation id JOURNAL_ID; any other run has nothing.
    tool('journalctl', 'case "$*" in *"_SYSTEMD_INVOCATION_ID=${JOURNAL_ID:-none}"*) printf "%s\\n" "${JOURNAL:-}" ;; esac');
    const script = join(d, 'foundry-backup.sh');
    writeFileSync(script, body, { mode: 0o755 });
    const r = spawnSync('bash', ['-c', 'export PATH="$BIN:$PATH"; exec bash "$SCRIPT"'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        // On PATH a drive letter's colon would split the entry: C:\x becomes /c/x (Git bash), unchanged on Linux.
        BIN: posix(bin).replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`),
        SCRIPT: posix(script),
        LOG: posix(log),
        SEQ: posix(seq),
        DAYS: posix(days),
        ACTIVE: active,
        CURL_FAILS: curlFails ? '1' : '0',
        FOUNDRY_BACKUP_SYSTEMD_DIR: posix(d),
        FOUNDRY_BACKUP_SKIP_MARKER: posix(join(d, 'marker', 'skipped-last-night')),
        ...env,
      },
    });
    const calls = readFileSync(log, 'utf8');
    return {
      status: r.status,
      out: `${r.stdout}${r.stderr}`,
      calls,
      sleeps: (calls.match(/^sleep /gm) || []).length,
      marker: existsSync(join(d, 'marker', 'skipped-last-night')),
      markerText: existsSync(join(d, 'marker', 'skipped-last-night')) ? readFileSync(join(d, 'marker', 'skipped-last-night'), 'utf8').trim() : null,
    };
  }

  test('the script was found in the stage', () => {
    assert.ok(body && body.includes('restic backup'), 'could not cut the nightly script out of 6-backup.sh');
  });

  test('nobody online: Foundry stops at once and the backup runs', () => {
    const r = nightly({ users: [0] });
    assert.equal(r.status, 0, r.out);
    assert.equal(r.sleeps, 0);
    assert.match(r.calls, /systemctl stop foundry\.service/);
    assert.match(r.calls, /restic backup/);
  });

  test('players online: it does not stop Foundry, waits 30 minutes and tries again until they are gone', () => {
    const r = nightly({ users: [3, 1, 0] });
    assert.equal(r.status, 0, r.out);
    assert.equal(r.sleeps, 2, r.calls);
    assert.match(r.calls, /sleep 1800/);
    assert.match(r.out, /3 player\(s\) online in Foundry: not stopping it for the backup; trying again in 30 minutes \(1 of 6\)/);
    assert.ok(r.calls.indexOf('sleep') < r.calls.indexOf('systemctl stop foundry.service'), 'the stop comes after the waiting');
  });

  test('players still there after six waits: the night is skipped with an ERROR, Foundry never stopped, no backup, a marker is left', () => {
    const r = nightly({ users: [2] });
    assert.notEqual(r.status, 0, r.out);
    assert.equal(r.sleeps, 6, r.calls);
    assert.match(r.out, /ERROR: backup skipped for tonight: 2 player\(s\) were still online/);
    assert.doesNotMatch(r.calls, /systemctl stop foundry\.service/);
    assert.doesNotMatch(r.calls, /restic/);
    assert.ok(r.marker, 'the skipped night is recorded');
    assert.equal(r.markerText, dayAgo(0), 'the marker holds the date of the skipped night');
  });

  test('never two skipped nights in a row: with a marker dated yesterday it backs up anyway after the waits, and the marker goes', () => {
    const r = nightly({ users: [2], marker: dayAgo(1) });
    assert.equal(r.status, 0, r.out);
    assert.equal(r.sleeps, 6, r.calls);
    assert.match(r.out, /last night's backup was skipped too: backing up anyway/);
    assert.match(r.calls, /systemctl stop foundry\.service/);
    assert.match(r.calls, /restic backup/);
    assert.ok(!r.marker, 'a finished backup removes the marker');
  });

  test('a marker dated today (a manual run or a stage 6 rerun the evening after a skip) never stops Foundry under players', () => {
    const r = nightly({ users: [2], marker: dayAgo(0) });
    assert.notEqual(r.status, 0, r.out);
    assert.equal(r.sleeps, 6, r.calls);
    assert.match(r.out, /ERROR: backup skipped for tonight/);
    assert.doesNotMatch(r.out, /backing up anyway/);
    assert.doesNotMatch(r.calls, /systemctl stop foundry\.service/);
    assert.doesNotMatch(r.calls, /restic/);
    assert.equal(r.markerText, dayAgo(0));
  });

  test('a run that starts the evening after a skip and waits past midnight still counts its start day as today', () => {
    const r = nightly({ users: [2], marker: dayAgo(0), midnightAfterFirstSleep: true });
    assert.notEqual(r.status, 0, r.out);
    assert.equal(r.sleeps, 6, r.calls);
    assert.doesNotMatch(r.out, /backing up anyway/);
    assert.doesNotMatch(r.calls, /systemctl stop foundry\.service/);
    assert.doesNotMatch(r.calls, /restic/);
    assert.equal(r.markerText, dayAgo(0), 'dated with the day the run started');
  });

  test('no way to work out yesterday: a warning, and a skipped night does not force the next one', () => {
    const r = nightly({ users: [2], marker: dayAgo(1), env: { FAKE_NO_YESTERDAY: '1' } });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /WARNING: could not work out yesterday's date/);
    assert.doesNotMatch(r.calls, /systemctl stop foundry\.service/);
  });

  test('an older marker (a night in between had no skip) is a fresh skip: no backup anyway, the marker is re-dated', () => {
    const r = nightly({ users: [2], marker: dayAgo(3) });
    assert.notEqual(r.status, 0, r.out);
    assert.doesNotMatch(r.calls, /systemctl stop foundry\.service/);
    assert.doesNotMatch(r.calls, /restic/);
    assert.equal(r.markerText, dayAgo(0));
  });

  test('an empty marker from the earlier version of the script is not trusted either', () => {
    const r = nightly({ users: [2], marker: '' });
    assert.notEqual(r.status, 0, r.out);
    assert.doesNotMatch(r.calls, /systemctl stop foundry\.service/);
    assert.equal(r.markerText, dayAgo(0));
  });

  test('a backup that finds nobody online also removes an old marker', () => {
    const r = nightly({ users: [0], marker: dayAgo(1) });
    assert.equal(r.status, 0, r.out);
    assert.ok(!r.marker);
  });

  test('FOUNDRY_BACKUP_ANYWAY=1 (the stage with FORCE=1) skips the waiting', () => {
    const r = nightly({ users: [4], env: { FOUNDRY_BACKUP_ANYWAY: '1' } });
    assert.equal(r.status, 0, r.out);
    assert.equal(r.sleeps, 0);
    assert.match(r.calls, /systemctl stop foundry\.service/);
  });

  test('an unreadable /api/status is looked at three times a minute apart, then does not hold the backup back (warns)', () => {
    const r = nightly({ curlFails: true });
    assert.equal(r.status, 0, r.out);
    assert.equal(r.sleeps, 2);
    assert.match(r.calls, /sleep 60/);
    assert.match(r.out, /could not read who is online in Foundry \(1 of 2 looks\)/);
    assert.match(r.out, /WARNING: could not read who is online in Foundry; backing up anyway/);
    assert.match(r.calls, /restic backup/);
  });

  test('Foundry not running: nobody to wait for, the backup runs as it is', () => {
    const r = nightly({ users: [5], active: '' });
    assert.equal(r.status, 0, r.out);
    assert.equal(r.sleeps, 0);
    assert.doesNotMatch(r.calls, /systemctl stop/);
    assert.match(r.calls, /restic backup/);
  });

  test('the Assistant GM and the Kit GM are not players once they have joined, and are before', () => {
    const joinedLine = '[assistant-gm] joined world w as Assistant GM (GM: true, module active: true)';
    const thisRun = { INVOCATION: 'run-2', JOURNAL_ID: 'run-2' };
    for (const unit of ['foundry-ai-tool-gm-browser.service', 'foundry-ai-tool-kit-gm-browser.service']) {
      const active = `foundry.service ${unit}`;
      const joined = nightly({ users: [1], active, env: { ...thisRun, JOURNAL: joinedLine } });
      assert.equal(joined.status, 0, joined.out);
      assert.equal(joined.sleeps, 0, unit);
      const waiting = nightly({ users: [1], active, env: { ...thisRun, JOURNAL: '[assistant-gm] no world is running', FOUNDRY_BACKUP_MAX_WAITS: '1' } });
      assert.notEqual(waiting.status, 0, waiting.out);
      assert.equal(waiting.sleeps, 1);
      // A join that belongs to an earlier run of the service (it left the game and was started again) does not count.
      const earlier = nightly({ users: [1], active, env: { INVOCATION: 'run-2', JOURNAL_ID: 'run-1', JOURNAL: joinedLine, FOUNDRY_BACKUP_MAX_WAITS: '1' } });
      assert.notEqual(earlier.status, 0, earlier.out);
    }
  });

  test('the service allows for the waiting, and the stage runs the first backup without it under FORCE=1', () => {
    assert.match(stage6, /TimeoutStartSec=5h/);
    assert.match(stage6, /if \[ "\$FORCE" = 1 \]; then[\s\S]*?FOUNDRY_BACKUP_ANYWAY=1 "\$backup_script"/);
  });
});

// set-tunnel-token.sh, set-dashboard-access.sh and set-discord-token.sh restart a service after writing a settings file:
// they refuse (before asking for anything) while players are online or a recording runs, and FORCE=1 goes on.
describe('the helper scripts the user runs check players and recordings first', () => {
  const scripts = {
    'set-tunnel-token.sh': { unit: 'foundry-ai-tool-cloudflared.service', reached: /is missing/ },
    'set-dashboard-access.sh': { unit: 'foundry-ai-tool-dashboard.service', reached: /is missing/ },
    'set-discord-token.sh': { unit: 'foundry-ai-tool-discord-bot.service', reached: /is missing: run stage 8/ },
  };

  // lib.sh is copied next to the script (as the user does with scp) with the Pi replaced at its end: no root, a fake
  // systemctl/curl/sleep, and every path the scripts use under one temp folder.
  function helper(name, { active = '', users = 0, recording = false, env = {} } = {}) {
    const d = tmp();
    mkdirSync(join(d, 'etc'));
    const rec = join(d, 'data', 'recordings', 'night', 'raw');
    if (recording) {
      mkdirSync(rec, { recursive: true });
      writeFileSync(join(rec, '1-gnu.rec'), 'x');
    }
    const nd = nodeDir();
    const real = read('scripts/pi/remote/lib.sh');
    writeFileSync(
      join(d, 'lib.sh'),
      `${real}
TOOL_ETC=${posix(d)}/etc; TOOL_DATA=${posix(d)}/data; NODE_DIR=${nd}
require_root() { :; }
have_systemd() { return 0; }
sleep() { :; }
journalctl() { :; }
systemctl() {
  case "$1" in
    is-active) case " $ACTIVE " in *" \${@: -1} "*) return 0 ;; esac; return 1 ;;
    show) echo "" ;;
  esac
  return 0
}
curl() { echo '{"active":true,"users":'"$USERS"'}'; }
`,
    );
    let text = read(`scripts/pi/remote/${name}`);
    const args = [];
    if (name === 'set-discord-token.sh') {
      // The ps1 sends lib.sh, the values and this file in one stream; here lib.sh is sourced the same way.
      text = `. "${posix(join(d, 'lib.sh'))}"\nTOKEN_IN=${'A'.repeat(60)}\nGUILD_IN=\n${text}`;
    }
    writeFileSync(join(d, name), text);
    const r = spawnSync('bash', [posix(join(d, name)), ...args], {
      encoding: 'utf8',
      input: '',
      env: { ...process.env, ACTIVE: active, USERS: String(users), ...env },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }

  for (const [name, { unit, reached }] of Object.entries(scripts)) {
    describe(name, () => {
      const running = `foundry.service ${unit}`;

      test('players online: refuses before asking for anything', () => {
        const r = helper(name, { active: running, users: 2 });
        assert.notEqual(r.status, 0, r.out);
        assert.match(r.out, /2 player\(s\) are online/);
        assert.match(r.out, /FORCE=1/);
        assert.doesNotMatch(r.out, /Paste the token|Tunnel token|The settings|the settings file/);
      });

      test('a recording running refuses too', () => {
        const r = helper(name, { active: unit, recording: true });
        assert.notEqual(r.status, 0, r.out);
        assert.match(r.out, /recording is in progress/);
      });

      test('FORCE=1 goes on with a warning (it then stops at the first missing file of the test folder)', () => {
        const r = helper(name, { active: running, users: 2, env: { FORCE: '1' } });
        assert.match(r.out, /2 player\(s\) are online in Foundry: .*\(FORCE=1: going on\)/);
        assert.match(r.out, reached);
      });

      test('nobody online passes the check', () => {
        const r = helper(name, { active: running, users: 0 });
        assert.doesNotMatch(r.out, /player\(s\) are online/);
        assert.match(r.out, reached);
      });

      test('a service that is not running is just started later: no check, even with players online', () => {
        const r = helper(name, { active: 'foundry.service', users: 3 });
        assert.doesNotMatch(r.out, /player\(s\) are online/);
        assert.match(r.out, reached);
      });
    });
  }

  test('the two stand-alone scripts source lib.sh from beside them and say so when it is missing', () => {
    for (const name of ['set-tunnel-token.sh', 'set-dashboard-access.sh']) {
      const d = tmp();
      writeFileSync(join(d, name), read(`scripts/pi/remote/${name}`));
      const r = spawnSync('bash', [posix(join(d, name))], { encoding: 'utf8', input: '' });
      assert.notEqual(r.status, 0);
      assert.match(`${r.stdout}${r.stderr}`, /lib\.sh is missing: copy lib\.sh next to this script/);
    }
  });
});

// set-discord-token.ps1 -Force passes FORCE=1 to the Pi in front of bash (PowerShell 7; a fake ssh records its arguments).
const hasPwsh = (() => {
  const p = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
  return p.status === 0 && Number(String(p.stdout).trim()) >= 7;
})();
describe('set-discord-token.ps1 passes FORCE through', { skip: !hasPwsh && 'PowerShell 7 is not available' }, () => {
  const ps1 = join(repo, 'scripts', 'pi', 'set-discord-token.ps1');

  function runPs1(extra = '') {
    const d = tmp();
    const log = join(d, 'ssh.log');
    const stdinFile = join(d, 'stdin.txt');
    const fake = join(d, 'fake-ssh.ps1');
    // The fake ssh records its arguments and what arrived on stdin (the script text), then reports success.
    writeFileSync(fake, `Add-Content -Path $env:FAKE_SSH_LOG -Value ($args -join ' | ')\n$input | Out-String | Set-Content -Path $env:FAKE_SSH_STDIN\nexit 0\n`);
    const token = 'A'.repeat(60);
    // Read-Host would wait for a console: a function of the same name stands in (a command lookup finds functions first).
    const command = `function Read-Host { param([string]$Prompt, [switch]$AsSecureString) if ($AsSecureString) { ConvertTo-SecureString '${token}' -AsPlainText -Force } else { '' } }; & '${ps1}' -Ssh '${fake}' ${extra}; exit $LASTEXITCODE`;
    const r = spawnSync('pwsh', ['-NoProfile', '-Command', command], {
      encoding: 'utf8',
      env: { ...process.env, FAKE_SSH_LOG: log, FAKE_SSH_STDIN: stdinFile },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, calls: existsSync(log) ? readFileSync(log, 'utf8').trim() : '', stdin: existsSync(stdinFile) ? readFileSync(stdinFile, 'utf8') : '', token };
  }

  test('-Force puts FORCE=1 in front of bash on the ssh line, and the token stays off it', () => {
    const r = runPs1('-Force');
    assert.equal(r.status, 0, r.out);
    assert.equal(r.calls, 'foundry-pi | FORCE=1 bash -s -- no-log');
    assert.ok(!r.calls.includes(r.token) && !r.out.includes(r.token));
    assert.ok(r.stdin.includes(`TOKEN_IN='${r.token}'`), 'the token travels on stdin');
  });

  test('without -Force the command is the plain one', () => {
    const r = runPs1();
    assert.equal(r.status, 0, r.out);
    assert.equal(r.calls, 'foundry-pi | bash -s -- no-log');
  });
});
