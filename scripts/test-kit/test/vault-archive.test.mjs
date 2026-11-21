import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { archiveOldBigLogs } from '../lib/vault-archive.mjs';

test('moves old big session and change logs, keeps today, small and other files', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vault-archive-'));
  try {
    const vault = path.join(root, 'vault');
    const w = path.join(vault, 'kit-world');
    mkdirSync(path.join(w, 'sessions'), { recursive: true });
    mkdirSync(path.join(w, 'gm'), { recursive: true });
    const big = 'x'.repeat(300);
    const put = (rel, text) => writeFileSync(path.join(w, rel), text);
    put('sessions/2026-11-17.jsonl', big);
    put('sessions/2026-11-17.play.jsonl', big);
    put('sessions/2026-11-17.jsonl.keep', big);
    put('sessions/2026-11-20.jsonl', 'x');
    put('sessions/2026-11-21.play.jsonl', big);
    put('gm/changes-2026-11-20.jsonl', big);
    put('gm/audit-log.jsonl', big);
    const { moved, failed } = archiveOldBigLogs({
      vaultRoot: vault,
      world: 'kit-world',
      today: '2026-11-21',
      overBytes: 100,
    });
    assert.deepEqual(failed, []);
    assert.deepEqual(moved.sort(), [
      'gm/changes-2026-11-20.jsonl',
      'sessions/2026-11-17.jsonl',
      'sessions/2026-11-17.play.jsonl',
    ]);
    const arch = path.join(root, 'vault-archive', 'kit-world');
    assert.ok(existsSync(path.join(arch, 'gm', 'changes-2026-11-20.jsonl')));
    assert.ok(existsSync(path.join(w, 'sessions', '2026-11-21.play.jsonl')));
    assert.ok(existsSync(path.join(w, 'sessions', '2026-11-20.jsonl')));
    assert.ok(existsSync(path.join(w, 'gm', 'audit-log.jsonl')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing world folder moves nothing', () => {
  const vaultRoot = path.join(os.tmpdir(), 'no-such-vault-for-archive-test');
  assert.deepEqual(archiveOldBigLogs({ vaultRoot, world: 'w' }), { moved: [], failed: [] });
});

test('a name already in the archive gets a prefix and nothing is lost', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vault-archive-'));
  try {
    const vault = path.join(root, 'vault');
    const w = path.join(vault, 'kit-world');
    mkdirSync(path.join(w, 'sessions'), { recursive: true });
    mkdirSync(path.join(w, 'gm'), { recursive: true });
    const big = 'x'.repeat(300);
    writeFileSync(path.join(w, 'sessions', '2026-11-17.jsonl'), big);
    writeFileSync(path.join(w, 'gm', 'changes-2026-11-20.jsonl'), big);
    // The archive already holds a file of that name.
    mkdirSync(path.join(root, 'vault-archive', 'kit-world', 'sessions', '2026-11-17.jsonl'), {
      recursive: true,
    });
    writeFileSync(
      path.join(root, 'vault-archive', 'kit-world', 'sessions', '2026-11-17.jsonl', 'f'),
      'x'
    );
    const { moved, failed } = archiveOldBigLogs({
      vaultRoot: vault,
      world: 'kit-world',
      today: '2026-11-21',
      overBytes: 100,
    });
    assert.deepEqual(failed, []);
    assert.equal(moved.length, 2);
    assert.ok(!existsSync(path.join(w, 'sessions', '2026-11-17.jsonl')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
