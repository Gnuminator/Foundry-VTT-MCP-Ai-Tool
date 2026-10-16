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
});
