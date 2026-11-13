/**
 * The merge runner's merge queue parts: reading the queue state from the backlog, the ghost check,
 * and the real dependencies that talk to GitHub and the merge train file (`queueOn`, `ghosts`,
 * `trainAdd`, `trainRemove`). Split from scripts/merge-runner.mjs to keep that file under the
 * line limit; the runner re-exports what its tests import.
 */
import os from 'node:os';
import path from 'node:path';
import { parseProgress } from '../backlog-items.mjs';
import { hasMergeQueue, requiredContexts } from '../lane-merge/ci.mjs';
import { AGGREGATE_CHECK } from '../lane-merge/constants.mjs';
import { isTrainRelevant } from '../lane-merge/risky.mjs';
import { acquireLock, readTrain, writeTrain } from '../lane-merge/train.mjs';

/** @typedef {{ status: number | null, stdout: string, stderr: string }} Ran */

/** The progress line the runner writes once the gate has put a PR into the merge queue. */
export const enqueuedLine = (/** @type {number} */ pr, /** @type {string} */ head) =>
  `PR #${pr} enqueued in the merge queue, head ${head}`;

/**
 * Items whose last progress line says the PR is in the merge queue.
 * @param {string} backlogText
 * @returns {{ id: string, pr: number, head: string }[]}
 */
export function enqueuedItems(backlogText) {
  const out = [];
  for (const [id, progress] of parseProgress(backlogText)) {
    const last = progress.split('\n').at(-1) ?? '';
    const m =
      /^(?:\d{4}-\d{2}-\d{2} )?PR #(\d+) enqueued in the merge queue, head ([0-9a-f]{40})\b/.exec(
        last.trim()
      );
    if (m) out.push({ id, pr: Number(m[1]), head: m[2] });
  }
  return out;
}

/** A check that sat in progress this long with its workflow run already completed is a ghost. */
export const GHOST_MINUTES = 20;

/**
 * The ghost checks (2026-11-13, PR 1002, run 43475526555: a check stayed "in progress" with no runner
 * while its run was completed, and held the queue for 30 minutes). Pure: `runs` is `gh run list` JSON
 * (databaseId, status, event), `checksByRun` maps a run id to its check runs (name, status,
 * startedAt). A run is a ghost when it is completed and still holds a check in progress or queued
 * that started more than GHOST_MINUTES ago.
 * @param {{ databaseId: number, status?: string, event?: string }[]} runs
 * @param {Record<number, { name: string, status: string, startedAt?: string }[]>} checksByRun
 * @param {number} nowMs
 * @returns {{ run: number, names: string[] }[]}
 */
export function findGhosts(runs, checksByRun, nowMs) {
  const out = [];
  for (const r of runs) {
    if (r.status !== 'completed') continue;
    const stuck = (checksByRun[r.databaseId] ?? []).filter(c => {
      if (c.status !== 'in_progress' && c.status !== 'queued') return false;
      const at = Date.parse(c.startedAt ?? '');
      return Number.isFinite(at) && nowMs - at > GHOST_MINUTES * 60_000;
    });
    if (stuck.length) out.push({ run: r.databaseId, names: stuck.map(c => c.name) });
  }
  return out;
}

/**
 * The real queue dependencies of the runner.
 * @param {{ sh: (cmd: string, args: string[]) => Ran, stamp: (line: string) => void, repo: string }} o
 */
export function makeQueueDeps({ sh, stamp, repo }) {
  const trainFile = () => path.join(os.homedir(), '.foundry-ai-tool', 'merge-train.json');
  return {
    queueOn: () => {
      const r = sh('gh', ['api', `repos/${repo}/rules/branches/main`]);
      // A queue merges on the required checks only: skipping the main-CI wait is safe only when the
      // aggregate check, which stands for every CI job, is one of them.
      return (
        r.status === 0 &&
        hasMergeQueue(r.stdout) &&
        !!requiredContexts(r.stdout)?.includes(AGGREGATE_CHECK)
      );
    },
    ghosts: () => {
      const list = sh('gh', [
        'run',
        'list',
        '-R',
        repo,
        '-w',
        'ci.yml',
        '-L',
        '15',
        '--json',
        'databaseId,status,event,headSha,createdAt,attempt',
      ]);
      if (list.status !== 0) return [];
      try {
        const nowMs = Date.now();
        const runs = JSON.parse(list.stdout).filter(
          (/** @type {any} */ r) =>
            r.status === 'completed' &&
            // a rerun (attempt 2 or later) is never reran again: its first attempt's stuck check stays
            Number(r.attempt ?? 1) === 1 &&
            ['pull_request', 'merge_group'].includes(r.event) &&
            nowMs - Date.parse(r.createdAt) < 6 * 3600_000
        );
        /** @type {Record<number, { name: string, status: string, startedAt?: string }[]>} */
        const checksByRun = {};
        for (const r of runs) {
          const c = sh('gh', ['api', `repos/${repo}/commits/${r.headSha}/check-runs?per_page=100`]);
          if (c.status !== 0) continue;
          checksByRun[r.databaseId] = (JSON.parse(c.stdout).check_runs ?? [])
            .filter((/** @type {any} */ x) =>
              String(x.details_url).includes(`/runs/${r.databaseId}/`)
            )
            .map((/** @type {any} */ x) => ({
              name: x.name,
              status: x.status,
              startedAt: x.started_at,
            }));
        }
        return findGhosts(runs, checksByRun, nowMs);
      } catch {
        return [];
      }
    },
    /** @param {number} pr @param {string} head */
    trainAdd: (pr, head) => {
      const file = trainFile();
      /** @type {(() => void) | undefined} */
      let release;
      try {
        // All pages (the PR view stops at 100 files). When the list cannot be read the PR counts.
        const v = sh('gh', [
          'api',
          `repos/${repo}/pulls/${pr}/files`,
          '--paginate',
          '--jq',
          '.[].filename',
        ]);
        const paths = v.stdout.split(/\r?\n/).filter(Boolean);
        if (v.status === 0 && paths.length > 0 && !isTrainRelevant(paths)) return;
        release = acquireLock(file, { timeoutMs: 20_000 });
        const t = readTrain(file);
        const since = t.since.filter(s => s.pr !== pr);
        since.push({ pr, sha: head, at: new Date().toISOString() });
        writeTrain(file, { ...t, since });
      } catch (e) {
        stamp(`WARNING: #${pr} not put on the merge train (${e instanceof Error ? e.message : e})`);
      } finally {
        release?.();
      }
    },
    /** @param {number} pr */
    trainRemove: pr => {
      const file = trainFile();
      /** @type {(() => void) | undefined} */
      let release;
      try {
        release = acquireLock(file, { timeoutMs: 20_000 });
        const t = readTrain(file);
        writeTrain(file, { ...t, since: t.since.filter(s => s.pr !== pr) });
      } catch (e) {
        stamp(
          `WARNING: #${pr} not taken off the merge train (${e instanceof Error ? e.message : e})`
        );
      } finally {
        release?.();
      }
    },
  };
}
