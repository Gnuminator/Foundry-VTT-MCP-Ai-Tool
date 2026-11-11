import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findCulprit,
  rerunState,
  parseArgs,
  streakLines,
  commitTitle,
  main,
} from './main-red-revert.mjs';

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
  const r = findCulprit(runs, 'd');
  assert.equal(r.culprit, 'b');
  assert.deepEqual(
    r.streak.map(x => x.head_sha),
    ['d', 'c', 'b']
  );
});

test('the PR body lists the streak oldest first and marks cancelled runs', () => {
  const lines = streakLines([run('ddddddd1', 'failure'), run('bbbbbbb1', 'cancelled')]);
  assert.deepEqual(lines, [
    '- bbbbbbb: cancelled (cancelled: no verdict, may be innocent)',
    '- ddddddd: failure',
  ]);
});

test('commitTitle uses the PR title of a merge commit', () => {
  assert.equal(
    commitTitle('Merge pull request #941 from Gnuminator/claude/x', '\nFix the thing\n'),
    'Fix the thing'
  );
  assert.equal(commitTitle('Fix the thing (#12)', ''), 'Fix the thing');
  assert.equal(commitTitle('Merge pull request #5 from a/b', ''), 'a merge to main');
});

/** A fake gh/git: records every call; `runState` answers the run lookups in order. */
function fakeIo({
  runStates,
  runs,
  openPrs = '0',
  branchExists = false,
  revertOk = true,
  prOk = true,
}) {
  const calls = [];
  const files = {};
  let clock = 0;
  const states = [...runStates];
  const io = {
    calls,
    files,
    logs: [],
    gh(args) {
      calls.push(['gh', ...args]);
      if (args[0] === 'api' && args[1].includes('/actions/runs/')) {
        const s = states.length > 1 ? states.shift() : states[0];
        return s === 'fail'
          ? { ok: false, out: '', err: 'boom' }
          : { ok: true, out: JSON.stringify(s), err: '' };
      }
      if (args[0] === 'api') return { ok: true, out: JSON.stringify(runs), err: '' };
      if (args[0] === 'pr' && args[1] === 'list') return { ok: true, out: openPrs, err: '' };
      if (args[0] === 'pr' && args[1] === 'create') {
        return prOk
          ? { ok: true, out: 'https://pr/1', err: '' }
          : { ok: false, out: '', err: 'denied' };
      }
      return { ok: true, out: '', err: '' };
    },
    git(args) {
      calls.push(['git', ...args]);
      if (args[0] === 'log' && args[2] === '--format=%s')
        return { ok: true, out: 'Merge pull request #7 from a/b', err: '' };
      if (args[0] === 'log') return { ok: true, out: 'Add the widget', err: '' };
      if (args[0] === 'rev-list') return { ok: true, out: 'c1 p1 p2', err: '' };
      if (args[0] === 'ls-remote') return { ok: branchExists, out: '', err: '' };
      if (args[0] === 'revert' && args[1] !== '--abort')
        return { ok: revertOk, out: '', err: 'conflict' };
      return { ok: true, out: '', err: '' };
    },
    sleep: ms => {
      clock += ms;
    },
    now: () => clock,
    writeFile: (p, t) => {
      files[p] = t;
    },
    log: m => io.logs.push(m),
    env: { GITHUB_REPOSITORY: 'o/r' },
  };
  return io;
}
const ARGS = ['--run', '9', '--attempt', '1', '--sha', 'bbbbbbb0'];
const done = (a, c) => ({ status: 'completed', run_attempt: a, conclusion: c });
const RUNS = [
  { head_sha: 'bbbbbbb0', conclusion: 'failure' },
  { head_sha: 'ccccccc0', conclusion: 'cancelled' },
  { head_sha: 'aaaaaaa0', conclusion: 'success' },
];
const has = (io, ...prefix) =>
  io.calls.some(c => prefix.every((p, i) => c[i] === p || (p instanceof RegExp && p.test(c[i]))));

test('main: red twice opens a draft revert PR listing the streak', () => {
  const io = fakeIo({
    runStates: [done(1, 'failure'), done(1, 'failure'), done(2, 'failure')],
    runs: RUNS,
  });
  assert.equal(main(ARGS, io), 0);
  assert.ok(has(io, 'gh', 'run', 'rerun'));
  assert.ok(has(io, 'git', 'revert', '--no-edit', '-m', '1', 'ccccccc0'));
  assert.ok(has(io, 'git', 'push'));
  const create = io.calls.find(c => c[1] === 'pr' && c[2] === 'create');
  assert.ok(create.includes('--draft'));
  const body = create[create.indexOf('--body') + 1];
  assert.match(body, /ccccccc: cancelled \(cancelled: no verdict/);
  assert.match(body, /bbbbbbb: failure/);
  assert.match(io.files['changelog.d/auto-revert-ccccccc.md'], /Add the widget/);
  assert.doesNotMatch(io.files['changelog.d/auto-revert-ccccccc.md'], /Merge pull request/);
});

test('main: a flaky red (rerun green) opens nothing', () => {
  const io = fakeIo({ runStates: [done(1, 'failure'), done(2, 'success')], runs: RUNS });
  assert.equal(main(ARGS, io), 0);
  assert.ok(!has(io, 'git', 'revert'));
  assert.ok(!has(io, 'gh', 'pr', 'create'));
});

test('main: a manual rerun in between is waited for, not repeated', () => {
  const io = fakeIo({ runStates: [done(2, null), done(2, 'success')], runs: RUNS });
  main(ARGS, io);
  assert.ok(!has(io, 'gh', 'run', 'rerun'));
  assert.ok(!has(io, 'gh', 'pr', 'create'));
});

test('main: a failed status poll is retried until the rerun ends', () => {
  const io = fakeIo({
    runStates: [done(1, 'failure'), 'fail', 'fail', done(2, 'failure')],
    runs: RUNS,
  });
  assert.equal(main(ARGS, io), 0);
  assert.ok(has(io, 'gh', 'pr', 'create'));
});

test('main: an endless failing poll ends at the deadline with an error', () => {
  const io = fakeIo({ runStates: [done(1, 'failure'), 'fail'], runs: RUNS });
  assert.throws(() => main(ARGS, io), /did not finish within 50 minutes/);
});

test('main: an open auto-revert PR, a manual attempt and a missing arg do nothing', () => {
  const open = fakeIo({
    runStates: [done(1, 'failure'), done(2, 'failure')],
    runs: RUNS,
    openPrs: '1',
  });
  main(ARGS, open);
  assert.ok(!has(open, 'git', 'revert'));
  const manual = fakeIo({ runStates: [done(2, 'failure')], runs: RUNS });
  main(['--run', '9', '--attempt', '2', '--sha', 'x'], manual);
  assert.equal(manual.calls.length, 0);
});

test('main: an existing revert branch is reused, a conflict throws, a failed PR create throws', () => {
  const reuse = fakeIo({
    runStates: [done(1, 'failure'), done(2, 'failure')],
    runs: RUNS,
    branchExists: true,
  });
  main(ARGS, reuse);
  assert.ok(!has(reuse, 'git', 'checkout'));
  assert.ok(has(reuse, 'gh', 'pr', 'create'));
  const conflict = fakeIo({
    runStates: [done(1, 'failure'), done(2, 'failure')],
    runs: RUNS,
    revertOk: false,
  });
  assert.throws(() => main(ARGS, conflict), /conflicts/);
  assert.ok(has(conflict, 'git', 'revert', '--abort'));
  const denied = fakeIo({
    runStates: [done(1, 'failure'), done(2, 'failure')],
    runs: RUNS,
    prOk: false,
  });
  assert.throws(() => main(ARGS, denied), /could not open/);
});

test('main --dry-run reruns nothing and creates nothing', () => {
  const io = fakeIo({ runStates: [done(1, 'failure')], runs: RUNS });
  main([...ARGS, '--dry-run'], io);
  assert.ok(!has(io, 'gh', 'run', 'rerun'));
  assert.ok(!has(io, 'git', 'checkout'));
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
