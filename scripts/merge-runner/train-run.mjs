/**
 * The merge runner's own train roundtrip (D-140; the user, 2026-11-17: the runner does it, not a
 * session). When the gate has turned a PR away for the full merge train, `step` is called once per
 * round and moves a small state machine:
 *
 *   idle    train full and a PR is blocked: join the queue for test server A's lock (`queue`).
 *   queued  every round `take` the lock; while it is held by somebody else nothing blocks: the
 *           other PRs are gated as usual (the roundtrip waits, the runner does not).
 *   holding the lock is ours: run the worker (live:roundtrip, plus live:sweep when write handlers
 *           changed since the last roundtrip) on main's tip, release the lock in every case, then
 *           green -> `lane:merge --train-reset <tip>` and carry on; red -> one #pr-log line with the
 *           merges since the last roundtrip (bisect hint) and the runner stops.
 *
 * Pure: every outside action is a dependency (TrainDeps), so the tests drive it without a server.
 */
import path from 'node:path';
import { TRAIN_SIZE } from '../lane-merge/constants.mjs';
import { readTrain } from '../lane-merge/train.mjs';

/** The holder name and session id the runner uses in lock.ps1. */
export const LOCK_HOLDER = 'Merge runner (train roundtrip)';
export const LOCK_SESSION = 'merge-runner';
/** Reset refused because main moved (queue merges land meanwhile): after this many in a row, stop. */
export const MAX_RESET_REFUSALS = 3;
/** Paths whose change means the write handlers may have changed: live:sweep runs as well. */
export const SWEEP_PATTERNS = [
  /^packages\/foundry-module\/src\/(?!.*\.test\.)/,
  /^packages\/mcp-server\/src\/tools\//,
];

/** @param {string[]} files */
export const needsSweep = files =>
  files.some(f => SWEEP_PATTERNS.some(p => p.test(f.replace(/\\/g, '/'))));

/**
 * @typedef {{ status: number | null, stdout: string, stderr: string }} Ran
 * @typedef {{
 *   state: () => { size: number, limit: number, since: { pr: number, sha: string }[], lastSha: string | null },
 *   lock: (cmd: 'queue' | 'take' | 'release' | 'leave') => Ran,
 *   tip: () => string,
 *   changedSince: (sha: string | null, tip: string) => string[],
 *   worker: (tip: string, sweep: boolean) => { code: number, output: string },
 *   reset: (tip: string) => Ran,
 *   post: (text: string) => void,
 *   log: (line: string) => void,
 * }} TrainDeps
 * @typedef {{ stop?: string, cleared?: boolean }} StepResult
 */

/** @param {string} s @param {number} [n] */
const cut = (s, n = 240) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};

/** @param {TrainDeps} d */
export function makeTrainRun(d) {
  let phase = /** @type {'idle' | 'queued'} */ ('idle');
  let waited = 0;
  let resetRefusals = 0;

  /** The merges the train counts, as a bisect hint. @param {{ pr: number, sha: string }[]} since */
  const hint = since =>
    since.length
      ? `merged since the last roundtrip: ${since.map(s => `#${s.pr}@${s.sha.slice(0, 7)}`).join(', ')}; bisect by checking out main at the first of them and then each one after it`
      : 'no merge is recorded on the train; check main at its tip';

  return {
    /** For a test or a restart: where the machine stands. */
    phase: () => phase,
    /** The runner is going away: give up a queue place. */
    leave() {
      if (phase === 'queued') d.lock('leave');
      phase = 'idle';
    },
    /**
     * One round. `blocked`: a PR is waiting for the train (the gate turned it away).
     * @param {boolean} blocked @returns {StepResult}
     */
    step(blocked) {
      if (phase === 'idle') {
        if (!blocked) return {};
        const st = d.state();
        if (st.size < st.limit) {
          d.log('a PR waits for the train, but the train is not full any more; carrying on');
          return { cleared: true };
        }
        const q = d.lock('queue');
        if (q.status !== 0) {
          d.log(`WARNING: could not queue for the test server lock (${cut(q.stderr || q.stdout)})`);
          return {};
        }
        phase = 'queued';
        waited = 0;
        d.log('merge train full: queued for test server A to run live:roundtrip');
        d.post(
          `merge runner: merge train full (${st.size}/${st.limit}); queued for test server A to run live:roundtrip, the other PRs go on meanwhile`
        );
        return {};
      }
      // queued: try the lock.
      const t = d.lock('take');
      if (t.status !== 0) {
        if (waited++ % 15 === 0) d.log('waiting for test server A (held by another session)');
        return {};
      }
      phase = 'idle';
      /** @type {{ code: number, output: string } | undefined} */
      let ran;
      /** @type {string} */
      let tip;
      let st;
      try {
        st = d.state();
        if (st.size < st.limit) {
          d.log('the train was reset by someone else while queued; nothing to run');
          return { cleared: true };
        }
        tip = d.tip();
        if (!/^[0-9a-f]{40}$/.test(tip)) {
          d.log('WARNING: main tip unreadable; trying again next round');
          phase = 'queued';
          return {};
        }
        const sweep = needsSweep(d.changedSince(st.lastSha, tip));
        d.log(
          `holding test server A: live:roundtrip${sweep ? ' and live:sweep' : ''} on ${tip.slice(0, 7)}`
        );
        ran = d.worker(tip, sweep);
      } finally {
        const rel = d.lock('release');
        if (rel.status !== 0)
          d.log(
            `WARNING: lock release failed (${cut(rel.stderr || rel.stdout)}); release it by hand`
          );
      }
      if (!ran) return {};
      if (ran.code === 0) {
        const r = d.reset(tip);
        if (r.status === 0) {
          resetRefusals = 0;
          d.log(`live:roundtrip green on ${tip.slice(0, 7)}; train reset`);
          d.post(
            `merge runner: live:roundtrip green on main ${tip.slice(0, 7)}; merge train reset, merging goes on`
          );
          return { cleared: true };
        }
        // Main moved while the roundtrip ran (the queue merged something): run it again on the new tip.
        if (++resetRefusals >= MAX_RESET_REFUSALS) {
          const why = `the train reset was refused ${resetRefusals} times (${cut(r.stdout + r.stderr, 200)})`;
          d.post(
            `merge runner stopped: ${why}; run live:roundtrip on main by hand, then lane:merge --train-reset <sha>`
          );
          return { stop: why };
        }
        d.log(`train reset refused (${cut(r.stdout + r.stderr, 200)}); queueing again`);
        phase = 'queued';
        d.lock('queue');
        return {};
      }
      const env = ran.code === 2;
      const why = env
        ? 'the test environment could not be brought up (nothing was judged)'
        : 'live:roundtrip (or live:sweep) failed on main';
      d.log(`stopped: ${why}`);
      d.post(
        `merge runner stopped: ${why} at ${tip.slice(0, 7)}. ${env ? 'Fix server A, then start the runner again' : hint(st.since)}. Output: ${cut(ran.output, 500)}`
      );
      return { stop: env ? 'train roundtrip: environment' : 'train roundtrip red' };
    },
  };
}

/**
 * The real dependencies: lock.ps1 and the worker in the gate checkout, main's copy of the gate for
 * the reset. `prepare` puts the gate checkout on a head (prepareCheckout); `mainCopy` is the
 * runner's.
 * @param {{
 *   sh: (cmd: string, args: string[], o?: { cwd?: string, timeout?: number }) => Ran,
 *   stamp: (line: string) => void, repo: string, repoRoot: string, checkout: string, vault: string,
 *   prepare: (r: { pr: number, head: string }) => string | null,
 *   mainCopy: (checkout: string, rel: string, folder?: string) => { file: string, cleanup: () => void } | null,
 *   post: (text: string) => void, trainFile: string,
 * }} o
 * @returns {TrainDeps}
 */
export function makeTrainDeps(o) {
  const lockPs1 = path.join(o.repoRoot, 'scripts', 'test-env', 'lock.ps1');
  const SWEEP_ALL = ['packages/foundry-module/src/unknown'];
  return {
    state: () => {
      const t = readTrain(o.trainFile);
      return {
        size: t.since.length,
        limit: TRAIN_SIZE,
        since: t.since,
        lastSha: t.lastRoundtrip?.sha ?? null,
      };
    },
    lock: cmd => {
      const args = ['-NoProfile', '-File', lockPs1, cmd, '-Server', 'A', '-Session', LOCK_SESSION];
      if (cmd === 'queue' || cmd === 'take')
        args.push('-Holder', LOCK_HOLDER, '-Purpose', 'train roundtrip (live:roundtrip on main)');
      return o.sh('pwsh', args, { timeout: 120_000 });
    },
    tip: () => {
      const v = o.sh('gh', ['api', `repos/${o.repo}/git/ref/heads/main`, '--jq', '.object.sha']);
      return v.status === 0 ? v.stdout.trim() : '';
    },
    changedSince: (sha, tip) => {
      // No roundtrip on record, or the old sha is unknown to this clone: sweep (the safe side).
      if (!sha) return SWEEP_ALL;
      const v = o.sh('git', ['diff', '--name-only', `${sha}..${tip}`], { cwd: o.checkout });
      return v.status === 0 ? v.stdout.split(/\r?\n/).filter(Boolean) : SWEEP_ALL;
    },
    worker: (tip, sweep) => {
      const problem = o.prepare({ pr: 0, head: tip });
      if (problem) return { code: 2, output: `gate checkout: ${problem}` };
      const script = path.join(o.repoRoot, 'scripts', 'merge-runner', 'train-worker.mjs');
      const r = o.sh(process.execPath, [script, ...(sweep ? ['--sweep'] : [])], {
        cwd: o.checkout,
        timeout: 3 * 60 * 60 * 1000,
      });
      for (const line of r.stdout.split(/\r?\n/).filter(Boolean)) o.stamp(`  ${line}`);
      const lines = `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter(Boolean);
      const mine = lines.filter(l => l.startsWith('train-worker:')).slice(-3);
      return { code: r.status ?? 2, output: (mine.length ? mine : lines.slice(-3)).join(' | ') };
    },
    reset: tip => {
      const copy = o.mainCopy(o.checkout, 'scripts/lane-merge.mjs', 'scripts/lane-merge');
      if (!copy) return { status: 1, stdout: '', stderr: 'no scripts/lane-merge.mjs on main' };
      try {
        return o.sh(process.execPath, [copy.file, '--train-reset', tip, '--vault', o.vault], {
          cwd: o.checkout,
          timeout: 10 * 60 * 1000,
        });
      } finally {
        copy.cleanup();
      }
    },
    post: o.post,
    log: o.stamp,
  };
}
