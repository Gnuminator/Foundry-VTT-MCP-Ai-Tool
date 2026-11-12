#!/usr/bin/env node
// `npm run usage:week` (D-122): a weekly report from the Claude Code transcripts on this PC.
//
//   node scripts/dev/usage-week.mjs [--days N] [--json] [--write-vault]
//
// Source: every .jsonl under ~/.claude/projects/<dir>, where <dir> is the main checkout's folder
// or one of its worktrees (C--...-Foundry-VTT-AI-Tool or ...-Foundry-VTT-AI-Tool--claude-worktrees-*),
// including <session>/subagents/*.jsonl, modified inside the window. Every API response is counted
// once (deduped by message.id across all files). Context of a response = input + cache read +
// cache creation tokens. Per local calendar day:
//   sessions       main-thread transcripts whose first turn is that day and that have 3+ turns
//   startup        median first-turn context of those sessions
//   share          sum(first-turn context * turns) / sum(context of every main-thread turn) over the
//                  same sessions: the part of the tokens that is the starting context re-read
//                  (information only; the target was dropped 2026-10-17, D-122 log)
//   tokens (M)     context of all turns (main + subagents) on that day
//   cost           price ratio (opus 5, sonnet 3, haiku 1, fable 5, other 3) * (input + 0.1 cache
//                  read + 2 cache creation + 5 output) / 1e6, summed; Opus% is Opus's part of it
//   PRs, M/PR      merged PRs (gh pr list) by local merge day; tokens per merged PR
//   weekly points  percentage points of the weekly limit used, from the vault note
//                  "Usage log (measured).md": sum of positive deltas between consecutive readings;
//                  a drop of more than 3 points is a weekly reset (the new value counts from 0),
//                  a smaller drop is noise and ignored
//   cost/pt        weighted cost per weekly point
// A line after the table gives the window's figures (startup, tokens per merged PR, sessions a
// day, weekly percent a day, weekly points per merged product PR, meaning a PR that changes a
// file under packages/ or shared/): numbers only, no limits and no pass or
// fail, because pace is information only (the user, 2026-11-11). The next line splits the turns
// per model (main-thread + subagent) with each model's share of the cost.
//
// Overrides (tests and checks): USAGE_WEEK_ROOT (the projects folder), USAGE_WEEK_VAULT,
// USAGE_WEEK_NOW (ISO time), USAGE_WEEK_GH=off (skip the merged-PR lookup).

import { execFile } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contextOf } from '../../.claude/hooks/context-alert.mjs';
import { noteFile, writeNote } from './weekly-check-note.mjs';
import { activeHours, buildProfile, paceNow, weekStartFor } from './usage-pace.mjs';
import {
  connectorLogging,
  dataDir,
  emptyLogHint,
  loadCatalog,
  readCalls,
  summarize,
  weekLine,
} from './usage-calls.mjs';

export const REPO = 'Gnuminator/Foundry-VTT-MCP-Ai-Tool';
export const PROJECT_DIR = 'C--Users-chris-Documents-Claude-Code-Projects-Foundry-VTT-AI-Tool';
export const MIN_TURNS = 3;
export const RESET_DROP = 3;
// Lane handover lines (context-alert.mjs): 200k until the change, 250k from it (the user,
// 2026-11-04). The change went live at the merge of the lines PR (2026-11-03 22:59:54Z), not at
// midnight. A lane session counts as having reached the line when its confirmed peak reached the
// line that was in force when it started.
export const LANE_LINE_CHANGE_AT = Date.parse('2026-11-03T22:59:54Z');
export const LANE_LINE_BEFORE = 200_000;
export const LANE_LINE_AFTER = 250_000;

// --- small helpers -------------------------------------------------------------------------

const pad2 = n => String(n).padStart(2, '0');

export function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

// The model family a response ran on, for the per-model split.
export function familyOf(model) {
  const m = String(model || '');
  for (const f of ['opus', 'sonnet', 'haiku', 'fable', 'mythos']) if (m.includes(f)) return f;
  return 'other';
}

export function priceOf(model) {
  const m = String(model || '');
  if (/opus/.test(m)) return 5;
  if (/sonnet/.test(m)) return 3;
  if (/haiku/.test(m)) return 1;
  if (/fable/.test(m)) return 5;
  // Mythos and any unknown model are weighted 3, like Sonnet: no measured price for them.
  return 3;
}

export function windowDays(now, days) {
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const keys = [];
  for (let i = 0; i < days; i++) {
    keys.push(dayKey(new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)));
  }
  return { startMs: first.getTime(), keys };
}

// --- finding and streaming the transcripts -------------------------------------------------

export function isProjectDir(name) {
  return name === PROJECT_DIR || name.startsWith(`${PROJECT_DIR}--claude-worktrees-`);
}

function walk(dir, found) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, found);
    else if (e.name.endsWith('.jsonl')) found.push(p);
  }
}

export function isSubagentFile(file) {
  return file.split(/[\\/]/).includes('subagents');
}

// Main-thread transcripts first, so a response found in both counts as main-thread.
export function findTranscripts(root, sinceMs) {
  const found = [];
  let dirs;
  try {
    dirs = readdirSync(root).filter(isProjectDir);
  } catch {
    return found;
  }
  for (const d of dirs) walk(path.join(root, d), found);
  return found
    .filter(f => {
      try {
        return statSync(f).mtimeMs >= sinceMs;
      } catch {
        return false;
      }
    })
    .sort((a, b) => Number(isSubagentFile(a)) - Number(isSubagentFile(b)) || a.localeCompare(b));
}

// One response: the numbers the report needs, or null for a line that is not one.
export function parseResponse(line) {
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  const u = j?.message?.usage;
  if (j?.type !== 'assistant' || !u || !j.timestamp) return null;
  const model = j.message.model || '';
  if (model === '<synthetic>') return null;
  const t = Date.parse(j.timestamp);
  if (!Number.isFinite(t)) return null;
  const n = v => (Number.isFinite(v) ? v : 0);
  const input = n(u.input_tokens);
  const cacheRead = n(u.cache_read_input_tokens);
  const cacheCreate = n(u.cache_creation_input_tokens);
  const output = n(u.output_tokens);
  return {
    id: j.message.id || null,
    t,
    model,
    sidechain: Boolean(j.isSidechain),
    ctx: input + cacheRead + cacheCreate,
    // the context the session holds (the last pass of an advisor response), as the hooks read it:
    // contextOf is imported from the hook file (context-alert.mjs) so both read a response alike
    real: contextOf(u),
    cost: (priceOf(model) * (input + 0.1 * cacheRead + 2 * cacheCreate + 5 * output)) / 1e6,
  };
}

// Streams every file line by line (transcripts reach tens of MB) and returns
// { responses, sessions }: each API response once, and one entry per main-thread transcript.
export async function readTranscripts(files, startMs) {
  const seen = new Set();
  const responses = [];
  const sessions = [];
  for (const file of files) {
    const sub = isSubagentFile(file);
    const mainTurns = [];
    const fileSeen = new Set();
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"usage"')) continue;
      const r = parseResponse(line);
      if (!r) continue;
      const main = !sub && !r.sidechain;
      // Sessions dedupe per file (a fork repeats its parent's ids but its first turn is its own, as in ctx.js); tokens and cost dedupe globally.
      if (main && !(r.id && fileSeen.has(r.id))) {
        if (r.id) fileSeen.add(r.id);
        mainTurns.push(r);
      }
      if (r.id) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
      }
      if (r.t >= startMs) responses.push({ ...r, main });
    }
    if (mainTurns.length) sessions.push({ file, turns: mainTurns });
  }
  return { responses, sessions };
}

// --- weekly limit use (the vault's Usage log) -----------------------------------------------

export function vaultDirFor(env = process.env) {
  return (
    env.USAGE_WEEK_VAULT ||
    env.FOUNDRY_AI_OBSIDIAN_DIR ||
    path.join(os.homedir(), 'Documents', 'Obsidian', 'vault')
  );
}

export function usageLogFile(vaultDir) {
  return path.join(vaultDir, 'Dev', 'Foundry AI Tool', 'Usage log (measured).md');
}

// Readings { t, v } from every markdown table with the columns "When (local)" and
// "Weekly % (all)" (one section per PC), in time order. Rows without a weekly value are skipped.
// The "When (local)" times are read in the zone of the machine running this script (the log is
// written on PCs in Europe/Copenhagen, the pace profile in usage-pace.mjs is read in that zone
// too). Run on a machine in another zone, the profile's hours shift by the difference.
export function parseUsageLog(text) {
  const readings = [];
  let cols = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      cols = null;
      continue;
    }
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(c => c.trim());
    const iWhen = cells.indexOf('When (local)');
    const iWeekly = cells.indexOf('Weekly % (all)');
    if (iWhen >= 0 && iWeekly >= 0) {
      cols = { iWhen, iWeekly };
      continue;
    }
    if (!cols) continue;
    const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/.exec(cells[cols.iWhen] || '');
    const v = Number.parseFloat((cells[cols.iWeekly] || '').replace('%', ''));
    if (!m || !Number.isFinite(v)) continue;
    const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    readings.push({ t, v });
  }
  readings.sort((a, b) => a.t - b.t);
  return readings;
}

// Percentage points of the weekly limit used per local day (a Map day -> points). The points of
// a step go to the day of the later reading. A drop of more than RESET_DROP is a weekly reset
// (the new value counts from 0); a smaller drop is noise: the old value stays the reference.
export function weeklyPoints(readings) {
  const byDay = new Map();
  let prev = null;
  for (const r of readings) {
    if (prev === null) {
      prev = r.v;
      continue;
    }
    let delta = 0;
    if (r.v >= prev) {
      delta = r.v - prev;
      prev = r.v;
    } else if (prev - r.v > RESET_DROP) {
      delta = r.v;
      prev = r.v;
    }
    if (delta > 0) {
      const key = dayKey(new Date(r.t));
      byDay.set(key, (byDay.get(key) || 0) + delta);
    }
  }
  return byDay;
}

// --- merged PRs ----------------------------------------------------------------------------

// A product PR changes the tool itself: a file under packages/ or shared/. A PR with no file list
// (an old fixture, a gh without `files`) counts as product, so the figure never silently drops it.
export function isProductPr(pr) {
  if (!Array.isArray(pr?.files)) return true;
  return pr.files.some(f => /^(packages|shared)\//.test(String(f?.path ?? '').replaceAll('\\', '/')));
}

export function fetchMergedPrs() {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      [
        'pr',
        'list',
        '--repo',
        REPO,
        '--state',
        'merged',
        '--limit',
        '300',
        '--json',
        'number,mergedAt,files',
      ],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

// --- the report ----------------------------------------------------------------------------

const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

function newDay(day) {
  return {
    day,
    sessions: 0,
    startup: null,
    share: null,
    tokens: 0,
    cost: 0,
    opusCost: 0,
    prs: null,
    productPrs: null,
    tokensPerPr: null,
    weeklyPoints: null,
    costPerPoint: null,
    pointsPerPr: null,
    coveredDays: null,
  };
}

// A lane is a main-thread transcript under the project's worktree folders.
export function isLaneFile(file) {
  return file.split(/[\\/]/).some(s => s.startsWith(`${PROJECT_DIR}--claude-worktrees-`));
}

// The peak context of a session as the hooks confirm it: a reading counts only when the response
// before it was at least as big, so one doubled response never counts. The first response has no
// response before it, so it is never confirmed on its own (stricter than the hook, which counts a
// single response).
export function confirmedPeak(turns) {
  let peak = 0;
  for (let i = 1; i < turns.length; i++) {
    const c = Math.min(turns[i].real, turns[i - 1].real);
    if (c > peak) peak = c;
  }
  return peak;
}

// Lane sessions that started in the window: how many reached their handover line (not proof that
// the lane then handed over), the peak they stood at afterwards, and how many reached 200k, 250k
// and 300k whatever the line was.
export function laneStats(qualifying, prCount) {
  const lanes = qualifying
    .filter(s => isLaneFile(s.file))
    .map(s => {
      const line = s.turns[0].t >= LANE_LINE_CHANGE_AT ? LANE_LINE_AFTER : LANE_LINE_BEFORE;
      return { peak: confirmedPeak(s.turns), line };
    });
  const handed = lanes.filter(l => l.peak >= l.line);
  const peaks = handed.map(l => l.peak);
  return {
    lanes: lanes.length,
    handovers: handed.length,
    handoversPerPr: prCount ? handed.length / prCount : null,
    handoverMedian: median(peaks),
    handoverMax: peaks.length ? Math.max(...peaks) : null,
    peakMedian: median(lanes.map(l => l.peak)),
    over200k: lanes.filter(l => l.peak >= 200_000).length,
    over250k: lanes.filter(l => l.peak >= 250_000).length,
    over300k: lanes.filter(l => l.peak >= 300_000).length,
  };
}

function sessionStats(list) {
  const base = sum(list, s => s.turns[0].ctx * s.turns.length);
  const all = sum(list, s => sum(s.turns, t => t.ctx));
  return { startup: median(list.map(s => s.turns[0].ctx)), share: all ? base / all : null };
}

export async function buildReport({ root, now, days, prs = null, usageLog = null, weeklyResets }) {
  const { startMs, keys } = windowDays(now, days);
  const files = findTranscripts(root, startMs);
  const { responses, sessions, advisorCalls } = await readTranscripts(files, startMs);
  const byDay = new Map(keys.map(k => [k, newDay(k)]));
  const models = {};

  for (const r of responses) {
    const d = byDay.get(dayKey(new Date(r.t)));
    if (!d) continue;
    d.tokens += r.ctx;
    d.cost += r.cost;
    if (/opus/.test(r.model)) d.opusCost += r.cost;
    const m = (models[familyOf(r.model)] ||= { turns: 0, mainTurns: 0, subTurns: 0, cost: 0 });
    m.turns++;
    m[r.main ? 'mainTurns' : 'subTurns']++;
    m.cost += r.cost;
  }

  const qualifying = sessions.filter(
    s =>
      s.turns.length >= MIN_TURNS &&
      s.turns[0].t >= startMs &&
      byDay.has(dayKey(new Date(s.turns[0].t)))
  );
  const sessionsByDay = new Map(keys.map(k => [k, []]));
  for (const s of qualifying) sessionsByDay.get(dayKey(new Date(s.turns[0].t))).push(s);

  const prCounts = prs ? new Map(keys.map(k => [k, 0])) : null;
  const productCounts = prs ? new Map(keys.map(k => [k, 0])) : null;
  if (prs) {
    for (const p of prs) {
      const k = p?.mergedAt ? dayKey(new Date(p.mergedAt)) : null;
      if (!k || !prCounts.has(k)) continue;
      prCounts.set(k, prCounts.get(k) + 1);
      if (isProductPr(p)) productCounts.set(k, productCounts.get(k) + 1);
    }
  }
  const readings = usageLog ? parseUsageLog(usageLog) : [];
  const points = readings.length ? weeklyPoints(readings) : null;
  // Days before the log's first reading are unknown, not zero.
  const firstLogDay = readings.length ? dayKey(new Date(readings[0].t)) : null;

  for (const d of byDay.values()) {
    const list = sessionsByDay.get(d.day);
    d.sessions = list.length;
    Object.assign(d, sessionStats(list));
    if (prCounts) {
      d.prs = prCounts.get(d.day);
      d.tokensPerPr = d.prs ? d.tokens / d.prs / 1e6 : null;
      d.productPrs = productCounts.get(d.day);
    }
    if (points && d.day >= firstLogDay) {
      d.weeklyPoints = points.get(d.day) || 0;
      d.costPerPoint = d.weeklyPoints > 0 ? d.cost / d.weeklyPoints : null;
      d.pointsPerPr = d.productPrs ? d.weeklyPoints / d.productPrs : null;
    }
  }

  const rows = [...byDay.values()];
  const total = newDay('total');
  total.sessions = qualifying.length;
  Object.assign(total, sessionStats(qualifying));
  total.tokens = sum(rows, d => d.tokens);
  total.cost = sum(rows, d => d.cost);
  total.opusCost = sum(rows, d => d.opusCost);
  if (prs) {
    total.prs = sum(rows, d => d.prs);
    total.tokensPerPr = total.prs ? total.tokens / total.prs / 1e6 : null;
  }
  const covered = rows.filter(d => d.weeklyPoints !== null);
  total.coveredDays = covered.length;
  if (covered.length) {
    total.weeklyPoints = sum(covered, d => d.weeklyPoints);
    const coveredCost = sum(covered, d => d.cost);
    total.costPerPoint = total.weeklyPoints > 0 ? coveredCost / total.weeklyPoints : null;
    // points over the product PRs merged on the days the Usage log covers
    const coveredProduct = prs ? sum(covered, d => d.productPrs) : 0;
    total.pointsPerPr = coveredProduct ? total.weeklyPoints / coveredProduct : null;
  }
  if (prs) total.productPrs = sum(rows, d => d.productPrs);

  const lanes = laneStats(qualifying, prs ? total.prs : null);
  const pace = paceFor(readings, now, 4, weeklyResets);

  return {
    pace,
    window: { days, from: keys[0], to: keys[keys.length - 1] },
    lanes,
    files: files.length,
    responses: responses.length,
    days: rows,
    total,
    models,
    figures: figuresFor(total, days),
  };
}

// The pace profile from the log and, when the newest reading is from this week, the pace as of
// that reading (reset = Saturday 05:00Z). Null without readings.
export function paceFor(readings, now, weeks = 4, weeklyResets) {
  if (!readings.length) return null;
  const nowMs = now.getTime();
  const weekStartMs = weekStartFor(nowMs, weeklyResets);
  const profile = buildProfile(readings, { weekStartMs, weeks });
  const last = readings[readings.length - 1];
  // As of the newest reading of this week (its time is `asOf`), so a stale log still gives a number.
  const thisWeek = last.t >= weekStartMs && last.t <= nowMs;
  return {
    profile: { ...profile, activeHours: activeHours(profile) },
    now: thisWeek
      ? {
          asOf: new Date(last.t).toISOString(),
          actual: last.v,
          ...paceNow({ profile, weekStartMs, nowMs: last.t, actual: last.v }),
        }
      : null,
  };
}

// The window's figures, numbers only (no limits, no pass or fail: pace is information only,
// the user 2026-11-11). value is null when the number is not known.
export function figuresFor(total, days) {
  return [
    { name: 'startup', value: total.startup, unit: 'tokens' },
    { name: 'M tokens per PR', value: total.tokensPerPr, unit: 'M' },
    { name: 'sessions a day', value: total.sessions / days, unit: 'sessions' },
    {
      name: 'weekly % a day',
      value: total.weeklyPoints === null ? null : total.weeklyPoints / total.coveredDays,
      unit: 'points',
    },
    { name: 'weekly points per PR', value: total.pointsPerPr ?? null, unit: 'points' },
  ];
}

// --- output --------------------------------------------------------------------------------

const dash = '-';
const num = (v, digits, fallback = dash) =>
  v === null || v === undefined ? fallback : v.toFixed(digits);
const kilo = v => (v === null ? dash : `${Math.round(v / 1000)}k`);
const pct = v => (v === null ? dash : `${Math.round(v * 100)}%`);

const COLUMNS = [
  ['Day', 10, d => d.day],
  ['Sess', 4, d => String(d.sessions)],
  ['Startup', 7, d => kilo(d.startup)],
  ['Share', 5, d => pct(d.share)],
  ['Tok M', 7, d => num(d.tokens / 1e6, 1)],
  ['Cost', 6, d => num(d.cost, 0)],
  ['Opus', 4, d => (d.cost ? pct(d.opusCost / d.cost) : dash)],
  ['PRs', 3, d => (d.prs === null ? 'n/a' : String(d.prs))],
  ['M/PR', 5, d => num(d.tokensPerPr, 1)],
  ['Wk pts', 6, d => num(d.weeklyPoints, 0, 'n/a')],
  ['Pts/PR', 6, d => num(d.pointsPerPr, 1)],
  ['Cost/pt', 7, d => num(d.costPerPoint, 1)],
];

export function formatFigures(figures) {
  const text = {
    startup: t => `startup ${kilo(t.value)}`,
    'M tokens per PR': t => `M/PR ${num(t.value, 1)}`,
    'sessions a day': t => `sessions/day ${num(t.value, 1)}`,
    'weekly % a day': t => `weekly %/day ${num(t.value, 1)}`,
    'weekly points per PR': t => `weekly pts/PR ${num(t.value, 1)}`,
  };
  return `Window: ${figures.map(t => text[t.name](t)).join(' | ')}`;
}

export function formatPace(pace) {
  if (!pace) return 'Pace: no usage log readings';
  const { profile, now } = pace;
  const base = `Pace profile: ${profile.source} (${profile.weeks} weeks), active hours ${profile.activeHours.weekday} weekday / ${profile.activeHours.weekend} weekend`;
  if (!now) return `${base}; no reading for this week`;
  const sign = now.delta > 0 ? '+' : '';
  const proj = now.projected === null ? 'too early' : `${now.projected}%`;
  return `${base}; as of ${now.asOf.slice(0, 16)}Z weekly ${now.actual}% vs expected ${now.expected}% (${sign}${now.delta}, ${now.delta > 0 ? 'ahead' : now.delta < 0 ? 'behind' : 'level'}), projected ${proj}, ${now.activeHoursLeft} active hours left`;
}

// Turns per model family with their share of the weighted cost; "main" and "sub" split the
// turns between main-thread sessions and subagents. CLAUDE.md "Models": lanes on Sonnet.
export function formatModels(models) {
  const list = Object.entries(models || {}).sort((a, b) => b[1].cost - a[1].cost);
  const cost = list.reduce((a, [, m]) => a + m.cost, 0);
  if (!list.length || !cost) return 'Models: none in the window';
  const name = f => f[0].toUpperCase() + f.slice(1);
  return `Models (turns main+sub, share of cost): ${list
    .map(
      ([f, m]) => `${name(f)} ${m.mainTurns}+${m.subTurns} ${Math.round((100 * m.cost) / cost)}%`
    )
    .join(' | ')}`;
}

// Lane line: sessions in .claude/worktrees that reached their line (200k, 250k from the
// 2026-11-03 22:59 UTC merge of the lines PR), per merged PR, and the peak after the line. Before 2026-11-04: 9 lanes, 5 of
// them handed over at 200k within about 35 minutes.
export function formatLanes(lanes) {
  if (!lanes || !lanes.lanes) return 'Lanes: none in the window';
  const perPr = Number.isFinite(lanes.handoversPerPr)
    ? ` (${num(lanes.handoversPerPr, 2)} per merged PR)`
    : '';
  return (
    `Lanes: ${lanes.lanes} sessions, ${lanes.handovers} reached line${perPr}, ` +
    `peak after line median ${kilo(lanes.handoverMedian)} max ${kilo(lanes.handoverMax)}, ` +
    `peak median ${kilo(lanes.peakMedian)}; reached 200k ${lanes.over200k}, 250k ${lanes.over250k}, 300k ${lanes.over300k}`
  );
}

export function formatReport(report, notes = []) {
  const header = COLUMNS.map(([name, w], i) => (i === 0 ? name.padEnd(w) : name.padStart(w))).join(
    ' '
  );
  const row = d =>
    COLUMNS.map(([, w, f], i) => (i === 0 ? f(d).padEnd(w) : f(d).padStart(w))).join(' ');
  const lines = [
    `Usage ${report.window.from} to ${report.window.to} (${report.window.days} days, weighted cost: Opus 5, Sonnet 3, Haiku 1)`,
    header,
    ...report.days.map(row),
    '-'.repeat(header.length),
    row({ ...report.total, day: 'Window' }),
    formatFigures(report.figures),
    formatModels(report.models),
    formatLanes(report.lanes),
    formatPace(report.pace),
    ...(report.toolCalls ? [report.toolCalls.line] : []),
    ...notes.map(n => `Note: ${n}`),
  ];
  return lines.join('\n');
}

export function parseArgs(argv) {
  const opts = { days: 7, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--days' || a.startsWith('--days=')) {
      const raw = a === '--days' ? argv[++i] : a.slice(7);
      const n = Number.parseInt(raw, 10);
      if (Number.isInteger(n) && n >= 1 && n <= 90) opts.days = n;
    }
  }
  return opts;
}

export async function main(argv = process.argv.slice(2), env = process.env, out = process.stdout) {
  const started = Date.now();
  const opts = parseArgs(argv);
  const notes = [];
  const now = env.USAGE_WEEK_NOW ? new Date(env.USAGE_WEEK_NOW) : new Date();
  const root = env.USAGE_WEEK_ROOT || path.join(os.homedir(), '.claude', 'projects');

  let prs = null;
  if (env.USAGE_WEEK_GH === 'off') notes.push('merged PRs skipped (USAGE_WEEK_GH=off).');
  else {
    try {
      prs = await fetchMergedPrs();
    } catch (e) {
      notes.push(`merged PRs unavailable (gh failed: ${String(e.message).split('\n')[0]}).`);
    }
  }

  let usageLog = null;
  const logFile = usageLogFile(vaultDirFor(env));
  if (existsSync(logFile)) usageLog = readFileSync(logFile, 'utf8');
  else notes.push(`weekly limit use unavailable (no ${logFile}).`);

  const report = await buildReport({ root, now, days: opts.days, prs, usageLog });
  report.notes = notes;
  // Real tool usage (I-113): the MCP tool call log on this PC (USAGE_WEEK_CALLS_DIR overrides).
  const callsDir = env.USAGE_WEEK_CALLS_DIR || path.join(dataDir(env), '_usage');
  let callList = [];
  try {
    callList = readCalls(callsDir, opts.days, now);
  } catch (e) {
    notes.push(`tool call log unreadable (${String(e.message).split('\n')[0]}).`);
  }
  const callSummary = summarize(callList, await loadCatalog());
  if (!callSummary.total) {
    const hint = emptyLogHint(connectorLogging(env));
    if (hint) notes.push(hint);
  }
  report.toolCalls = {
    total: callSummary.total,
    errors: callSummary.errors,
    used: callSummary.tools.length,
    never: callSummary.never ? callSummary.never.length : null,
    line: weekLine(callSummary, opts.days),
  };
  report.runMs = Date.now() - started;
  if (argv.includes('--write-vault')) {
    const file = noteFile(vaultDirFor(env));
    writeNote(file, report);
    notes.push(`weekly check written to ${file}`);
  }
  if (opts.json) out.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    out.write(`${formatReport(report, notes)}\n`);
    out.write(
      `(${report.files} files, ${report.responses} responses, ${(report.runMs / 1000).toFixed(1)} s)\n`
    );
  }
}

const self = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href
) {
  main().catch(e => {
    process.stderr.write(`usage:week failed: ${e?.message || e}\n`);
    process.exitCode = 1;
  });
}
