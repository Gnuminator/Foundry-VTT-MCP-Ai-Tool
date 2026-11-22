// @ts-check
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
 * @typedef {{ status: number | null, stdout: string, stderr: string, timedOut?: boolean }} Ran
 * @typedef {{
 *   state: () => { size: number, limit: number, since: { pr: number, sha: string }[], lastSha: string | null },
 *   lock: (cmd: 'queue' | 'take' | 'release' | 'leave') => Ran,
 *   tip: () => string,
 *   changedSince: (sha: string | null, tip: string) => string[],
 *   worker: (tip: string, sweep: boolean) => { code: number, output: string },
 *   stopServer: () => void,
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
  /** A green reset left the train full (PRs in the merge queue count): wait until it changes. */
  /** @type {{ sig: string, tip: string } | null} */
  let stuck = null;
  let postedWait = false;
  const sig = (/** @type {{ since: { pr: number, sha: string }[] }} */ st) =>
    st.since.map(s => `${s.pr}@${s.sha}`).join(',');

  /** The merges the train counts, as a bisect hint. @param {{ pr: number, sha: string }[]} since */
  const hint = since =>
    since.length
      ? `merged since the last roundtrip: ${since.map(s => `#${s.pr}@${s.sha.slice(0, 7)}`).join(', ')}; bisect by checking out main at the first of them and then each one after it`
      : 'no merge is recorded on the train; check main at its tip';

  let warnedFile = false;
  /** The train file, or null when it cannot be read (one line, then the round is skipped). */
  const state = () => {
    try {
      return d.state();
    } catch (e) {
      if (!warnedFile) {
        warnedFile = true;
        const why = cut(e instanceof Error ? e.message : String(e), 200);
        d.log(`WARNING: merge train file unreadable: ${why}`);
        d.post(
          `merge runner: the merge train file is unreadable (${why}); the train roundtrip waits`
        );
      }
      return null;
    }
  };

  return {
    /** For a test or a restart: where the machine stands. */
    phase: () => phase,
    /**
     * The runner starts: a previous runner that was killed may have left the lock, a queue place
     * and a running server A behind (M3). Only the runner's own session id is touched.
     */
    start() {
      d.lock('leave');
      // "The lock is already free." also exits 0: only a lock that was ours says "Released".
      const rel = d.lock('release');
      if (rel.status === 0 && /^Released from/m.test(rel.stdout)) d.stopServer();
    },
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
        const st = state();
        if (!st) return {};
        if (st.size < st.limit) {
          d.log('a PR waits for the train, but the train is not full any more; carrying on');
          return { cleared: true };
        }
        // A green reset left the train full (PRs in the merge queue count): no new roundtrip until
        // the train or main's tip changes (M4).
        if (stuck) {
          const now = d.tip();
          if (sig(st) === stuck.sig && (!now || now === stuck.tip)) return {};
          stuck = null;
          postedWait = false;
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
      // queued: the train may have been reset meanwhile, and main's tip must be readable, both
      // checked before the lock is taken (a take that is then given back loses the queue place).
      const st0 = state();
      if (!st0) return {};
      if (st0.size < st0.limit) {
        d.lock('leave');
        phase = 'idle';
        d.log('the train was reset by someone else while queued; nothing to run');
        return { cleared: true };
      }
      if (!/^[0-9a-f]{40}$/.test(d.tip())) {
        d.log('WARNING: main tip unreadable; trying again next round');
        return {};
      }
      const t = d.lock('take');
      if (t.status !== 0) {
        if (waited++ % 15 === 0) d.log('waiting for test server A (held by another session)');
        if (waited === 60)
          d.post(
            'merge runner: still waiting for test server A (held by another session) for the train roundtrip; the other PRs go on'
          );
        return {};
      }
      phase = 'idle';
      /** @type {{ code: number, output: string } | undefined} */
      let ran;
      /** @type {string} */
      let tip;
      /** @type {NonNullable<ReturnType<typeof state>>} */
      let st;
      let requeue = false;
      try {
        st = state() ?? st0;
        tip = d.tip();
        if (!/^[0-9a-f]{40}$/.test(tip)) {
          // Main's tip went unreadable between the check and the take: the lock goes back below,
          // so queue again (a lost place would let others take server A first).
          d.log('WARNING: main tip unreadable; trying again next round');
          phase = 'queued';
          requeue = true;
          return {};
        }
        const sweep = needsSweep(d.changedSince(st.lastSha, tip));
        d.log(
          `holding test server A: live:roundtrip${sweep ? ' and live:sweep' : ''} on ${tip.slice(0, 7)}`
        );
        ran = d.worker(tip, sweep);
      } finally {
        // A worker that failed or timed out may have left server A running: stop it before the lock
        // goes back, or the next holder meets a stale server (M3).
        if (!ran || ran.code !== 0) d.stopServer();
        const rel = d.lock('release');
        if (rel.status !== 0) {
          const why = cut(rel.stderr || rel.stdout);
          d.log(`WARNING: lock release failed (${why}); release it by hand`);
          d.post(
            `merge runner: could not release test server A's lock (${why}); release it by hand (lock.ps1 release -Session ${LOCK_SESSION} -Force)`
          );
        }
        if (requeue) d.lock('queue');
      }
      if (!ran) return {};
      if (ran.code === 0) {
        const r = d.reset(tip);
        if (r.status === 0) {
          resetRefusals = 0;
          const after = state();
          if (after && after.size >= after.limit) {
            // PRs still in the merge queue keep the train at its limit: do not run it again every
            // round (M4); wait until the train or main's tip changes.
            stuck = { sig: sig(after), tip };
            d.log(`live:roundtrip green on ${tip.slice(0, 7)}; train reset, but it is still full`);
            if (!postedWait) {
              postedWait = true;
              d.post(
                `merge runner: live:roundtrip green on main ${tip.slice(0, 7)}, but the train is still full (PRs in the merge queue count); waiting for them to merge before the next roundtrip`
              );
            }
            return {};
          }
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
 * One train step for the runner: from `main()` after each round, and (queued only) before each gate
 * in a round, so a queued runner at the head of the lock's queue does not hold up others' `take`
 * while gates run for hours (M5). A `cleared` answer drops the waiting PRs' attempt keys.
 * @param {{ step: (blocked: boolean) => StepResult, phase: () => string } | undefined} run
 * @param {Map<string, number>} attempts
 * @param {string} key attempts key prefix of a PR the gate turned away for the full train
 * @param {boolean} [onlyQueued] skip unless the machine is queued (the in-round call)
 * @returns {StepResult}
 */
export function trainTick(run, attempts, key, onlyQueued = false) {
  if (!run || (onlyQueued && run.phase() !== 'queued')) return {};
  const blocked = [...attempts.keys()].some(k => k.startsWith(key));
  const tr = run.step(blocked);
  if (tr.cleared) for (const k of [...attempts.keys()]) if (k.startsWith(key)) attempts.delete(k);
  return tr;
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
      // Killed at the time limit: nothing was judged (sh turns a missing status into 1).
      return {
        code: r.timedOut ? 2 : (r.status ?? 2),
        output: (mine.length ? mine : lines.slice(-3)).join(' | '),
      };
    },
    stopServer: () => {
      const stop = path.join(o.repoRoot, 'scripts', 'test-env', 'stop.ps1');
      o.sh('pwsh', ['-NoProfile', '-File', stop, '-Server', 'A'], { timeout: 180_000 });
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
