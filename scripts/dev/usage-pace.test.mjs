// Tests for the weekly pace profile (usage-pace.mjs): the profile from hourly readings, gaps,
// the clock change of 2026-10-25, reset outliers, the short-log fallback and the pace numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK,
  WEEK_MS,
  activeHours,
  buildProfile,
  expectedAt,
  lastReset,
  localParts,
  paceNow,
  smooth,
  steps,
} from './usage-pace.mjs';

const HOUR = 3_600_000;
const START = Date.UTC(2026, 9, 10, 5); // Saturday 2026-10-10 05:00Z, four weeks before WEEK4
const WEEK4 = START + 4 * WEEK_MS; // Saturday 2026-11-07 05:00Z

// Hourly readings: weekday evenings (local 17 to 22) cost 2 points an hour, weekend mornings
// (local 9 to 11) 3 points an hour; the count restarts at each Saturday 05:00Z. `skip` drops
// readings, `extra` adds [t, v] readings.
function log({ from = START, to = WEEK4, skip = () => false, extra = [] } = {}) {
  const out = [];
  let v = 0;
  for (let t = from; t <= to; t += HOUR) {
    if ((t - START) % WEEK_MS === 0) v = 0;
    else {
      const p = localParts(t - HOUR / 2);
      v += p.weekend ? (p.hour >= 9 && p.hour <= 11 ? 3 : 0) : p.hour >= 17 && p.hour <= 22 ? 2 : 0;
    }
    if (!skip(t)) out.push({ t, v });
  }
  for (const [t, value] of extra) out.push({ t, v: value });
  return out.sort((a, b) => a.t - b.t);
}

const sum = (shape, a, b) => shape.slice(a, b + 1).reduce((x, y) => x + y, 0);

test('local time follows Copenhagen across the 2026-10-25 clock change', () => {
  assert.equal(localParts(Date.UTC(2026, 9, 25, 0, 30)).hour, 2); // 02:30 CEST
  assert.equal(localParts(Date.UTC(2026, 9, 25, 1, 30)).hour, 2); // 02:30 CET, same hour again
  assert.equal(localParts(Date.UTC(2026, 9, 25, 2, 0)).hour, 3);
  assert.equal(localParts(Date.UTC(2026, 9, 24, 22, 30)).day, '2026-10-25');
  assert.equal(localParts(Date.UTC(2026, 9, 25, 12)).weekend, true);
  assert.equal(localParts(Date.UTC(2026, 9, 26, 12)).weekend, false);
});

test('the measured profile finds the evening and the weekend morning', () => {
  const p = buildProfile(log(), { weekStartMs: WEEK4 });
  assert.equal(p.source, 'measured');
  assert.equal(p.weeks, 4);
  // The shape sits on local hours although the log crosses the clock change.
  assert.ok(sum(p.weekday, 16, 23) > 0.99, 'weekday evening');
  assert.ok(sum(p.weekend, 8, 12) > 0.99, 'weekend morning');
  assert.ok(Math.abs(p.weekdayPerDay - 12) < 0.5, `weekday ${p.weekdayPerDay}`);
  assert.ok(Math.abs(p.weekendPerDay - 9) < 0.5, `weekend ${p.weekendPerDay}`);
  assert.deepEqual(activeHours(p), { weekday: 8, weekend: 5 });
  assert.ok(Math.abs(p.weekday.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('a day without readings is skipped, not counted as zero', () => {
  const day = Date.UTC(2026, 9, 21);
  const gap = log({ skip: t => t >= day && t < day + 24 * HOUR });
  const p = buildProfile(gap, { weekStartMs: WEEK4 });
  assert.equal(p.source, 'measured');
  assert.ok(Math.abs(p.weekdayPerDay - 12) < 0.5, `weekday ${p.weekdayPerDay}`);
  // a step across a gap of more than three hours is dropped
  const s = steps([
    { t: 0, v: 10 },
    { t: 4 * HOUR, v: 20 },
    { t: 5 * HOUR, v: 22 },
  ]);
  assert.deepEqual(s, [{ t0: 4 * HOUR, t1: 5 * HOUR, delta: 2 }]);
});

test('a stale 95 reading and a reset do not reach the shape', () => {
  const noon = Date.UTC(2026, 9, 24, 10, 30); // 2026-10-24 12:30 local (Saturday)
  const tue = Date.UTC(2026, 9, 20, 10, 30); // Tuesday 12:30 local
  const p = buildProfile(log({ extra: [[tue, 95], [noon, 95]] }), { weekStartMs: WEEK4 });
  assert.equal(p.source, 'measured');
  assert.ok(p.weekday[12] < 0.02, `weekday noon ${p.weekday[12]}`);
  assert.ok(p.weekend[12] < 0.2, `weekend noon ${p.weekend[12]}`);
  assert.ok(Math.abs(p.weekdayPerDay - 12) < 1.5, `weekday ${p.weekdayPerDay}`);
  // resets never count as spending
  const s = steps([
    { t: 0, v: 90 },
    { t: HOUR, v: 2 },
    { t: 2 * HOUR, v: 4 },
  ]);
  assert.deepEqual(s, [{ t0: HOUR, t1: 2 * HOUR, delta: 2 }]);
});

test('a sparse burst-only log (readings around evening sessions) keeps the points a day', () => {
  // readings only from local 17 to 23 on weekdays and 09 to 12 on weekends: the real log's shape
  const sparse = log({
    skip: t => {
      const p = localParts(t);
      return p.weekend ? p.hour < 9 || p.hour > 12 : p.hour < 17;
    },
  });
  const p = buildProfile(sparse, { weekStartMs: WEEK4 });
  assert.equal(p.source, 'measured');
  assert.ok(p.weekdayPerDay <= 12.5 && p.weekdayPerDay > 8, `weekday ${p.weekdayPerDay}`);
  assert.ok(p.weekendPerDay <= 9.5 && p.weekendPerDay > 6, `weekend ${p.weekendPerDay}`);
  assert.ok(sum(p.weekday, 16, 23) > 0.95);
});

test('a short log uses the fallback table', () => {
  const short = log({ from: WEEK4 - WEEK_MS, to: WEEK4 });
  const p = buildProfile(short, { weekStartMs: WEEK4 });
  assert.equal(p.source, 'fallback');
  assert.equal(p.weeks, 0);
  assert.equal(p.weekday, FALLBACK.weekday);
  assert.equal(buildProfile([], { weekStartMs: WEEK4 }).source, 'fallback');
  assert.ok(Math.abs(FALLBACK.weekday.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(FALLBACK.weekday[9] < FALLBACK.weekday[20], 'evening above morning');
});

test('smoothing spreads a spike over three hours', () => {
  const spike = new Array(24).fill(0);
  spike[0] = 3;
  const s = smooth(spike);
  assert.deepEqual([s[23], s[0], s[1]], [1, 1, 1]);
});

test('expected percent reaches 100 at the reset, in the clock change week too', () => {
  const p = buildProfile(log(), { weekStartMs: WEEK4 });
  for (const start of [WEEK4, Date.UTC(2026, 9, 24, 5)]) {
    assert.ok(Math.abs(expectedAt(p, start, start + WEEK_MS).expected - 100) < 1e-6);
    assert.equal(expectedAt(p, start, start).expected, 0);
    // 50 active hours: 8 each weekday evening, 5 each weekend morning
    assert.equal(expectedAt(p, start, start).activeHoursLeft, 50);
  }
  // Monday morning: only the weekend (18 of 78 points) has passed
  const mon = expectedAt(p, WEEK4, Date.UTC(2026, 10, 9, 8)).expected;
  assert.ok(Math.abs(mon - (100 * 18) / 78) < 1, `monday ${mon}`);
});

test('pace: delta, projection at the reset, too early and active hours left', () => {
  const p = buildProfile(log(), { weekStartMs: WEEK4 });
  const wedNight = Date.UTC(2026, 10, 12, 23); // Thursday 00:00 local
  const { expected } = expectedAt(p, WEEK4, wedNight);
  const behind = paceNow({ profile: p, weekStartMs: WEEK4, nowMs: wedNight, actual: expected * 0.9 });
  assert.ok(behind.delta < 0);
  assert.equal(behind.onPace, Math.abs(behind.delta) <= 8);
  assert.equal(
    paceNow({ profile: p, weekStartMs: WEEK4, nowMs: wedNight, actual: expected - 3 }).onPace,
    true
  );
  assert.ok(Math.abs(behind.projected - 90) < 0.5, `projected ${behind.projected}`);
  assert.equal(behind.profileWeeks, 4);
  const ahead = paceNow({ profile: p, weekStartMs: WEEK4, nowMs: wedNight, actual: expected + 20 });
  assert.equal(ahead.onPace, false);
  assert.equal(ahead.projected, 100); // capped
  // Saturday noon: 11.5 percent expected, below the 15 needed for a projection
  const early = paceNow({ profile: p, weekStartMs: WEEK4, nowMs: WEEK4 + 6 * HOUR, actual: 5 });
  assert.equal(early.projected, null);
  assert.ok(early.activeHoursLeft > 45);
});

test('the weekly reset is Saturday 05:00Z', () => {
  assert.equal(lastReset(Date.UTC(2026, 10, 11, 12)), WEEK4);
  assert.equal(lastReset(Date.UTC(2026, 10, 14, 4)), WEEK4);
  assert.equal(lastReset(Date.UTC(2026, 10, 14, 5)), WEEK4 + WEEK_MS);
  assert.equal(lastReset(WEEK4), WEEK4);
  assert.equal(lastReset(WEEK4 + 6 * 24 * HOUR + 3 * HOUR), WEEK4);
});
