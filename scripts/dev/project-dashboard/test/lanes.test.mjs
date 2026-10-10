import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLanes } from '../lanes.mjs';

const NOW = new Date('2026-10-08T12:00:00.000Z');
const ROOT = '/fake/repo';
const min = m => new Date(NOW.getTime() - m * 60000).toISOString();

function agg(id, over = {}) {
  return {
    sessionId: id,
    title: `Title ${id}`,
    firstTs: min(500),
    lastTs: min(5),
    lastRequestTs: min(5),
    context: 50000,
    peak: 60000,
    model: 'claude-test-1',
    cwd: ROOT,
    branch: 'feature/a',
    folder: 'x',
    ...over,
  };
}

function liveOf(id, over = {}) {
  return {
    pid: 4242,
    sessionId: id,
    cwd: ROOT,
    name: null,
    status: 'idle',
    updatedAt: NOW.getTime() - 5 * 60000,
    hostSessionId: 'host-' + id,
    startedAt: NOW.getTime() - 3600000,
    alive: true,
    ...over,
  };
}

const lanes = (aggs, lives = [], prs = { items: [] }) =>
  buildLanes({
    transcripts: { sessions: aggs },
    live: { sessions: lives },
    prs,
    repoRoot: ROOT,
    now: NOW,
  });

const rowOf = (res, id) => res.rows.find(r => r.sessionId === id);

test('state: busy, waiting and stale', () => {
  const res = lanes(
    [
      agg('busy1'),
      agg('wait1'),
      agg('old1', { lastTs: min(90), lastRequestTs: min(90) }),
      agg('dead1'),
    ],
    [
      liveOf('busy1', { status: 'busy' }),
      liveOf('wait1'),
      liveOf('old1', { updatedAt: NOW.getTime() - 90 * 60000 }),
      liveOf('dead1', { alive: false }),
    ]
  );
  assert.equal(rowOf(res, 'busy1').state, 'busy');
  assert.equal(rowOf(res, 'wait1').state, 'waiting');
  assert.equal(rowOf(res, 'old1').state, 'stale');
  assert.equal(rowOf(res, 'dead1').state, 'stale');
  assert.equal(rowOf(res, 'dead1').pid, null);
  assert.equal(rowOf(res, 'busy1').pid, 4242);
  assert.equal(rowOf(res, 'wait1').hostSessionId, 'host-wait1');
});

test('level thresholds: amber from 200k, red from 250k', () => {
  const res = lanes([
    agg('a', { context: 199999 }),
    agg('b', { context: 200000 }),
    agg('c', { context: 249999 }),
    agg('d', { context: 250000 }),
  ]);
  assert.deepEqual(
    ['a', 'b', 'c', 'd'].map(id => rowOf(res, id).level),
    ['ok', 'amber', 'amber', 'red']
  );
});

test('doNotReuse needs an hour idle and more than 150k', () => {
  const old = { lastTs: min(61), lastRequestTs: min(61) };
  const res = lanes([
    agg('a', { ...old, context: 150001 }),
    agg('b', { ...old, context: 150000 }),
    agg('c', { lastTs: min(59), lastRequestTs: min(59), context: 200000 }),
    agg('d', { lastTs: min(60), lastRequestTs: min(60), context: 160000 }),
  ]);
  assert.equal(rowOf(res, 'a').doNotReuse, true);
  assert.equal(rowOf(res, 'b').doNotReuse, false);
  assert.equal(rowOf(res, 'c').doNotReuse, false);
  assert.equal(rowOf(res, 'd').doNotReuse, true);
});

test('the cache countdown exists for waiting rows only', () => {
  const res = lanes(
    [
      agg('w', { lastRequestTs: min(20) }),
      agg('b', { lastRequestTs: min(20) }),
      agg('s'),
      agg('cold', { lastTs: min(10), lastRequestTs: min(75) }),
    ],
    [liveOf('w'), liveOf('b', { status: 'busy' }), liveOf('s', { alive: false }), liveOf('cold')]
  );
  const w = rowOf(res, 'w');
  assert.equal(w.cacheMinutesLeft, 40);
  assert.equal(w.cacheColdAt, new Date(NOW.getTime() + 40 * 60000).toISOString());
  assert.equal(rowOf(res, 'b').cacheMinutesLeft, null);
  assert.equal(rowOf(res, 'b').cacheColdAt, null);
  assert.equal(rowOf(res, 's').cacheMinutesLeft, null);
  assert.equal(rowOf(res, 'cold').cacheMinutesLeft, 0);
});

test('the lane cap counts open sessions active in the last hour', () => {
  const res = lanes(
    [
      agg('l1'),
      agg('l2'),
      agg('old', { lastTs: min(120), lastRequestTs: min(120) }),
      agg('c1', { title: 'CLOSED (handed over 2026-10-07) Something' }),
    ],
    [liveOf('l1'), liveOf('l2')]
  );
  assert.equal(res.cap.max, 3);
  assert.equal(res.cap.used, 2);
  assert.deepEqual(Object.keys(res.cap).sort(), ['max', 'used']);
});

test('CLOSED titles fold: closed flag, not counted', () => {
  const res = lanes([
    agg('c1', { title: 'CLOSED (handed over) Done thing', lastTs: min(1) }),
    agg('o1', { title: 'Open thing', lastTs: min(30) }),
  ]);
  assert.equal(rowOf(res, 'c1').closed, true);
  assert.equal(rowOf(res, 'o1').closed, false);
  assert.equal(res.cap.used, 1);
  assert.equal(res.rows[0].sessionId, 'c1');
});

test('live name wins over the transcript title; titles are cut at 120 characters', () => {
  const res = lanes(
    [agg('a', { title: 'old title' }), agg('b', { title: 'x'.repeat(300) })],
    [liveOf('a', { name: 'Current name' })]
  );
  assert.equal(rowOf(res, 'a').title, 'Current name');
  assert.ok(rowOf(res, 'b').title.length <= 120);
});

test('rows: window of days, live sessions without a transcript, worktree and PR', () => {
  const res = lanes(
    [
      agg('recent', { branch: 'claude/x', cwd: ROOT + '/.claude/worktrees/admiring-austin' }),
      agg('ancient', { lastTs: min(60 * 24 * 5), lastRequestTs: min(60 * 24 * 5) }),
    ],
    [
      liveOf('newlive', { cwd: ROOT + '/.claude/worktrees/w2' }),
      liveOf('elsewhere', { cwd: '/some/other/project' }),
    ],
    {
      items: [
        { number: 77, branch: 'claude/x', state: 'OPEN' },
        { number: 5, branch: 'claude/x', state: 'MERGED' },
      ],
    }
  );
  const ids = res.rows.map(r => r.sessionId);
  assert.ok(ids.includes('recent'));
  assert.ok(ids.includes('newlive'));
  assert.ok(!ids.includes('ancient'));
  assert.ok(!ids.includes('elsewhere'));
  assert.equal(rowOf(res, 'recent').worktree, 'admiring-austin');
  assert.equal(rowOf(res, 'recent').pr, 77);
  assert.equal(rowOf(res, 'newlive').context, 0);
  assert.equal(rowOf(res, 'newlive').state, 'waiting');
  assert.equal(rowOf(res, 'newlive').cacheMinutesLeft, null);
});

test('rows are sorted by last activity, newest first', () => {
  const res = lanes([agg('a', { lastTs: min(50), context: 123456 }), agg('b', { lastTs: min(3) })]);
  assert.deepEqual(
    res.rows.map(r => r.sessionId),
    ['b', 'a']
  );
  assert.equal(rowOf(res, 'a').context, 123456);
});

test('a busy session file with no activity for 30 minutes is not trusted (pid reuse)', () => {
  const res = lanes(
    [
      agg('fresh'),
      agg('crashed', { lastTs: min(45), lastRequestTs: min(45) }),
      agg('gone', { lastTs: min(600) }),
    ],
    [
      liveOf('fresh', { status: 'busy', updatedAt: NOW.getTime() - 60000 }),
      liveOf('crashed', { status: 'busy', updatedAt: NOW.getTime() - 45 * 60000 }),
      liveOf('gone', { status: 'busy', updatedAt: NOW.getTime() - 600 * 60000, pid: 99 }),
    ]
  );
  assert.equal(rowOf(res, 'fresh').state, 'busy');
  // A quiet main thread while a subagent works is still busy.
  const sub = lanes(
    [agg('sub', { lastTs: min(45), lastRequestTs: min(45), subLastTs: min(2) })],
    [liveOf('sub', { status: 'busy', updatedAt: NOW.getTime() - 45 * 60000 })]
  );
  assert.equal(rowOf(sub, 'sub').state, 'busy');
  assert.equal(rowOf(res, 'crashed').state, 'waiting');
  assert.equal(rowOf(res, 'gone').state, 'stale');
});
