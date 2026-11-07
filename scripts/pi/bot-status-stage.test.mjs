// Pi stage 27, the recorder bot's status endpoint (scripts/pi/remote/27-bot-status.sh, backlog pi-bot-status-endpoint):
//   node --test scripts/pi/bot-status-stage.test.mjs
// The stage runs in bash with stand-ins for systemctl, curl, ss and Node, and folders for /etc/foundry-ai-tool, the tool
// build and the systemd drop-in directory, so no Pi and no systemd.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const remote = path.join(repo, 'scripts', 'pi', 'remote');
const stage = readFileSync(path.join(remote, '27-bot-status.sh'), 'utf8');
const lib = readFileSync(path.join(remote, 'lib.sh'), 'utf8');
const posix = p => p.replace(/\\/g, '/');
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;

const roots = [];
after(() => roots.forEach(d => rmSync(d, { recursive: true, force: true })));

const BOT = 'foundry-ai-tool-discord-bot.service';
const DASH = 'foundry-ai-tool-dashboard.service';
const SECRET = 'DISCORD_TOKEN=SECRET-TOKEN-VALUE-1234567890';

function fakePi({
  envLines = [SECRET, 'FVTT_SESSIONS_DIR=/var/lib/foundry-ai-tool/recordings'],
  active = [BOT, DASH],
  botKnows = true,
  dashKnows = true,
  snapshot = true,
  portBusy = false,
  answers = true,
  foundryUsers = 0,
} = {}) {
  const d = mkdtempSync(path.join(tmpdir(), 'bot-status-'));
  roots.push(d);
  for (const sub of [
    'bin',
    'state',
    'etc',
    'tool/discord-bot/dist',
    'tool/app/packages/cogm-dashboard/dist',
    'systemd',
    'node/bin',
    'dietpi',
  ]) {
    mkdirSync(path.join(d, sub), { recursive: true });
  }
  writeFileSync(path.join(d, 'etc', 'discord-bot.env'), envLines.join('\n') + '\n');
  writeFileSync(
    path.join(d, 'tool/discord-bot/dist/config.js'),
    botKnows ? "get('FOUNDRY_AI_BOT_STATUS_PORT')" : 'x'
  );
  writeFileSync(
    path.join(d, 'tool/app/packages/cogm-dashboard/dist/config.js'),
    dashKnows ? "'DASHBOARD_BOT_STATUS_URL'" : 'x'
  );
  for (const u of active) writeFileSync(path.join(d, 'state', `active-${u}`), '');
  if (foundryUsers) writeFileSync(path.join(d, 'state', 'foundry-users'), String(foundryUsers));
  const stub = (name, body) => {
    writeFileSync(
      path.join(d, 'bin', name),
      `#!/usr/bin/env bash\nS="${posix(path.join(d, 'state'))}"\n${body}\n`
    );
    chmodSync(path.join(d, 'bin', name), 0o755);
  };
  stub(
    'systemctl',
    `echo "systemctl $*" >>"$S/calls"
case "$1" in
  is-active) [ "\${2:-}" = --quiet ] && u="$3" || u="$2"; [ -f "$S/active-$u" ]; exit $? ;;
  show) cat "$S/show-ts" 2>/dev/null || echo "" ;;
esac
exit 0`
  );
  stub(
    'ss',
    portBusy
      ? 'echo "LISTEN 0 511 127.0.0.1:3110 0.0.0.0:*"'
      : 'echo "LISTEN 0 511 127.0.0.1:3000 0.0.0.0:*"'
  );
  stub(
    'curl',
    answers
      ? `case "$*" in *api/status*) echo '{"active":true,"users":0}' ;; *) echo '{"recording":false,"problems":[]}' ;; esac`
      : 'exit 22'
  );
  writeFileSync(
    path.join(d, 'node/bin/node'),
    `#!/usr/bin/env bash\nexec "${posix(process.execPath)}" "$@"\n`
  );
  chmodSync(path.join(d, 'node/bin/node'), 0o755);
  const today = new Date().toLocaleDateString('sv');
  writeFileSync(
    path.join(d, 'stats'),
    snapshot ? `${today}_01:25:00  Backup completed\n` : '2020-01-01_01:25:00  Backup completed\n'
  );
  return d;
}

function run(d, env = {}) {
  const script = [
    lib,
    'have_systemd() { return 0; }',
    'sleep() { :; }',
    'id() { echo 0; }',
    `TOOL_ETC="${posix(path.join(d, 'etc'))}"`,
    `TOOL_DIR="${posix(path.join(d, 'tool'))}"`,
    `TOOL_DATA="${posix(path.join(d, 'data'))}"`,
    `NODE_DIR="${posix(path.join(d, 'node'))}"`,
    `DROPIN_DIR_BASE="${posix(path.join(d, 'systemd'))}"`,
    stage,
  ].join('\n');
  const file = path.join(d, 'run.sh');
  writeFileSync(file, script);
  const r = spawnSync('bash', [posix(file)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${posix(path.join(d, 'bin'))}:${process.env.PATH}`,
      DIETPI_DIR: posix(path.join(d, 'dietpi')),
      DIETPI_BACKUP_STATS: posix(path.join(d, 'stats')),
      ...env,
    },
  });
  const calls = existsSync(path.join(d, 'state', 'calls'))
    ? readFileSync(path.join(d, 'state', 'calls'), 'utf8')
    : '';
  const envFile = readFileSync(path.join(d, 'etc', 'discord-bot.env'), 'utf8');
  const dropinPath = path.join(d, 'systemd', `${DASH}.d`, 'bot-status.conf');
  return {
    status: r.status,
    out: `${r.stdout}${r.stderr}`,
    calls,
    envFile,
    dropin: existsSync(dropinPath) ? readFileSync(dropinPath, 'utf8') : null,
  };
}

describe('27-bot-status.sh', { skip: !hasBash && 'no bash here' }, () => {
  test('is valid bash', () => {
    const res = spawnSync('bash', ['-n', path.join(remote, '27-bot-status.sh')], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
  });

  test('sets the port line and the dashboard drop-in, restarts bot then dashboard, checks the endpoint', () => {
    const d = fakePi();
    const r = run(d);
    assert.equal(r.status, 0, r.out);
    assert.match(r.envFile, /^FOUNDRY_AI_BOT_STATUS_PORT=3110$/m);
    assert.match(r.envFile, /^DISCORD_TOKEN=SECRET-TOKEN-VALUE-1234567890$/m);
    assert.match(r.envFile, /^FVTT_SESSIONS_DIR=/m);
    assert.match(
      r.dropin ?? '',
      /^\[Service\]\n(?:#.*\n)?Environment=DASHBOARD_BOT_STATUS_URL=http:\/\/127\.0\.0\.1:3110\/status$/m
    );
    const bot = r.calls.indexOf(`restart ${BOT}`);
    const dash = r.calls.indexOf(`restart ${DASH}`);
    assert.ok(bot >= 0 && dash > bot, r.calls);
    assert.match(r.out, /the bot answers with JSON; keys: recording, problems/);
  });

  test('never prints the settings file (it holds the Discord token)', () => {
    const r = run(fakePi());
    assert.doesNotMatch(r.out, /SECRET-TOKEN/);
  });

  test('replaces an existing line instead of adding a second one', () => {
    const d = fakePi({ envLines: [SECRET, 'FOUNDRY_AI_BOT_STATUS_PORT=3999', 'OTHER=1'] });
    const r = run(d, { PORT: '3120' });
    assert.equal(r.status, 0, r.out);
    assert.equal((r.envFile.match(/FOUNDRY_AI_BOT_STATUS_PORT/g) ?? []).length, 1);
    assert.match(r.envFile, /^FOUNDRY_AI_BOT_STATUS_PORT=3120$/m);
    assert.match(r.envFile, /^OTHER=1$/m);
    assert.match(r.dropin ?? '', /127\.0\.0\.1:3120\/status/);
  });

  test('run again: nothing changes and nothing restarts', () => {
    const d = fakePi();
    run(d);
    rmSync(path.join(d, 'state', 'calls'));
    const r = run(d);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /already set; nothing to write/);
    assert.doesNotMatch(r.calls, /restart/);
  });

  test('a rerun after a partial run (files written, services started earlier) still restarts both', () => {
    const d = fakePi();
    run(d);
    const ts = path.join(d, 'state', 'show-ts');
    writeFileSync(ts, '2000-01-01 00:00:00 UTC\n'); // the services started before the files were written
    rmSync(path.join(d, 'state', 'calls'));
    const r = run(d);
    assert.equal(r.status, 0, r.out);
    assert.match(r.calls, new RegExp(`restart ${BOT}`));
    assert.match(r.calls, new RegExp(`restart ${DASH}`));
    writeFileSync(ts, '2099-01-01 00:00:00 UTC\n'); // started after the files: nothing to do
    rmSync(path.join(d, 'state', 'calls'));
    assert.doesNotMatch(run(d).calls, /restart/);
  });

  test('DRY_RUN changes nothing and needs no snapshot', () => {
    const d = fakePi({ snapshot: false });
    const r = run(d, { DRY_RUN: '1' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /plan: bot env: set FOUNDRY_AI_BOT_STATUS_PORT=3110/);
    assert.doesNotMatch(r.envFile, /STATUS_PORT/);
    assert.equal(r.dropin, null);
    assert.doesNotMatch(r.calls, /restart/);
  });

  test('a real run without a snapshot from today stops before any write', () => {
    const d = fakePi({ snapshot: false });
    const r = run(d);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /no dietpi-backup snapshot completed today/);
    assert.doesNotMatch(r.envFile, /STATUS_PORT/);
  });

  test('an old deployed build (bot or dashboard) stops it before any write', () => {
    for (const opt of [{ botKnows: false }, { dashKnows: false }]) {
      const d = fakePi(opt);
      const r = run(d);
      assert.notEqual(r.status, 0);
      assert.match(r.out, /does not know/);
      assert.doesNotMatch(r.envFile, /STATUS_PORT/);
      assert.equal(r.dropin, null);
    }
  });

  test('a dashboard URL already set in dashboard.env stops it before any write (EnvironmentFile beats the drop-in)', () => {
    const d = fakePi();
    writeFileSync(
      path.join(d, 'etc', 'dashboard.env'),
      'DASHBOARD_BOT_STATUS_URL=http://elsewhere/status\n'
    );
    const r = run(d);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /would override the drop-in/);
    assert.doesNotMatch(r.envFile, /STATUS_PORT/);
    assert.equal(r.dropin, null);
  });

  test('the settings file is replaced through a sibling temp file, not truncated in place', () => {
    assert.match(stage, /mktemp "\$\(dirname "\$env_file"\)/);
    assert.match(stage, /mv "\$tmp" "\$env_file"/);
    assert.doesNotMatch(stage, />\s*"\$env_file"/);
  });

  test('a port in use or a bad PORT stops it before any write', () => {
    const busy = run(fakePi({ portBusy: true }));
    assert.notEqual(busy.status, 0);
    assert.match(busy.out, /port 3110 is already in use/);
    assert.doesNotMatch(busy.envFile, /STATUS_PORT/);
    for (const bad of ['80', 'abc', '70000']) {
      const r = run(fakePi(), { PORT: bad });
      assert.notEqual(r.status, 0, bad);
      assert.doesNotMatch(r.envFile, /STATUS_PORT/);
    }
  });

  test('players online refuse the restarts, and nothing is written', () => {
    const d = fakePi({ active: [BOT, DASH, 'foundry.service'], foundryUsers: 2 });
    writeFileSync(
      path.join(d, 'bin', 'curl'),
      `#!/usr/bin/env bash\ncase "$*" in *api/status*) echo '{"active":true,"users":2}' ;; *) echo '{}' ;; esac\n`
    );
    const r = run(d);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /player\(s\) are online/);
    assert.doesNotMatch(r.envFile, /STATUS_PORT/);
    assert.equal(r.dropin, null);
    assert.doesNotMatch(r.calls, /restart/);
  });

  test('a stopped bot is not started (no token yet); the setting is written', () => {
    const d = fakePi({ active: [DASH] });
    const r = run(d);
    assert.equal(r.status, 0, r.out);
    assert.match(r.envFile, /STATUS_PORT=3110/);
    assert.doesNotMatch(r.calls, new RegExp(`(start|restart) ${BOT}`));
    assert.match(r.out, /the endpoint was not checked/);
  });

  test('a bot that does not answer fails the check', () => {
    const r = run(fakePi({ answers: false }));
    assert.notEqual(r.status, 0);
    assert.match(r.out, /does not answer JSON/);
  });

  test('UNDO removes the line and the drop-in and restarts both', () => {
    const d = fakePi();
    run(d);
    rmSync(path.join(d, 'state', 'calls'));
    const r = run(d, { UNDO: '1' });
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.envFile, /STATUS_PORT/);
    assert.match(r.envFile, /SECRET-TOKEN-VALUE/);
    assert.equal(r.dropin, null);
    assert.match(r.calls, new RegExp(`restart ${BOT}`));
    assert.match(r.calls, new RegExp(`restart ${DASH}`));
  });
});

describe('27-bot-status.sh as text', () => {
  test('rm uses ${var:?}, the port is loopback only, and the stage checks the snapshot after require_root', () => {
    assert.doesNotMatch(stage, /rm -rf?\s+(?!"\$\{)/);
    assert.match(stage, /^require_root\n(?:.*\n)*?.*require_recent_snapshot/m);
    assert.doesNotMatch(stage, /FOUNDRY_AI_BOT_STATUS_HOST=/);
    assert.match(stage, /http:\/\/127\.0\.0\.1:\$port\/status/);
  });
});
