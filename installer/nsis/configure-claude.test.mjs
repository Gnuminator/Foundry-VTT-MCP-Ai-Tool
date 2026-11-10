// Path choice of installer/nsis/configure-claude.ps1: which Claude Desktop config files it writes.
//   node --test installer/nsis/configure-claude.test.mjs
// Two parts. The source checks run on every platform (CI is Linux): the order of the candidate places in
// configure-claude.ps1, and that scripts/plan-b/connectors.ps1 and scripts/desktop/repoint-connectors.ps1
// default to the same Claude-Data file (and refuse a Claude-Data folder without a file, Sort-Object Name).
// The runtime tests run the installer script with -ListConfigFiles against a fake %APPDATA% and
// %LOCALAPPDATA% (Windows only; skipped elsewhere). Nothing real is read or written.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'configure-claude.ps1');
const win = process.platform === 'win32';
const CFG = 'claude_desktop_config.json';

function fakeProfile() {
  const root = mkdtempSync(path.join(tmpdir(), 'cfg-path-'));
  const appdata = path.join(root, 'AppData', 'Roaming');
  const local = path.join(root, 'AppData', 'Local');
  mkdirSync(appdata, { recursive: true });
  mkdirSync(local, { recursive: true });
  return { root, appdata, local };
}

function run(profile, args) {
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        APPDATA: profile.appdata,
        LOCALAPPDATA: profile.local,
        TEMP: profile.root,
        TMP: profile.root,
      },
    }
  );
  return r;
}

const list = p =>
  run(p, ['-ListConfigFiles'])
    .stdout.split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

// Source checks that run on every platform (CI is Linux): the order of the candidate places and the
// conditions for the classic file, plus the same default in the two scripts that edit the config.
describe('config file choice, source checks', () => {
  const src = readFileSync(path.join(here, 'configure-claude.ps1'), 'utf8').replace(/\r\n/g, '\n');
  const fn = src.slice(
    src.indexOf('function Get-ClaudeConfigFiles'),
    src.indexOf('function Read-ConfigObject')
  );
  test('Claude-Data before Packages before the classic file', () => {
    const a = fn.indexOf('foreach ($f in $current)');
    const b = fn.indexOf('foreach ($f in $store)');
    const c = fn.indexOf('$files.Add($classicFile)');
    assert.ok(a > 0 && b > a && c > b, 'order is Claude-Data, Packages, classic');
    assert.match(
      fn,
      /Test-Path \$classicFile\) -or \(\$store\.Count -eq 0 -and \$current\.Count -eq 0\)/
    );
    assert.match(fn, /Join-Path \$env:LOCALAPPDATA 'Claude-Data'/);
  });
  for (const rel of [
    '../../scripts/plan-b/connectors.ps1',
    '../../scripts/desktop/repoint-connectors.ps1',
  ]) {
    test(`${path.basename(rel)} defaults to the Claude-Data file, classic as fallback`, () => {
      const t = readFileSync(path.join(here, rel), 'utf8');
      const dataLine = "Join-Path $env:LOCALAPPDATA 'Claude-Data'";
      const d = t.indexOf(dataLine);
      const c =
        t.indexOf("'Claude\\claude_desktop_config.json'") >= 0
          ? t.indexOf("'Claude\\claude_desktop_config.json'")
          : t.indexOf("'Claude' 'claude_desktop_config.json'");
      assert.ok(d > 0 && c > d, 'Claude-Data is looked at before the classic path');
      assert.match(t, /Sort-Object Name/, 'the Claude-Data folders are sorted by name');
      assert.match(
        t,
        /\$dataDirs\.Count -and -not \$current\.Count\) \{ throw /,
        'a Claude-Data folder without the file is refused, not skipped'
      );
    });
  }
});

describe('configure-claude.ps1 config file choice', { skip: !win }, () => {
  test('Claude-Data folder first, older copies after, stale classic file kept in the list', () => {
    const p = fakeProfile();
    try {
      const data = path.join(p.local, 'Claude-Data', 'claude_abc123');
      const pkgRoaming = path.join(
        p.local,
        'Packages',
        'Claude_abc123',
        'LocalCache',
        'Roaming',
        'Claude'
      );
      const classic = path.join(p.appdata, 'Claude');
      for (const d of [data, pkgRoaming, classic]) mkdirSync(d, { recursive: true });
      writeFileSync(path.join(classic, CFG), '{}');
      const files = list(p);
      assert.deepEqual(files, [
        path.join(data, CFG),
        path.join(pkgRoaming, CFG),
        path.join(classic, CFG),
      ]);
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  });

  test('Claude-Data folder without a file yet: its path is listed and no classic file is invented', () => {
    const p = fakeProfile();
    try {
      const data = path.join(p.local, 'Claude-Data', 'claude_abc123');
      mkdirSync(data, { recursive: true });
      assert.deepEqual(list(p), [path.join(data, CFG)]);
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  });

  test('classic Desktop only: the classic file is the one', () => {
    const p = fakeProfile();
    try {
      assert.deepEqual(list(p), [path.join(p.appdata, 'Claude', CFG)]);
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  });

  test('older Store build only (no Claude-Data): the Packages copy, no classic file created', () => {
    const p = fakeProfile();
    try {
      const pkgRoaming = path.join(p.local, 'Packages', 'Claude_abc123', 'LocalCache', 'Roaming');
      mkdirSync(pkgRoaming, { recursive: true });
      assert.deepEqual(list(p), [path.join(pkgRoaming, 'Claude', CFG)]);
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  });

  test('write keeps entries it does not own (cast) and makes a backup', () => {
    const p = fakeProfile();
    try {
      const data = path.join(p.local, 'Claude-Data', 'claude_abc123');
      mkdirSync(data, { recursive: true });
      const file = path.join(data, CFG);
      writeFileSync(file, JSON.stringify({ mcpServers: { cast: { command: 'x' } }, other: 1 }));
      const install = path.join(p.root, 'inst');
      mkdirSync(path.join(install, 'foundry-mcp-client'), { recursive: true });
      writeFileSync(path.join(install, 'node.exe'), '');
      writeFileSync(path.join(install, 'foundry-mcp-client', 'index.cjs'), '');
      const r = run(p, [
        '-InstallDir',
        install,
        '-BridgeHost',
        '127.0.0.1',
        '-BridgePort',
        '39999',
        '-ConfigPath',
        file,
      ]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(
        readdirSync(data).some(n => n.startsWith(`${CFG}.backup-`)),
        'a backup was made'
      );
      const cfg = JSON.parse(readFileSync(file, 'utf8'));
      assert.deepEqual(cfg.mcpServers.cast, { command: 'x' });
      assert.equal(cfg.other, 1);
      assert.ok(cfg.mcpServers['foundry-mcp'] && cfg.mcpServers['foundry-mcp-admin']);
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  });
});
