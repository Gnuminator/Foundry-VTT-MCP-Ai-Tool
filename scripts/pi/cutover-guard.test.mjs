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
  function guard(mode, { noDocker = false, systemd = '', pgrep = '1' } = {}) {
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
    // pgrep stand-in (the host's own never decides): PGREP_RC 1 = no containerd-shim, 0 = one runs, 127 = cannot run.
    writeFileSync(path.join(bin, 'pgrep'), '#!/usr/bin/env bash\nexit "${PGREP_RC:-1}"\n');
    chmodSync(path.join(bin, 'pgrep'), 0o755);
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
      PGREP_RC: pgrep,
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
  test('daemon silent, docker off, but a containerd-shim runs (live-restore): refused', () => {
    assert.equal(guard('down', { systemd: 'off', pgrep: '0' }).status, 1);
  });
  test('daemon silent, docker off, and pgrep cannot run (exit 127): refused, a missing pgrep is not "no container"', () => {
    assert.equal(guard('down', { systemd: 'off', pgrep: '127' }).status, 1);
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

// ---- use_stack and the svc_* helpers (day two, D-149) ------------------------------------------------------------
// DOCKER_MODE: down (daemon silent) | none (no container) | live (a running container of the live project) | stopped.
// Calls land in $CALLS. systemctl says a unit is active only when ACTIVE_UNIT names it.
describe('use_stack and svc_*', { skip: !hasBash && 'no bash here' }, () => {
  function run(mode, body, { activeUnit = '', systemd = true } = {}) {
    const dir = path.join(tmp, `s${++counter}`);
    const bin = path.join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const calls = path.join(dir, 'calls');
    writeFileSync(calls, '');
    writeFileSync(
      path.join(bin, 'docker'),
      `#!/usr/bin/env bash
echo "docker $*" >>"$CALLS"
case "$1" in
  info) [ "$DOCKER_MODE" != down ] || exit 1; exit 0 ;;
  inspect) [ "$DOCKER_MODE" != down ] || exit 1; echo false; exit 0 ;;
  ps)
    [ "$DOCKER_MODE" != down ] || exit 1
    all=0; svc=""
    for a in "$@"; do case "$a" in -aq) all=1 ;; label=com.docker.compose.service=*) svc="\${a#label=com.docker.compose.service=}" ;; esac; done
    case "$DOCKER_MODE" in
      live) echo "cid-\${svc:-all}" ;;
      stopped) [ "$all" = 1 ] && echo "cid-\${svc:-all}" ;;
    esac
    exit 0 ;;
esac
exit 0
`
    );
    chmodSync(path.join(bin, 'docker'), 0o755);
    writeFileSync(
      path.join(bin, 'systemctl'),
      `#!/usr/bin/env bash
echo "systemctl $*" >>"$CALLS"
if [ "$1" = is-active ]; then u="\${@: -1}"; [ "$u" = "$ACTIVE_UNIT" ] && exit 0; exit 3; fi
exit 0
`
    );
    chmodSync(path.join(bin, 'systemctl'), 0o755);
    const sys = systemd ? 'have_systemd() { return 0; }\n' : 'have_systemd() { return 1; }\n';
    const r = bash(`export PATH="$BIN:$PATH"\n${lib}\n${sys}${body}\n`, {
      BIN: posix(bin),
      CALLS: posix(calls),
      DOCKER_MODE: mode,
      ACTIVE_UNIT: activeUnit,
    });
    return { ...r, calls: readFileSync(calls, 'utf8') };
  }

  test('no container of the live project: STACK is units and the helpers run the same systemctl commands as before', () => {
    const r = run('none', 'use_stack "stage X"; echo "STACK=$STACK"; svc_stop gm-browser; svc_start foundry; svc_restart bridge; svc_try_restart dashboard');
    assert.match(r.stdout, /STACK=units/);
    assert.match(r.calls, /systemctl stop foundry-ai-tool-gm-browser\.service/);
    assert.match(r.calls, /systemctl start foundry\.service/);
    assert.match(r.calls, /systemctl restart foundry-ai-tool-bridge\.service/);
    assert.match(r.calls, /systemctl try-restart foundry-ai-tool-dashboard\.service/);
    assert.doesNotMatch(r.calls, /docker (stop|start|restart)/);
  });
  test('docker not installed: units', () => {
    const r = run('none', 'command() { if [ "$1" = -v ] && [ "$2" = docker ]; then return 1; fi; builtin command "$@"; }\nuse_stack "stage X"; echo "STACK=$STACK"');
    assert.match(r.stdout, /STACK=units/);
  });
  test('a container of the live project: STACK is containers and the helpers act on the existing container', () => {
    const r = run('live', 'use_stack "stage X"; echo "STACK=$STACK"; svc_stop foundry; svc_start foundry; svc_restart bridge; svc_try_restart dashboard; svc_active gm-browser && echo active');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /STACK=containers/);
    assert.match(r.stdout, /active/);
    assert.match(r.calls, /docker stop cid-foundry/);
    assert.match(r.calls, /docker start cid-foundry/);
    assert.match(r.calls, /docker restart cid-bridge/);
    assert.match(r.calls, /docker restart cid-dashboard/);
    assert.doesNotMatch(r.calls, /systemctl (start|stop|restart|try-restart)/);
    assert.doesNotMatch(r.calls, /docker (rm|compose|run)/);
  });
  test('a stopped container still means containers; svc_start starts it and svc_stop leaves it', () => {
    const r = run('stopped', 'use_stack "stage X"; echo "STACK=$STACK"; svc_stop foundry; svc_start foundry; svc_wanted gm-browser && echo wanted; svc_active gm-browser || echo notactive');
    assert.match(r.stdout, /STACK=containers/);
    assert.match(r.stdout, /wanted/);
    assert.match(r.stdout, /notactive/);
    assert.match(r.calls, /docker start cid-foundry/);
    assert.doesNotMatch(r.calls, /docker stop/);
  });
  test('a silent Docker daemon refuses (unknown), FORCE=1 does not change that', () => {
    const r = run('down', 'FORCE=1; use_stack "stage X"; echo passed', { systemd: false });
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /passed/);
    assert.match(r.stderr, /does not answer.*stage X is refused/);
  });
  test('a unit running next to the containers is a mixed state: refused', () => {
    const r = run('live', 'use_stack "stage X"; echo passed', { activeUnit: 'foundry.service' });
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /passed/);
    assert.match(r.stderr, /foundry\.service runs next to the containers.*mixed state/);
  });
  test('a silent Docker daemon is not "no container": svc_stop on containers fails and says so', () => {
    const r = run('live', 'use_stack "x"; DOCKER_MODE=down; export DOCKER_MODE; svc_stop foundry || echo "rc=$?"');
    assert.match(r.stdout, /rc=1/);
    assert.doesNotMatch(r.calls, /docker stop/);
    assert.match(r.stderr, /does not answer/);
  });

  test('svc_start of a service with no container is an error, not a silent success', () => {
    const r = run('none', 'use_stack "x"; STACK=containers; svc_start foundry || echo "rc=$?"');
    assert.match(r.stdout, /rc=1/);
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
  '35-who-uses-what.sh': 'its own oneshot service and timer only; the report reads the dashboard, which a cut-over stack still serves on its port',
  'set-discord-token.sh': 'restarts the Discord bot unit only; the bot is not a container',
  'set-tunnel-token.sh': 'restarts the cloudflared unit only; not part of the stack',
};

const stageFiles = readdirSync(remote)
  .filter(f => f.endsWith('.sh') && f !== 'lib.sh' && f !== 'lib-gm-passwords.sh')
  .sort();
const codeLines = text => text.split('\n').map((line, i) => ({ line, n: i + 1 })).filter(l => !/^\s*#/.test(l.line));
const MUTATING = /\benable_unit\b|\bsystemctl\s+(?:--\S+\s+)*(?:start|restart|try-restart|reload-or-restart|enable)\b/;
// A stage is guarded by refuse_when_cut_over (it refuses on a cut-over Pi) or by use_stack (day two, D-149: it works on the
// containers through the svc_* helpers of lib.sh).
const GUARD = /^\s*(?:refuse_when_cut_over|use_stack)\s+"/;
const USE_STACK = /^\s*use_stack\s+"/;
// A use_stack stage reaches the four stack services only through svc_*: a direct systemctl start, stop, restart or
// try-restart of foundry.service, the bridge, the dashboard or the Assistant GM would act on a unit while the containers run.
const RAW_STACK_UNIT =
  /\bsystemctl\s+(?:--\S+\s+)*(?:start|stop|restart|try-restart|reload-or-restart)\s+(?:--\S+\s+)*(?:foundry\.service|foundry-ai-tool-(?:bridge|dashboard|gm-browser)\.service|"?\$(?:\{?(?:gm_unit|GM_UNIT|dashboard_unit)\}?)"?)/;

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

  test('a stage that calls use_stack drives the stack services through svc_*, not systemctl on their units', () => {
    const users = stageFiles.filter(f => codeLines(readFileSync(path.join(remote, f), 'utf8')).some(l => USE_STACK.test(l.line)));
    assert.deepEqual(
      users,
      ['21-player-vault.sh', '25-modules.sh', '5-tool.sh', 'kit-session.sh', 'switch-world.sh'],
      'the day-two stages (D-149)'
    );
    for (const f of users) {
      const raw = codeLines(readFileSync(path.join(remote, f), 'utf8')).filter(l => RAW_STACK_UNIT.test(l.line));
      assert.deepEqual(
        raw.map(l => `${f}:${l.n}: ${l.line.trim()}`),
        [],
        `${f} calls systemctl on a stack unit directly: use svc_start, svc_stop, svc_restart or svc_try_restart (lib.sh)`
      );
    }
  });

  test('only the use_stack stages and lib.sh call stack_docker or stack_compose, with the allowed verbs', () => {
    const allowed = new Set(['lib.sh', '21-player-vault.sh', '25-modules.sh', '5-tool.sh', 'kit-session.sh', 'switch-world.sh']);
    const files = readdirSync(remote).filter(f => f.endsWith('.sh'));
    const verbs = /\bstack_docker\s+(\S+)/g;
    const found = new Map();
    for (const f of files) {
      const text = codeLines(readFileSync(path.join(remote, f), 'utf8')).map(l => l.line).join('\n');
      const hits = [...text.matchAll(/\bstack_(?:docker|compose)\b/g)];
      if (hits.length && !allowed.has(f)) assert.fail(`${f} uses stack_docker or stack_compose: only the use_stack stages and lib.sh may (the guard hides their verbs)`);
      for (const m of text.matchAll(verbs)) found.set(m[1], (found.get(m[1]) ?? 0) + 1);
      assert.doesNotMatch(text, /\bstack_compose\b[^\n]*\b(?:down|kill)\b/, `${f}: stack_compose down or kill is stage 24's, with its own checks`);
    }
    for (const verb of found.keys()) assert.ok(['stop', 'start', 'restart', 'rm', 'run', 'logs', 'inspect'].includes(verb) || verb.startsWith('-'), `stack_docker ${verb}`);
  });

  test('the Kit GM hint never tells the operator to run a bare docker inspect (it prints the password)', () => {
    const text = readFileSync(path.join(remote, 'kit-session.sh'), 'utf8');
    assert.doesNotMatch(text, /echo "docker inspect \$KIT_GM_UNIT"/);
  });

  test('the nightly backup subtracts the Kit GM container like lib.sh does', () => {
    const backup = readFileSync(path.join(remote, '6-backup.sh'), 'utf8');
    assert.match(backup, /kit_gm_container_joined/);
    assert.match(backup, /\$stack" = containers \] && \[ "\$users" -gt 0 \] && kit_gm_container_joined/);
  });

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
