#!/usr/bin/env node
// A ci-health table for the Board and the weekly check (I-160): how CI ran in the last 24 hours and
// the last 7 days, from `gh run list` for the workflow ci.yml.
//
//   npm run ci:health               the table (24 h and 7 d)
//   npm run ci:health -- --json     the same as JSON
//
// A run counts in a window by its createdAt. Duration is wall time, updatedAt minus startedAt, of
// runs that finished (success or failure; a cancelled run is counted, not timed). A "red main" is a
// finished push-to-main run that failed. `usage:week --write-vault` appends `ciLines()` of the 7 day
// window to the Saturday section of the vault note Weekly check.md, so the Board's Week page reads it.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = 'Gnuminator/Foundry-VTT-MCP-Ai-Tool';
export const WINDOWS = [
  { label: 'last 24 hours', hours: 24 },
  { label: 'last 7 days', hours: 24 * 7 },
];

/** @param {number[]} sorted ascending */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, i))];
}

/** @param {number[]} sorted ascending; the middle value, or the mean of the two middle ones */
function median(sorted) {
  if (!sorted.length) return null;
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/** Conclusions that count as a red run (a timeout and a startup failure are red too). */
const RED = new Set(['failure', 'timed_out', 'startup_failure']);

const round1 = v => (v === null ? null : Math.round(v * 10) / 10);

/**
 * The figures of one window.
 * @param {{ createdAt: string, startedAt?: string, updatedAt?: string, status?: string, conclusion?: string, event?: string }[]} runs
 * @param {Date} now
 * @param {number} hours
 */
export function summarizeRuns(runs, now, hours) {
  const from = now.getTime() - hours * 3_600_000;
  const inWindow = runs.filter(r => {
    const t = Date.parse(r.createdAt);
    return t >= from && t <= now.getTime();
  });
  const finished = inWindow.filter(r => r.status === 'completed');
  const count = c => finished.filter(r => r.conclusion === c).length;
  const isFailed = r => RED.has(r.conclusion);
  const minutes = finished
    .filter(r => r.conclusion === 'success' || isFailed(r))
    .map(r => (Date.parse(r.updatedAt ?? '') - Date.parse(r.startedAt ?? r.createdAt)) / 60_000)
    .filter(m => Number.isFinite(m) && m >= 0)
    .sort((a, b) => a - b);
  const failed = finished.filter(isFailed).length;
  const success = count('success');
  const done = failed + success;
  return {
    hours,
    runs: inWindow.length,
    running: inWindow.length - finished.length,
    success,
    failed,
    cancelled: count('cancelled'),
    failPercent: done ? round1((failed / done) * 100) : null,
    redMain: finished.filter(r => r.event === 'push' && isFailed(r)).length,
    medianMinutes: round1(median(minutes)),
    p90Minutes: round1(percentile(minutes, 90)),
  };
}

const cell = v => (v === null || v === undefined ? 'n/a' : String(v));

/** The plain-text table: one row per figure, one column per window. */
export function formatTable(summaries) {
  const rows = [
    ['runs', s => s.runs],
    ['still running', s => s.running],
    ['success', s => s.success],
    ['failed', s => s.failed],
    ['cancelled', s => s.cancelled],
    ['failed % of finished', s => s.failPercent],
    ['red main runs', s => s.redMain],
    ['median minutes', s => s.medianMinutes],
    ['p90 minutes', s => s.p90Minutes],
  ];
  const head = ['CI health', ...summaries.map(s => s.label)];
  const body = rows.map(([name, f]) => [name, ...summaries.map(s => cell(f(s)))]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(r => r[i].length)));
  const line = r => r.map((c, i) => (i ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ');
  const cut = summaries.filter(s => s.truncated).map(s => s.label);
  const note = cut.length
    ? [`(cut off at the newest 1000 runs, so too low: ${cut.join(', ')})`]
    : [];
  return [line(head), ...body.map(line), ...note].join('\n');
}

/** The lines the Saturday section of Weekly check.md gets (numbers only, same `- key: value` form). */
export function ciLines(week) {
  if (week.truncated) return []; // a cut-off window would write wrong numbers
  const lines = [
    `- ci-runs: ${week.runs}`,
    `- ci-failed: ${week.failed}`,
    `- ci-cancelled: ${week.cancelled}`,
    `- ci-red-main: ${week.redMain}`,
  ];
  if (week.medianMinutes !== null) lines.push(`- ci-median-minutes: ${week.medianMinutes}`);
  if (week.p90Minutes !== null) lines.push(`- ci-p90-minutes: ${week.p90Minutes}`);
  return lines;
}

/** Both windows from one run list, each with its label. */
export function buildCiHealth(runs, now = new Date(), limit = 1000) {
  const oldest = runs.length
    ? Math.min(...runs.map(r => Date.parse(r.createdAt)).filter(Number.isFinite))
    : Infinity;
  return WINDOWS.map(w => ({
    label: w.label,
    ...summarizeRuns(runs, now, w.hours),
    // The list is the newest `limit` runs: a window that reaches back past the oldest one is cut off.
    truncated: runs.length >= limit && oldest > now.getTime() - w.hours * 3_600_000,
  }));
}

/** The last runs of ci.yml (all events). */
export function fetchRuns(limit = 1000) {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      [
        'run',
        'list',
        '--repo',
        REPO,
        '--workflow',
        'ci.yml',
        '--limit',
        String(limit),
        '--json',
        'createdAt,startedAt,updatedAt,status,conclusion,event',
      ],
      { timeout: 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
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

/** Workflows that run rarely or by hand; their last run is shown under the table. */
export const OTHER_WORKFLOWS = ['mutation-core', 'pi-images', 'release'];

/** One line: the last conclusion and date of a workflow. @param {string} name @param {{ conclusion?: string, status?: string, createdAt?: string } | undefined} run */
export function lastRunLine(name, run) {
  if (!run) return `last ${name}: no run`;
  const state = run.conclusion || run.status || 'unknown';
  const date = run.createdAt ? run.createdAt.slice(0, 10) : 'unknown date';
  return `last ${name}: ${state} (${date})`;
}

/** The newest run of one workflow, or undefined. @param {string} workflow file stem, without .yml */
export function fetchLastRun(workflow) {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      [
        'run',
        'list',
        '--repo',
        REPO,
        '--workflow',
        `${workflow}.yml`,
        '--limit',
        '1',
        '--json',
        'createdAt,status,conclusion',
      ],
      { timeout: 60_000, windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(stdout)[0]);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

export async function main(argv = process.argv.slice(2), out = process.stdout, now = new Date()) {
  const summaries = buildCiHealth(await fetchRuns(), now);
  if (argv.includes('--json')) {
    out.write(`${JSON.stringify(summaries, null, 2)}\n`);
    return;
  }
  /** @type {string[]} */
  const others = [];
  for (const w of OTHER_WORKFLOWS) {
    // A workflow that cannot be read must not hide the table above it.
    others.push(lastRunLine(w, await fetchLastRun(w).catch(() => undefined)));
  }
  out.write(`${formatTable(summaries)}\n${others.join('\n')}\n`);
}

const self = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href
) {
  main().catch(e => {
    process.stderr.write(`ci:health failed: ${e?.message || e}\n`);
    process.exitCode = 1;
  });
}
