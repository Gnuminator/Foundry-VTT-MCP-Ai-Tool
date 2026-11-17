import assert from 'node:assert/strict';
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

test('other paths come back unchanged', () => {
  for (const p of ['C:\\FoundryTest\\app', 'E:\\PiBackup', 'C:\\FoundryAIX\\x', '/tmp/FoundryAI']) {
    assert.equal(resolveRootPath(p, 'D:\\data', '/drive'), p);
  }
});
