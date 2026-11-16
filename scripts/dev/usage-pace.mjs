// Weekly pace by active hours (vault Design/Weekly pace by active hours 2026-11-08.md).
// Pure functions: an hourly weekday/weekend profile of when the weekly limit is spent, built from
// the usage log readings ({ t: epoch ms, v: weekly percent }) in Europe/Copenhagen time, and the
// numbers the planner needs from it: expected percent by now, delta, projected percent at the
// reset and the active hours left. Times are absolute instants walked in half hour slots, so the
// clock changes (2026-10-25) need no special case. Only numbers are produced.

export const ZONE = 'Europe/Copenhagen';
export const HALF_HOUR = 30 * 60_000;
export const WEEK_MS = 7 * 24 * 3_600_000;
export const MAX_GAP_MS = 3 * 3_600_000; // longer between two readings: unknown, skipped
export const MAX_STEP = 25; // more points than this in one step: a stale or reset outlier
export const ACTIVE_SHARE = 0.03; // an hour is active when it carries at least 3% of a day
export const MIN_EXPECTED = 15; // below this expected percent a projection is too noisy
export const ON_PACE = 8; // points either way
export const MIN_WEEKDAYS = 8; // covered weekdays and weekend days for a measured profile
export const MIN_WEEKEND_DAYS = 3;

// Hourly shares of a day (index = local hour), from the 2026-10-12..11-08 log (percent of the
// day's points; 00-06, 10-15 and the other blocks spread evenly). Used when the log is short.
const WEEKDAY_BLOCKS = [[0, 6, 8], [7, 7, 5], [8, 8, 8], [9, 9, 2], [10, 15, 7], [16, 16, 7],
  [17, 17, 6], [18, 18, 10], [19, 19, 8], [20, 20, 8], [21, 21, 9], [22, 22, 10], [23, 23, 11]];
const WEEKEND_BLOCKS = [[0, 6, 19], [7, 7, 6], [8, 8, 8], [9, 9, 12], [10, 10, 11], [11, 11, 4],
  [12, 15, 18], [16, 18, 18], [19, 23, 5]];

function fromBlocks(blocks) {
  const shape = new Array(24).fill(0);
  for (const [a, b, total] of blocks) for (let h = a; h <= b; h++) shape[h] = total / (b - a + 1);
  return normalise(shape);
}

// Points per weekday and per weekend day in the same four weeks: 74% of the points on 5 days.
export const FALLBACK = {
  weekday: fromBlocks(WEEKDAY_BLOCKS),
  weekend: fromBlocks(WEEKEND_BLOCKS),
  weekdayPerDay: 74 / 5,
  weekendPerDay: 26 / 2,
};

function normalise(shape) {
  const total = shape.reduce((a, b) => a + b, 0);
  return total > 0 ? shape.map(v => v / total) : shape.map(() => 1 / shape.length);
}

// 3-hour circular moving average, so one odd night does not decide the shape.
export function smooth(shape) {
  const n = shape.length;
  return shape.map((_, i) => (shape[(i + n - 1) % n] + shape[i] + shape[(i + 1) % n]) / 3);
}

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  weekday: 'short',
  hour: '2-digit',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// { day: 'YYYY-MM-DD', hour: 0-23, weekend: bool } of an instant in Copenhagen.
export function localParts(ms) {
  const p = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    weekend: p.weekday === 'Sat' || p.weekday === 'Sun',
  };
}

// The valid steps between neighbouring readings: { t0, t1, delta }. A drop of more than 3 points
// is a weekly reset, a smaller one noise (as weeklyPoints in usage-week.mjs). Steps across a gap
// of more than three hours, across a reset, or with more than MAX_STEP points are skipped.
export function steps(readings) {
  const out = [];
  let prev = null;
  for (const r of readings) {
    if (prev === null) {
      prev = r;
      continue;
    }
    if (r.v >= prev.v) {
      const delta = r.v - prev.v;
      const gap = r.t - prev.t;
      if (gap > 0 && gap <= MAX_GAP_MS && delta <= MAX_STEP) out.push({ t0: prev.t, t1: r.t, delta });
      prev = r;
    } else if (prev.v - r.v > 3) {
      prev = r; // reset: the step across it is unknown
    }
  }
  return out;
}

// The profile from the readings of the `weeks` completed weeks before `weekStartMs`.
// { weekday, weekend: 24 shares each summing to 1, weekdayPerDay, weekendPerDay (points per
// covered day), weeks, source: 'measured' | 'fallback' }.
export function buildProfile(readings, { weekStartMs, weeks = 4 } = {}) {
  const from = weekStartMs - weeks * WEEK_MS;
  const inWindow = readings.filter(r => r.t >= from - MAX_GAP_MS && r.t <= weekStartMs);
  const raw = { weekday: new Array(24).fill(0), weekend: new Array(24).fill(0) };
  // A day counts when it has any reading, spent or not (idle days are real); days without readings
  // are unknown, and the day the new week starts in is a partial day. A real log has readings
  // around sessions only, so covered slots are no measure of coverage.
  const days = { weekday: new Set(), weekend: new Set() };
  const edge = localParts(weekStartMs).day;
  for (const r of inWindow) {
    if (r.t < from) continue;
    const p = localParts(r.t);
    if (p.day !== edge) days[p.weekend ? 'weekend' : 'weekday'].add(p.day);
  }
  for (const s of steps(inWindow)) {
    if (s.t0 < from) continue;
    const slots = Math.max(1, Math.round((s.t1 - s.t0) / HALF_HOUR));
    const per = s.delta / slots;
    const len = (s.t1 - s.t0) / slots;
    for (let i = 0; i < slots; i++) {
      const p = localParts(s.t0 + len * (i + 0.5));
      if (p.day !== edge) raw[p.weekend ? 'weekend' : 'weekday'][p.hour] += per;
    }
  }
  const wd = days.weekday.size;
  const we = days.weekend.size;
  const total = type => raw[type].reduce((a, b) => a + b, 0);
  if (wd < MIN_WEEKDAYS || we < MIN_WEEKEND_DAYS || total('weekday') <= 0 || total('weekend') <= 0) {
    return { ...FALLBACK, weeks: 0, source: 'fallback' };
  }
  return {
    weekday: normalise(smooth(raw.weekday)),
    weekend: normalise(smooth(raw.weekend)),
    weekdayPerDay: total('weekday') / wd,
    weekendPerDay: total('weekend') / we,
    weeks: Math.round((wd + we) / 7),
    source: 'measured',
  };
}

// Percent of the week spent in the half hour slot starting at `ms` (unnormalised).
function slotWeight(profile, ms) {
  const p = localParts(ms);
  const shape = p.weekend ? profile.weekend : profile.weekday;
  const perDay = p.weekend ? profile.weekendPerDay : profile.weekdayPerDay;
  return (perDay * shape[p.hour]) / 2;
}

// Expected percent by `nowMs` for the week that started at `weekStartMs` (7 days long), the hours
// left before the reset that the profile calls active, and the weekly share per day type.
export function expectedAt(profile, weekStartMs, nowMs) {
  const end = weekStartMs + WEEK_MS;
  let total = 0;
  let done = 0;
  let activeLeft = 0;
  for (let ms = weekStartMs; ms < end; ms += HALF_HOUR) {
    const w = slotWeight(profile, ms);
    total += w;
    const frac = Math.min(1, Math.max(0, (nowMs - ms) / HALF_HOUR));
    done += w * frac;
    if (frac < 1) {
      const p = localParts(ms);
      const shape = p.weekend ? profile.weekend : profile.weekday;
      if (shape[p.hour] >= ACTIVE_SHARE) activeLeft += (1 - frac) / 2;
    }
  }
  return { expected: total > 0 ? (100 * done) / total : 0, activeHoursLeft: activeLeft };
}

const round1 = v => Math.round(v * 10) / 10;

// The pace numbers. Null fields mean unknown: projected is null before MIN_EXPECTED percent of
// the week is expected ("too early"). All percent values are points of the weekly limit.
export function paceNow({ profile, weekStartMs, nowMs, actual }) {
  const { expected, activeHoursLeft } = expectedAt(profile, weekStartMs, nowMs);
  const projected =
    expected >= MIN_EXPECTED ? Math.min(100, actual + (100 - expected) * (actual / expected)) : null;
  return {
    expected: round1(expected),
    delta: round1(actual - expected),
    projected: projected === null ? null : round1(projected),
    activeHoursLeft: round1(activeHoursLeft),
    profileWeeks: profile.weeks,
    source: profile.source,
    onPace: Math.abs(actual - expected) <= ON_PACE,
  };
}

// The reset the weekly week count from: Saturday 05:00Z (06:00 local in winter, 07:00 in summer)
// at or before `nowMs`.
export function lastReset(nowMs) {
  const d = new Date(nowMs);
  const sat = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 5);
  const back = (d.getUTCDay() + 1) % 7; // days since Saturday
  let t = sat - back * 86_400_000;
  if (t > nowMs) t -= WEEK_MS;
  return t;
}

// The one source for the start of the week being measured: the reset time the caller passes
// (`--weekly-resets`, the weekly limit's own reset, minus 7 days) when there is one, else the
// last Saturday 05:00Z reset at or before `nowMs`.
export function weekStartFor(nowMs, weeklyResets) {
  return weeklyResets === undefined ? lastReset(nowMs) : Date.parse(weeklyResets) - WEEK_MS;
}

// Hours of a day type the profile calls active, for the notes.
export function activeHours(profile) {
  const count = shape => shape.filter(v => v >= ACTIVE_SHARE).length;
  return { weekday: count(profile.weekday), weekend: count(profile.weekend) };
}
