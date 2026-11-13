// @ts-check
import { REPO } from './constants.mjs';
import { firstLine } from './run.mjs';

/** @import { Run } from './run.mjs' */

/** Conclusions that say nothing about main's health (a superseded or skipped run). */
const NEUTRAL = new Set(['cancelled', 'skipped', 'neutral', 'stale']);
/** Answers that are not a real reason. */
const EMPTY_REASON = /^(none|nothing|no|n\/?a|not needed|tbd)\.?$/i;

/**
 * The text of an `Unblocks main:` line with real content, or null. Same shape as `Live check:`:
 * a bullet or bold is fine; an empty line, a placeholder, "none" or an HTML comment is not.
 * @param {string} body
 */
export function unblocksMainLine(body) {
  const text = String(body ?? '').replace(/<!--[\s\S]*?(-->|$)/g, '');
  for (const raw of text.split(/\r?\n/)) {
    const m =
      /^\s*(?:[-*]\s+)?(?:unblocks main:|\*\*unblocks main:\*\*|\*\*unblocks main\*\*:)\s*(.*)$/i.exec(
        raw
      );
    if (!m) continue;
    const t = m[1].trim();
    if (/[a-z0-9]{3}/i.test(t) && !/^<[^>]*>$/.test(t) && !EMPTY_REASON.test(t)) return t;
  }
  return null;
}

/**
 * Is main red? Reads main's push runs of ci.yml (newest first).
 * @param {Run} run
 * @returns {{ problem: string | null, red: boolean, text: string }} `problem` is a refusal reason
 * (red or unreadable), `red` says main is red, `text` names the run
 */
function readMain(run) {
  const r = run('gh', [
    'run',
    'list',
    '-R',
    REPO,
    '--branch',
    'main',
    '--event',
    'push',
    '--workflow',
    'ci.yml',
    '--limit',
    '20',
    '--json',
    'databaseId,status,conclusion,headSha,url,attempt',
  ]);
  if (r.status !== 0) {
    return {
      problem: `main red: cannot read main's CI runs (gh run list failed: ${firstLine(r.stderr || r.stdout) || 'no output'}); refusing`,
      red: false,
      text: '',
    };
  }
  /** @type {any[]} */
  let runs;
  try {
    runs = JSON.parse(r.stdout);
    if (!Array.isArray(runs)) throw new Error('not a list');
  } catch {
    return {
      problem: 'main red: gh run list answered something that is not a list of runs; refusing',
      red: false,
      text: '',
    };
  }
  const describe = (/** @type {any} */ x) =>
    `run ${x.databaseId}${x.headSha ? ` at ${String(x.headSha).slice(0, 7)}` : ''}${x.url ? `, ${x.url}` : ''}`;
  // A red run that is being rerun (attempt 2 or later, not completed) is still red.
  const rerun = runs.find(x => x.status !== 'completed' && Number(x.attempt ?? 1) > 1);
  const last = runs.find(
    x => x.status === 'completed' && !NEUTRAL.has(String(x.conclusion ?? '').toLowerCase())
  );
  if (rerun && (!last || runs.indexOf(rerun) < runs.indexOf(last))) {
    return { problem: null, red: true, text: `${describe(rerun)} is being rerun after a failure` };
  }
  if (!last) {
    return {
      problem: 'main red: no completed push run of ci.yml on main to judge; refusing',
      red: false,
      text: '',
    };
  }
  if (String(last.conclusion).toLowerCase() === 'success')
    return { problem: null, red: false, text: '' };
  return { problem: null, red: true, text: `${describe(last)}: ${last.conclusion}` };
}

/**
 * The gate's verdict on main's health: a refusal when main's last completed push run of ci.yml
 * failed (or is being rerun, or cannot be read), unless the PR body has an `Unblocks main:` line;
 * then a note says it passed that way.
 * @param {Run} run @param {string} body
 * @returns {{ problem: string | null, note: string | null }}
 */
export function mainRedCheck(run, body) {
  const unblocks = unblocksMainLine(body);
  const main = readMain(run);
  if (main.problem) return { problem: unblocks === null ? main.problem : null, note: null };
  if (!main.red) return { problem: null, note: null };
  if (unblocks !== null) {
    return {
      problem: null,
      note: `main is red (${main.text}); passed as "Unblocks main: ${unblocks}"`,
    };
  }
  return {
    problem: `main red: main's last completed push run of ci.yml failed (${main.text}); merge only the fix: a PR whose description has an "Unblocks main: <what it fixes>" line`,
    note: null,
  };
}
