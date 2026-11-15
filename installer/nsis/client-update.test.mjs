// Checks for installer/nsis/client-update.ps1 (item client-autoupdate, layer 3).
//   node --test installer/nsis/client-update.test.mjs
// Source checks run everywhere. The behaviour tests need Windows PowerShell and the .NET compiler, so
// they run on Windows only: a local HTTP server stands in for the GitHub release page and a tiny
// compiled exe stands in for the installer, all in a throwaway folder (never a real install).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, test, before, after } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'client-update.ps1');
const src = readFileSync(script, 'utf8');
const tunnelSrc = readFileSync(path.join(here, 'tunnel-client.ps1'), 'utf8');

describe('client-update.ps1 source', () => {
  test('is off unless the flag file exists, and never touches the token', () => {
    assert.match(src, /autoupdate\.on/);
    assert.ok(src.indexOf('Test-Path -LiteralPath $flagPath') < src.indexOf('$installed = Get-InstalledVersion'));
    assert.ok(!/token\.dpapi|Read-Token|TUNNELTOKENFILE|-TokenFile/.test(src.replace(/#.*$/gm, '').replace(/<#[\s\S]*?#>/, '')), 'no token handling');
  });
  test('checks the hash before it runs the installer, and Claude Desktop before and after the download', () => {
    const hash = src.indexOf('Get-FileHash');
    const run = src.indexOf('Start-Process -FilePath $exe');
    assert.ok(hash > 0 && run > hash);
    assert.equal(src.split('Test-ClaudeRunning)').length - 1, 2);
  });
  test('the logon task script starts it only when the flag exists', () => {
    assert.match(tunnelSrc, /autoupdate\.on[\s\S]*client-update\.ps1/);
  });
  test('the installer ships and removes it', () => {
    const nsi = readFileSync(path.join(here, 'foundry-mcp-server.nsi'), 'utf8');
    assert.match(nsi, /File "client-update\.ps1"/);
    assert.ok(nsi.split('client-update.ps1"').length - 1 >= 3);
    assert.match(readFileSync(path.join(here, '..', 'build-nsis.js'), 'utf8'), /'client-update\.ps1'/);
  });
});

const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const canRun = process.platform === 'win32' && existsSync(csc);

describe('client-update.ps1 behaviour', { skip: !canRun && 'needs Windows and csc.exe' }, () => {
  let root, server, port, fakeExe, exeBytes;
  let sumsLine = null; // what the server answers for SHA256SUMS.txt

  before(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'client-update-test-'));
    const cs = path.join(root, 'fake.cs');
    writeFileSync(
      cs,
      `using System; using System.IO;
class P { static int Main(string[] a) {
  string d = ""; foreach (var x in a) if (x.StartsWith("/D=")) d = x.Substring(3);
  File.WriteAllText(Path.Combine(d, "args.txt"), string.Join(" ", a));
  File.WriteAllText(Path.Combine(d, "sentinel.txt"), "new");
  return int.Parse(Environment.GetEnvironmentVariable("FAKE_EXIT") ?? "0"); } }`
    );
    fakeExe = path.join(root, 'fake.exe');
    const r = spawnSync(csc, ['/nologo', `/out:${fakeExe}`, cs], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    exeBytes = readFileSync(fakeExe);
    server = http.createServer((req, res) => {
      if (req.url === '/v0.29.1/FoundryMCPServer-Setup-v0.29.1.exe') return res.end(exeBytes);
      if (req.url === '/v0.29.1/SHA256SUMS.txt') return res.end(sumsLine ?? '');
      res.statusCode = 404;
      res.end();
    });
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    port = server.address().port;
  });
  after(() => {
    server?.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  // A fresh install folder with a state folder under it, like the real layout.
  function fresh(name, { flag = true } = {}) {
    const inst = path.join(root, name);
    const state = path.join(inst, 'tunnel');
    mkdirSync(state, { recursive: true });
    writeFileSync(path.join(inst, 'sentinel.txt'), 'old');
    writeFileSync(path.join(state, 'token.dpapi'), 'TOKEN-BYTES');
    writeFileSync(path.join(state, 'tunnel.json'), JSON.stringify({ host: 'mcp.example.com', port: 31999 }));
    if (flag) writeFileSync(path.join(state, 'autoupdate.on'), 'on');
    return { inst, state };
  }

  function run({ inst, state }, extra = [], env = {}, installed = '0.29.0') {
    return new Promise(resolve => {
      const p = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'Check',
          '-StateDir', state, '-InstallDir', inst, '-ReleaseBase', `http://127.0.0.1:${port}`, '-InstalledVersion', installed,
          '-PiVersion', '0.29.1', ...extra],
        { env: { ...process.env, ...env }, windowsHide: true }
      );
      let out = '';
      p.stdout.on('data', d => (out += d));
      p.stderr.on('data', d => (out += d));
      p.on('close', code => resolve({ code, out }));
    });
  }
  const status = ({ state }) => JSON.parse(readFileSync(path.join(state, 'update-status.json'), 'utf8').replace(/^\uFEFF/, ''));
  const goodSums = () => `${createHash('sha256').update(exeBytes).digest('hex')}  FoundryMCPServer-Setup-v0.29.1.exe\n`;

  test('off by default: no flag, no log, nothing run', async () => {
    const d = fresh('off', { flag: false });
    const r = await run(d);
    assert.equal(r.code, 0);
    assert.ok(!existsSync(path.join(d.state, 'update.log')));
    assert.ok(!existsSync(path.join(d.inst, 'args.txt')));
  });

  test('already current: nothing downloaded', async () => {
    const d = fresh('current');
    const r = await run(d, [], {}, '0.29.1');
    assert.equal(r.code, 0);
    assert.equal(status(d).result, 'current');
    assert.ok(!existsSync(path.join(d.inst, 'args.txt')));
  });

  test('Claude Desktop running: skipped', async () => {
    const d = fresh('running');
    sumsLine = goodSums();
    const r = await run(d, ['-ClaudeProcess', 'node']); // this test process is a node.exe
    assert.equal(r.code, 0);
    assert.equal(status(d).result, 'skipped');
    assert.ok(!existsSync(path.join(d.inst, 'args.txt')));
  });

  test('wrong checksum: failed, installer never runs', async () => {
    const d = fresh('badsum');
    sumsLine = `${'0'.repeat(64)}  FoundryMCPServer-Setup-v0.29.1.exe\n`;
    const r = await run(d, ['-ClaudeProcess', 'NoSuchProcessXyz']);
    assert.equal(r.code, 1);
    assert.equal(status(d).result, 'failed');
    assert.ok(!existsSync(path.join(d.inst, 'args.txt')));
    assert.equal(readFileSync(path.join(d.inst, 'sentinel.txt'), 'utf8'), 'old');
  });

  test('good checksum: installer runs silently with tunnel and port, token untouched', async () => {
    const d = fresh('ok');
    sumsLine = goodSums();
    const r = await run(d, ['-ClaudeProcess', 'NoSuchProcessXyz']);
    assert.equal(r.code, 0, r.out);
    assert.equal(status(d).result, 'updated');
    const args = readFileSync(path.join(d.inst, 'args.txt'), 'utf8');
    assert.match(args, /^\/S \/TUNNEL=mcp\.example\.com \/PORT=31999 \/D=/);
    assert.ok(!/TOKEN/i.test(args), 'no token argument');
    assert.equal(readFileSync(path.join(d.state, 'token.dpapi'), 'utf8'), 'TOKEN-BYTES');
  });

  test('installer fails: the old files are put back', async () => {
    const d = fresh('restore');
    sumsLine = goodSums();
    const r = await run(d, ['-ClaudeProcess', 'NoSuchProcessXyz'], { FAKE_EXIT: '1' });
    assert.equal(r.code, 1);
    assert.equal(status(d).result, 'failed');
    assert.equal(readFileSync(path.join(d.inst, 'sentinel.txt'), 'utf8'), 'old');
    assert.equal(readFileSync(path.join(d.state, 'token.dpapi'), 'utf8'), 'TOKEN-BYTES');
  });

  test('installer exit 4 (bridge did not answer yet) counts as updated, not rolled back', async () => {
    const d = fresh('exit4');
    sumsLine = goodSums();
    const r = await run(d, ['-ClaudeProcess', 'NoSuchProcessXyz'], { FAKE_EXIT: '4' });
    assert.equal(r.code, 0, r.out);
    assert.equal(status(d).result, 'updated');
  });
});
