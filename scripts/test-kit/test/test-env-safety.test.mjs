/**
 * The test servers' safety lists stay in step with scripts/test-env/servers.json (PR #435 review
 * L1, L2, L4): every server port is reserved for Plan B and forbidden in the scripts that pick
 * their own ports, and config.ps1 refuses a Root that is, or sits inside, another server's.
 * The port checks read the .ps1 sources; the Root check runs through pwsh and is skipped where
 * pwsh 7 is missing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = rel => readFileSync(path.join(root, rel), 'utf8');

const servers = JSON.parse(read('scripts/test-env/servers.json'));
const serverPorts = Object.entries(servers).flatMap(([name, s]) =>
  ['FoundryPort', 'ControlPort', 'LinkPort', 'DashboardPort'].map(key => ({
    name,
    key,
    port: s[key],
  }))
);

test('servers.json: A, B and C all have four distinct ports', () => {
  assert.deepEqual(Object.keys(servers), ['A', 'B', 'C']);
  assert.equal(serverPorts.length, 12);
  assert.equal(new Set(serverPorts.map(p => p.port)).size, 12);
});

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
  encoding: 'utf8',
}).stdout?.trim();

// voice-stack, livekit, the Pi drill and Plan B read their lists from shared/ports.json; that
// file has to cover the test servers in servers.json field by field and the live bridge ports.
const portsJson = JSON.parse(read('shared/ports.json'));

test(
  'Plan B reserves every test server port and the live bridge ports (scripts/plan-b/lib.ps1)',
  { skip: !hasPwsh },
  () => {
    assert.match(read('scripts/plan-b/lib.ps1'), /shared\/ports\.json/);
    const lib = path.join(root, 'scripts', 'plan-b', 'lib.ps1').replace(/'/g, "''");
    const r = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `. '${lib}'; ConvertTo-Json -InputObject @($PlanBReservedPorts.Keys | Sort-Object) -Compress`,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
    const reserved = new Set(JSON.parse(r.stdout));
    for (const { name, key, port } of serverPorts)
      assert.ok(reserved.has(port), `server ${name} ${key} ${port} is not in $PlanBReservedPorts`);
    for (const port of [31414, 31415, 31416, 3200])
      assert.ok(reserved.has(port), `${port} is not in $PlanBReservedPorts`);
    // the rehearsal row is Plan B's own: it must stay free
    for (const port of Object.values(portsJson.ports.rehearsal))
      assert.ok(!reserved.has(port), `rehearsal port ${port} is reserved against Plan B itself`);
  }
);

for (const file of [
  'scripts/voice-stack.ps1',
  'tools/livekit/scripts/livekit-poc.ps1',
  'scripts/pi/rebuild-drill.ps1',
]) {
  test(`${file} reads its forbidden ports from shared/ports.json`, () => {
    assert.match(read(file), /\$ForbiddenPorts\s*=\s*@\(.*shared\/ports\.json/i);
  });
  // The text check above would pass after a change to the number of Split-Path hops; this one
  // evaluates the path chain with the script's own $PSScriptRoot and $Root and wants the real file.
  test(
    `${file}: the ports.json path chain resolves to shared/ports.json`,
    { skip: !hasPwsh },
    () => {
      const expr = /\(Join-Path (.+?) 'shared\/ports\.json'\)/.exec(read(file))?.[1];
      assert.ok(expr, `no Join-Path ... 'shared/ports.json' in ${file}`);
      const dir = path.dirname(path.join(root, file)).replace(/'/g, "''");
      const r = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$PSScriptRoot = '${dir}'; $Root = Split-Path -Parent $PSScriptRoot; [IO.Path]::GetFullPath((Join-Path ${expr} 'shared/ports.json'))`,
        ],
        { encoding: 'utf8' }
      );
      assert.equal(r.status, 0, r.stderr);
      const got = path.normalize(r.stdout.trim());
      assert.equal(got.toLowerCase(), path.join(root, 'shared', 'ports.json').toLowerCase());
    }
  );
}
test('shared/ports.json matches servers.json and forbids every test and live port', () => {
  const forbidden = new Set(portsJson.forbidden);
  for (const [name, s] of Object.entries(servers)) {
    const set = portsJson.ports[`test${name}`];
    assert.deepEqual(
      [set.foundry, set.control, set.link, set.dashboard],
      [s.FoundryPort, s.ControlPort, s.LinkPort, s.DashboardPort],
      `ports.json test${name} differs from servers.json`
    );
  }
  for (const { name, key, port } of serverPorts)
    assert.ok(forbidden.has(port), `server ${name} ${key} ${port} is not forbidden`);
  for (const live of [31414, 31415, 31416]) assert.ok(forbidden.has(live), `live ${live}`);
});


/** Get-RootProblems from config.ps1 for one server over a name-to-path table. */
function rootProblems(name, roots) {
  const config = path.join(root, 'scripts', 'test-env', 'config.ps1').replace(/'/g, "''");
  const r = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `. '${config}'; $roots = [ordered]@{}; (ConvertFrom-Json $env:ROOTS_JSON).PSObject.Properties | ForEach-Object { $roots[$_.Name] = $_.Value }; $p = Get-RootProblems '${name}' $roots; ConvertTo-Json -InputObject @($p) -Compress`,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, FOUNDRY_TEST_SERVER: 'A', ROOTS_JSON: JSON.stringify(roots) },
    }
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test(
  'config.ps1 refuses a Root equal to, or inside, another server Root',
  { skip: !hasPwsh },
  () => {
    const sep = process.platform === 'win32' ? '\\' : '/';
    const base = process.platform === 'win32' ? 'C:\\' : '/tmp/';
    const a = `${base}FoundryTest`;
    const b = `${base}FoundryTestB`;
    const c = `${base}FoundryTestC`;
    assert.deepEqual(rootProblems('C', { A: a, B: b, C: c }), []);
    // the same folder (also with a trailing separator and, on Windows, another letter case)
    const same = rootProblems('C', { A: a, B: b, C: `${b}${sep}` });
    assert.equal(same.length, 1);
    assert.match(same[0], /also server B's Root/);
    if (process.platform === 'win32')
      assert.equal(rootProblems('C', { A: a, B: b, C: b.toLowerCase() }).length, 1);
    // one inside the other, both ways round
    assert.match(rootProblems('C', { A: a, B: b, C: `${a}${sep}c` })[0], /overlaps server A/);
    assert.match(rootProblems('A', { A: a, B: `${a}${sep}b`, C: c })[0], /overlaps server B/);
    // a name that merely starts the same is not an overlap
    assert.deepEqual(rootProblems('A', { A: a, B: b, C: c }), []);
    // only this server's pairs count: B and C sharing a folder does not stop A
    assert.deepEqual(rootProblems('A', { A: a, B: b, C: b }), []);
  }
);

test(
  'loading config.ps1 throws when the server Root is another server Root, and names the file to fix',
  { skip: !hasPwsh },
  () => {
    // A copy of config.ps1 and servers.json in a temp folder (two levels down, as RepoRoot expects)
    // with local files that make B and C share one Root, so the real local files do not matter.
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'test-env-safety-'));
    try {
      const dir = path.join(tmp, 'scripts', 'test-env');
      mkdirSync(dir, { recursive: true });
      for (const f of ['config.ps1', 'servers.json'])
        copyFileSync(path.join(root, 'scripts', 'test-env', f), path.join(dir, f));
      const shared = JSON.stringify({ Root: path.join(tmp, 'shared') });
      writeFileSync(path.join(dir, 'local.B.json'), shared);
      writeFileSync(path.join(dir, 'local.C.json'), shared);
      const load = server =>
        spawnSync(
          'pwsh',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            // the thrown message as plain text on stdout (the error view wraps and colours it)
            `try { . '${path.join(dir, 'config.ps1')}'; 'OK ' + $TestEnv.Root } catch { 'THREW ' + $_.Exception.Message }`,
          ],
          { encoding: 'utf8', env: { ...process.env, FOUNDRY_TEST_SERVER: server } }
        );
      const c = load('C');
      assert.match(c.stdout, /^THREW /);
      assert.match(c.stdout, /also server B's Root/);
      assert.match(c.stdout, /local\.<name>\.json/);
      // A is fine: only this server's pairs count
      const a = load('A');
      assert.match(a.stdout, /^OK /, a.stdout + a.stderr);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
);
