// The Docker cutover guard (scripts/pi/remote/lib.sh: refuse_when_cut_over, containers_of, env_file_value) and the
// rule that keeps it true for stages written later (Backlog: pi-compose-cutover):
//   node --test scripts/pi/cutover-guard.test.mjs
// Runs with the real lib.sh and a stand-in docker in folders of its own (bash needed; Git Bash on Windows works).
// The scenarios that run each guarded stage on a cut-over Pi are scripts/pi/container-test/cutover-guard-scenarios.sh.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const remote = path.join(repo, 'scripts', 'pi', 'remote');
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'pi-cutover-guard-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const posix = p => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
const lib = readFileSync(path.join(remote, 'lib.sh'), 'utf8');
let counter = 0;

function bash(script, env = {}) {
  const dir = path.join(tmp, `run${++counter}`);
  mkdirSync(dir);
  const file = path.join(dir, 'run.sh');
  writeFileSync(file, script);
  return spawnSync('bash', [posix(file)], { encoding: 'utf8', env: { ...process.env, ...env } });
}

// ---- the env reader ---------------------------------------------------------------------------------------------
describe('env_file_value (the one reader of deploy/pi/.env)', { skip: !hasBash && 'no bash here' }, () => {
  const read = (envText, name) => {
    const dir = path.join(tmp, `env${++counter}`);
    mkdirSync(dir);
    const file = path.join(dir, '.env');
    if (envText !== null) writeFileSync(file, envText);
    const r = bash(`${lib}\nenv_file_value ${posix(file)} ${name}\n`);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  test('a plain value, with the name and the value surrounded by blanks', () => {
    assert.equal(read('A=1\n  B  =  two  \n', 'B'), 'two');
    assert.equal(read('A=1\n', 'A'), '1');
  });
  test('the last assignment wins', () => {
    assert.equal(read('A=1\nA=2\nA=3\n', 'A'), '3');
  });
  test('an unquoted value ends at a blank-then-hash comment; a hash inside the value stays', () => {
    assert.equal(read('A=8080 # the port\n', 'A'), '8080');
    assert.equal(read('A=ab#cd\n', 'A'), 'ab#cd');
  });
  test('one pair of matching quotes is removed and what is inside is kept as it is', () => {
    assert.equal(read('A="a b # c"\n', 'A'), 'a b # c');
    assert.equal(read("A='x y'\n", 'A'), 'x y');
    assert.equal(read('A="quoted" # tail\n', 'A'), 'quoted');
  });
  test('a name that is not there, a name that only ends like it, a commented line and a missing file give nothing', () => {
    assert.equal(read('A=1\n', 'B'), '');
    assert.equal(read('XA=1\n', 'A'), '');
    assert.equal(read('# A=1\n', 'A'), '');
    assert.equal(read(null, 'A'), '');
  });
});

// ---- refuse_when_cut_over ---------------------------------------------------------------------------------------
// A docker stand-in: DOCKER_MODE=down (daemon silent) | none (no container) | live (a container of the live project) |
// stopped (only a stopped one) | rehearsal (a container of the rehearsal project only).
describe('refuse_when_cut_over', { skip: !hasBash && 'no bash here' }, () => {
  function guard(mode, { noDocker = false, systemd = '' } = {}) {
    const dir = path.join(tmp, `g${++counter}`);
    const bin = path.join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      path.join(bin, 'docker'),
      `#!/usr/bin/env bash
case "$1" in
  info) if [ "$DOCKER_MODE" = down ]; then exit 1; fi; exit 0 ;;
  ps)
    all=0; proj=""
    for a in "$@"; do case "$a" in -aq) all=1 ;; label=com.docker.compose.project=*) proj="\${a#label=com.docker.compose.project=}" ;; esac; done
    case "$DOCKER_MODE" in
      live) [ "$proj" = foundry-ai-tool-pi ] && echo cid-foundry ;;
      stopped) [ "$proj" = foundry-ai-tool-pi ] && [ "$all" = 1 ] && echo cid-foundry ;;
      rehearsal) [ "$proj" = foundry-ai-tool-pi-rehearsal ] && echo cid-foundry ;;
    esac
    exit 0 ;;
esac
exit 0
`
    );
    chmodSync(path.join(bin, 'docker'), 0o755);
    // systemd: 'off' = docker.service and docker.socket are neither enabled nor active; 'on' = enabled.
    writeFileSync(
      path.join(bin, 'systemctl'),
      `#!/usr/bin/env bash
case "$1" in
  is-active) exit 3 ;;
  is-enabled) [ "$SYSTEMD_DOCKER" = on ] && echo enabled || echo disabled ;;
esac
exit 0
`
    );
    chmodSync(path.join(bin, 'systemctl'), 0o755);
    const hide = noDocker
      ? 'command() { if [ "$1" = -v ] && [ "$2" = docker ]; then return 1; fi; builtin command "$@"; }\n'
      : '';
    // Explicit both ways: a CI runner has a real systemd, so "no systemd" must be stubbed too.
    const sys = systemd ? 'have_systemd() { return 0; }\n' : 'have_systemd() { return 1; }\n';
    // PATH is extended inside bash: on Windows the parent's PATH is semicolon-separated until bash converts it.
    return bash(`export PATH="$BIN:$PATH"\n${lib}\n${hide}${sys}refuse_when_cut_over "stage X"\necho passed\n`, {
      BIN: posix(bin),
      DOCKER_MODE: mode,
      SYSTEMD_DOCKER: systemd,
    });
  }

  test('docker not installed: never cut over, the stage may run', () => {
    assert.match(guard('down', { noDocker: true }).stdout, /passed/);
  });
  test('docker answers and no container of the live project exists: the stage may run', () => {
    assert.match(guard('none').stdout, /passed/);
  });
  test('a container of the live project: refused, naming the stage and MODE=rollback, nothing after it runs', () => {
    const r = guard('live');
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /passed/);
    assert.match(r.stderr, /the stack runs as containers .*foundry-ai-tool-pi.*stage X/);
    assert.match(r.stderr, /MODE=rollback/);
  });
  test('a stopped container counts too (the nightly backup stops the Foundry container)', () => {
    assert.equal(guard('stopped').status, 1);
  });
  test('only a rehearsal container: not cut over', () => {
    assert.match(guard('rehearsal').stdout, /passed/);
  });
  test('docker installed but its daemon silent: unknown, so refused (fail closed)', () => {
    const r = guard('down');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /Docker daemon does not answer.*stage X is refused/);
  });
  test('daemon silent and systemd will not start docker (a FORCE=1 rollback switched it off): the stage may run', () => {
    assert.match(guard('down', { systemd: 'off' }).stdout, /passed/);
  });
  test('daemon silent while docker.service is enabled: still refused', () => {
    assert.equal(guard('down', { systemd: 'on' }).status, 1);
  });
  test('FORCE=1 does not override it', () => {
    const body = lib.slice(lib.indexOf('refuse_when_cut_over() {'), lib.indexOf('# env_file_value FILE NAME'));
    assert.ok(body.includes('die "'), 'it dies, it does not call refuse');
    assert.doesNotMatch(body.replace(/^\s*#.*$/gm, ''), /FORCE|\brefuse\b/);
  });
});

// ---- the stick: every stage that touches a unit has the guard or a reason ------------------------------------------
// Compose runs four units as containers (compose.yml): foundry, bridge, dashboard, gm-browser. A stage that starts,
// restarts or enables a systemd unit would start a second copy of one of them next to its container on a cut-over Pi
// (PR 724 Opus review H1), so each such stage calls refuse_when_cut_over before its first change, or is named below
// with the reason it cannot hurt. The test reads the code, not a list: a new stage under scripts/pi/remote/ that calls
// enable_unit or `systemctl start|restart|enable` fails here until its author decides. A unit the stack does not run
// (the bot, timers, sshd, Syncthing, cloudflared) goes into NO_GUARD with the reason; a stage that merely stops or
// reads units is not caught, and does not need to be.
const NO_GUARD = {
  '4-tailscale.sh': 'enables tailscaled only; Tailscale is not part of the stack',
  '6-backup.sh':
    'installs the backup timer; the nightly script it writes finds the stack by label and stops the Foundry container instead of foundry.service (pi-stage-safety.test.mjs)',
  '8-recorder.sh': 'the Discord recorder unit; the bot is not a container (compose.yml has no bot)',
  '9-ssh-log.sh': 'sshd logging and its safety timer only',
  '10-space-check.sh': 'its own timer; starts the space check, which only reads',
  '15-ssh-keys-only.sh': 'sshd only (reload, with a safety timer)',
  '16-board-status.sh': 'its own timer; the report only reads',
  '17-gh-runner.sh': 'the GitHub runner units; not part of the stack',
  '23-docker.sh': 'enables docker.service and builds images; starts no stack unit (docker-compose.test.mjs)',
  '24-compose.sh': 'is the cutover and the rollback: it starts and stops the units on purpose, with its own guards',
  '26-discord-game-server.sh': 'the Discord bot unit; the bot stays a systemd unit after the cutover (compose.yml has no bot)',
  '29-gamenight-watch.sh': 'its own watch unit (After= lines only name the stack); not a stack unit',
  '32-crash-guard.sh': 'drop-ins only for stack units that are enabled systemd units, plus its own timer; starts none of them',
  'set-discord-token.sh': 'restarts the Discord bot unit only; the bot is not a container',
  'set-tunnel-token.sh': 'restarts the cloudflared unit only; not part of the stack',
};

const stageFiles = readdirSync(remote)
  .filter(f => f.endsWith('.sh') && f !== 'lib.sh' && f !== 'lib-gm-passwords.sh')
  .sort();
const codeLines = text => text.split('\n').map((line, i) => ({ line, n: i + 1 })).filter(l => !/^\s*#/.test(l.line));
const MUTATING = /\benable_unit\b|\bsystemctl\s+(?:--\S+\s+)*(?:start|restart|try-restart|reload-or-restart|enable)\b/;
const GUARD = /^\s*refuse_when_cut_over\s+"/;

describe('every stage that starts, restarts or enables a unit calls the guard', () => {
  const info = Object.fromEntries(
    stageFiles.map(f => {
      const lines = codeLines(readFileSync(path.join(remote, f), 'utf8'));
      return [
        f,
        {
          firstChange: lines.find(l => MUTATING.test(l.line))?.n ?? null,
          guard: lines.find(l => GUARD.test(l.line))?.n ?? null,
        },
      ];
    })
  );

  test('the scan sees the stage scripts', () => {
    assert.ok(stageFiles.length >= 30, stageFiles.join(' '));
    assert.ok(info['3-foundry.sh'].firstChange, 'the pattern finds enable_unit in stage 3');
  });

  for (const f of stageFiles) {
    const { firstChange, guard } = info[f];
    if (firstChange === null && guard === null) continue;
    test(`${f}`, () => {
      if (f in NO_GUARD) {
        assert.ok(firstChange !== null, `${f} is in NO_GUARD but no longer starts, restarts or enables a unit: remove the entry`);
        assert.equal(guard, null, `${f} is in NO_GUARD but calls refuse_when_cut_over: remove the entry`);
        assert.ok(NO_GUARD[f].length > 20, 'a reason, not a word');
        return;
      }
      assert.ok(
        guard !== null,
        `${f} starts, restarts or enables a unit (line ${firstChange}) and does not call refuse_when_cut_over "<what>": call it right after require_root, or add the file to NO_GUARD with the reason it cannot start a second copy of a stack unit`
      );
      if (firstChange !== null) {
        assert.ok(guard < firstChange, `${f}: the guard (line ${guard}) comes after the first change (line ${firstChange})`);
      }
    });
  }

  test('NO_GUARD names only files that exist', () => {
    for (const f of Object.keys(NO_GUARD)) assert.ok(stageFiles.includes(f), `${f} is gone: remove the entry`);
  });

  test('the stages the item names are guarded', () => {
    for (const f of [
      '3-foundry',
      '5-tool',
      '5-check-world',
      '7-vault',
      '11-world',
      '12-tunnel',
      '13-player-creation',
      '14-system-trial',
      '19-join-page-look',
      '21-player-vault',
      '25-modules',
      '27-bot-status',
      '28-gm-watchdog',
      '30-player-connector',
      'kit-session',
      'switch-world',
      'set-dashboard-access',
      'gm-script',
    ]) {
      assert.ok(info[`${f}.sh`].guard !== null, `${f}.sh`);
    }
  });
});
