// @ts-check
/**
 * Was a ready PR's green CI run on top of main's current tip? Then main's own CI for that tip, still
 * running, has nothing to add for this PR, and the merge runner does not wait for it (the gate still
 * reads main and refuses a red one). Split from scripts/merge-runner.mjs (line limit).
 *
 * Two ways to answer yes: the PR head already contains main's tip (compare `behind_by` 0), or a
 * green pull_request CI run on that head was created after the tip commit existed (the run tests
 * the head merged into the base as it was at that moment, and a rerun keeps its first merge).
 */

/** @typedef {{ status: number | null, stdout: string, stderr: string }} Ran */

/** GitHub refreshes a pull request's merge ref lazily and clocks differ: a run must start this long after the tip. */
const SLACK_MS = 2 * 60_000;

/**
 * @param {{ behindBy: number | null, tipDate: string, runs: { event?: string, conclusion?: string | null, createdAt?: string }[] }} i
 * @returns {boolean}
 */
export function testedOnTip({ behindBy, tipDate, runs }) {
  if (behindBy === 0) return true;
  const tipMs = Date.parse(tipDate);
  if (!Number.isFinite(tipMs)) return false;
  return runs.some(
    r =>
      ['pull_request', 'merge_group'].includes(String(r.event)) &&
      r.conclusion === 'success' &&
      Date.parse(r.createdAt ?? '') > tipMs + SLACK_MS
  );
}

/**
 * What mainState adds while main's tip run is not finished: `running` (it is main's tip run) and
 * `prevGreen` (the newest finished run before it passed).
 * @param {{ status?: string, conclusion?: string | null }[]} runs newest first
 * @param {object} run the running one @param {string} tip
 */
export function runningInfo(runs, run, tip) {
  const prev = runs
    .slice(runs.indexOf(run) + 1)
    .find(
      r =>
        r.status === 'completed' &&
        !['cancelled', 'skipped', 'neutral'].includes(String(r.conclusion))
    );
  // A running attempt 2 or later is a rerun, usually of a red run: the gate calls that main red.
  const rerun = Number(/** @type {any} */ (run).attempt ?? 1) > 1;
  return { running: !!tip, prevGreen: !rerun && prev?.conclusion === 'success' };
}

/**
 * No wait for main's running CI when the run before it passed and this PR's green CI already ran on
 * top of main's tip: that run covers what main's would. The gate still reads main and refuses a red
 * one. Not with a merge queue (the runner has its own rule there).
 * @param {{ baseCurrent?: (r: any, tip: string) => boolean, log: (l: string) => void }} d
 * @param {{ wait: boolean, running?: boolean, prevGreen?: boolean, why: string }} main
 * @param {boolean} queueOn @param {{ pr: number, head: string }} r @param {string} tip
 */
export function skipMainWait(d, main, queueOn, r, tip) {
  const skip =
    main.wait &&
    !queueOn &&
    main.running === true &&
    main.prevGreen === true &&
    d.baseCurrent?.(r, tip) === true;
  if (skip)
    d.log(`${main.why}, but #${r.pr}'s CI ran on main's tip ${tip.slice(0, 7)}; not waiting`);
  return skip;
}

/**
 * The real dependency: `baseCurrent(r, tip)`, false on any read that fails.
 * @param {{ sh: (cmd: string, args: string[]) => Ran, repo: string }} o
 */
export function makeBaseDeps({ sh, repo }) {
  return {
    /** @param {{ head: string }} r @param {string} tip */
    baseCurrent: (r, tip) => {
      const cmp = sh('gh', [
        'api',
        `repos/${repo}/compare/${tip}...${r.head}`,
        '--jq',
        '.behind_by',
      ]);
      const out = cmp.stdout.trim();
      const behind = cmp.status === 0 && /^\d+$/.test(out) ? Number(out) : NaN;
      if (behind === 0) return true;
      const t = sh('gh', ['api', `repos/${repo}/commits/${tip}`, '--jq', '.commit.committer.date']);
      const list = sh('gh', [
        'run',
        'list',
        '-R',
        repo,
        '-w',
        'ci.yml',
        '--commit',
        r.head,
        '-L',
        '10',
        '--json',
        'event,conclusion,createdAt',
      ]);
      if (t.status !== 0 || list.status !== 0) return false;
      try {
        return testedOnTip({
          behindBy: Number.isFinite(behind) ? behind : null,
          tipDate: t.stdout.trim(),
          runs: JSON.parse(list.stdout),
        });
      } catch {
        return false;
      }
    },
  };
}
