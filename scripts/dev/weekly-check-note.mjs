// The vault note `Weekly check.md` that the PM board's Week page reads: one `## <first day>` section
// per weekly check, newest first, plain `key: value` lines, numbers only. Written by
// `npm run usage:week -- --write-vault` (a second run for the same window replaces its section).
//
//   ## 2026-10-17
//   - from: 2026-10-17
//   - to: 2026-10-23
//   - startup: 77822
//   ... the same kind of line for tokens-m-per-pr, sessions-a-day, weekly-points-a-day and
//   weekly-points-per-pr. Numbers only: no limits and no ok flags (pace is information only, the
//   user 2026-11-11).
//   - pace-profile-weeks / pace-active-hours-weekday / pace-active-hours-weekend (usage-pace.mjs)
//   - advisor-calls / advisor-per-pr (only when known)
//   - tool-calls / tool-errors / tools-used / tools-never-used (MCP tool call log; only when calls
//     were logged, tools-never-used only when the server is built)

import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const KEYS = [
  ['startup', 'startup', 0],
  ['M tokens per PR', 'tokens-m-per-pr', 1],
  ['sessions a day', 'sessions-a-day', 1],
  ['weekly % a day', 'weekly-points-a-day', 1],
  ['weekly points per PR', 'weekly-points-per-pr', 1],
];

export function noteFile(vaultDir) {
  return path.join(vaultDir, 'Dev', 'Foundry AI Tool', 'Weekly check.md');
}

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

// The section for a usage:week report: unknown values are left out, never written as 0.
export function sectionFor(report) {
  const lines = [
    `## ${report.window.from}`,
    `- from: ${report.window.from}`,
    `- to: ${report.window.to}`,
  ];
  for (const [name, key, digits] of KEYS) {
    const t = report.figures.find(x => x.name === name);
    if (t && t.value !== null && t.value !== undefined) {
      lines.push(`- ${key}: ${round(t.value, digits)}`);
    }
  }
  const profile = report.pace?.profile;
  if (profile) {
    lines.push(`- pace-profile-weeks: ${profile.weeks}`);
    lines.push(`- pace-active-hours-weekday: ${profile.activeHours.weekday}`);
    lines.push(`- pace-active-hours-weekend: ${profile.activeHours.weekend}`);
  }
  if (Number.isInteger(report.advisorCalls)) lines.push(`- advisor-calls: ${report.advisorCalls}`);
  if (Number.isFinite(report.advisorPerPr)) {
    lines.push(`- advisor-per-pr: ${round(report.advisorPerPr, 1)}`);
  }
  const calls = report.toolCalls;
  if (calls && calls.total > 0) {
    lines.push(`- tool-calls: ${calls.total}`);
    lines.push(`- tool-errors: ${calls.errors}`);
    lines.push(`- tools-used: ${calls.used}`);
    if (Number.isInteger(calls.never)) lines.push(`- tools-never-used: ${calls.never}`);
  }
  return lines.join('\n');
}

const HEAD = [
  '---',
  'type: weekly-check',
  '---',
  '',
  '# Weekly check',
  '',
  'Written by `npm run usage:week -- --write-vault` at the Saturday weekly check; do not edit by hand.',
  "The board's Week page reads the sections below (newest first). Only numbers go here.",
  '',
].join('\n');

// Sections in the existing text, as [heading date, text].
export function splitSections(text) {
  const parts = text.split(/^## /m).slice(1);
  return parts.map(p => [p.split('\n', 1)[0].trim(), `## ${p}`.trimEnd()]);
}

// The note with this report's section added, or replacing the one for the same first day.
export function upsert(existing, report) {
  const id = report.window.from;
  // sections from before 2026-11-11 carry `-limit` and `-ok` lines: drop them as they pass through
  const rest = splitSections(existing || '')
    .filter(([d]) => d !== id)
    .map(([d, s]) => [d, s.replace(/^- [a-z-]+-(?:limit|ok): .*(?:\r?\n|$)/gm, '').trimEnd()]);
  const all = [[id, sectionFor(report)], ...rest].sort((a, b) =>
    a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0
  );
  return `${HEAD}\n${all.map(([, s]) => s).join('\n\n')}\n`;
}

export function writeNote(file, report) {
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, upsert(existing, report));
}
