import assert from 'node:assert/strict';
import test from 'node:test';

import { pickRun, safeTarget, SCREENSHOTS, validBranch } from './visual-baselines.mjs';

test('validBranch accepts normal branches only', () => {
  assert.ok(validBranch('claude/dnd-levelup'));
  assert.ok(!validBranch('a b'));
  assert.ok(!validBranch('x;rm'));
  assert.ok(!validBranch('a/../b'));
  assert.ok(!validBranch('-f'));
});

test('safeTarget keeps to PNGs under the screenshots folder', () => {
  assert.ok(safeTarget(`${SCREENSHOTS}desktop/home.png`));
  assert.ok(!safeTarget(`${SCREENSHOTS}../../x.png`));
  assert.ok(!safeTarget('package.json'));
  assert.ok(!safeTarget(`${SCREENSHOTS}a.txt`));
  assert.ok(!safeTarget('changed.txt'));
});

test('pickRun takes the newest run after the dispatch', () => {
  const since = Date.parse('2026-10-27T10:00:10Z');
  const runs = [
    { databaseId: 1, createdAt: '2026-10-27T09:00:00Z' },
    { databaseId: 3, createdAt: '2026-10-27T10:00:14Z' },
    { databaseId: 2, createdAt: '2026-10-27T10:00:12Z' }
  ];
  assert.equal(pickRun(runs, since)?.databaseId, 3);
  assert.equal(pickRun([runs[0]], since), undefined);
});
