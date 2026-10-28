// Tests for Pi stage 17 (scripts/pi/remote/17-gh-runner.sh, backlog board-local-deploy):
//   node --test scripts/pi/gh-runner.test.mjs
// - the gate script (the stage's GATE_SCRIPT_BODY heredoc) in bash with stand-ins for systemctl and pgrep: idle starts
//   the runners, a marked play session stops them (a runner with a job is left alone), unknown holds them up to the
//   ceiling, a stale or ended session counts as idle;
// - the stage and the PC helper as text: the token never reaches a command line or output, the runner is pinned.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const remote = path.join(repo, 'scripts', 'pi', 'remote');
const stage = readFileSync(path.join(remote, '17-gh-runner.sh'), 'utf8');
const helper = readFileSync(path.join(remote, 'put-runner-token.sh'), 'utf8');
const posix = p => p.replace(/\\/g, '/');
const gate = /<<'GATE_SCRIPT_BODY'\n([\s\S]*?)\nGATE_SCRIPT_BODY\n/.exec(stage)?.[1];
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;

const roots = [];
after(() => roots.forEach(d => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'gh-runner-'));
  roots.push(d);
  return d;
};

const NOW = Date.parse('2026-11-15T20:00:00Z');
const marker = (type, ms) =>
  JSON.stringify({
    id: 'm',
    timestamp: new Date(ms).toISOString(),
    timestampMs: ms,
    eventType: type,
    details: { source: 'mark-play-session' },
  });
const hours = h => h * 3600_000;

// A fake Pi folder: a vault with the given session logs, a systemctl that records calls and knows which units run,
// and a pgrep that says which runner has a job.
function fakePi({ logs = {}, vault = true, active = [], busy = [] } = {}) {
  const d = tmp();
  const bin = path.join(d, 'bin');
  mkdirSync(bin);
  if (vault) {
    mkdirSync(path.join(d, 'vault'));
    for (const [world, files] of Object.entries(logs)) {
      mkdirSync(path.join(d, 'vault', world, 'sessions'), { recursive: true });
      for (const [file, lines] of Object.entries(files)) {
        const f = path.join(d, 'vault', world, 'sessions', file);
        writeFileSync(f, lines.join('\n') + '\n');
        utimesSync(f, (NOW - hours(1)) / 1000, (NOW - hours(1)) / 1000); // the fake clock is NOW
      }
    }
  }
  // `active` entries are "unit" or "unit=activating"; `busy` lists units whose cgroup holds a Runner.Worker. The cgroup
  // and /proc are fake folders: every active unit has a Runner.Listener process, a busy one also a Runner.Worker.
  const states = Object.fromEntries(
    active.map(a => a.split('=')).map(([u, s]) => [u, s || 'active'])
  );
  let pid = 1000;
  for (const u of active.map(a => a.split('=')[0])) {
    const cg = path.join(d, 'cg', 'system.slice', u);
    mkdirSync(cg, { recursive: true });
    const pids = [`${pid++}:Runner.Listener`];
    if (busy.includes(u)) pids.push(`${pid++}:Runner.Worker`);
    writeFileSync(path.join(cg, 'cgroup.procs'), pids.map(p => p.split(':')[0]).join('\n') + '\n');
    for (const p of pids) {
      const [n, comm] = p.split(':');
      mkdirSync(path.join(d, 'proc', n), { recursive: true });
      writeFileSync(path.join(d, 'proc', n, 'comm'), comm + '\n');
    }
  }
  const stateCase = Object.entries(states)
    .map(([u, s]) => `${u}) echo ${s}; exit 0 ;;`)
    .join(' ');
  writeFileSync(
    path.join(bin, 'systemctl'),
    `#!/usr/bin/env bash\necho "systemctl $*" >>"${posix(d)}/calls"\ncase "$1" in\n  is-active) case "\${@: -1}" in ${stateCase} esac; echo inactive; exit 3 ;;\n  show) echo "/system.slice/\${@: -1}" ;;\nesac\nexit 0\n`
  );
  chmodSync(path.join(bin, 'systemctl'), 0o755);
  writeFileSync(path.join(d, 'gate.sh'), gate);
  return d;
}

const UNITS = 'foundry-ai-tool-gh-runner-vault.service foundry-ai-tool-gh-runner-board.service';
function runGate(d, env = {}) {
  const r = spawnSync('bash', [posix(path.join(d, 'gate.sh'))], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${posix(path.join(d, 'bin'))}:${process.env.PATH}`,
      GATE_VAULT_ROOT: posix(path.join(d, 'vault')),
      GATE_STATE_DIR: posix(path.join(d, 'state')),
      GATE_NODE: posix(process.execPath),
      GATE_NOW_MS: String(NOW),
      GATE_CGROUP_ROOT: posix(path.join(d, 'cg')),
      GATE_PROC_ROOT: posix(path.join(d, 'proc')),
      GATE_UNITS: UNITS,
      ...env,
    },
  });
  let calls = '';
  try {
    calls = readFileSync(path.join(d, 'calls'), 'utf8');
  } catch {}
  return { status: r.status, out: `${r.stdout}${r.stderr}`, calls };
}
const dry = (d, env) => runGate(d, { GATE_DRY: '1', ...env }).out.trim();

describe('the gate', { skip: !hasBash && 'no bash here' }, () => {
  test('the heredoc was found', () => assert.ok(gate && gate.includes('session-start')));

  test('no session marker at all is idle and starts both stopped runners', () => {
    const d = fakePi({ logs: { w: { '2026-11-14.jsonl': [] } } });
    const r = runGate(d);
    assert.equal(r.status, 0, r.out);
    assert.match(r.calls, /start foundry-ai-tool-gh-runner-vault\.service/);
    assert.match(r.calls, /start foundry-ai-tool-gh-runner-board\.service/);
  });

  test('a running runner is not started again when idle', () => {
    const d = fakePi({ logs: {}, active: UNITS.split(' ') });
    assert.doesNotMatch(runGate(d).calls, /start /);
  });

  test('an open session stops the runners that run no job', () => {
    const d = fakePi({
      logs: { w: { '2026-11-15.jsonl': [marker('session-start', NOW - hours(2))] } },
      active: UNITS.split(' '),
    });
    const r = runGate(d);
    assert.match(r.calls, /stop foundry-ai-tool-gh-runner-vault\.service/);
    assert.match(r.calls, /stop foundry-ai-tool-gh-runner-board\.service/);
    assert.equal(dry(d), 'state=playing decision=playing');
  });

  test('an open session leaves a runner with a job alone', () => {
    const d = fakePi({
      logs: { w: { '2026-11-15.jsonl': [marker('session-start', NOW - hours(2))] } },
      active: UNITS.split(' '),
      busy: ['foundry-ai-tool-gh-runner-vault.service'],
    });
    const r = runGate(d);
    assert.doesNotMatch(r.calls, /stop foundry-ai-tool-gh-runner-vault/);
    assert.match(r.calls, /stop foundry-ai-tool-gh-runner-board\.service/);
    assert.match(r.out, /runs a job, left alone/);
  });

  test('a runner waiting out its restart delay (activating) is stopped during a session, and not started when idle', () => {
    const activating = ['foundry-ai-tool-gh-runner-vault.service=activating'];
    const playing = fakePi({
      logs: { w: { '2026-11-15.jsonl': [marker('session-start', NOW - hours(2))] } },
      active: activating,
    });
    assert.match(runGate(playing).calls, /stop foundry-ai-tool-gh-runner-vault\.service/);
    const idle = fakePi({ logs: {}, active: activating });
    assert.doesNotMatch(runGate(idle).calls, /start foundry-ai-tool-gh-runner-vault/);
  });

  test('a failing start of one runner does not hide the other, and the gate exits non-zero', () => {
    const d = fakePi({ logs: {} });
    writeFileSync(
      path.join(d, 'bin', 'systemctl'),
      `#!/usr/bin/env bash\necho "systemctl $*" >>"${posix(d)}/calls"\ncase "$1" in is-active) echo inactive; exit 3 ;; start) case "$2" in *vault*) exit 1 ;; esac ;; esac\nexit 0\n`
    );
    const r = runGate(d);
    assert.notEqual(r.status, 0);
    assert.match(r.calls, /start foundry-ai-tool-gh-runner-board\.service/);
    assert.match(r.out, /could not start foundry-ai-tool-gh-runner-vault/);
  });

  test('a session that crosses midnight (start in one file, end in the next) is idle', () => {
    const d = fakePi({
      logs: {
        w: {
          '2026-11-14.jsonl': [marker('session-start', NOW - hours(6))],
          '2026-11-15.jsonl': [marker('session-end', NOW - hours(1))],
        },
      },
    });
    assert.equal(dry(d), 'state=idle decision=idle');
    const open = fakePi({
      logs: {
        w: {
          '2026-11-14.jsonl': [
            marker('session-end', NOW - hours(9)),
            marker('session-start', NOW - hours(6)),
          ],
          '2026-11-15.jsonl': [],
        },
      },
    });
    assert.equal(dry(open), 'state=playing decision=playing');
  });

  test('an open session does not start a stopped runner', () => {
    const d = fakePi({
      logs: { w: { '2026-11-15.jsonl': [marker('session-start', NOW - hours(1))] } },
    });
    assert.doesNotMatch(runGate(d).calls, /start |stop /);
  });

  test('the last marker wins: a start followed by an end is idle', () => {
    const d = fakePi({
      logs: {
        w: {
          '2026-11-15.jsonl': [
            marker('session-start', NOW - hours(5)),
            marker('session-end', NOW - hours(1)),
          ],
        },
      },
    });
    assert.equal(dry(d), 'state=idle decision=idle');
  });

  test('a start older than 14 hours is stale (idle)', () => {
    const d = fakePi({
      logs: { w: { '2026-11-14.jsonl': [marker('session-start', NOW - hours(15))] } },
    });
    assert.equal(dry(d), 'state=idle decision=idle');
  });

  test('a half-written last line does not decide', () => {
    const d = fakePi({
      logs: {
        w: {
          '2026-11-15.jsonl': [marker('session-start', NOW - hours(1)), '{"eventType":"session-en'],
        },
      },
    });
    assert.equal(dry(d), 'state=playing decision=playing');
  });

  test('any world playing means playing', () => {
    const d = fakePi({
      logs: {
        a: { '2026-11-15.jsonl': [marker('session-end', NOW - hours(1))] },
        b: { '2026-11-15.jsonl': [marker('session-start', NOW - hours(1))] },
      },
    });
    assert.equal(dry(d), 'state=playing decision=playing');
  });

  test('an unreadable vault folder is unknown and holds the runners', () => {
    const d = fakePi({ vault: false, active: UNITS.split(' ') });
    assert.equal(dry(d), 'state=unknown decision=unknown');
    assert.match(runGate(d).calls, /stop foundry-ai-tool-gh-runner-vault\.service/);
  });

  test('unknown for longer than the ceiling lets the runners run again, and says so', () => {
    const d = fakePi({ vault: false });
    assert.equal(dry(d), 'state=unknown decision=unknown');
    const later = runGate(d, { GATE_DRY: '1', GATE_NOW_MS: String(NOW + hours(7)) });
    assert.match(later.out, /state=unknown decision=idle/);
    assert.match(later.out, /unknown for over 6 hours/);
    assert.match(
      runGate(d, { GATE_NOW_MS: String(NOW + hours(7)) }).calls,
      /start foundry-ai-tool-gh-runner-vault\.service/
    );
  });

  test('a known state resets the unknown clock', () => {
    const d = fakePi({ vault: false });
    dry(d);
    mkdirSync(path.join(d, 'vault'));
    assert.equal(dry(d), 'state=idle decision=idle');
    rmSync(path.join(d, 'vault'), { recursive: true });
    const again = runGate(d, { GATE_DRY: '1', GATE_NOW_MS: String(NOW + hours(7)) });
    assert.match(again.out, /state=unknown decision=unknown/);
  });
});

describe('the stage as text', () => {
  test('the runner release is pinned by version and sha256, and checked before it is used', () => {
    assert.match(stage, /^RUNNER_VERSION=\d+\.\d+\.\d+$/m);
    assert.match(stage, /^RUNNER_SHA256=[0-9a-f]{64}$/m);
    assert.ok(stage.indexOf('does not match the pinned sha256') < stage.indexOf('tar -xzf'));
  });

  test('every check comes before the first write', () => {
    const firstWrite = stage.indexOf('useradd');
    for (const needle of ['require_recent_snapshot', 'is missing: run stage', '.reg"']) {
      assert.ok(stage.indexOf(needle) < firstWrite, needle);
    }
    assert.match(stage, /stat -c '%u %a' "\$reg"\)" = "0 600"/);
  });

  test('the token goes in through the environment, is never echoed, and the file is deleted', () => {
    assert.match(stage, /ACTIONS_RUNNER_INPUT_TOKEN="\$\(cat "\$reg"\)"/);
    assert.doesNotMatch(stage, /--token/);
    assert.doesNotMatch(stage, /(echo|printf|say|ok|warn|die)[^\n]*\$\(cat "\$reg"\)/);
    assert.match(stage, /rm -f "\$\{reg:\?\}"/);
  });

  test('every rm -rf uses ${var:?} and the runner never runs as root', () => {
    for (const line of stage.split('\n').filter(l => /rm -[a-z]*r/.test(l)))
      assert.match(line, /\$\{[a-z_]+:\?\}/, line);
    assert.match(stage, /runuser -u "\$RUNNER_USER" -- env [^\n]*"\$dir\/config\.sh"/);
    assert.match(stage, /^User=\$RUNNER_USER$/m);
  });

  test('the units fence the runner from the live game', () => {
    for (const needle of [
      'NoNewPrivileges=true',
      'ProtectSystem=strict',
      'ReadWritePaths=$dir',
      'IPAddressDeny=$IP_DENY',
      'IPAddressAllow=$ALLOW',
      'fe80::/10 ::/0"',
      'the control probe',
      'ProtectProc=invisible',
      'IP_DENY="127.0.0.0/8',
      '100.64.0.0/10',
      '192.168.0.0/16',
      'must NOT reach sshd',
      'MemoryMax=',
      'InaccessiblePaths=-/etc/foundry-ai-tool -/var/lib/foundry -/var/lib/foundry-ai-tool',
    ]) {
      assert.ok(stage.includes(needle), needle);
    }
    // not enabled at boot: only the gate starts a runner
    assert.doesNotMatch(stage, /enable_unit foundry-ai-tool-gh-runner-\$/);
  });

  test('the stage does not stop or restart Foundry or its services', () => {
    assert.doesNotMatch(
      stage,
      /systemctl (stop|restart)[^\n]*foundry(\.service|-ai-tool-(bridge|dashboard|gm|discord))/
    );
  });

  test('the PC helper pipes the token and prints none', () => {
    assert.match(helper, /\| *\n? *ssh foundry-pi/);
    assert.match(helper, /--jq \.token/);
    assert.doesNotMatch(helper, /(echo|printf)[^\n]*\$\(?(token|TOKEN)/);
    assert.match(helper, /chmod 600/);
  });
});
