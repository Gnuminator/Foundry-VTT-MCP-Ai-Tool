import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCulprit, rerunState, parseArgs } from './main-red-revert.mjs';

const run = (head_sha, conclusion) => ({ head_sha, conclusion });

test('rerun state', () => {
  const r = (status, run_attempt, conclusion) => ({ status, run_attempt, conclusion });
  assert.equal(rerunState(r('completed', 1, 'failure')), 'waiting');
  assert.equal(rerunState(r('in_progress', 2, null)), 'waiting');
  assert.equal(rerunState(r('completed', 2, 'success')), 'green');
  assert.equal(rerunState(r('completed', 2, 'failure')), 'red');
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

test('a green failed-sha run is left alone', () => {
  assert.equal(findCulprit([run('b', 'success'), run('a', 'success')], 'b').culprit, null);
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['--run', '9', '--attempt', '2', '--sha', 'abc', '--dry-run']), {
    dryRun: true,
    run: '9',
    attempt: 2,
    sha: 'abc',
  });
});
