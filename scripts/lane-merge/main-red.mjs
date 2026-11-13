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
 * Main's tip sha from GitHub (the same source as the run list, so the two agree).
 * @param {Run} run
 * @returns {{ sha: string, problem: string | null }}
 */
function readTip(run) {
  const t = run('gh', ['api', `repos/${REPO}/git/ref/heads/main`, '--jq', '.object.sha']);
  const sha = t.stdout.trim();
  if (t.status !== 0 || !/^[0-9a-f]{40}$/.test(sha)) {
    return {
      sha: '',
      problem: `main red: cannot read main's tip (gh api failed: ${firstLine(t.stderr || t.stdout) || 'no output'}); refusing`,
    };
  }
  return { sha, problem: null };
}

/**
 * Did the attempt before this rerun end red? A rerun of a cancelled, skipped or green attempt says
 * nothing about main; an attempt that cannot be read counts as red (fails closed).
 * @param {Run} run @param {any} rerun
 * @returns {boolean}
 */
function rerunAfterFailure(run, rerun) {
  const before = Number(rerun.attempt) - 1;
  const r = run('gh', [
    'api',
    `repos/${REPO}/actions/runs/${rerun.databaseId}/attempts/${before}`,
    '--jq',
    '.conclusion',
  ]);
  const conclusion = r.stdout.trim().toLowerCase();
  if (r.status !== 0 || !conclusion || conclusion === 'null') return true;
  return conclusion !== 'success' && !NEUTRAL.has(conclusion);
}

/**
 * Is main red? Reads main's push runs of ci.yml (newest first) and judges them only once main's tip
 * has a run: a tip without one (a merge GitHub never started CI for, or not yet) says nothing, so
 * it is a refusal the runner tries again.
 * @param {Run} run
 * @returns {{ problem: string | null, red: boolean, text: string }} `problem` is a refusal reason
 * (red or unreadable), `red` says main is red, `text` names the run
 */
function readMain(run) {
  const tip = readTip(run);
  if (tip.problem) return { problem: tip.problem, red: false, text: '' };
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
  if (!runs.some(x => String(x.headSha ?? '') === tip.sha)) {
    return {
      problem: `main red: no push run of ci.yml for main's tip ${tip.sha.slice(0, 7)} yet; refusing`,
      red: false,
      text: '',
    };
  }
  // A red run that is being rerun (attempt 2 or later, not completed) is still red; the rerun of a
  // cancelled or green attempt is not.
  const rerun = runs.find(
    x => x.status !== 'completed' && Number(x.attempt ?? 1) > 1 && rerunAfterFailure(run, x)
  );
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
