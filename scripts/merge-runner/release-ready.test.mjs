// Tests for scripts/merge-runner/release-ready.mjs with a fake release item: no server, no tag, no Pi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReleaseDeps, makeReleaseRun, releaseItems, stillWaiting } from './release-ready.mjs';
import { run } from '../backlog.mjs';
import { waitingEdit } from '../backlog-waiting.mjs';

const TIP = 'c'.repeat(40);
const ok = { status: 0, stdout: '', stderr: '' };
const backlog = (dep = '#10, item:other', extra = '') =>
  `# Backlog\n\n## M Release v9.9.9\n\n- id: release-v9-9-9\n- depends on: ${dep}\n${extra}\n## S Other\n\n- id: other\n\n`;
const DONE = '- 2026-11-17 other: PR #11 merged at abc (x) | Process\n';

/** Fake dependencies; `o` overrides. */
function fake(o = {}) {
  const calls = [];
  const posts = [];
  const seen = new Set();
  const d = {
    readDone: () => DONE,
    prMerged: () => true,
    seen: k => seen.has(k),
    mark: k => seen.add(k),
    lock: c => (calls.push(`lock:${c}`), ok),
    tip: () => TIP,
    lastRoundtrip: () => null,
    worker: () => (calls.push('worker'), { code: 0, output: '' }),
    stopServer: () => calls.push('stop'),
    waiting: (k, _t) => (calls.push(`waiting:${k}`), ok),
    post: t => posts.push(t),
    log: () => {},
    ...o,
  };
  return { d, calls, posts, seen };
}

test('release items need an open release-* id and at least one dependency', () => {
  const [r] = releaseItems(backlog());
  assert.deepEqual([r.id, r.prs, r.items], ['release-v9-9-9', [10], ['other']]);
  assert.deepEqual(releaseItems(backlog('nothing yet')), []);
  assert.deepEqual(releaseItems('## S X\n\n- id: not-release\n- depends on: #1\n'), []);
});

test('stillWaiting names unmerged PRs and items that are open or not done', () => {
  const [r] = releaseItems(backlog());
  assert.deepEqual(
    stillWaiting(r, backlog(), DONE, () => true),
    ['item:other']
  ); // still open
  const gone = backlog().replace(/## S Other[\s\S]*$/, '');
  assert.deepEqual(
    stillWaiting(r, gone, DONE, () => true),
    []
  );
  assert.deepEqual(
    stillWaiting(r, gone, DONE, () => false),
    ['#10']
  );
  assert.deepEqual(
    stillWaiting(r, gone, DONE, () => null),
    ['#10']
  );
  assert.deepEqual(
    stillWaiting(r, gone, '', () => true),
    ['item:other']
  ); // typo or never done
});

const unblocked = backlog().replace(/## S Other[\s\S]*$/, '');

test('blocked release: nothing runs', () => {
  const { d, calls, posts } = fake({ prMerged: () => false });
  makeReleaseRun(d).step(unblocked);
  assert.deepEqual(calls, []);
  assert.deepEqual(posts, []);
});

test('unblocked release: queue, then roundtrip, one post, one Waiting line, once only', () => {
  const { d, calls, posts } = fake();
  const run = makeReleaseRun(d);
  run.step(unblocked);
  assert.deepEqual(calls, ['lock:queue']);
  assert.equal(run.phase(), 'queued');
  run.step(unblocked);
  assert.deepEqual(calls, [
    'lock:queue',
    'lock:take',
    'worker',
    'lock:release',
    'waiting:release-ready-release-v9-9-9',
  ]);
  assert.equal(posts.length, 1);
  assert.match(posts[0], /release-v9-9-9 is ready to tag/);
  assert.doesNotMatch(posts[0], /release session/);
  const n = calls.length;
  run.step(unblocked);
  run.step(unblocked);
  assert.equal(calls.length, n);
  assert.equal(posts.length, 1);
});

test('a lock held by someone else waits, nothing is posted', () => {
  let busy = true;
  const { d, calls, posts } = fake({
    lock: c => (
      calls0.push(c),
      c === 'take' && busy ? { status: 1, stdout: '', stderr: 'held' } : ok
    ),
  });
  const calls0 = calls;
  const run = makeReleaseRun(d);
  run.step(unblocked);
  run.step(unblocked);
  assert.ok(!calls.includes('worker'));
  assert.equal(posts.length, 0);
  busy = false;
  run.step(unblocked);
  assert.equal(posts.length, 1);
});

test('a roundtrip already green on the tip skips the server', () => {
  const { d, calls, posts } = fake({ lastRoundtrip: () => TIP });
  makeReleaseRun(d).step(unblocked);
  assert.deepEqual(calls, ['waiting:release-ready-release-v9-9-9']);
  assert.equal(posts.length, 1);
});

test('red roundtrip: one line, no Waiting item, not retried on the same tip, server stopped', () => {
  const { d, calls, posts } = fake({ worker: () => ({ code: 1, output: 'boom' }) });
  const run = makeReleaseRun(d);
  run.step(unblocked);
  run.step(unblocked);
  assert.ok(calls.includes('stop'));
  assert.ok(!calls.some(c => c.startsWith('waiting')));
  assert.equal(posts.length, 1);
  assert.match(posts[0], /live:roundtrip failed.*boom/);
  const n = calls.length;
  run.step(unblocked);
  assert.equal(calls.length, n);
});

test('a failed Waiting write is not marked and not posted; the next round retries', () => {
  let fail = true;
  const { d, posts, calls } = fake({
    waiting: () => (fail ? { status: 1, stdout: '', stderr: 'no' } : ok),
  });
  const run = makeReleaseRun(d);
  run.step(unblocked);
  run.step(unblocked);
  assert.equal(posts.length, 0);
  fail = false;
  run.step(unblocked); // the roundtrip is not repeated: it was green on this tip
  assert.equal(posts.length, 1);
  assert.equal(calls.filter(c => c === 'worker').length, 1);
});

test('a red roundtrip on a later tip retries quietly: one red line per release item', () => {
  let tip = TIP;
  const { d, posts, calls } = fake({
    tip: () => tip,
    worker: () => (calls.push('worker'), { code: 1, output: 'boom' }),
  });
  const run = makeReleaseRun(d);
  run.step(unblocked);
  run.step(unblocked);
  tip = 'd'.repeat(40);
  run.step(unblocked);
  run.step(unblocked);
  assert.equal(calls.filter(c => c === 'worker').length, 2);
  assert.equal(posts.length, 1);
});

test('a different kind of red on a later tip posts again (failed, then could not run)', () => {
  let tip = TIP;
  let code = 1;
  const { d, posts } = fake({ tip: () => tip, worker: () => ({ code, output: 'boom' }) });
  const run = makeReleaseRun(d);
  run.step(unblocked);
  run.step(unblocked);
  tip = 'd'.repeat(40);
  run.step(unblocked);
  run.step(unblocked);
  assert.equal(posts.length, 1);
  code = 2;
  tip = 'e'.repeat(40);
  run.step(unblocked);
  run.step(unblocked);
  assert.equal(posts.length, 2);
  assert.match(posts[1], /could not run/);
});

test('the release session is started only when wired, and named in the post', () => {
  const started = [];
  const { d, posts } = fake({
    startSession: (r, tip) => (started.push([r.id, tip]), { id: 'sess-1' }),
  });
  const run = makeReleaseRun(d);
  run.step(unblocked);
  run.step(unblocked);
  assert.deepEqual(started, [['release-v9-9-9', TIP]]);
  assert.match(posts[0], /claude --resume sess-1/);
});

test('real deps: the session is off by default and its command stops short of the tag', () => {
  const spawned = [];
  const base = {
    sh: () => ({ status: 0, stdout: 'MERGED\n', stderr: '' }),
    stamp: () => {},
    repo: 'o/r',
    repoRoot: '/repo',
    vaultGit: () => ({ status: 0, stdout: DONE }),
    deps: () => ({ post: () => {}, backlog: a => (spawned.push(a), ok) }),
    train: {
      tip: () => TIP,
      worker: () => ({ code: 0, output: '' }),
      stopServer: () => {},
      state: () => ({ lastSha: null }),
    },
    spawn: (cmd, args) => (spawned.push([cmd, args]), {}),
  };
  assert.equal(makeReleaseDeps({ ...base, releaseSession: false }).startSession, undefined);
  const d = makeReleaseDeps({ ...base, releaseSession: true });
  assert.equal(d.lastRoundtrip(), null);
  assert.equal(d.seen('k'), false);
  assert.equal(d.prMerged(10), true);
  assert.equal(d.readDone(), DONE);
  const r = d.startSession({ id: 'release-v9', title: 'Release', prs: [], items: [] }, TIP);
  assert.ok(r.id && !r.error);
  const [cmd, args] = spawned.at(-1);
  assert.equal(cmd, 'claude');
  assert.ok(args.includes('claude-sonnet-5-5'));
  assert.match(args[1], /STOP before step 5: do not tag/);
  d.waiting('k', 't', 'x');
  assert.deepEqual(spawned.at(-1).slice(0, 2), ['waiting', 'k']);
});

// ---- backlog.mjs waiting ----

const WAITING = `# Waiting on the user\n\n## W9 First\n- due: 2026-11-20\n\n## Someday\n\n## W3 Old\n- due: none\n`;

test('waitingEdit adds the next W number above Someday, once per key', () => {
  const r = waitingEdit(WAITING, {
    key: 'release-ready-x',
    title: 'X: ready to tag',
    due: '2026-11-17',
    text: 'go',
    date: '2026-11-17',
  });
  assert.equal(r.added, true);
  assert.equal(r.n, 10);
  const lines = r.text.split('\n');
  assert.ok(lines.indexOf('## W10 X: ready to tag') < lines.indexOf('## Someday'));
  assert.match(r.text, /- due: 2026-11-17\n/);
  const again = waitingEdit(r.text, {
    key: 'release-ready-x',
    title: 't',
    due: '2026-11-17',
    text: 'go',
    date: '2026-11-17',
  });
  assert.equal(again.added, false);
  assert.equal(again.text, r.text);
});

test('backlog.mjs waiting needs a key, a title and text', () => {
  const errs = [];
  const code = run(['waiting', 'k', '--vault', '/nope'], { err: s => errs.push(s), out: () => {} });
  assert.notEqual(code, 0);
});
