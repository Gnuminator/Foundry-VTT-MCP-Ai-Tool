// @ts-check
import {
  REPO,
  WAIT_MAX_ERRORS,
  EXIT_CI_FAILED,
  EXIT_HEAD_MOVED,
  EXIT_WAIT_TIMEOUT,
} from './constants.mjs';
import { firstLine } from './run.mjs';

/** @import { Run } from './run.mjs' */

/**
 * The status check names the branch ruleset requires, from `gh api .../rules/branches/main`.
 * Null when the answer is not a list of rules or lists no required status checks at all.
 * @param {string} json
 * @returns {string[] | null}
 */
export function requiredContexts(json) {
  let rules;
  try {
    rules = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(rules)) return null;
  const contexts = rules
    .filter(r => r && r.type === 'required_status_checks')
    .flatMap(r => r.parameters?.required_status_checks ?? [])
    .map(c => c?.context)
    .filter(c => typeof c === 'string' && c !== '');
  return contexts.length > 0 ? [...new Set(contexts)] : null;
}

/** A job name an unexpanded expression leaks into ends at the "${{"; the rest is not a name. @param {any} name */
export function stripExpression(name) {
  const t = String(name ?? '');
  const i = t.indexOf('${{');
  return i < 0 ? t : t.slice(0, i).trim();
}

/** The Actions run id in a check's detailsUrl (github.com/<owner>/<repo>/actions/runs/<id>/job/<id>), or null. @param {any} c */
export function runIdOf(c) {
  const m = /github\.com\/[^/]+\/[^/]+\/actions\/runs\/(\d+)/.exec(String(c.detailsUrl ?? ''));
  return m ? Number(m[1]) : null;
}

/** Whether a job name still holds an unexpanded expression (the job never started). @param {any} name */
export const isRaw = name => String(name ?? '').includes('${{');

/**
 * Which runs are hand-dispatched: a run is told apart by the names of its jobs that did expand (a
 * " [dispatch]" suffix or none). A run with no expanded name is unknown and is neither.
 * @param {any[]} rollup @returns {{ dispatch: Set<number>, normal: Set<number> }}
 */
export function runClasses(rollup) {
  const dispatch = new Set();
  const normal = new Set();
  for (const c of rollup) {
    const id = runIdOf(c);
    if (id === null || c.status === undefined || isRaw(c.name)) continue;
    (/\[dispatch\]/.test(String(c.name)) ? dispatch : normal).add(id);
  }
  return { dispatch, normal };
}

/**
 * Gives each check run the name it is keyed by. An expanded name is kept. A raw name (cancelled
 * before it started) loses everything from "${{" on, with " [dispatch]" appended when its run is a
 * dispatch run, so it meets the same check of a newer run. A raw name of a run that cannot be
 * classified stays whole (fail closed: it keeps blocking).
 * @param {any[]} rollup @returns {(c: any) => string}
 */
export function checkNamer(rollup) {
  const { dispatch, normal } = runClasses(rollup);
  return c => {
    const name = String(c.name ?? c.context ?? '');
    if (!isRaw(name)) return name;
    const id = runIdOf(c);
    if (id !== null && dispatch.has(id)) return `${stripExpression(name)} [dispatch]`;
    if (id !== null && normal.has(id)) return stripExpression(name);
    return name;
  };
}

/**
 * Drops each CANCELLED check run that a newer run replaced: a run of the same workflow with a
 * higher id, not a dispatch run, reports the same check (by key name; for a raw matrix name, a name
 * starting with its text before the expression). That is the run the concurrency group cancelled
 * when a newer run started on the same head. The newer run must report that very check: a newer run
 * that has only some jobs in the rollup yet (the screenshot summary appears after its shards) does
 * not excuse the old one. A cancelled check without a run id, from a dispatch run, or with no newer
 * check of its own stays and blocks. So does a cancelled check of an unclassified run (every job of
 * it cancelled before it started, so no name expanded and its kind is unknown: it may be a dispatch
 * run) and of a mixed run (some jobs expanded with " [dispatch]", some without). A rerun
 * (`gh run rerun <id> --failed`) or a new push replaces such a check; a newer run alone does not.
 * @param {any[]} rollup @returns {any[]}
 */
export function supersededCancelled(rollup) {
  const { dispatch, normal } = runClasses(rollup);
  const nameOf = checkNamer(rollup);
  /** newer, replaceable candidates: finished or not, from non-dispatch runs of a named workflow */
  const candidates = rollup
    .map(c => ({ c, id: runIdOf(c) }))
    .filter(
      ({ c, id }) =>
        id !== null &&
        c.status !== undefined &&
        c.workflowName &&
        !dispatch.has(id) &&
        // a matrix leg skipped by `if:` in the newer run keeps its raw name (it never expanded);
        // from a run known to be normal it still counts as that run's answer for the leg
        (!isRaw(c.name) ||
          (String(c.conclusion ?? '').toUpperCase() === 'SKIPPED' && normal.has(id)))
    );
  return rollup.filter(c => {
    if (c.status === undefined || String(c.conclusion ?? '').toUpperCase() !== 'CANCELLED')
      return true;
    const id = runIdOf(c);
    // only a run known to be a normal (pull_request) run can be superseded; an unclassified run
    // (every job cancelled before it started) may be a dispatch run, so it keeps blocking. A run
    // with both kinds of expanded names (a mixed run) is not purely normal: it keeps blocking too.
    if (id === null || !normal.has(id) || dispatch.has(id) || !c.workflowName) return true;
    const mine = nameOf(c);
    const prefix = isRaw(c.name) ? stripExpression(c.name) : null;
    if (prefix === '') return true;
    return !candidates.some(
      n =>
        /** @type {number} */ (n.id) > id &&
        n.c.workflowName === c.workflowName &&
        (prefix === null ? String(n.c.name) === mine : String(n.c.name).startsWith(prefix))
    );
  });
}

/**
 * The newest entry of each check in a rollup. A PR closed and reopened (or a workflow run again on
 * a fresh merge ref) gets a second run on the same head, and GitHub keeps both in the rollup: an old
 * failure must not outvote the newer run. Check runs are keyed by workflow and name, commit statuses
 * by context, so a matrix job's `name:` must include its matrix variables or its legs hide each
 * other. The later `startedAt` wins. A start time that is missing, not a number or at or below 0 (gh
 * writes a missing time as Go's zero time `0001-01-01T00:00:00Z`) is unknown: an unfinished entry with
 * an unknown time (queued) counts as the newest, a finished one as the oldest. On equal or unknown
 * times the worse entry stays (failing over pending over success).
 * Chosen on purpose (#657 L3): a finished entry with no start time ranks oldest, so a dated run
 * replaces it even when that run is a success older than the failure. The alternative (keep the
 * undated failure) would block a PR for good once a retry has passed, and the dated entry is the
 * only one that can be placed in time; two undated finished entries keep the worse one. A hand-dispatched ci.yml run
 * (event workflow_dispatch) cannot collide with the pull_request run: its job names carry a
 * " [dispatch]" suffix, so it is a key of its own. The other side: a failing or cancelled
 * "[dispatch]" check on the head blocks the gate even when the pull_request run is green. That is on
 * purpose; `gh run rerun <id> --failed` on the dispatch run (a newer start under the same key wins)
 * or a new push clears it.
 *
 * Two more rules, both for a run that a newer pull_request run of the same workflow replaced on the
 * same head (the concurrency group cancels the older one): a job cancelled before it started keeps
 * the raw expression in its name ("dashboard-visual (screenshots)${{ ... }}"), so the newer run's
 * green check never shared its key. A raw name is keyed without the expression (with " [dispatch]"
 * added when its run is a dispatch run; a run that cannot be classified keeps the raw name), and
 * `supersededCancelled` drops a CANCELLED check when a newer non-dispatch run reports that check.
 * A cancelled check of a dispatch run is never dropped, so the "[dispatch] blocks" rule above holds.
 * Nor is one of an unclassified run (all its jobs cancelled before they started, so its kind is
 * unknown) or of a mixed run: those keep blocking until a rerun or a push replaces them.
 * @param {any[]} rollup @returns {any[]}
 */
export function latestChecks(rollup) {
  rollup = supersededCancelled(rollup);
  const keyName = checkNamer(rollup);
  const byKey = new Map();
  const isStatusEntry = (/** @type {any} */ c) => c.state !== undefined && c.status === undefined;
  const unfinished = (/** @type {any} */ c) =>
    isStatusEntry(c)
      ? ['PENDING', 'EXPECTED'].includes(String(c.state).toUpperCase())
      : String(c.status ?? '').toUpperCase() !== 'COMPLETED';
  const started = (/** @type {any} */ c) => {
    const t = c.startedAt ? Date.parse(c.startedAt) : NaN;
    if (Number.isFinite(t) && t > 0) return t;
    return unfinished(c) ? Infinity : 0;
  };
  const badness = (/** @type {any} */ c) => {
    if (unfinished(c)) return 1;
    const v = String(isStatusEntry(c) ? c.state : c.conclusion).toUpperCase();
    return ['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(v) ? 0 : 2;
  };
  for (const c of rollup) {
    const key = isStatusEntry(c)
      ? `status\u0000${c.context ?? c.name}`
      : `run\u0000${c.workflowName ?? ''}\u0000${keyName(c)}`;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, c);
      continue;
    }
    const [tc, ts] = [started(c), started(seen)];
    if (tc > ts || (tc === ts && badness(c) >= badness(seen))) byKey.set(key, c);
  }
  return [...byKey.values()];
}

/**
 * What is wrong with the CI checks of a PR. Handles both shapes of `statusCheckRollup`: a check run
 * `{ name, status, conclusion }` and a commit status `{ context, state }`. Only the newest entry of
 * each check counts (`latestChecks`). `required` are names that must be in the rollup.
 * @param {any[]} rollup @param {string[]} [required]
 * @returns {{ failing: string[], pending: string[], missing: string[] }}
 */
export function rollupProblems(rollup, required = []) {
  const failing = [];
  const pending = [];
  const names = new Set();
  for (const c of latestChecks(rollup)) {
    names.add(c.name ?? c.context);
    if (c.state !== undefined && c.status === undefined) {
      const name = c.context ?? c.name ?? 'status';
      const state = String(c.state).toUpperCase();
      if (state === 'SUCCESS') continue;
      if (state === 'PENDING' || state === 'EXPECTED') pending.push(`${name} (${state})`);
      else failing.push(`${name} (${state})`);
      continue;
    }
    const name = c.name ?? c.context ?? 'check';
    const status = String(c.status ?? '').toUpperCase();
    const conclusion = String(c.conclusion ?? '').toUpperCase();
    if (status !== 'COMPLETED') pending.push(`${name} (${status || 'unknown'})`);
    else if (!['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(conclusion)) {
      failing.push(`${name} (${conclusion || 'no conclusion'})`);
    }
  }
  return { failing, pending, missing: required.filter(r => !names.has(r)) };
}

/**
 * --wait-ci: poll the PR until every CI check on its head commit has finished, in this one process.
 * A check the branch ruleset requires that is not reported yet counts as pending (CI may not have
 * started). Ends at once on a failing check (names it), when the head commit differs from the first
 * one seen ("head moved"), when the PR is no longer open, after `timeoutMs`, or after
 * WAIT_MAX_ERRORS gh failures in a row. The gate's own CI check still runs afterwards; this only
 * waits. `log` gets one line when the set of pending checks changes.
 * @param {{ pr: number, run: Run, log: (line: string) => void, sleep: (ms: number) => void,
 *   clock: () => number, pollMs: number, timeoutMs: number }} o
 * @returns {{ ok: true, head: string } | { ok: false, code: number, reason: string }}
 */
export function waitForCi(o) {
  const { pr: n, run, log, sleep, clock, pollMs, timeoutMs } = o;
  const rules = run('gh', ['api', `repos/${REPO}/rules/branches/main`]);
  const required = (rules.status === 0 ? requiredContexts(rules.stdout) : null) ?? [];
  const started = clock();
  /** @type {string | null} */
  let firstHead = null;
  let errors = 0;
  let lastReport = '';
  let waitingFor = 'the first poll';
  /** @param {number} code @param {string} reason */
  const stop = (code, reason) => ({ ok: /** @type {const} */ (false), code, reason });
  for (;;) {
    const view = run('gh', [
      'pr',
      'view',
      String(n),
      '--json',
      'state,headRefOid,mergeable,statusCheckRollup',
    ]);
    /** @type {any} */
    let pr = null;
    if (view.status === 0) {
      try {
        pr = JSON.parse(view.stdout);
      } catch {
        /* counted as an error below */
      }
    }
    if (!pr) {
      errors += 1;
      if (errors >= WAIT_MAX_ERRORS) {
        return stop(
          1,
          `wait-ci: gh pr view ${n} failed ${errors} times in a row: ${firstLine(view.stderr || view.stdout) || 'no output'}`
        );
      }
    } else {
      errors = 0;
      const head = String(pr.headRefOid ?? '').toLowerCase();
      firstHead ??= head;
      if (head !== firstHead) {
        return stop(
          EXIT_HEAD_MOVED,
          `wait-ci: head moved from ${firstHead.slice(0, 7)} to ${head.slice(0, 7)} while waiting; the checks and the review no longer match, start again`
        );
      }
      if (pr.state !== 'OPEN') return stop(1, `wait-ci: #${n} is ${pr.state}, not OPEN`);
      if (pr.mergeable === 'CONFLICTING') {
        return stop(
          1,
          `wait-ci: #${n} has merge conflicts, so CI will not run; merge main into the branch and resolve them`
        );
      }
      const rollup = pr.statusCheckRollup ?? [];
      const { failing, pending, missing } = rollupProblems(rollup, required);
      if (failing.length > 0) {
        return stop(
          EXIT_CI_FAILED,
          `wait-ci: CI failed on ${head.slice(0, 7)}: ${failing.join(', ')}`
        );
      }
      const open = [...pending, ...missing.map(m => `${m} (not reported yet)`)];
      if (rollup.length === 0) open.push('no checks reported yet');
      if (open.length === 0) return { ok: true, head };
      waitingFor = open.join(', ');
      if (waitingFor !== lastReport) {
        lastReport = waitingFor;
        log(`lane:merge: waiting for CI on #${n} at ${head.slice(0, 7)}: ${waitingFor}`);
      }
    }
    if (clock() - started >= timeoutMs) {
      return stop(
        EXIT_WAIT_TIMEOUT,
        `wait-ci: timed out after ${Math.round(timeoutMs / 60000)} minutes; still waiting for ${waitingFor}`
      );
    }
    sleep(pollMs);
  }
}
