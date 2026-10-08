// Measured Usage log rows and the weekly summary (D-102 line 4, D-103 line 5). The page keeps its
// rows in `usage-log.json` in the data folder and renders two vault notes from them:
//   Dev/Foundry AI Tool/Usage log (measured).md     a start and an end row per session
//   Dev/Foundry AI Tool/Usage weekly (measured).md  one summary per plan week
// Each PC owns one "## PC <name>" section of each note and rewrites only that section, so two PCs
// running the page never overwrite each other's rows.
//
//   updateUsageState(state, { sessions, lanes, plan, messages, now, pc }) -> state
//   usageSummary(state) -> the snapshot's `usageLog` part
//   syncUsageToVault({ state, vaultDir, now, force, push }) -> state (with `push` set)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pushPaths } from './vault.mjs';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const AMBER = 200000;
const RED = 250000;
const PLAN_MATCH_MS = HOUR;
const PLAN_HISTORY_MS = 3 * DAY;
const WEEKS_KEPT = 12;
const STATE_VERSION = 1;

export const NOTES_DIR = 'Dev/Foundry AI Tool';
export const LOG_NOTE = `${NOTES_DIR}/Usage log (measured).md`;
export const WEEKLY_NOTE = `${NOTES_DIR}/Usage weekly (measured).md`;
const COMMIT_MESSAGE = 'project dashboard: measured usage';

function toMs(v) {
  const t = typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(t) ? t : null;
}

function iso(ms) {
  return ms == null ? null : new Date(ms).toISOString();
}

function localMidnight(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function localStamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function cutTitle(t) {
  const s = String(t || '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > 120 ? s.slice(0, 119) + '…' : s;
}

// The PC's section name: PROJECT_DASHBOARD_PC, else the host name when the state was first made
// (kept in the state, so renaming the PC changes nothing until the variable is set). A section
// under an old name stays in the notes until someone deletes it by hand.
export function pcName(env = process.env) {
  return String(env.PROJECT_DASHBOARD_PC || os.hostname()).slice(0, 60);
}

export function emptyUsageState(now = new Date(), pc = pcName()) {
  return {
    version: STATE_VERSION,
    pc: String(pc).slice(0, 60),
    // The first run starts the log at local midnight of that day.
    since: iso(localMidnight(now.getTime())),
    sessions: {},
    planHistory: [],
    weeks: {},
    push: null,
    waitingSince: null,
    lastPushAttempt: null,
    pushedHash: null,
  };
}

export function loadUsageState(dataDir, now = new Date(), env = process.env) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dataDir, 'usage-log.json'), 'utf8'));
    if (s && s.version === STATE_VERSION && s.sessions && typeof s.sessions === 'object') {
      if (env.PROJECT_DASHBOARD_PC) s.pc = pcName(env);
      return s;
    }
  } catch {
    // no state yet
  }
  return emptyUsageState(now, pcName(env));
}

export function saveUsageState(dataDir, state) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'usage-log.json');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

function planReading(plan) {
  const at = toMs(plan?.asOf);
  if (at == null) return null;
  const pick = kind => {
    const w = (plan.windows || []).find(x => x.kind === kind);
    return w && Number.isFinite(w.percentUsed) ? w.percentUsed : null;
  };
  const fiveHour = pick('five_hour');
  const weekly = pick('seven_day');
  if (fiveHour == null && weekly == null) return null;
  return { at, fiveHour, weekly };
}

// The plan reading closest to `ms`, if one lies within an hour of it.
function planAt(history, ms) {
  let best = null;
  for (const r of history) {
    const d = Math.abs(r.at - ms);
    if (d <= PLAN_MATCH_MS && (!best || d < Math.abs(best.at - ms))) best = r;
  }
  return best ? { fiveHour: best.fiveHour, weekly: best.weekly } : { fiveHour: null, weekly: null };
}

function zero() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function add(t, u) {
  t.input += u.input;
  t.output += u.output;
  t.cacheRead += u.cacheRead;
  t.cacheWrite += u.cacheWrite;
}

function total(t) {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

function localDate(ms) {
  return localStamp(ms).slice(0, 10);
}

// The plan week that holds `nowMs`: from the weekly reset time when known, else Monday to Monday.
export function weekWindow(nowMs, plan) {
  const w = (plan?.windows || []).find(x => x.kind === 'seven_day');
  let end = toMs(w?.resetsAt);
  if (end != null) {
    while (end <= nowMs) end += WEEK;
    while (end - WEEK > nowMs) end -= WEEK;
    return { start: end - WEEK, end };
  }
  const d = new Date(nowMs);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  const start = monday.getTime();
  return { start, end: new Date(start).setDate(monday.getDate() + 7) };
}

function buildWeek({ win, sessions, titles, messages, history }) {
  const main = zero();
  const sub = zero();
  const days = new Map();
  for (const m of messages.values()) {
    const t = toMs(m.ts);
    if (t == null || t < win.start || t >= win.end) continue;
    add(m.sub ? sub : main, m.tokens);
    const key = localDate(t);
    const day = days.get(key) || { date: key, main: 0, sub: 0 };
    day[m.sub ? 'sub' : 'main'] += total(m.tokens);
    days.set(key, day);
  }
  const active = sessions.filter(s => {
    const first = toMs(s.firstTs);
    const last = toMs(s.lastTs);
    return first != null && last != null && first < win.end && last >= win.start;
  });
  const name = s => cutTitle(titles.get(s.sessionId) || s.title) || s.sessionId.slice(0, 8);
  const lastPlan = history
    .filter(r => r.at >= win.start && r.at < win.end && r.weekly != null)
    .sort((a, b) => b.at - a.at)[0];
  return {
    start: iso(win.start),
    end: iso(win.end),
    started: active.filter(s => toMs(s.firstTs) >= win.start).length,
    active: active.length,
    over200: active
      .filter(s => s.peak >= AMBER && s.peak < RED)
      .sort((a, b) => b.peak - a.peak)
      .map(name),
    over250: active
      .filter(s => s.peak >= RED)
      .sort((a, b) => b.peak - a.peak)
      .map(name),
    main,
    sub,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    weekly: lastPlan ? lastPlan.weekly : null,
    weeklyAt: lastPlan ? iso(lastPlan.at) : null,
  };
}

/**
 * Bring the rows up to date with one scan.
 * sessions: the scanner's main-chain aggregates; lanes: the lane rows; plan: the plan gauges;
 * messages: the scanner's de-duplicated messages (Map id -> { ts, tokens, sub }).
 */
export function updateUsageState(state, { sessions, lanes, plan, messages, now = new Date() }) {
  const nowMs = now.getTime();
  const reading = planReading(plan);
  if (reading && !state.planHistory.some(r => r.at === reading.at)) state.planHistory.push(reading);
  state.planHistory = state.planHistory.filter(r => nowMs - r.at <= PLAN_HISTORY_MS);

  const sinceMs = toMs(state.since) ?? 0;
  const laneById = new Map((lanes?.rows || []).map(r => [r.sessionId, r]));
  const titles = new Map();
  for (const s of sessions) {
    const lane = laneById.get(s.sessionId);
    titles.set(s.sessionId, (lane && lane.title !== '(untitled)' && lane.title) || s.title || '');
    const firstMs = toMs(s.firstTs);
    if (firstMs == null || firstMs < sinceMs) continue;
    const rec = state.sessions[s.sessionId] || { title: '', start: null, end: null };
    rec.title = cutTitle(titles.get(s.sessionId));

    if (!rec.start && s.firstContext > 0) {
      rec.start = { at: iso(firstMs), context: s.firstContext, peak: s.firstContext };
      Object.assign(rec.start, planAt(state.planHistory, firstMs));
    }

    // An end row: first of "renamed CLOSED" and "process gone and idle an hour" (provisional).
    const lastMs = toMs(s.lastTs) ?? firstMs;
    const closed = rec.title.startsWith('CLOSED');
    const gone = !lane || (lane.pid == null && nowMs - lastMs >= HOUR);
    if (rec.start && (closed || gone)) {
      const keep = rec.end && rec.end.at === iso(lastMs) ? rec.end : null;
      rec.end = {
        at: iso(lastMs),
        context: s.context,
        peak: s.peak,
        fiveHour: keep ? keep.fiveHour : null,
        weekly: keep ? keep.weekly : null,
        provisional: !closed,
      };
      if (!keep) Object.assign(rec.end, planAt(state.planHistory, lastMs));
    } else {
      rec.end = null;
    }
    state.sessions[s.sessionId] = rec;
  }

  const win = weekWindow(nowMs, plan);
  state.weeks[iso(win.start)] = buildWeek({
    win,
    sessions,
    titles,
    messages: messages || new Map(),
    history: state.planHistory,
  });
  const keys = Object.keys(state.weeks).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - WEEKS_KEPT))) delete state.weeks[k];
  return state;
}

// Flat rows, oldest first: { at, title, event, context, peak, fiveHour, weekly }.
export function usageRows(state) {
  const rows = [];
  for (const rec of Object.values(state.sessions)) {
    if (rec.start) rows.push({ ...rec.start, title: rec.title, event: 'start' });
    if (rec.end)
      rows.push({
        at: rec.end.at,
        context: rec.end.context,
        peak: rec.end.peak,
        fiveHour: rec.end.fiveHour,
        weekly: rec.end.weekly,
        title: rec.title,
        event: rec.end.provisional ? 'end (provisional)' : 'end',
      });
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at) || a.event.localeCompare(b.event));
}

const fmt = n => (Number.isFinite(n) ? Number(n).toLocaleString('en-US') : '');
const pct = n => (Number.isFinite(n) ? String(Math.round(n)) : '');
const mtok = n => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${(n / 1e6).toFixed(1)}M`);
const NAMES_SHOWN = 8;
const cell = s => String(s || '').replace(/\|/g, '\\|');

function logSection(state) {
  const lines = [
    `## PC ${state.pc}`,
    '',
    '| When (local) | Session | Event | Context tokens | Peak tokens | 5-hour % | Weekly % (all) |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of usageRows(state)) {
    lines.push(
      `| ${localStamp(Date.parse(r.at))} | ${cell(r.title) || '(untitled)'} | ${r.event} | ${fmt(r.context)} | ${fmt(r.peak)} | ${pct(r.fiveHour)} | ${pct(r.weekly)} |`
    );
  }
  return lines.join('\n') + '\n';
}

function weeklySection(state, nowMs) {
  const lines = [`## PC ${state.pc}`, ''];
  const weeks = Object.values(state.weeks).sort((a, b) => b.start.localeCompare(a.start));
  for (const w of weeks) {
    const current = Date.parse(w.end) > nowMs ? ' (current)' : '';
    const list = names => {
      if (!names.length) return '';
      const more = names.length > NAMES_SHOWN ? `, and ${names.length - NAMES_SHOWN} more` : '';
      return `: ${names.slice(0, NAMES_SHOWN).map(cell).join(', ')}${more}`;
    };
    lines.push(
      `### ${localStamp(Date.parse(w.start))} to ${localStamp(Date.parse(w.end))}${current}`,
      '',
      `- Sessions active: ${w.active}, started: ${w.started}.`,
      `- Peak context 200k to 250k: ${w.over200.length}${list(w.over200)}.`,
      `- Peak context over 250k: ${w.over250.length}${list(w.over250)}.`,
      `- Tokens, main thread: ${mtok(total(w.main))} (input ${mtok(w.main.input)}, output ${mtok(w.main.output)}, cache read ${mtok(w.main.cacheRead)}, cache write ${mtok(w.main.cacheWrite)}).`,
      `- Tokens, subagents: ${mtok(total(w.sub))}.`,
      w.weekly == null
        ? '- Weekly plan: no reading.'
        : `- Weekly plan at the last reading: ${pct(w.weekly)}% (${localStamp(Date.parse(w.weeklyAt))}).`,
      ''
    );
    if (w.days.length) {
      lines.push('| Day | Main | Subagents |', '| --- | --- | --- |');
      for (const d of w.days) lines.push(`| ${d.date} | ${mtok(d.main)} | ${mtok(d.sub)} |`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

const LOG_HEAD = `---
type: log
tags: [dev/usage]
---

# Usage log (measured)

Written by the project dashboard (\`scripts/dev/project-dashboard\`, D-103); do not edit it by hand.
Each PC rewrites only its own section. A start row is the first request of a session in this
project; an end row comes when the session is renamed CLOSED, or (provisional) when its process is
gone and it was idle an hour. Context is the session's last main-thread request; peak is its
largest. Plan % is the reading nearest the event, blank when none lies within an hour. The older
hand-written rows stay in [Usage log](Usage%20log.md).
`;

const WEEKLY_HEAD = `---
type: log
tags: [dev/usage]
---

# Usage weekly (measured)

Written by the project dashboard (\`scripts/dev/project-dashboard\`, D-103); do not edit it by hand.
One summary per plan week (from the weekly reset), newest first; each PC rewrites only its own
section. Tokens are counted once per API response, as \`scripts/dev/usage-report.py\` does.
`;

// Replace (or add) this PC's "## PC <name>" section; other PCs' sections are kept as they are.
export function mergeSection(existing, head, pc, section) {
  const others = [];
  const text = String(existing || '').replace(/\r\n/g, '\n');
  const parts = text.split(/^(?=## PC )/m).slice(1);
  for (const p of parts) {
    const name = p.slice('## PC '.length).split('\n')[0].trim();
    if (name !== pc) others.push(p.replace(/\n+$/, '\n'));
  }
  const all = [...others, section].sort((a, b) => a.localeCompare(b));
  return `${head}\n${all.join('\n')}`;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

export function renderNotes(state, nowMs, existing = { log: '', weekly: '' }) {
  const logSec = logSection(state);
  const weekSec = weeklySection(state, nowMs);
  return {
    log: mergeSection(existing.log, LOG_HEAD, state.pc, logSec),
    weekly: mergeSection(existing.weekly, WEEKLY_HEAD, state.pc, weekSec),
    hash: crypto
      .createHash('sha1')
      .update(logSec + '\0' + weekSec)
      .digest('hex'),
  };
}

/**
 * Write both notes into the vault and push them, at most once an hour and only when the rest of
 * the vault is clean (otherwise it waits and tries again on the next tick).
 */
export async function syncUsageToVault({
  state,
  vaultDir,
  now = new Date(),
  force = false,
  push = pushPaths,
}) {
  const nowMs = now.getTime();
  if (!vaultDir || !fs.existsSync(path.join(vaultDir, '.git'))) {
    state.push = { state: 'off', detail: 'no vault found', at: iso(nowMs) };
    return state;
  }
  const { hash } = renderNotes(state, nowMs);
  if (!force && hash === state.pushedHash) return state;
  const last = toMs(state.lastPushAttempt);
  if (!force && last != null && nowMs - last < HOUR && state.push?.state !== 'waiting')
    return state;

  const r = await push({
    dir: vaultDir,
    paths: [LOG_NOTE, WEEKLY_NOTE],
    message: COMMIT_MESSAGE,
    requireClean: true,
    write: async dir => {
      const logFile = path.join(dir, LOG_NOTE);
      const weeklyFile = path.join(dir, WEEKLY_NOTE);
      const out = renderNotes(state, nowMs, {
        log: readText(logFile),
        weekly: readText(weeklyFile),
      });
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, out.log);
      fs.writeFileSync(weeklyFile, out.weekly);
    },
  });
  state.push = { state: r.state, detail: String(r.detail || '').slice(0, 150), at: r.at };
  if (r.state === 'waiting') {
    state.waitingSince = state.waitingSince || iso(nowMs);
  } else {
    state.waitingSince = null;
    state.lastPushAttempt = iso(nowMs);
    if (r.state === 'pushed' || r.state === 'nothing') state.pushedHash = hash;
  }
  return state;
}

// The snapshot's `usageLog` part: the newest rows and the push state, numbers and titles only.
export function usageSummary(state, n = 8) {
  const rows = usageRows(state)
    .slice(-n)
    .reverse()
    .map(r => ({
      at: r.at,
      title: r.title || '(untitled)',
      event: r.event,
      context: r.context,
      peak: r.peak,
    }));
  const last = toMs(state.lastPushAttempt);
  return {
    file: LOG_NOTE,
    since: state.since,
    rows,
    push: state.push
      ? { state: state.push.state, detail: state.push.detail, at: state.push.at }
      : { state: 'never', detail: null, at: null },
    waitingSince: state.waitingSince || null,
    nextPushAt: last == null ? null : iso(last + HOUR),
  };
}

export function usageWarning(summary, nowMs = Date.now()) {
  const p = summary.push;
  if (p.state === 'waiting') {
    const since = toMs(summary.waitingSince);
    const mins = since == null ? 0 : Math.floor((nowMs - since) / 60000);
    return `measured Usage log not pushed: ${p.detail} (waiting ${mins} min)`;
  }
  if (p.state === 'error') return `measured Usage log push failed: ${p.detail}`;
  return null;
}
