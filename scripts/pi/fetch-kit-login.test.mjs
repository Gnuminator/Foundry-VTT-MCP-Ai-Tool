// Tests for scripts/pi/fetch-kit-login.ps1 (the Kit GM password fetch of the Pi kit session):
//   node --test scripts/pi/fetch-kit-login.test.mjs
// Needs PowerShell 7; the ssh program is a fake script that records its arguments.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'fetch-kit-login.ps1');
const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']);
const hasPwsh = probe.status === 0 && Number(String(probe.stdout).trim()) >= 7;

const PASSWORD = '0123456789abcdef0123456789abcdef';

let tmp;
before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'fetch-kit-login-'));
  // The fake ssh: prints FAKE_SSH_OUT, exits FAKE_SSH_CODE, appends its arguments to FAKE_SSH_LOG.
  writeFileSync(
    path.join(tmp, 'fake-ssh.ps1'),
    [
      'Add-Content -Path $env:FAKE_SSH_LOG -Value ($args -join " ")',
      'if ($env:FAKE_SSH_OUT) { Write-Output $env:FAKE_SSH_OUT }',
      'exit ([int]($env:FAKE_SSH_CODE ?? 0))',
      '',
    ].join('\n')
  );
});
after(() => rmSync(tmp, { recursive: true, force: true }));

function run(args, env = {}) {
  const log = path.join(tmp, 'ssh.log');
  rmSync(log, { force: true });
  const r = spawnSync(
    'pwsh',
    ['-NoProfile', '-File', script, '-Ssh', path.join(tmp, 'fake-ssh.ps1'), ...args],
    { encoding: 'utf8', env: { ...process.env, FAKE_SSH_LOG: log, ...env } }
  );
  return { ...r, calls: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

describe('fetch-kit-login.ps1', { skip: !hasPwsh && 'PowerShell 7 is not available' }, () => {
  test('writes the password to the file, runs one read-only command and never prints it', () => {
    const dest = path.join(tmp, 'a', 'pw.txt');
    const r = run(['-Destination', dest], { FAKE_SSH_OUT: PASSWORD });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(readFileSync(dest, 'utf8'), PASSWORD);
    assert.ok(!r.stdout.includes(PASSWORD) && !r.stderr.includes(PASSWORD));
    assert.ok(!existsSync(`${dest}.tmp`), 'no temp file is left');
    const lines = r.calls.trim().split(/\r?\n/);
    assert.equal(lines.length, 1);
    assert.ok(
      lines[0].endsWith(
        "foundry-pi sed -n 's/^ASSISTANT_GM_PASSWORD=//p' /var/lib/foundry-ai-tool/kit-gm.env"
      ),
      lines[0]
    );
    assert.ok(!lines[0].includes(PASSWORD));
  });

  test('a wrong answer changes nothing: not hex, empty, or an ssh failure', () => {
    for (const [out, code] of [
      ['not-a-password', '0'],
      ['', '0'],
      [PASSWORD.toUpperCase(), '0'],
      [PASSWORD, '255'],
    ]) {
      const dest = path.join(tmp, `b-${code}-${out.length}`, 'pw.txt');
      const r = run(['-Destination', dest], { FAKE_SSH_OUT: out, FAKE_SSH_CODE: code });
      assert.equal(r.status, 1, `out '${out}' code ${code}`);
      assert.ok(!existsSync(dest));
      assert.ok(!r.stdout.includes(PASSWORD) && !r.stderr.includes(PASSWORD));
    }
  });

  test('a host name with odd characters is refused before ssh runs', () => {
    const dest = path.join(tmp, 'c', 'pw.txt');
    const r = run(['-PiHost', 'foundry-pi;rm', '-Destination', dest], { FAKE_SSH_OUT: PASSWORD });
    assert.equal(r.status, 1);
    assert.equal(r.calls, '');
    assert.ok(!existsSync(dest));
  });

  test('-Remove deletes the file and succeeds when it is not there', () => {
    const dest = path.join(tmp, 'd.txt');
    writeFileSync(dest, PASSWORD);
    let r = run(['-Remove', '-Destination', dest]);
    assert.equal(r.status, 0);
    assert.ok(!existsSync(dest));
    assert.equal(r.calls, '', 'no ssh for -Remove');
    r = run(['-Remove', '-Destination', dest]);
    assert.equal(r.status, 0);
  });
});
