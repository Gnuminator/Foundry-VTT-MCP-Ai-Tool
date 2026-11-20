import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { resolveRootPath, rootFolder } from './data-folder.mjs';

test('a root folder stays at the drive root without a data folder', () => {
  assert.equal(rootFolder('FoundryAI', '', '/drive'), path.join('/drive', 'FoundryAI'));
});

test('a root folder follows the move, and the old place answers until then', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rootf-'));
  try {
    const drive = path.join(root, 'drive');
    const data = path.join(root, 'data');
    assert.equal(rootFolder('FoundryAI', data, drive), path.join(data, 'FoundryAI'));
    mkdirSync(path.join(drive, 'FoundryAI'), { recursive: true });
    assert.equal(rootFolder('FoundryAI', data, drive), path.join(drive, 'FoundryAI'));
    assert.equal(
      resolveRootPath('C:\\FoundryAI\\module-archive', data, drive),
      path.join(drive, 'FoundryAI', 'module-archive')
    );
    mkdirSync(path.join(data, 'FoundryAI'), { recursive: true });
    assert.equal(
      resolveRootPath('C:\\FoundryAI\\module-archive', data, drive),
      path.join(data, 'FoundryAI', 'module-archive')
    );
    assert.equal(resolveRootPath('C:/FoundryAI', data, drive), path.join(data, 'FoundryAI'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Get-DataFolder (data-folder.ps1) follows the same rule as dataFolder()', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dataf-'));
  const ps1 = path.join(import.meta.dirname, 'data-folder.ps1');
  const run = (/** @type {string} */ dataDir, /** @type {string} */ home) => {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `. '${ps1}'; Get-DataFolder 'FoundrySessions'`],
      { encoding: 'utf8', env: { ...process.env, USERPROFILE: home, FVTT_DATA_DIR: dataDir } }
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  try {
    const home = path.join(root, 'home');
    const data = path.join(root, 'data');
    const legacy = path.join(home, 'Documents', 'FoundrySessions');
    assert.equal(run('', home), legacy, 'no data folder: the old place');
    assert.equal(run(data, home), path.join(data, 'FoundrySessions'), 'nothing exists: the new place');
    mkdirSync(legacy, { recursive: true });
    assert.equal(run(data, home), legacy, 'old folder exists, not moved yet: the old place');
    mkdirSync(path.join(data, 'FoundrySessions'), { recursive: true });
    assert.equal(run(data, home), path.join(data, 'FoundrySessions'), 'moved: the new place');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('other paths come back unchanged', () => {
  for (const p of ['C:\\FoundryTest\\app', 'E:\\PiBackup', 'C:\\FoundryAIX\\x', '/tmp/FoundryAI']) {
    assert.equal(resolveRootPath(p, 'D:\\data', '/drive'), p);
  }
});
