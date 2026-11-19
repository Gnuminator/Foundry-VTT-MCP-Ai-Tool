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
import net from 'node:net';
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
    // one check before the download and one after the checksum, before the backup and the installer
    const before = src.indexOf('if (Test-ClaudeRunning)');
    const download = src.indexOf('Invoke-WebRequest');
    const after = src.indexOf('if (Test-ClaudeRunning)', before + 1);
    assert.ok(before > 0 && before < download, 'checked before the download');
    assert.ok(after > hash && after < run, 'checked again after the checksum, before the installer runs');
  });
  test('Claude Code (claude.exe under .local\\bin, .claude or node_modules) does not count as Claude Desktop', () => {
    assert.match(src, /\$claudeCodePath = .*\.local.*\.claude.*node_modules/);
  });
  test('the logon task logs a failed updater launch', () => {
    assert.match(tunnelSrc, /Win32_Process[\s\S]*ReturnValue -ne 0[\s\S]*Add-Content -LiteralPath \(Join-Path \$StateDir 'update\.log'\)/);
  });
  test('the logon task script starts it only when the flag exists', () => {
    assert.match(tunnelSrc, /autoupdate\.on[\s\S]*client-update\.ps1/);
  });
  test('direct installs: own sign-in task, read-only version read from the configured host, same safety checks', () => {
    assert.match(src, /'Install'[\s\S]*Register-ScheduledTask[\s\S]*'Uninstall'/);
    assert.match(src, /direct\.json/);
    assert.match(src, /\/HOST=\$directHost/);
    // the only control request it ever sends is the read-only wrapper_status
    assert.equal(src.split("Invoke-Control $readHost $port '").length - 1, 1);
    assert.match(src, /Invoke-Control \$readHost \$port 'wrapper_status'/);
    const nsi = readFileSync(path.join(here, 'foundry-mcp-server.nsi'), 'utf8');
    assert.match(nsi, /client-update\.ps1" -Action Install -StateDir "\$INSTDIR\\update"/);
    assert.match(nsi, /\/NOAUTOUPDATE/);
    assert.match(nsi, /update-client-now\.cmd/);
    assert.match(readFileSync(path.join(here, '..', 'build-nsis.js'), 'utf8'), /'update-client-now\.cmd'/);
    assert.match(readFileSync(path.join(here, 'update-client-now.cmd'), 'utf8'), /-Action Check -Now/);
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

  test('no tunnel.json and no direct.json: skipped, nothing downloaded', async () => {
    const d = fresh('noconfig');
    rmSync(path.join(d.state, 'tunnel.json'));
    sumsLine = goodSums();
    const r = await run(d, ['-ClaudeProcess', 'NoSuchProcessXyz']);
    assert.equal(r.code, 0, r.out);
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

  // A direct install: no tunnel.json, a direct.json instead, and the table answered over TCP.
  function freshDirect(name, ctlPort, { flag = true } = {}) {
    const inst = path.join(root, name);
    const state = path.join(inst, 'update');
    mkdirSync(state, { recursive: true });
    writeFileSync(path.join(inst, 'sentinel.txt'), 'old');
    writeFileSync(path.join(state, 'direct.json'), JSON.stringify({ host: '127.0.0.1', port: ctlPort }));
    if (flag) writeFileSync(path.join(state, 'autoupdate.on'), 'on');
    return { inst, state };
  }
  // Same as run(), but without the -PiVersion hook, so the version is read from the control port.
  function runDirect({ inst, state }, extra = [], proc = 'NoSuchProcessXyz') {
    return new Promise(resolve => {
      const p = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'Check',
          '-StateDir', state, '-InstallDir', inst, '-ReleaseBase', `http://127.0.0.1:${port}`, '-InstalledVersion', '0.29.0',
          '-ClaudeProcess', proc, ...extra],
        { windowsHide: true }
      );
      let out = '';
      p.stdout.on('data', d => (out += d));
      p.stderr.on('data', d => (out += d));
      p.on('close', code => resolve({ code, out }));
    });
  }
  async function withControl(fn) {
    const requests = [];
    const srv = net.createServer(sock => {
      sock.on('data', d => {
        for (const line of d.toString().split('\n').filter(Boolean)) {
          requests.push(JSON.parse(line).method);
          sock.write(JSON.stringify({ id: 'upd', result: { current: '0.29.1' } }) + '\n');
        }
      });
    });
    await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
    try {
      return await fn(srv.address().port, requests);
    } finally {
      srv.close();
    }
  }

  test('direct install: reads the version from the configured host, installs with /HOST= /PORT=', async () => {
    sumsLine = goodSums();
    await withControl(async (ctl, requests) => {
      const d = freshDirect('direct-ok', ctl);
      const r = await runDirect(d);
      assert.equal(r.code, 0, r.out);
      assert.equal(status(d).result, 'updated');
      assert.deepEqual(requests, ['wrapper_status'], 'only the read-only status request');
      const args = readFileSync(path.join(d.inst, 'args.txt'), 'utf8');
      assert.match(args, new RegExp(`^/S /HOST=127\\.0\\.0\\.1 /PORT=${ctl} /D=`));
    });
  });

  test('direct install: Claude Desktop running is skipped, nothing installed', async () => {
    sumsLine = goodSums();
    await withControl(async ctl => {
      const d = freshDirect('direct-running', ctl);
      const r = await runDirect(d, [], 'node');
      assert.equal(r.code, 0);
      assert.equal(status(d).result, 'skipped');
      assert.ok(!existsSync(path.join(d.inst, 'args.txt')));
    });
  });

  test('direct install: the table does not answer: skipped, nothing installed', async () => {
    const d = freshDirect('direct-silent', 1); // port 1: nothing listens
    const r = await runDirect(d, ['-ReadAttempts', '1']);
    assert.equal(r.code, 0);
    assert.ok(!existsSync(path.join(d.inst, 'args.txt')));
  });

  test('direct install: bad checksum fails and rolls nothing in; failed installer restores', async () => {
    await withControl(async ctl => {
      const bad = freshDirect('direct-badsum', ctl);
      sumsLine = `${'0'.repeat(64)}  FoundryMCPServer-Setup-v0.29.1.exe\n`;
      assert.equal((await runDirect(bad)).code, 1);
      assert.ok(!existsSync(path.join(bad.inst, 'args.txt')));
      const rb = freshDirect('direct-restore', ctl);
      sumsLine = goodSums();
      const r = await new Promise(resolve => {
        const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'Check',
          '-StateDir', rb.state, '-InstallDir', rb.inst, '-ReleaseBase', `http://127.0.0.1:${port}`, '-InstalledVersion', '0.29.0', '-ClaudeProcess', 'NoSuchProcessXyz'],
          { env: { ...process.env, FAKE_EXIT: '1' }, windowsHide: true });
        p.on('close', code => resolve({ code }));
      });
      assert.equal(r.code, 1);
      assert.equal(readFileSync(path.join(rb.inst, 'sentinel.txt'), 'utf8'), 'old');
    });
  });

  test('-Now runs although auto-update is off; without it an off install does nothing', async () => {
    sumsLine = goodSums();
    await withControl(async ctl => {
      const off = freshDirect('direct-off', ctl, { flag: false });
      assert.equal((await runDirect(off)).code, 0);
      assert.ok(!existsSync(path.join(off.inst, 'args.txt')));
      const now = freshDirect('direct-now', ctl, { flag: false });
      assert.equal((await runDirect(now, ['-Now'])).code, 0);
      assert.equal(status(now).result, 'updated');
    });
  });

  test('Install: on by default the first time, keeps an earlier off, -NoEnable switches off, bad host refused', () => {
    const inst = path.join(root, 'install-action');
    const state = path.join(inst, 'update');
    mkdirSync(inst, { recursive: true });
    const ps = args =>
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'Install',
        '-StateDir', state, '-NoTask', ...args], { encoding: 'utf8', windowsHide: true });
    const flag = path.join(state, 'autoupdate.on');
    assert.equal(ps(['-ControlHost', '100.64.0.7', '-ControlPort', '31414']).status, 0);
    assert.ok(existsSync(flag), 'first install is on');
    const direct = readFileSync(path.join(state, 'direct.json'), 'utf8');
    assert.deepEqual(JSON.parse(direct.slice(direct.indexOf('{'))), { host: '100.64.0.7', port: 31414 });
    rmSync(flag); // the user switched it off
    assert.equal(ps(['-ControlHost', 'pi.tail1234.ts.net', '-ControlPort', '31414']).status, 0);
    assert.ok(!existsSync(flag), 'an upgrade keeps the off choice');
    writeFileSync(flag, 'on');
    assert.equal(ps(['-ControlHost', '100.64.0.7', '-ControlPort', '31414', '-NoEnable']).status, 0);
    assert.ok(!existsSync(flag), '-NoEnable switches off');
    assert.equal(ps(['-ControlHost', 'bad host";x']).status, 2);
  });

  test('installer exit 4 (bridge did not answer yet) counts as updated, not rolled back', async () => {
    const d = fresh('exit4');
    sumsLine = goodSums();
    const r = await run(d, ['-ClaudeProcess', 'NoSuchProcessXyz'], { FAKE_EXIT: '4' });
    assert.equal(r.code, 0, r.out);
    assert.equal(status(d).result, 'updated');
  });
});
