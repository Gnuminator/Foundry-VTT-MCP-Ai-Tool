// Tests for `npm run ci:health` (scripts/ci-health.mjs) and its lines in the Weekly check note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCiHealth, ciLines, formatTable, lastRunLine, summarizeRuns } from '../ci-health.mjs';
import { sectionFor } from './weekly-check-note.mjs';

const NOW = new Date('2026-11-18T12:00:00Z');
const run = (createdAt, minutes, conclusion, event = 'pull_request', status = 'completed') => ({
  createdAt,
  startedAt: createdAt,
  updatedAt: new Date(Date.parse(createdAt) + minutes * 60_000).toISOString(),
  status,
  conclusion,
  event,
});

// Three runs worked out by hand: 10 min success, 20 min failure on main, 30 min success.
const THREE = [
  run('2026-11-18T10:00:00Z', 10, 'success'),
  run('2026-11-18T08:00:00Z', 20, 'failure', 'push'),
  run('2026-11-16T08:00:00Z', 30, 'success'),
];

test('three runs match a hand count, per window', () => {
  const [day, week] = buildCiHealth(THREE, NOW);
  assert.equal(day.runs, 2);
  assert.equal(day.success, 1);
  assert.equal(day.failed, 1);
  assert.equal(day.failPercent, 50);
  assert.equal(day.redMain, 1);
  assert.equal(day.medianMinutes, 15); // sorted [10, 20], mean of the middle two
  assert.equal(day.p90Minutes, 20);
  assert.equal(week.runs, 3);
  assert.equal(week.success, 2);
  assert.equal(week.failPercent, 33.3);
  assert.equal(week.medianMinutes, 20); // sorted [10, 20, 30]
  assert.equal(week.p90Minutes, 30);
});

test('cancelled and running runs are counted but not timed or failed', () => {
  const s = summarizeRuns(
    [
      run('2026-11-18T09:00:00Z', 3, 'cancelled'),
      run('2026-11-18T09:30:00Z', 0, '', 'pull_request', 'in_progress'),
      run('2026-11-18T09:40:00Z', 12, 'success'),
    ],
    NOW,
    24
  );
  assert.deepEqual(
    [s.runs, s.running, s.cancelled, s.failed, s.success, s.medianMinutes],
    [3, 1, 1, 0, 1, 12]
  );
});

test('a timeout or startup failure is red; a cut-off window is flagged and writes no ci lines', () => {
  const s = summarizeRuns(
    [
      run('2026-11-18T09:00:00Z', 25, 'timed_out', 'push'),
      run('2026-11-18T09:10:00Z', 0, 'startup_failure'),
      run('2026-11-18T09:40:00Z', 12, 'success'),
    ],
    NOW,
    24
  );
  assert.deepEqual([s.failed, s.success, s.redMain, s.failPercent], [2, 1, 1, 66.7]);
  const cut = buildCiHealth(THREE, NOW, 3); // the list is as long as the limit: the 7 day window is cut
  assert.equal(cut[1].truncated, true);
  assert.equal(cut[0].truncated, false); // the 24 h window starts after the oldest run
  assert.deepEqual(ciLines(cut[1]), []);
  assert.match(formatTable(cut), /cut off at the newest 1000 runs.*last 7 days/);
  assert.equal(buildCiHealth(THREE, NOW)[1].truncated, false);
});

test('runs outside the window and an empty list give n/a, not 0', () => {
  const s = summarizeRuns([run('2026-11-01T10:00:00Z', 10, 'success')], NOW, 24 * 7);
  assert.equal(s.runs, 0);
  assert.equal(s.failPercent, null);
  assert.equal(s.medianMinutes, null);
  assert.match(formatTable(buildCiHealth([], NOW)), /median minutes\s+n\/a\s+n\/a/);
});

test('lastRunLine names the conclusion and date, or says there was no run', () => {
  assert.equal(
    lastRunLine('release', { conclusion: 'success', createdAt: '2026-11-20T08:00:00Z' }),
    'last release: success (2026-11-20)'
  );
  assert.equal(
    lastRunLine('pi-images', {
      conclusion: '',
      status: 'in_progress',
      createdAt: '2026-11-25T01:00:00Z',
    }),
    'last pi-images: in_progress (2026-11-25)'
  );
  assert.equal(lastRunLine('mutation-core', undefined), 'last mutation-core: no run');
});

test('the table has both windows and one row per figure', () => {
  const text = formatTable(buildCiHealth(THREE, NOW));
  assert.match(text, /^CI health\s+last 24 hours\s+last 7 days$/m);
  assert.match(text, /^runs\s+2\s+3$/m);
  assert.match(text, /^red main runs\s+1\s+1$/m);
});

test('the Saturday section gets the ci lines, and none when gh gave no runs', () => {
  const [, week] = buildCiHealth(THREE, NOW);
  assert.deepEqual(ciLines(week), [
    '- ci-runs: 3',
    '- ci-failed: 1',
    '- ci-cancelled: 0',
    '- ci-red-main: 1',
    '- ci-median-minutes: 20',
    '- ci-p90-minutes: 30',
  ]);
  const report = { window: { from: '2026-11-15', to: '2026-11-18' }, figures: [], ci: week };
  assert.match(sectionFor(report), /- ci-runs: 3\n- ci-failed: 1/);
  assert.doesNotMatch(sectionFor({ ...report, ci: undefined }), /ci-/);
});
