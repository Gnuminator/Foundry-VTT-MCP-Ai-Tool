import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const stage9 = readFileSync(path.join(here, 'remote', '9-ssh-log.sh'), 'utf8');

const bash = (args, opts = {}) => spawnSync('bash', args, { encoding: 'utf8', ...opts });
const hasBash = bash(['-c', 'echo ok']).stdout?.trim() === 'ok';

// Build the wrapper exactly as stage 9 writes it: evaluate the wrapper_body assignment with a temp log dir.
function buildWrapper(dir) {
  const start = stage9.indexOf('runner_tpl="');
  const end = stage9.indexOf('esac"', start) + 'esac"'.length;
  assert.ok(start > 0 && end > start);
  const logDir = path.join(dir, 'log').replace(/\\/g, '/');
  const script = `wrapper=/usr/local/sbin/foundry-ssh-log\nlog_dir='${logDir}'\n${stage9.slice(start, end)}\nprintf '%s\\n' "$wrapper_body"\n`;
  const gen = bash(['-c', script]);
  assert.equal(gen.status, 0, gen.stderr);
  const file = path.join(dir, 'wrapper.sh');
  writeFileSync(file, gen.stdout);
  const syntax = bash(['-n', file]);
  assert.equal(syntax.status, 0, syntax.stderr);
  return { file, logDir };
}

function run(dir, cmd, input = '', shell = bash(['-c', 'command -v bash']).stdout.trim()) {
  const { file, logDir } = buildWrapper(dir);
  spawnSync('bash', ['-c', `mkdir -p '${logDir}/scripts'`]);
  const r = bash([file], {
    input,
    env: { ...process.env, SSH_ORIGINAL_COMMAND: cmd, SSH_CLIENT: '1.2.3.4 1 2', SHELL: shell },
  });
  const logFile = path.join(logDir, 'ssh-commands.log');
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  const saved = existsSync(path.join(logDir, 'scripts')) ? readdirSync(path.join(logDir, 'scripts')) : [];
  return { r, log, saved };
}

// The command put-runner-token.sh sends for runner `name`, minus the ssh quoting (what the Pi receives).
// The sandbox path is swapped for a temp file so running it here touches nothing real.
function runnerCmd(name) {
  return `set -e; umask 077; f=/etc/foundry-ai-tool/gh-runner-${name}.reg; t=$f.tmp; trap 'rm -f "$t"' EXIT; cat > "$t"; [ "$(wc -c < "$t")" -ge 20 ]; chown root:root "$t"; chmod 600 "$t"; mv -f "$t" "$f"`;
}

test(
  'token script commands are logged by kind, without their text, and still run',
  { skip: !hasBash },
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sshlog-'));
    for (const [cmd, kind] of [
      ['bash -s -- no-log', 'Discord token'],
      ['FORCE=1 bash -s -- no-log', 'Discord token'],
      ['bash /tmp/set-tunnel-token.sh', 'set-tunnel-token'],
      ['bash /tmp/set-dashboard-access.sh', 'set-dashboard-access'],
      ['FORCE=1 bash /tmp/set-dashboard-access.sh', 'set-dashboard-access'],
      [runnerCmd('vault'), 'runner token file'],
      [runnerCmd('board'), 'runner token file'],
    ]) {
      const { r, log, saved } = run(dir, cmd, 'echo ran\n');
      assert.ok(log.includes('command text not saved'), `${cmd}: ${log}`);
      assert.ok(log.includes(kind), `${cmd}: ${log}`);
      assert.ok(!log.includes('SECRETAUD') && !log.includes('FORCE=1'), `${cmd}: text leaked: ${log}`);
      assert.deepEqual(saved, [], 'input is never saved');
      assert.equal(typeof r.status, 'number');
    }
  }
);

test('the exact token commands reach the shell unchanged, exit 0, with the right label', { skip: !hasBash }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sshlog-'));
  const seen = path.join(dir, 'seen.txt').replace(/\\/g, '/');
  const fake = path.join(dir, 'fake-shell.sh');
  writeFileSync(fake, `#!/bin/bash\nprintf '%s' "$2" >'${seen}'\necho shell-ran\n`, { mode: 0o755 });
  const fakeShell = fake.replace(/\\/g, '/');
  for (const [cmd, kind] of [
    ['bash -s -- no-log', 'Discord token'],
    ['bash /tmp/set-tunnel-token.sh', 'set-tunnel-token'],
    ['bash /tmp/set-dashboard-access.sh', 'set-dashboard-access'],
    ['FORCE=1 bash /tmp/set-dashboard-access.sh', 'set-dashboard-access'],
    [runnerCmd('vault'), 'runner token file'],
    [runnerCmd('board'), 'runner token file'],
  ]) {
    const { r, log } = run(dir, cmd, '', fakeShell);
    assert.equal(r.status, 0, `${cmd}: ${r.stderr}`);
    assert.match(r.stdout, /shell-ran/);
    assert.equal(readFileSync(seen, 'utf8'), cmd, 'the command is passed on unchanged');
    assert.ok(log.includes(`${kind}`) && log.includes('command text not saved'), `${cmd}: ${log}`);
  }
});

test('a token command with anything appended is not treated as one and keeps its text', { skip: !hasBash }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sshlog-'));
  const tails = ['; echo x', ' && echo x', ' | cat', ' `id`', ' $(id)', '\necho x', ' --aud A'];
  for (const base of ['bash /tmp/set-dashboard-access.sh', 'bash /tmp/set-tunnel-token.sh', runnerCmd('vault')]) {
    for (const tail of tails) {
      const cmd = base + tail;
      const { log } = run(dir, cmd);
      assert.ok(!log.includes('command text not saved'), `${JSON.stringify(cmd)}: ${log}`);
    }
  }
  // a runner command for another name is not one of the two exact commands either
  assert.ok(!run(dir, runnerCmd('other')).log.includes('command text not saved'));
});

test('any other command keeps its text, even with no-log or a token script name in it', { skip: !hasBash }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sshlog-'));
  for (const cmd of ['echo hi # no-log', 'cat /tmp/set-tunnel-token.sh', 'ls /etc/foundry-ai-tool/gh-runner-vault.reg']) {
    const { log } = run(dir, cmd);
    assert.ok(log.includes(`run: ${cmd}`), `${cmd}: ${log}`);
  }
});

test('the command still runs unchanged and a stage script is still saved', { skip: !hasBash }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sshlog-'));
  const echo = run(dir, 'echo hello; exit 3');
  assert.equal(echo.r.status, 3);
  assert.match(echo.r.stdout, /hello/);
  const stage = run(dir, 'bash -s', 'echo staged\n');
  assert.match(stage.r.stdout, /staged/);
  assert.equal(stage.saved.length, 1);
});
