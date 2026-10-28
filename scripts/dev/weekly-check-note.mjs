// The vault note `Weekly check.md` that the PM board's Week page reads: one `## <first day>` section
// per weekly check, newest first, plain `key: value` lines, numbers only. Written by
// `npm run usage:week -- --write-vault` (a second run for the same window replaces its section).
//
//   ## 2026-10-17
//   - from: 2026-10-17
//   - to: 2026-10-23
//   - startup: 77822
//   - startup-limit: 75000
//   - startup-ok: no
//   ... the same three lines for tokens-m-per-pr, sessions-a-day and weekly-points-a-day

import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const KEYS = [
  ['startup', 'startup', 0],
  ['M tokens per PR', 'tokens-m-per-pr', 1],
  ['sessions a day', 'sessions-a-day', 1],
  ['weekly % a day', 'weekly-points-a-day', 1],
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
    const t = report.targets.find(x => x.name === name);
    if (!t) continue;
    if (t.value !== null && t.value !== undefined)
      lines.push(`- ${key}: ${round(t.value, digits)}`);
    lines.push(`- ${key}-limit: ${t.limit}`);
    // ok from the rounded number, so it agrees with what the board recomputes from the note
    const known = t.value !== null && t.value !== undefined;
    const ok = known ? round(t.value, digits) <= t.limit : t.ok;
    lines.push(`- ${key}-ok: ${ok === null || ok === undefined ? 'unknown' : ok ? 'yes' : 'no'}`);
  }
  if (Number.isInteger(report.advisorCalls)) lines.push(`- advisor-calls: ${report.advisorCalls}`);
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
  const rest = splitSections(existing || '').filter(([d]) => d !== id);
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
