import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCulprit, nextStep, parseArgs } from './main-red-revert.mjs';

const run = (head_sha, conclusion) => ({ head_sha, conclusion });

test('first failure reruns, second reverts', () => {
  assert.equal(nextStep(1), 'rerun');
  assert.equal(nextStep(2), 'revert');
});

test('culprit is the oldest red run of the streak', () => {
  const runs = [
    run('d', 'failure'),
    run('c', 'failure'),
    run('b', 'cancelled'),
    run('a', 'success'),
  ];
  assert.deepEqual(findCulprit(runs, 'd'), { culprit: 'b', reason: 'ok' });
});

test('a single red run is its own culprit', () => {
  assert.equal(findCulprit([run('b', 'failure'), run('a', 'success')], 'b').culprit, 'b');
});

test('nothing to do when a newer run is green', () => {
  const r = findCulprit([run('c', 'success'), run('b', 'failure'), run('a', 'success')], 'b');
  assert.equal(r.culprit, null);
});

test('nothing to do when the failed sha or a green run is missing', () => {
  assert.equal(findCulprit([run('a', 'success')], 'x').culprit, null);
  assert.equal(findCulprit([run('b', 'failure'), run('a', 'failure')], 'b').culprit, null);
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['--run', '9', '--attempt', '2', '--sha', 'abc', '--dry-run']), {
    dryRun: true,
    run: '9',
    attempt: 2,
    sha: 'abc',
  });
});
