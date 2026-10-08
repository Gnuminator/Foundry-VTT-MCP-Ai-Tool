import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrs, parsePrList, parseRunList, resetPrCache } from '../gh.mjs';

const PR_KEYS = [
  'number',
  'title',
  'state',
  'draft',
  'branch',
  'headSha',
  'updatedAt',
  'url',
  'checks',
];
const CHECK_KEYS = ['pass', 'fail', 'pending', 'failing'];
const RUN_KEYS = ['workflow', 'title', 'status', 'conclusion', 'headSha', 'createdAt'];

function pr(over = {}) {
  return {
    number: 1,
    title: 'a pr',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'claude/x',
    headRefOid: 'abc123',
    updatedAt: '2026-10-01T10:00:00Z',
    url: 'https://github.com/o/r/pull/1',
    statusCheckRollup: [],
    extra: 'dropped',
    ...over,
  };
}

test('parsePrList keeps exactly the PrItem keys', () => {
  const [item] = parsePrList([pr()]);
  assert.deepEqual(Object.keys(item).sort(), [...PR_KEYS].sort());
  assert.deepEqual(Object.keys(item.checks).sort(), [...CHECK_KEYS].sort());
  assert.equal(item.draft, false);
  assert.equal(item.branch, 'claude/x');
  assert.equal(item.headSha, 'abc123');
});

test('parsePrList accepts JSON text and survives junk', () => {
  assert.equal(parsePrList(JSON.stringify([pr()])).length, 1);
  assert.deepEqual(parsePrList('not json'), []);
  assert.deepEqual(parsePrList(null), []);
  assert.deepEqual(parsePrList({}), []);
  assert.equal(parsePrList([null, 3, pr()]).length, 1);
});

test('checks: CheckRun and StatusContext entries are counted by outcome', () => {
  const rollup = [
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'CheckRun', name: 'neutral', status: 'COMPLETED', conclusion: 'NEUTRAL' },
    { __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'slow', status: 'COMPLETED', conclusion: 'TIMED_OUT' },
    { __typename: 'CheckRun', name: 'cancel', status: 'COMPLETED', conclusion: 'CANCELLED' },
    { __typename: 'CheckRun', name: 'gate', status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' },
    { __typename: 'CheckRun', name: 'running', status: 'IN_PROGRESS', conclusion: '' },
    { __typename: 'CheckRun', name: 'queued', status: 'QUEUED', conclusion: '' },
    { __typename: 'StatusContext', context: 'ci/ok', state: 'SUCCESS' },
    { __typename: 'StatusContext', context: 'ci/bad', state: 'FAILURE' },
    { __typename: 'StatusContext', context: 'ci/err', state: 'ERROR' },
    { __typename: 'StatusContext', context: 'ci/wait', state: 'PENDING' },
  ];
  const [item] = parsePrList([pr({ statusCheckRollup: rollup })]);
  assert.equal(item.checks.pass, 4);
  assert.equal(item.checks.fail, 6);
  assert.equal(item.checks.pending, 3);
  assert.deepEqual(item.checks.failing, ['unit', 'slow', 'cancel', 'gate', 'ci/bad']);
});

test('checks: failing names are capped at 5 and cut to 60 characters', () => {
  const rollup = Array.from({ length: 8 }, (_, i) => ({
    __typename: 'CheckRun',
    name: `${i}-${'n'.repeat(100)}`,
    status: 'COMPLETED',
    conclusion: 'FAILURE',
  }));
  const [item] = parsePrList([pr({ statusCheckRollup: rollup })]);
  assert.equal(item.checks.fail, 8);
  assert.equal(item.checks.failing.length, 5);
  for (const name of item.checks.failing) assert.equal(name.length, 60);
});

test('titles are cut to 120 characters', () => {
  const [item] = parsePrList([pr({ title: 'x'.repeat(300) })]);
  assert.equal(item.title.length, 120);
  const [run] = parseRunList([
    {
      workflowName: 'CI',
      displayTitle: 'y'.repeat(300),
      status: 'completed',
      conclusion: 'success',
      headSha: 'a',
      createdAt: 't',
    },
  ]);
  assert.equal(run.title.length, 120);
});

test('sort: open with failing checks, then open, then the rest by updatedAt desc', () => {
  const red = [
    { __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE' },
  ];
  const items = parsePrList([
    pr({ number: 1, state: 'MERGED', updatedAt: '2026-10-05T00:00:00Z' }),
    pr({ number: 2, state: 'OPEN', updatedAt: '2026-10-02T00:00:00Z' }),
    pr({ number: 3, state: 'CLOSED', updatedAt: '2026-10-07T00:00:00Z' }),
    pr({ number: 4, state: 'OPEN', updatedAt: '2026-10-01T00:00:00Z', statusCheckRollup: red }),
    pr({ number: 5, state: 'OPEN', updatedAt: '2026-10-03T00:00:00Z' }),
    pr({ number: 6, state: 'MERGED', updatedAt: '2026-10-06T00:00:00Z', statusCheckRollup: red }),
  ]);
  assert.deepEqual(
    items.map(p => p.number),
    [4, 5, 2, 3, 6, 1]
  );
});

test('parseRunList keeps exactly the RunItem keys', () => {
  const [run] = parseRunList(
    JSON.stringify([
      {
        workflowName: 'CI',
        displayTitle: 'merge',
        status: 'completed',
        conclusion: 'success',
        headSha: 'abc',
        createdAt: '2026-10-01T00:00:00Z',
        databaseId: 9,
      },
    ])
  );
  assert.deepEqual(Object.keys(run).sort(), [...RUN_KEYS].sort());
  assert.equal(run.workflow, 'CI');
  assert.equal(run.conclusion, 'success');
});

function fakeRun(prs, runs) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    const which = args[0];
    const value = which === 'pr' ? prs : runs;
    if (value instanceof Error) throw value;
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  return { run, calls };
}

test('getPrs runs the two fixed gh commands without a shell', async () => {
  resetPrCache();
  const { run, calls } = fakeRun(
    [pr()],
    [
      {
        workflowName: 'CI',
        displayTitle: 't',
        status: 'completed',
        conclusion: 'success',
        headSha: 'a',
        createdAt: 'c',
      },
    ]
  );
  const now = new Date('2026-10-08T12:00:00Z');
  const out = await getPrs({ now, force: true, run });
  assert.equal(out.error, null);
  assert.equal(out.asOf, now.toISOString());
  assert.equal(out.items.length, 1);
  assert.equal(out.mainRuns.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c[0] === 'gh'));
  const prCall = calls.find(c => c[1] === 'pr');
  const runCall = calls.find(c => c[1] === 'run');
  assert.ok(prCall.includes('Gnuminator/Foundry-VTT-MCP-Ai-Tool'));
  assert.ok(
    prCall.includes('statusCheckRollup') ||
      prCall.some(a => String(a).includes('statusCheckRollup'))
  );
  assert.ok(runCall.includes('main'));
});

test('getPrs caches for 60 s unless forced', async () => {
  resetPrCache();
  const { run, calls } = fakeRun([pr()], []);
  const t0 = new Date('2026-10-08T12:00:00Z');
  await getPrs({ now: t0, force: true, run });
  assert.equal(calls.length, 2);
  await getPrs({ now: new Date(t0.getTime() + 30_000), run });
  assert.equal(calls.length, 2);
  await getPrs({ now: new Date(t0.getTime() + 61_000), run });
  assert.equal(calls.length, 4);
  await getPrs({ now: new Date(t0.getTime() + 62_000), force: true, run });
  assert.equal(calls.length, 6);
});

test('getPrs keeps the last good data and sets a short error when gh fails', async () => {
  resetPrCache();
  const good = fakeRun(
    [pr({ number: 7 })],
    [
      {
        workflowName: 'CI',
        displayTitle: 't',
        status: 'completed',
        conclusion: 'success',
        headSha: 'a',
        createdAt: 'c',
      },
    ]
  );
  const t0 = new Date('2026-10-08T12:00:00Z');
  const first = await getPrs({ now: t0, force: true, run: good.run });
  assert.equal(first.error, null);

  const long = new Error('x');
  long.stderr = `gh: ${'network down '.repeat(60)}\nsecond line`;
  const bad = fakeRun(long, long);
  const second = await getPrs({ now: new Date(t0.getTime() + 120_000), force: true, run: bad.run });
  assert.equal(typeof second.error, 'string');
  assert.ok(second.error.length <= 150);
  assert.ok(!second.error.includes('second line'));
  assert.deepEqual(
    second.items.map(p => p.number),
    [7]
  );
  assert.equal(second.mainRuns.length, 1);
  assert.equal(second.asOf, t0.toISOString());

  // a failed call is not cached: the next poll tries again and recovers
  const third = await getPrs({ now: new Date(t0.getTime() + 121_000), run: good.run });
  assert.equal(third.error, null);
});

test('getPrs without any good data returns empty lists and an error', async () => {
  resetPrCache();
  const enoent = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
  const { run } = fakeRun(enoent, enoent);
  const out = await getPrs({ force: true, run });
  assert.deepEqual(out.items, []);
  assert.deepEqual(out.mainRuns, []);
  assert.equal(out.asOf, null);
  assert.match(out.error, /gh/);
  assert.ok(out.error.length <= 150);
});

test('getPrs: one failing command keeps the other fresh', async () => {
  resetPrCache();
  const { run } = fakeRun([pr({ number: 3 })], new Error('boom'));
  const out = await getPrs({ force: true, run });
  assert.deepEqual(
    out.items.map(p => p.number),
    [3]
  );
  assert.deepEqual(out.mainRuns, []);
  assert.equal(out.error, 'boom');
});
