/**
 * The kit flake ledger: per-scenario history of every kit run on this PC, and the flaky marker.
 * A scenario is flaky when it passed and failed on the same git sha and the same world. The
 * history lives in <kit home>/scenario-history.json (local, counts and ids only); the runs note
 * gets a "Flaky scenarios" table built from it.
 *
 *   node scripts/test-kit/lib/flake-ledger.mjs backfill [--home <kit home>]   seed from old reports
 *   node scripts/test-kit/lib/flake-ledger.mjs show [--home <kit home>]       print the flaky list
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { kitHome } from './targets.mjs';

export const HISTORY_FILE = 'scenario-history.json';
export const MAX_RUNS = 300;
const FAIL = new Set(['fail', 'error']);

/** @param {string} home */
export function readHistory(home) {
  try {
    const doc = JSON.parse(readFileSync(path.join(home, HISTORY_FILE), 'utf8'));
    return Array.isArray(doc?.runs) ? doc.runs : [];
  } catch {
    return [];
  }
}

/** @param {string} home @param {object[]} runs */
export function writeHistory(home, runs) {
  const file = path.join(home, HISTORY_FILE);
  mkdirSync(home, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ version: 1, runs: runs.slice(-MAX_RUNS) }, null, 1)}\n`);
  renameSync(tmp, file);
}

/**
 * One history entry from a report.json document: {at, sha, world, size, dir, scenarios}. Skipped
 * scenarios are left out. Null when the report has no scenarios.
 */
export function entryFromReport(report, dir = '', dirty = false) {
  const run = report?.run || {};
  const scenarios = {};
  for (const s of report?.scenarios || []) {
    if (s.status === 'pass') scenarios[s.id] = 'pass';
    else if (FAIL.has(s.status)) scenarios[s.id] = 'fail';
  }
  const ids = Object.keys(scenarios);
  if (!ids.length) return null;
  // A run where nothing passed is the environment or the bridge, not a scenario flaking.
  if (ids.length > 3 && !ids.some(id => scenarios[id] === 'pass')) return null;
  return {
    ...(dirty ? { dirty: true } : {}),
    at: run.finishedAt || run.startedAt || '',
    sha: String(run.gitSha || 'unknown'),
    world: String(run.target?.world || ''),
    size: String(run.size || ''),
    dir,
    scenarios,
  };
}

/** Appends a run's entry (same dir twice replaces it). Returns the new history. */
export function recordRun(home, report, dir = '', dirty = false) {
  const entry = entryFromReport(report, dir, dirty);
  const runs = readHistory(home);
  if (!entry) return runs;
  const next = runs.filter(r => !dir || r.dir !== dir);
  next.push(entry);
  next.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  writeHistory(home, next);
  return next;
}

/**
 * Flaky scenarios: passed and failed on the same sha, world and kit size. Newest first. Runs from
 * a tree with uncommitted changes (the fix-and-rerun loop) and runs with no sha are left out: a
 * real failure fixed without a commit would otherwise look flaky.
 */
export function findFlaky(runs) {
  /** @type {Map<string, {id:string, sha:string, world:string, size:string, pass:number, fail:number, last:string}>} */
  const m = new Map();
  for (const run of runs) {
    if (run.dirty || !run.sha || run.sha === 'unknown') continue;
    for (const [id, st] of Object.entries(run.scenarios || {})) {
      const key = `${id}\u0000${run.sha}\u0000${run.world}\u0000${run.size}`;
      const e = m.get(key) || {
        id,
        sha: run.sha,
        world: run.world,
        size: run.size,
        pass: 0,
        fail: 0,
        last: '',
      };
      e[st === 'pass' ? 'pass' : 'fail'] += 1;
      if (String(run.at) > e.last) e.last = String(run.at);
      m.set(key, e);
    }
  }
  return [...m.values()]
    .filter(e => e.pass && e.fail)
    .sort((a, b) => b.last.localeCompare(a.last) || a.id.localeCompare(b.id));
}

/** Scenario ids flaky on this sha and world, for marking the failing list of a run. */
export function flakyIds(runs, sha, world, size) {
  return new Set(
    findFlaky(runs)
      .filter(e => e.sha === sha && e.world === world && (size === undefined || e.size === size))
      .map(e => e.id)
  );
}

export const FLAKY_HEAD = '## Flaky scenarios';
const FLAKY_TABLE = `| Scenario | Git | World | Passed | Failed | PC | Last seen |
| --- | --- | --- | --- | --- | --- | --- |`;

/** The note's flaky section for one PC, as table row lines. */
export function flakyRows(runs, pc, limit = 30) {
  const cell = s =>
    String(s ?? '')
      .replace(/\|/g, '/')
      .trim();
  return findFlaky(runs)
    .slice(0, limit)
    .map(
      e =>
        `| ${[e.id, e.sha, e.world, e.pass, e.fail, pc, e.last.slice(0, 16).replace('T', ' ')].map(cell).join(' | ')} |`
    );
}

/**
 * The note text with its flaky section rewritten: rows of this PC are replaced by `rows`, rows of
 * other PCs are kept. The section sits after the runs table.
 */
export function updateFlakySection(text, pc, rows, max = 60) {
  const lines = String(text || '').split(/\r?\n/);
  const at = lines.findIndex(l => l.trim() === FLAKY_HEAD);
  const before = (at === -1 ? lines : lines.slice(0, at)).join('\n').replace(/\s+$/, '');
  const kept = [];
  if (at !== -1) {
    for (let i = at + 1; i < lines.length; i += 1) {
      const l = lines[i];
      if (!l.startsWith('|') || /^\|\s*(Scenario|---)/.test(l)) continue;
      const cols = l.split('|').map(c => c.trim());
      if (cols[6] !== pc) kept.push(l);
    }
  }
  const all = [...rows, ...kept].slice(0, max);
  if (!all.length) return `${before}\n`;
  return `${before}

${FLAKY_HEAD}

Passed and failed on the same git sha and world, so not a real regression. Built by the kit run
command from the per-scenario history on each PC.

${FLAKY_TABLE}
${all.join('\n')}
`;
}

/** Seeds the history from every report.json under <home>/reports. Returns the run count. */
export function backfill(home) {
  const root = path.join(home, 'reports');
  if (!existsSync(root)) return 0;
  const runs = [];
  for (const d of readdirSync(root)) {
    try {
      const report = JSON.parse(readFileSync(path.join(root, d, 'report.json'), 'utf8'));
      if (report?.run?.fake) continue;
      const e = entryFromReport(report, path.join(root, d));
      if (e) runs.push(e);
    } catch {
      // not a report folder
    }
  }
  runs.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  writeHistory(home, runs);
  return runs.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--home');
  const home = i !== -1 ? argv[i + 1] : kitHome();
  if (argv[0] === 'backfill')
    console.log(`${backfill(home)} runs in ${path.join(home, HISTORY_FILE)}`);
  else if (argv[0] === 'show') {
    for (const e of findFlaky(readHistory(home)))
      console.log(`${e.id}  ${e.sha}  ${e.world}  pass ${e.pass}  fail ${e.fail}  ${e.last}`);
  } else console.log('usage: flake-ledger.mjs backfill|show [--home <kit home>]');
}
