import assert from 'node:assert/strict';
import test from 'node:test';

import { pickRun, renderProblem, safeTarget, SCREENSHOTS, validBranch } from './visual-baselines.mjs';

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

test('pickRun matches only the run carrying its own nonce', () => {
  const runs = [
    { databaseId: 1, displayTitle: 'visual-baselines claude/a nAAA' },
    { databaseId: 2, displayTitle: 'visual-baselines claude/b nBBB' }
  ];
  assert.equal(pickRun(runs, 'nBBB')?.databaseId, 2);
  assert.equal(pickRun(runs, 'nCCC'), undefined);
});

test('renderProblem refuses a failed render with nothing changed', () => {
  assert.equal(renderProblem('0\n', 0), '');
  assert.equal(renderProblem('1\n', 4), '');
  assert.match(renderProblem('1\n', 0), /nothing rendered/);
  assert.match(renderProblem('', 3), /no Playwright exit code/);
});
