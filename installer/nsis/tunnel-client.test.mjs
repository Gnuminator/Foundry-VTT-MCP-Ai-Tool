// Source checks for installer/nsis/tunnel-client.ps1 (D-095; the three lows of the PR #344 round 2 review).
//   node --test installer/nsis/tunnel-client.test.mjs
// The script needs Windows PowerShell and a real or fake cloudflared, so CI (Linux) only reads it: the
// order of the steps in -Action Install and the shape of the -NoTask start. The behaviour itself was run by
// hand against a fake cloudflared (see the PR description).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, 'tunnel-client.ps1'), 'utf8').replace(/\r\n/g, '\n');

// The text of the Install branch of the action switch.
const install = (() => {
  const from = src.indexOf("  'Install' {");
  const to = src.indexOf("  'Uninstall' {");
  assert.ok(from > 0 && to > from, 'the Install and Uninstall branches moved');
  return src.slice(from, to);
})();

describe('tunnel-client.ps1 Install', () => {
  test('L1: the old tunnel is stopped before tunnel.json is overwritten', () => {
    const stop = install.indexOf('Stop-Tunnel $TunnelHost $Port');
    const write = install.indexOf('Set-Content -LiteralPath $configPath');
    assert.ok(stop > 0, 'Install must stop the tunnel');
    assert.ok(write > 0, 'Install must write tunnel.json');
    assert.ok(stop < write, 'Stop-Tunnel has to read the old host and port before the new config replaces them');
    assert.equal(install.split('Stop-Tunnel $TunnelHost $Port').length - 1, 1, 'one Stop-Tunnel call in Install');
  });

  test('the register-failure text claims the old tunnel was stopped only when -NoStart is off', () => {
    const line = install.split(/\r?\n/).find(l => l.includes('could not register the task'));
    assert.ok(line, 'the register failure message moved');
    // Stop-Tunnel runs only when -not $NoStart, so only that branch may say the old tunnel was stopped.
    assert.match(
      line,
      /\$\(if \(\$NoStart\) \{ '[^']*' \} else \{ '[^']*the old tunnel was stopped[^']*' \}\)/,
      'the "old tunnel was stopped" claim has to sit in the else branch of an $NoStart check',
    );
    assert.equal(line.split('the old tunnel was stopped').length - 1, 1, 'the claim appears once, inside that branch');
  });

  test('L2: waits up to about 3 seconds for the old listener before the port-in-use refusal', () => {
    const wait = install.match(/for \(\$i = 0; \$i -lt (\d+) -and \(Test-PortListening \$Port\); \$i\+\+\) \{ Start-Sleep -Milliseconds (\d+) \}/);
    assert.ok(wait, 'a bounded wait on Test-PortListening');
    const total = Number(wait[1]) * Number(wait[2]);
    assert.ok(total >= 2500 && total <= 4000, `the wait is ${total} ms`);
    assert.ok(install.indexOf(wait[0]) < install.indexOf('is already in use'), 'the wait comes before the refusal');
  });

  test('L3: the -NoTask start passes one quoted argument string, not an array', () => {
    const start = install.match(/Start-Process -FilePath \(Join-Path \$env:SystemRoot [^\n]*\n\s*-ArgumentList ([^\n]*)/);
    assert.ok(start, 'the -NoTask Start-Process call');
    const args = start[1];
    assert.ok(!args.startsWith('@('), 'Windows PowerShell 5.1 joins an array with spaces and does not quote');
    assert.ok(args.includes('-File `"$PSCommandPath`"'), 'the script path is quoted');
    assert.ok(args.includes('-StateDir `"$StateDir`"'), 'the state folder is quoted');
  });

  test('a failing Register-ScheduledTask ends with a Fail line, not the PowerShell error', () => {
    const reg = install.match(/try \{\s*Register-ScheduledTask [\s\S]*?\} catch \{\s*Fail "([^\n]*)"\s*\}/);
    assert.ok(reg, 'Register-ScheduledTask sits in a try with a catch that calls Fail');
    assert.ok(reg[1].includes('$($_.Exception.Message)'), 'the Fail line carries the cause');
  });

  test('a -StateDir ending in a backslash is trimmed after the param block, before any path is built', () => {
    const trim = src.indexOf("$StateDir = $StateDir.TrimEnd('\\')");
    assert.ok(trim > 0, 'StateDir is trimmed');
    assert.ok(trim > src.indexOf('[switch]$NoStart'), 'after the param block');
    assert.ok(trim < src.indexOf('$configPath = Join-Path $StateDir'), 'before $configPath is built');
    assert.ok(src.includes('$StateDir.Length -gt 3'), 'a bare drive root is left alone');
  });

  test('audit L2: the plain-text token file is deleted after the DPAPI copy is written', () => {
    const write = install.indexOf('[System.IO.File]::WriteAllLines($tokenPath');
    const del = install.indexOf('Remove-Item -LiteralPath $TokenFile');
    assert.ok(write > 0 && del > write, 'Remove-Item on the token file comes after the DPAPI write');
    assert.ok(!install.includes('Delete $TokenFile now'), 'no more "delete it yourself" line');
  });

  test('audit L4: a folder others can write to is refused before anything is stored or registered', () => {
    const check = install.indexOf('Get-SharedWriters $f');
    assert.ok(check > 0, 'Install checks the script and cloudflared folders');
    assert.ok(check < install.indexOf('WriteAllLines($tokenPath'), 'before the token is stored');
    assert.ok(check < install.indexOf('Register-ScheduledTask'), 'before the logon task is registered');
    assert.ok(src.includes('catch {') && src.includes('could not be read'), 'an unreadable ACL fails closed');
    assert.match(src, /\[int64\]\$write = 0x500D0046/, 'the mask covers GENERIC_WRITE and GENERIC_ALL');
    const refusal = install.slice(check, install.indexOf('$secretSecure = $null'));
    assert.ok(refusal.includes('Unregister-ScheduledTask'), 'a refusal removes the logon task of an earlier install');
    assert.ok(refusal.indexOf('Unregister-ScheduledTask') < refusal.indexOf('Fail "$f can be changed'), 'before the Fail');
  });

  test('the installer script holds no raw carriage returns (NSIS string escapes must stay $\\r$\\n)', () => {
    const nsi = readFileSync(path.join(here, 'foundry-mcp-server.nsi'), 'utf8');
    assert.ok(!nsi.includes('\r'), 'a raw CR in a MessageBox string breaks makensis');
  });
});
