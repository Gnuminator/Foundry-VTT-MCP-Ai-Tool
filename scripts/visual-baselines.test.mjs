import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  artifactProblem,
  collectProblem,
  entryDecision,
  isEntryModule,
  logPathFor,
  pickRun,
  renderProblem,
  runProblem,
  safeTarget,
  SCREENSHOTS,
  validBranch,
} from './visual-baselines.mjs';

test('entryDecision: run for this file, mismatch for a same-named other file, import otherwise', () => {
  const self = fileURLToPath(new URL('./visual-baselines.mjs', import.meta.url));
  assert.equal(entryDecision(self, self), 'run');
  assert.ok(!isEntryModule(undefined, self));
  if (process.platform === 'win32') assert.equal(entryDecision(self.toUpperCase(), self), 'run');
  assert.equal(
    entryDecision(path.join(os.tmpdir(), 'nope', 'visual-baselines.mjs'), self),
    'mismatch'
  );
  assert.equal(entryDecision(path.join(os.tmpdir(), 'other.mjs'), self), 'import');
  assert.equal(entryDecision(undefined, self), 'import');
  assert.equal(entryDecision(pathToFileURL(self).href, self), 'import');
});

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
    { databaseId: 2, displayTitle: 'visual-baselines claude/b nBBB' },
  ];
  assert.equal(pickRun(runs, 'nBBB')?.databaseId, 2);
  assert.equal(pickRun(runs, 'nCCC'), undefined);
});

test('two concurrent runs: each lane takes only its own branch, sha and log', () => {
  const runs = [
    {
      databaseId: 1,
      displayTitle: 'visual-baselines claude/a nAAA',
      headBranch: 'claude/a',
      headSha: 'a'.repeat(40),
    },
    {
      databaseId: 2,
      displayTitle: 'visual-baselines claude/b nBBB',
      headBranch: 'claude/b',
      headSha: 'b'.repeat(40),
    },
  ];
  const a = pickRun(runs, 'nAAA');
  const b = pickRun(runs, 'nBBB');
  assert.equal(a?.databaseId, 1);
  assert.equal(b?.databaseId, 2);
  // A nonce match on another branch is still picked, so runProblem can refuse it by name.
  assert.match(runProblem(a, 'claude/b', ''), /is for branch claude\/a, not claude\/b/);
  assert.equal(runProblem(a, 'claude/a', 'a'.repeat(40)), '');
  assert.match(runProblem(b, 'claude/a', ''), /is for branch claude\/b, not claude\/a/);
  assert.match(runProblem(a, 'claude/a', 'c'.repeat(40)), /was at cccccccc/);
  assert.equal(artifactProblem(`${'a'.repeat(40)}\n`, a.headSha), '');
  assert.match(artifactProblem('b'.repeat(40), a.headSha), /another run's output/);
  assert.equal(artifactProblem('', a.headSha), '');
  assert.notEqual(logPathFor('claude/a'), logPathFor('claude/b'));
  assert.ok(!logPathFor('claude/a').includes('claude/a'));
});

test('pickRun and runProblem cope with a run that has no headBranch', () => {
  const run = pickRun([{ databaseId: 7, displayTitle: 'x nZZZ' }], 'nZZZ');
  assert.equal(run?.databaseId, 7);
  assert.equal(runProblem(run, 'claude/a', 'a'.repeat(40)), '');
});

test('logPathFor: a/b and a_b differ, case differs, and the name is a flat file name', () => {
  assert.notEqual(logPathFor('a/b'), logPathFor('a_b'));
  assert.notEqual(logPathFor('Claude/x').toLowerCase(), logPathFor('claude/x').toLowerCase());
  assert.match(
    path.basename(logPathFor('claude/a')),
    /^visual-baselines-claude_a-[0-9a-f]{6}\.log$/
  );
});

test('main is wired to the script start: a bad branch exits 2 with the usage line', () => {
  const script = fileURLToPath(new URL('./visual-baselines.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, 'a b'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage: npm run visual:baselines/);
});

test('renderProblem refuses a failed render with nothing changed', () => {
  assert.equal(renderProblem('0\n', 0), '');
  assert.equal(renderProblem('1\n', 4), '');
  assert.match(renderProblem('1\n', 0), /nothing rendered/);
  assert.match(renderProblem('', 3), /no Playwright exit code/);
});

test('collectProblem fails when the artifact holds fewer PNGs than the run counted', () => {
  assert.equal(collectProblem('6\n', 6), '');
  assert.equal(collectProblem('0\n', 0), '');
  assert.match(
    collectProblem('6\n', 0),
    /git saw 6 changed or new PNG\(s\) in the run but the artifact holds 0/
  );
  assert.match(collectProblem('2', 3), /holds 3/);
  assert.match(collectProblem('', 0), /no png-count\.txt/);
  assert.match(collectProblem('x', 0), /no png-count\.txt/);
});
