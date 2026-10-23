#!/usr/bin/env node
// `npm run usage:now`: writes the vault note `Usage now.md` that the PM board's Today view reads
// (format: pm-board README, "Usage now.md"). The plan percentages come from `get_usage` (a tool a
// script cannot call), so the planner or lane passes them in; the `check-` numbers come from the
// same code as `npm run usage:week --json`.
//
//   npm run usage:now -- --weekly 79 --weekly-resets 2026-10-24T05:00:00.111Z \
//     --five-hour 7 --five-hour-resets 2026-10-23T18:50:00.111Z [--model sonnet=41 --model opus=27]
//     [--days 7] [--no-check] [--out <file>] [--stdout]
//
// Only numbers and times are written. Times must carry an offset (get_usage gives `...Z`).
// Overrides (tests): USAGE_WEEK_ROOT, USAGE_WEEK_VAULT, USAGE_WEEK_NOW, USAGE_WEEK_GH=off.

import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildReport, fetchMergedPrs, usageLogFile, vaultDirFor } from './usage-week.mjs';

const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function noteFile(vaultDir) {
  return path.join(vaultDir, 'Dev', 'Foundry AI Tool', 'Usage now.md');
}

export function parseArgs(argv) {
  const opts = { days: 7, check: true, models: {}, stdout: false };
  const need = (i, flag) => {
    if (i >= argv.length) throw new Error(`${flag} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--weekly') opts.weekly = need(++i, a);
    else if (a === '--weekly-resets') opts.weeklyResets = need(++i, a);
    else if (a === '--five-hour') opts.fiveHour = need(++i, a);
    else if (a === '--five-hour-resets') opts.fiveHourResets = need(++i, a);
    else if (a === '--model') {
      const m = /^([a-z]+)=(.+)$/i.exec(need(++i, a));
      if (!m) throw new Error('--model takes name=percent, for example sonnet=41');
      opts.models[m[1].toLowerCase()] = m[2];
    } else if (a === '--days') opts.days = Number.parseInt(need(++i, a), 10);
    else if (a === '--out') opts.out = need(++i, a);
    else if (a === '--no-check') opts.check = false;
    else if (a === '--stdout') opts.stdout = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

function percent(value, flag) {
  const n = Number(String(value).replace(/%$/, ''));
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${flag} must be 0 to 100`);
  return Math.round(n * 10) / 10;
}

function instant(value, flag) {
  if (!OFFSET_ISO.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${flag} must be an ISO time with an offset (2026-10-24T05:00:00Z)`);
  }
  return value;
}

const round1 = v => Math.round(v * 10) / 10;

// The frontmatter lines for the plan numbers, in the order the board README lists them.
export function planLines(opts, now) {
  if (opts.weekly === undefined) throw new Error('--weekly <percent> is required');
  const lines = [`updated: ${now.toISOString()}`];
  if ((opts.fiveHour === undefined) !== (opts.fiveHourResets === undefined)) {
    throw new Error('--five-hour and --five-hour-resets go together');
  }
  if (opts.fiveHour !== undefined) {
    lines.push(`five-hour-percent: ${percent(opts.fiveHour, '--five-hour')}`);
    lines.push(`five-hour-resets: ${instant(opts.fiveHourResets, '--five-hour-resets')}`);
  }
  lines.push(`weekly-percent: ${percent(opts.weekly, '--weekly')}`);
  if (opts.weeklyResets !== undefined) {
    lines.push(`weekly-resets: ${instant(opts.weeklyResets, '--weekly-resets')}`);
  }
  for (const [name, value] of Object.entries(opts.models)) {
    lines.push(`weekly-${name}-percent: ${percent(value, `--model ${name}`)}`);
  }
  return lines;
}

// The `check-` lines from a usage:week report (targets[].value; unknown values are left out).
export function checkLines(report) {
  const value = name => report.targets.find(t => t.name === name)?.value;
  const rows = [
    ['check-from', report.window.from],
    ['check-to', report.window.to],
    ['check-startup', value('startup') == null ? null : Math.round(value('startup'))],
    ['check-m-tokens-per-pr', value('M tokens per PR') == null ? null : round1(value('M tokens per PR'))],
    ['check-sessions-a-day', value('sessions a day') == null ? null : round1(value('sessions a day'))],
    ['check-weekly-points-a-day', value('weekly % a day') == null ? null : round1(value('weekly % a day'))],
  ];
  return rows.filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${v}`);
}

export function renderNote(lines) {
  return [
    '---',
    'type: usage-now',
    ...lines,
    '---',
    '',
    '# Usage now',
    '',
    'Written by `npm run usage:now` at each planner start and each lane start; do not edit by hand.',
    "The board's Today view reads the frontmatter above. Only numbers and times go here.",
    '',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2), env = process.env, out = process.stdout) {
  const opts = parseArgs(argv);
  const now = env.USAGE_WEEK_NOW ? new Date(env.USAGE_WEEK_NOW) : new Date();
  const lines = planLines(opts, now);
  if (opts.check) {
    let prs = null;
    if (env.USAGE_WEEK_GH !== 'off') {
      try {
        prs = await fetchMergedPrs();
      } catch {
        prs = null;
      }
    }
    const logFile = usageLogFile(vaultDirFor(env));
    const usageLog = existsSync(logFile) ? readFileSync(logFile, 'utf8') : null;
    const root = env.USAGE_WEEK_ROOT || path.join(os.homedir(), '.claude', 'projects');
    const report = await buildReport({ root, now, days: opts.days, prs, usageLog });
    lines.push(...checkLines(report));
  }
  const text = renderNote(lines);
  if (opts.stdout) {
    out.write(text);
    return;
  }
  const file = opts.out || noteFile(vaultDirFor(env));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  out.write(`usage:now wrote ${file} (weekly ${opts.weekly}%)\n`);
}

const self = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href
) {
  main().catch(e => {
    process.stderr.write(`usage:now failed: ${e?.message || e}\n`);
    process.exitCode = 1;
  });
}
