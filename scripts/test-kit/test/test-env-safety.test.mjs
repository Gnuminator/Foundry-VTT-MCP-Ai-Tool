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

test('Plan B reserves every test server port (scripts/plan-b/lib.ps1)', () => {
  const lib = read('scripts/plan-b/lib.ps1');
  const block = /\$PlanBReservedPorts\s*=\s*@\{([\s\S]*?)\n\}/.exec(lib)?.[1];
  assert.ok(block, '$PlanBReservedPorts block not found');
  const reserved = new Set([...block.matchAll(/^\s*(\d+)\s*=/gm)].map(m => Number(m[1])));
  for (const { name, key, port } of serverPorts)
    assert.ok(reserved.has(port), `server ${name} ${key} ${port} is not in $PlanBReservedPorts`);
});

// The forbidden-port lists of the scripts that choose their own ports (L4).
const FORBIDDEN = [
  ['scripts/voice-stack.ps1', /\$ForbiddenPorts\s*=\s*@\(([^)]*)\)/],
  ['tools/livekit/scripts/livekit-poc.ps1', /\$ForbiddenPorts\s*=\s*@\(([^)]*)\)/],
  ['scripts/pi/rebuild-drill.ps1', /\$HostPort -in ([\d, ]+)\)/],
];

for (const [file, pattern] of FORBIDDEN) {
  test(`${file} forbids every test server port and the live bridge ports`, () => {
    const list = pattern.exec(read(file))?.[1];
    assert.ok(list, `forbidden-port list not found in ${file}`);
    const ports = new Set(list.split(',').map(s => Number(s.trim())));
    for (const { name, key, port } of serverPorts)
      assert.ok(ports.has(port), `${file}: server ${name} ${key} ${port} is not forbidden`);
    for (const live of [31414, 31415, 31416]) assert.ok(ports.has(live), `${file}: live ${live}`);
  });
}

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
  encoding: 'utf8',
}).stdout?.trim();

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
            `. '${path.join(dir, 'config.ps1')}'; $TestEnv.Root`,
          ],
          { encoding: 'utf8', env: { ...process.env, FOUNDRY_TEST_SERVER: server } }
        );
      const c = load('C');
      assert.notEqual(c.status, 0);
      assert.match(c.stderr, /also server B's Root/);
      assert.match(c.stderr, /local\.<name>\.json/);
      // A is fine: only this server's pairs count
      const a = load('A');
      assert.equal(a.status, 0, a.stderr);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
);
