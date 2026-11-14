#!/usr/bin/env node
/**
 * Merge runner (D-140, D-141): merges ready PRs without a model, so no planner has to stand by.
 *
 *   node scripts/merge-runner.mjs [--once] [--interval <s>] [--vault <dir>] [--checkout <dir>]
 *
 * A Windows scheduled task starts it at logon (scripts/register-merge-runner.ps1) from the main
 * checkout. Each round it reads vault Backlog.md from the upstream branch (fetch, `git show @{u}:`,
 * never the shared working tree) and takes every item whose progress line is a ready line
 * (`PR #<n> ready, head <40-hex sha>`, written by `backlog.mjs progress <id> --ready`; parseReady),
 * one PR at a time, in Backlog order. Before each PR the line is read again (an earlier gate run
 * can take half an hour); a line that changed meanwhile waits for the next round.
 *
 * Merge queue (main's ruleset has `merge_queue` and requires ci-all-green): the gate ends with
 * `lane:merge: enqueued #<PR>`; the runner replaces the ready line with "PR #<n> enqueued in the
 * merge queue, head <sha>" and each round follows those PRs: merged -> `backlog.mjs done` and one
 * #pr-log line; out of the queue unmerged in two rounds -> off the merge train, a progress line,
 * one #pr-log line. A main CI run still going then does not hold the next PR (the queue merges on
 * ci-all-green, which stands for every job); a completed red one still stops the runner. Each round
 * also reruns once a CI run that is completed but holds a check in progress for over 20 minutes
 * (the ghost check, findGhosts). The gate's merged line below is the no-queue behaviour.
 *
 *   - main's newest CI run (push, ci.yml) is red: post one line, exit 3. Nothing is merged and the
 *     ready lines stay. A run still going, or CI that cannot be read, waits for the next round, and
 *     so does a main tip with no usable CI run (none yet, or only a cancelled one: a push run on
 *     main is never cancelled by a newer push); after 16 minutes of that one Discord line says to
 *     start its CI (`gh workflow run ci.yml --ref main`, or `gh run rerun`).
 *     A gate end that is not the PR's fault (gh/git blip, a GitHub 5xx, UNKNOWN mergeability) is tried again, up
 *     to 3 times per head. A gate killed at its time limit stops the runner (leftover processes).
 *   - the PR is already merged: `backlog.mjs done`. Closed: a refusal (below). Open, but the ready
 *     head is already on main (GitHub lost the merge event): `done --sha <main's tip>`, one line.
 *   - the PR head is not the sha of the ready line: a refusal. The gate never judges a head the
 *     ready line did not name.
 *   - else the gate checkout (default: the sibling folder `<main checkout>-gate`, a built worktree
 *     outside .claude/worktrees) is checked to be its own top level and clean, the head is checked
 *     out detached, `npm ci` runs when package-lock.json changed since the last install, and main's
 *     copy of scripts/lane-merge.mjs runs there as `<PR> --wait-ci --vault <vault>`, nothing else
 *     (GATE_FLAGS: never a dry run, a force, a skip or a train reset). The gate posts its own
 *     #pr-log line on a merge.
 *       merged (a `lane:merge: merged #<PR>` line, exit 0): `backlog.mjs done <id> <PR> --by
 *         merge-runner` (no --sha: done reads the merge commit from GitHub).
 *       merge train full: post "merge train full: ask a session to run live:roundtrip", exit 3; the
 *         ready line stays, so the next logon or a manual start after `--train-reset` merges it.
 *       CI still running after the gate's wait (exit 5): left for the next round.
 *       any other refusal: `backlog.mjs progress <id> "PR #<n> refused by the merge gate: <why>"
 *         --if-ready <PR>@<sha>` (that replaces the ready line, so it is not tried again until a
 *         lane writes a new one; a newer ready line is never overwritten) and one #pr-log line.
 *       Any end other than merged or train full is checked against GitHub: a PR merged after all
 *       (the gate killed after `gh pr merge`) is marked done, not refused.
 *     A checkout problem (not the PR's fault) posts one line and exits 3.
 *
 * It never runs `live:roundtrip` or `--train-reset`; a session does that on demand (D-141). A lock
 * file (~/.foundry-ai-tool/merge-runner.lock, the holder's pid) lets one runner run; a second one
 * posts one line and exits 1. A holder pid that is gone or is no longer a merge runner (Windows
 * reuses pids after a logoff) is taken over. A vault write that fails is logged; the PR is not tried
 * again in this run.
 * Discord lines go through main's copy of the bot's announce sender (`pr-note`, #pr-log, silent).
 *
 * Its own code: at the start of each round (not with --once) it compares its files (this one,
 * backlog.mjs and what they import) with aitool/main (merge-runner/self-check.mjs). When they
 * differ it fast-forwards the main checkout and runs the runner again as a child, same arguments
 * and output (the scheduled task has no restart count): the first process stays as the parent and
 * starts each new child. A failed update is tried again next round; the third in a row posts one
 * line and exits 3, as do five restarts in a row that each lived under a minute.
 *
 * Exit codes: 0 --once finished, 1 another runner holds the lock, 2 usage, 3 stopped (main red,
 * merge train full, checkout problem, code changed but not updatable, restart loop), 75 a child that
 * wants new code (to its parent only). Every log line starts with
 * `merge-runner:` and a time.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBacklog, parseProgress, parseReady } from './backlog-items.mjs';
import { pidAlive } from './heavy-lock.mjs';
import { readUpstreamBacklog } from './planner-wake.mjs';
import { queueQuery } from './lane-merge/constants.mjs';
import {
  GHOST_MINUTES,
  enqueuedItems,
  enqueuedLine,
  findGhosts,
  makeQueueDeps,
} from './merge-runner/queue.mjs';
import { EXIT_RESTART, makeSelfCheck, reexec } from './merge-runner/self-check.mjs';

export const REPO = 'Gnuminator/Foundry-VTT-MCP-Ai-Tool';
const MAIN = 'aitool/main';
export const DEFAULT_INTERVAL = 120;
/**
 * The gate waits up to 30 minutes for CI, then drift-check may queue on the heavy lock behind
 * another lane's green. A kill here never decides the outcome: the PR state is read afterwards.
 */
const GATE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const NPM_CI_TIMEOUT_MS = 20 * 60 * 1000;
const SHORT_TIMEOUT_MS = 120_000;
/** The only flags the runner ever passes to the gate, after the PR number. */
export const GATE_FLAGS = ['--wait-ci'];
export const EXIT_STOPPED = 3;
/** The gate's exit code for "CI did not finish in time" (lane-merge.mjs EXIT_WAIT_TIMEOUT). */
const GATE_WAIT_TIMEOUT = 5;
/** What the gate dependency appends when it had to kill the gate at the time limit. */
export const KILLED_LINE = 'merge-runner: gate killed at the time limit';
export const TRAIN_FULL_LINE = 'merge train full: ask a session to run live:roundtrip';
/** Written into the gate checkout's node_modules after an `npm ci`: the package-lock.json hash. */
const LOCK_STAMP = path.join('node_modules', '.merge-runner-lock-hash');
const here = path.dirname(fileURLToPath(import.meta.url));

/** One line: newlines folded, at most `max` characters. @param {string} s @param {number} [max] */
export const oneLine = (s, max = 400) => {
  const t = String(s)
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
};

/**
 * Ready items in Backlog order.
 * @param {string} backlogText
 * @returns {{ id: string, pr: number, head: string }[]}
 */
export function readyItems(backlogText) {
  const out = [];
  for (const [id, progress] of parseProgress(backlogText)) {
    const r = parseReady(progress);
    if (r) out.push({ id, ...r });
  }
  return out;
}

export { GHOST_MINUTES, enqueuedItems, enqueuedLine, findGhosts };

/** Rounds (2 minutes each) a tip without a usable CI run is waited for before one Discord line. */
export const TIP_WAIT_ROUNDS = 8;
const TIP_WAIT_KEY = 'main-tip-wait';

/**
 * Main's state from `gh run list --json conclusion,headSha,status,event` (newest first, push runs
 * and hand-dispatched runs of ci.yml, finished or not). Cancelled and skipped runs are passed over
 * (an older run of main is still judged by its own result). The newest run is the one for main's
 * latest push, so a run still going means "not yet known": the round waits (an earlier merge in it
 * may not have finished its CI). Only a finished red run is red. With `tip` (main's head sha) a
 * list with no run for the tip, or only cancelled or skipped ones, waits too (`tipWait`): a merge
 * GitHub has not started CI for yet (or never will) is not judged by the run before it. A push run
 * on main is never cancelled by a newer push, so a cancelled tip run means the tip was not tested.
 * @param {string} json
 * @param {string} [tip]
 * @returns {{ red: boolean, wait: boolean, sha: string, why: string, tipWait?: boolean }}
 */
export function mainState(json, tip = '') {
  /** @type {{ conclusion?: string | null, status?: string, headSha?: string, event?: string }[]} */
  let runs;
  try {
    runs = JSON.parse(json);
  } catch {
    return { red: false, wait: true, sha: '', why: 'main CI unreadable (gh answered no JSON)' };
  }
  if (Array.isArray(runs)) {
    runs = runs.filter(r => ['push', 'workflow_dispatch'].includes(String(r.event ?? 'push')));
  }
  if (tip && Array.isArray(runs)) {
    const tipRuns = runs.filter(r => String(r.headSha ?? '') === tip);
    const short = tip.slice(0, 7);
    const none = tipRuns.length === 0;
    if (
      none ||
      tipRuns.every(r => ['cancelled', 'skipped', 'neutral'].includes(String(r.conclusion)))
    ) {
      return {
        red: false,
        wait: true,
        sha: '',
        tipWait: true,
        why: none
          ? `no CI run for main's tip ${short} yet`
          : `main's tip ${short} has only a cancelled or skipped CI run`,
      };
    }
  }
  const run = Array.isArray(runs)
    ? runs.find(r => !['cancelled', 'skipped', 'neutral'].includes(String(r.conclusion)))
    : undefined;
  if (!run) return { red: false, wait: true, sha: '', why: 'no CI run on main to judge' };
  const sha = String(run.headSha ?? '').slice(0, 7);
  if (!run.conclusion || (run.status && run.status !== 'completed')) {
    return { red: false, wait: true, sha, why: `main's CI is still running at ${sha}` };
  }
  if (run.conclusion === 'success') return { red: false, wait: false, sha, why: '' };
  return { red: true, wait: false, sha, why: `main is red at ${sha} (CI ${run.conclusion})` };
}

/**
 * Gate ends that are not the PR's fault (GitHub or git blipped, GitHub answered a 5xx such as a 502
 * on `gh pr merge`, main moved, mergeability not yet computed, the gate was killed with no reason):
 * tried again, up to MAX_TRANSIENT times per head. A merge that landed despite the 5xx is caught after
 * the gate (any end but merged, enqueued, train full or main red): the PR reads MERGED, or its head is
 * already on main while the PR still reads OPEN (GitHub lost the merge event).
 */
const TRANSIENT =
  /gh pr view \d+ failed|git fetch .* failed|the gate on .* changed during the wait|mergeable is UNKNOWN|unexpected error|train lock|no reason line/;
/** GitHub answered `gh pr merge` with a 5xx (GraphQL `non-200 OK status code: 502 ...` or REST `HTTP 502: ...`). */
export const GH_MERGE_5XX =
  /merge: gh pr merge exited \d+: .*?(?:non-200 OK status code: |\bHTTP )5\d\d\b/;
const MAX_TRANSIENT = 3;

/**
 * What a gate run ended with.
 * @param {number} code @param {string} output @param {number} pr
 * @returns {{ kind: 'merged' | 'enqueued' | 'train-full' | 'main-red' | 'wait' | 'transient' | 'killed' | 'refused', reason: string }}
 */
export function gateOutcome(code, output, pr) {
  const lines = output.split(/\r?\n/);
  if (code === 0 && lines.some(l => l.startsWith(`lane:merge: merged #${pr} `))) {
    return { kind: 'merged', reason: '' };
  }
  if (code === 0 && lines.some(l => l.startsWith(`lane:merge: enqueued #${pr} `))) {
    return { kind: 'enqueued', reason: '' };
  }
  if (lines.includes(KILLED_LINE)) return { kind: 'killed', reason: KILLED_LINE };
  const because = lines.filter(l => l.startsWith('lane:merge: refused because ')).at(-1);
  const verdict = lines.filter(l => l.startsWith('lane:merge: wait-ci ended: ')).at(-1);
  const reason = because
    ? because.slice('lane:merge: refused because '.length)
    : verdict
      ? verdict.slice('lane:merge: wait-ci ended: '.length)
      : `the gate ended with exit ${code} and no reason line`;
  if (/merge train full/.test(because ?? '')) return { kind: 'train-full', reason };
  // Main went red while the gate ran: not this PR's fault, its ready line stays.
  if (/main red: main's last completed/.test(because ?? '')) return { kind: 'main-red', reason };
  // Main's CI could not be judged yet (unreadable, no run to judge, no run for the tip): try again.
  if (
    /main red: (cannot read|no completed push run|gh run list answered something that is not a list|no push run of ci\.yml for main's tip)/.test(
      because ?? ''
    )
  )
    return { kind: 'transient', reason };
  if (code === GATE_WAIT_TIMEOUT) return { kind: 'wait', reason };
  if (TRANSIENT.test(reason) || GH_MERGE_5XX.test(reason)) return { kind: 'transient', reason };
  return { kind: 'refused', reason };
}

/** @param {string} p */
const norm = p => {
  const r = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

/**
 * @typedef {{ status: number, stdout: string, stderr: string }} Ran
 * @typedef {{
 *   readBacklog: () => string | null,
 *   gh: (args: string[]) => Ran,
 *   prepare: (o: { pr: number, head: string }) => string | null,
 *   gate: (pr: number) => Ran,
 *   backlog: (args: string[]) => Ran,
 *   post: (text: string) => void,
 *   log: (line: string) => void,
 *   queueOn?: () => boolean,
 *   ghosts?: () => { run: number, names: string[] }[],
 *   trainRemove?: (pr: number) => void,
 *   trainAdd?: (pr: number, head: string) => void,
 *   selfCheck?: () => import('./merge-runner/self-check.mjs').SelfCheckResult | null,
 * }} Deps
 * `queueOn`: main's ruleset holds a merge queue (then a running main CI does not hold the next
 * PR back: the queue tests every PR on top of the ones ahead). `ghosts`: stuck checks, see
 * findGhosts. `trainRemove`: take a PR that left the queue unmerged off the merge train.
 */

/**
 * One round over the ready lines. `tried` holds `<PR>@<sha>` already handled in this run, so a
 * failed vault write cannot make the gate run twice on one head.
 * @param {Deps} d @param {Set<string>} tried @param {Map<string, number>} [attempts]
 * @returns {{ stop: string | null, merged: number[] }}
 */
export function round(d, tried, attempts) {
  /** @type {number[]} */
  const merged = [];
  const text = d.readBacklog();
  if (text === null) return { stop: null, merged };
  const ready = readyItems(text).filter(r => !tried.has(`${r.pr}@${r.head}`));
  attempts ??= new Map();

  /** @param {string} id @param {string[]} args @param {string} what */
  const write = (id, args, what) => {
    const r = d.backlog(args);
    if (r.status !== 0) {
      d.log(`WARNING: ${what} for ${id} not written (${oneLine(r.stderr || r.stdout, 200)})`);
    }
  };
  /**
   * The refusal replaces the ready line only while it is still that same line (`--if-ready`,
   * checked under backlog.mjs's lock): a lane that wrote a newer one keeps it.
   * @param {{ id: string, pr: number, head: string }} r @param {string} why
   */
  const refuse = (r, why) => {
    const reason = oneLine(why, 300);
    d.log(`#${r.pr} (${r.id}) not merged: ${reason}`);
    write(
      r.id,
      [
        'progress',
        r.id,
        `PR #${r.pr} refused by the merge gate: ${reason}`,
        '--if-ready',
        `${r.pr}@${r.head}`,
      ],
      'progress'
    );
    d.post(`merge runner: #${r.pr} not merged: ${reason}`);
  };
  /**
   * @param {{ id: string, pr: number, head: string }} r @param {boolean} [fromReady] the line is still a ready line
   * @param {string} [sha] main's commit that holds the head, when GitHub has no merge commit for the PR
   */
  const markDone = (r, fromReady = true, sha = '') => {
    // An item with a Pi run or a Waiting blocker left is not closed here: `done --pi-run` is the
    // planner's call. It gets a "merged" progress line, which the status Pi list flag picks up.
    const item = parseBacklog(d.readBacklog() ?? '').items.find(i => i.id === r.id);
    const piLeft = item && /^yes\b/i.test(item.fields.get('pi')?.at(-1) ?? '');
    const waiting = item && (item.fields.get('blocked by') ?? []).some(b => /\bW\d+\b/.test(b));
    if (piLeft || waiting) {
      d.log(`#${r.pr} (${r.id}) merged, but a Pi run or Waiting item is left; not closing it`);
      write(
        r.id,
        [
          'progress',
          r.id,
          `PR #${r.pr} merged; the item stays open for its Pi run or Waiting step: close it with done --pi-run (merge runner)`,
          ...(fromReady ? ['--if-ready', `${r.pr}@${r.head}`] : []),
        ],
        'progress'
      );
      return;
    }
    // No --sha: `backlog.mjs done` reads the merge commit from GitHub (the head is not on main).
    // With a sha: GitHub lost the merge event and the PR still reads OPEN, so there is none to read.
    write(
      r.id,
      ['done', r.id, String(r.pr), ...(sha ? ['--sha', sha] : []), '--by', 'merge-runner'],
      'done'
    );
  };
  /**
   * Is this head already on main? GitHub can land a merge and lose its event (a 502 on `gh pr
   * merge`, 2026-11-14): the PR still reads OPEN and main's tip gets no CI run.
   * @param {string} head
   */
  const headOnMain = head => {
    const v = d.gh(['api', `repos/${REPO}/compare/${head}...main`, '--jq', '.status']);
    return v.status === 0 && ['ahead', 'identical'].includes(v.stdout.trim());
  };
  /** main's tip sha, or '' when unreadable. */
  const mainTip = () => {
    const v = d.gh(['api', `repos/${REPO}/git/ref/heads/main`, '--jq', '.object.sha']);
    const s = v.stdout.trim();
    return v.status === 0 && /^[0-9a-f]{40}$/.test(s) ? s : '';
  };
  /** Is the PR merged after all (a gate run killed after `gh pr merge`)? @param {number} n */
  const mergedOnGitHub = n => {
    const v = d.gh(['pr', 'view', String(n), '-R', REPO, '--json', 'state']);
    try {
      return v.status === 0 && JSON.parse(v.stdout).state === 'MERGED';
    } catch {
      return false;
    }
  };

  /** Is the PR waiting in the merge queue right now? @param {number} n */
  const queuedOnGitHub = n => {
    const v = d.gh(['api', 'graphql', '-f', `query=${queueQuery(n)}`]);
    try {
      const st = JSON.parse(v.stdout)?.data?.repository?.pullRequest;
      return v.status === 0 && st?.state === 'OPEN' && st?.isInMergeQueue === true;
    } catch {
      return false;
    }
  };

  // PRs the gate put into the merge queue: merged -> done; gone from the queue unmerged (a failed
  // queue run, removed by hand) -> off the train, a progress line, one Discord line. Seen missing
  // in two rounds in a row first, so the moment between `gh pr merge` and the queue entry is safe.
  for (const q of enqueuedItems(text)) {
    const key = `q${q.pr}@${q.head}`;
    if (tried.has(key)) continue;
    const v = d.gh(['api', 'graphql', '-f', `query=${queueQuery(q.pr)}`]);
    /** @type {{ state?: string, isInMergeQueue?: boolean } | undefined} */
    let st;
    try {
      st = JSON.parse(v.stdout)?.data?.repository?.pullRequest;
    } catch {
      /* unreadable: next round */
    }
    if (v.status !== 0 || !st) {
      d.log(`#${q.pr} (${q.id}): merge queue state unreadable; next round`);
      continue;
    }
    if (st.state === 'MERGED') {
      tried.add(key);
      merged.push(q.pr);
      d.log(`#${q.pr} (${q.id}) merged by the queue`);
      d.post(`merge runner: #${q.pr} merged by the merge queue`);
      markDone(q, false);
    } else if (st.state === 'OPEN' && st.isInMergeQueue) {
      attempts.delete(key);
    } else if ((attempts.get(key) ?? 0) + 1 < 2) {
      attempts.set(key, (attempts.get(key) ?? 0) + 1);
      d.log(`#${q.pr} (${q.id}) is not in the merge queue (${st.state}); looking again next round`);
    } else {
      tried.add(key);
      // The line may have been replaced meanwhile (a lane's new ready line): then nothing is written.
      const nowLine = enqueuedItems(d.readBacklog() ?? '').some(
        x => x.id === q.id && x.pr === q.pr && x.head === q.head
      );
      if (!nowLine) continue;
      const why = `PR #${q.pr} left the merge queue without merging (a failed queue run, or taken out by hand); fix it, then write a new ready line`;
      d.log(`#${q.pr} (${q.id}): ${why}`);
      d.trainRemove?.(q.pr);
      write(q.id, ['progress', q.id, why], 'progress');
      d.post(`merge runner: #${q.pr} left the merge queue without merging`);
    }
  }
  // Ghost checks: a check in progress for over GHOST_MINUTES with its run completed gets one rerun.
  for (const g of d.ghosts?.() ?? []) {
    const key = `ghost${g.run}`;
    if (tried.has(key)) continue;
    tried.add(key);
    const r = d.gh(['run', 'rerun', String(g.run), '-R', REPO]);
    d.log(
      `ghost check in run ${g.run} (${g.names.join(', ')}): rerun ${r.status === 0 ? 'started' : `failed (${oneLine(r.stderr, 200)})`}`
    );
    d.post(
      `merge runner: CI run ${g.run} had a check stuck in progress (${g.names.join(', ')}); ${r.status === 0 ? 'rerun started' : 'rerun failed, rerun it by hand'}`
    );
  }
  if (!ready.length) return { stop: null, merged };

  /** @type {boolean | undefined} */
  let queueOn;

  for (const first of ready) {
    // Read the line again: an earlier gate run in this round can take half an hour, and the lane
    // may have written a newer ready line meanwhile. A changed line waits for the next round.
    const fresh = d.readBacklog();
    const r = fresh === null ? undefined : readyItems(fresh).find(x => x.id === first.id);
    if (!r || r.pr !== first.pr || r.head !== first.head) continue;

    // Main is read before each PR: an earlier merge in this round may have turned it red.
    const runs = d.gh([
      'run',
      'list',
      '-R',
      REPO,
      '--branch',
      'main',
      '-w',
      'ci.yml',
      '-L',
      '10',
      '--json',
      'conclusion,headSha,status,event',
    ]);
    const tipRead = d.gh(['api', `repos/${REPO}/git/ref/heads/main`, '--jq', '.object.sha']);
    const tip = tipRead.stdout.trim();
    const main =
      runs.status === 0 && tipRead.status === 0 && /^[0-9a-f]{40}$/.test(tip)
        ? mainState(runs.stdout, tip)
        : runs.status === 0
          ? {
              red: false,
              wait: true,
              sha: '',
              why: `main's tip unreadable (${oneLine(tipRead.stderr || tipRead.stdout, 200)})`,
            }
          : {
              red: false,
              wait: true,
              sha: '',
              why: `main CI unreadable (${oneLine(runs.stderr, 200)})`,
            };
    // With a merge queue a main CI run still going holds nothing back: the queue tested this PR on
    // top of everything ahead of it. Unreadable CI still waits (the gate reads main again itself).
    queueOn ??= d.queueOn?.() ?? false;
    if (main.wait && !(queueOn && main.sha !== '')) {
      d.log(`${main.why}; next round`);
      // A tip with no usable run does not clear itself when GitHub never started its CI: say so once.
      if ('tipWait' in main && main.tipWait) {
        const n = (attempts.get(TIP_WAIT_KEY) ?? 0) + 1;
        attempts.set(TIP_WAIT_KEY, n);
        if (n === TIP_WAIT_ROUNDS) {
          d.post(
            `merge runner waiting: ${main.why} for ${TIP_WAIT_ROUNDS * 2} minutes; start its CI (gh workflow run ci.yml --ref main, or gh run rerun for a cancelled one), the runner goes on by itself`
          );
        }
      } else attempts.delete(TIP_WAIT_KEY);
      return { stop: null, merged };
    }
    attempts.delete(TIP_WAIT_KEY);
    if (main.red) {
      d.log(`stopped: ${main.why}; nothing merged`);
      d.post(
        `merge runner stopped: ${main.why}; ask a session to fix main, then start the runner again`
      );
      return { stop: main.why, merged };
    }

    const view = d.gh(['pr', 'view', String(r.pr), '-R', REPO, '--json', 'state,headRefOid']);
    if (view.status !== 0) {
      d.log(`#${r.pr}: gh pr view failed (${oneLine(view.stderr, 200)}); next round`);
      continue;
    }
    /** @type {{ state?: string, headRefOid?: string }} */
    let pr;
    try {
      pr = JSON.parse(view.stdout);
    } catch {
      d.log(`#${r.pr}: gh pr view answered no JSON; next round`);
      continue;
    }
    const key = `${r.pr}@${r.head}`;
    if (pr.state === 'MERGED') {
      tried.add(key);
      d.log(`#${r.pr} (${r.id}) is already merged; marking it done`);
      markDone(r);
      continue;
    }
    if (pr.state !== 'OPEN') {
      tried.add(key);
      refuse(r, `PR #${r.pr} is ${String(pr.state ?? 'unknown').toLowerCase()}`);
      continue;
    }
    if (pr.headRefOid !== r.head) {
      tried.add(key);
      refuse(
        r,
        `the head moved from ${r.head.slice(0, 7)} to ${String(pr.headRefOid ?? '?').slice(0, 7)} since the ready line; write a new ready line for the new head (a clean merge of main keeps its review)`
      );
      continue;
    }
    if (headOnMain(r.head)) {
      tried.add(key);
      d.log(
        `#${r.pr} (${r.id}) reads OPEN, but its head ${r.head.slice(0, 7)} is already on main; marking it done`
      );
      d.post(
        `merge runner: #${r.pr} reads open on GitHub, but its head is already on main (GitHub lost the merge event); marked done, not gated again`
      );
      markDone(r, true, tip);
      continue;
    }

    const problem = d.prepare(r);
    if (problem) {
      d.log(`stopped: gate checkout: ${problem}`);
      d.post(
        `merge runner stopped: gate checkout problem (${oneLine(problem, 200)}); #${r.pr} waits`
      );
      return { stop: `gate checkout: ${problem}`, merged };
    }
    d.log(`#${r.pr} (${r.id}): running main's gate on ${r.head.slice(0, 7)}`);
    const g = d.gate(r.pr);
    let out = gateOutcome(g.status, `${g.stdout}\n${g.stderr}`, r.pr);
    // A PR that is in the queue although the gate ended without saying so. Only a gate end with no
    // verdict (killed, or "no reason line") is adopted: the PR is followed and counted on the train
    // (the gate died before its train write). A real refusal stays a refusal, with a hint that the
    // PR is queued and has to be taken out by hand (the queue would merge it).
    if (
      !['merged', 'enqueued', 'train-full', 'main-red'].includes(out.kind) &&
      queuedOnGitHub(r.pr)
    ) {
      // A 5xx on `gh pr merge` may come after GitHub queued the PR: adopt it too.
      if (
        out.kind === 'killed' ||
        /no reason line/.test(out.reason) ||
        GH_MERGE_5XX.test(out.reason)
      ) {
        d.log(
          `#${r.pr} (${r.id}) is in the merge queue although the gate said: ${oneLine(out.reason, 200)}`
        );
        d.trainAdd?.(r.pr, r.head);
        out = { kind: 'enqueued', reason: '' };
      } else {
        out = {
          kind: 'refused',
          reason: `${out.reason} (the PR is already in the merge queue, put there by hand: take it out of the queue or it will merge)`,
        };
      }
    }
    const notMergedEnd = !['merged', 'enqueued', 'train-full', 'main-red'].includes(out.kind);
    if (notMergedEnd && mergedOnGitHub(r.pr)) {
      // The gate ended without its merged line (killed, timed out) after the merge went through.
      tried.add(key);
      merged.push(r.pr);
      d.log(`#${r.pr} (${r.id}) is merged although the gate said: ${oneLine(out.reason, 200)}`);
      markDone(r);
    } else if (notMergedEnd && headOnMain(r.head)) {
      // The merge landed but GitHub lost its event (the PR still reads OPEN).
      tried.add(key);
      merged.push(r.pr);
      d.log(
        `#${r.pr} (${r.id}) reads OPEN, but its head is on main although the gate said: ${oneLine(out.reason, 200)}`
      );
      d.post(
        `merge runner: #${r.pr} landed on main although GitHub answered: ${oneLine(out.reason, 200)}; the PR may still read open and main's tip may get no CI run`
      );
      markDone(r, true, mainTip());
    } else if (out.kind === 'merged') {
      tried.add(key);
      merged.push(r.pr);
      d.log(`#${r.pr} (${r.id}) merged`);
      markDone(r);
    } else if (out.kind === 'enqueued') {
      // The queue merges it later; the line below replaces the ready line, so it is not gated again.
      tried.add(key);
      d.log(`#${r.pr} (${r.id}) is in the merge queue`);
      write(
        r.id,
        ['progress', r.id, enqueuedLine(r.pr, r.head), '--if-ready', `${r.pr}@${r.head}`],
        'progress'
      );
    } else if (out.kind === 'train-full') {
      d.log(`stopped: ${TRAIN_FULL_LINE} (#${r.pr} waits)`);
      d.post(`${TRAIN_FULL_LINE} (#${r.pr} waits; start the runner again after the train reset)`);
      return { stop: 'merge train full', merged };
    } else if (out.kind === 'main-red') {
      d.log(`stopped: ${oneLine(out.reason, 200)} (#${r.pr} waits)`);
      d.post(
        `merge runner stopped: main went red while the gate ran (#${r.pr} waits); ask a session to fix main, then start the runner again`
      );
      return { stop: 'main went red during the gate', merged };
    } else if (out.kind === 'killed') {
      // The gate's own children (drift-check, heavy lock) may still run in the gate checkout.
      d.log(`stopped: the gate on #${r.pr} was killed at the time limit`);
      d.post(
        `merge runner stopped: the gate on #${r.pr} ran into its time limit and was killed; check for leftover processes in the gate checkout, then start the runner again`
      );
      return { stop: 'gate killed at the time limit', merged };
    } else if (out.kind === 'wait') {
      d.log(`#${r.pr}: CI still running (${oneLine(out.reason, 200)}); next round`);
    } else if (out.kind === 'transient' && (attempts.get(key) ?? 0) + 1 < MAX_TRANSIENT) {
      attempts.set(key, (attempts.get(key) ?? 0) + 1);
      d.log(
        `#${r.pr}: gate ended for a reason that is not the PR's (${oneLine(out.reason, 200)}); next round`
      );
    } else {
      tried.add(key);
      refuse(r, out.reason);
    }
  }
  return { stop: null, merged };
}

// ---- the real dependencies ---------------------------------------------------------------------

/** @param {string} cmd @param {string[]} args @param {{ cwd?: string, timeout?: number }} [o] @returns {Ran} */
function sh(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: o.timeout ?? SHORT_TIMEOUT_MS,
    cwd: o.cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? r.error?.message ?? '',
    timedOut: /** @type {NodeJS.ErrnoException | undefined} */ (r.error)?.code === 'ETIMEDOUT',
  };
}

/**
 * Get the gate checkout to the PR head: its own top level (an emptied worktree folder falls
 * through to the main checkout), clean, the head fetched and checked out detached, and `npm ci`
 * when package-lock.json changed since the last install. Returns a problem, or null.
 * @param {string} checkout @param {{ pr: number, head: string }} r
 * @param {(cmd: string, args: string[], o?: { cwd?: string, timeout?: number }) => Ran} [run]
 */
export function prepareCheckout(checkout, r, run = sh) {
  const git = (/** @type {string[]} */ args, timeout = SHORT_TIMEOUT_MS) =>
    run('git', args, { cwd: checkout, timeout });
  if (!fs.existsSync(checkout)) return `${checkout} does not exist`;
  const top = git(['rev-parse', '--show-toplevel']);
  if (top.status !== 0 || norm(top.stdout.trim()) !== norm(checkout)) {
    return `${checkout} is not its own git checkout (top level ${top.stdout.trim() || 'unknown'})`;
  }
  const dirty = git(['status', '--porcelain']);
  if (dirty.status !== 0 || dirty.stdout.trim()) return `${checkout} is not clean`;
  const fetched = git(['fetch', '-q', 'aitool', 'main', `refs/pull/${r.pr}/head`], 300_000);
  if (fetched.status !== 0) return `git fetch failed (${oneLine(fetched.stderr, 200)})`;
  const co = git(['checkout', '-q', '--detach', r.head]);
  if (co.status !== 0)
    return `git checkout ${r.head.slice(0, 7)} failed (${oneLine(co.stderr, 200)})`;
  const at = git(['rev-parse', 'HEAD']);
  if (at.stdout.trim() !== r.head) return `HEAD is ${at.stdout.trim()}, not ${r.head}`;
  const lock = path.join(checkout, 'package-lock.json');
  const hash = createHash('sha256').update(fs.readFileSync(lock)).digest('hex');
  const stamp = path.join(checkout, LOCK_STAMP);
  const had = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : '';
  if (had !== hash) {
    const npm =
      process.platform === 'win32'
        ? run('cmd.exe', ['/d', '/s', '/c', 'npm ci'], {
            cwd: checkout,
            timeout: NPM_CI_TIMEOUT_MS,
          })
        : run('npm', ['ci'], { cwd: checkout, timeout: NPM_CI_TIMEOUT_MS });
    if (npm.status !== 0) return `npm ci failed (${oneLine(npm.stderr || npm.stdout, 200)})`;
    fs.writeFileSync(stamp, `${hash}\n`);
  }
  return null;
}

/**
 * Write main's copy of a repo file to a temp folder (the PR's own copy never runs). Null when main
 * has none.
 * `folder` (optional, `/` separated, e.g. `scripts/lane-merge`) also writes that folder of main
 * beside the file, under its own name: the merge gate is an entry file plus modules. Null when main
 * has none of it.
 * @param {string} checkout @param {string} rel `/` separated @param {string} [folder]
 * @returns {{ file: string, cleanup: () => void } | null}
 */
export function mainCopy(checkout, rel, folder) {
  const r = sh('git', ['show', `${MAIN}:${rel}`], { cwd: checkout });
  if (r.status !== 0 || !r.stdout) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-runner-'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  if (folder) {
    const list = sh('git', ['ls-tree', '-r', '--name-only', MAIN, `${folder}/`], { cwd: checkout });
    if (list.status !== 0) {
      cleanup();
      return null;
    }
    const sub = path.join(dir, path.basename(folder));
    fs.mkdirSync(sub);
    for (const name of list.stdout.split(/\r?\n/).filter(Boolean)) {
      const shown = sh('git', ['show', `${MAIN}:${name}`], { cwd: checkout });
      if (shown.status !== 0) {
        cleanup();
        return null;
      }
      fs.writeFileSync(path.join(sub, path.basename(name)), shown.stdout);
    }
  }
  const file = path.join(dir, path.basename(rel));
  fs.writeFileSync(file, r.stdout);
  return { file, cleanup };
}

/** The gate's argv after the script path. @param {number} pr @param {string} vault */
export const gateArgs = (pr, vault) => [String(pr), ...GATE_FLAGS, '--vault', vault];

/**
 * Is `pid` a live merge runner? A logoff leaves the lock behind and Windows reuses pids at the next
 * logon, so a live pid alone is not enough: its command line must name merge-runner.mjs. When the
 * command line cannot be read, the pid counts as a runner (never two runners).
 * @param {number} pid
 */
export function isRunnerProcess(pid) {
  if (!pidAlive(pid)) return false;
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`,
      ],
      { encoding: 'utf8', timeout: 60_000 }
    );
    const line = (r.stdout ?? '').trim();
    // An unreadable command line (empty answer) counts as a runner: never two runners.
    if (r.status !== 0 || !line) return true;
    return /merge-runner\.mjs/.test(line);
  }
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('merge-runner.mjs');
  } catch {
    return true;
  }
}

/**
 * Take the runner lock: `wx` create with our pid. A lock whose holder is not a live runner is taken
 * over.
 * @param {string} file @param {number} [pid] @param {(pid: number) => boolean} [isRunner]
 * @returns {{ ok: true, release: () => void } | { ok: false, holder: number }}
 */
export function takeRunnerLock(file, pid = process.pid, isRunner = isRunnerProcess) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(file, `${pid}\n`, { flag: 'wx' });
      // Two starters that read the same stale holder can both have removed it: a later starter's
      // removal may have deleted this file, so the pid read back must still be ours.
      if (fs.readFileSync(file, 'utf8').trim() !== String(pid)) return { ok: false, holder: 0 };
      return {
        ok: true,
        release: () => {
          try {
            if (fs.readFileSync(file, 'utf8').trim() === String(pid)) fs.unlinkSync(file);
          } catch {
            // already gone
          }
        },
      };
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
      const holder = Number(fs.readFileSync(file, 'utf8').trim());
      // A lock older than the last boot is stale whatever its pid is now (a killed runner leaves
      // it behind, and the pid may belong to a service whose command line cannot be read).
      const bootMs = Date.now() - os.uptime() * 1000;
      const stale = fs.statSync(file).mtimeMs < bootMs - 60_000;
      if (!stale && Number.isInteger(holder) && holder > 0 && holder !== pid && isRunner(holder)) {
        return { ok: false, holder };
      }
      fs.rmSync(file, { force: true });
    }
  }
  return { ok: false, holder: 0 };
}

/**
 * @param {string[]} argv
 * @returns {{ once: boolean, interval: number, vault: string, checkout: string }}
 */
export function parseArgs(argv) {
  const repo = path.resolve(here, '..').replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/, '');
  const o = {
    once: false,
    interval: DEFAULT_INTERVAL,
    vault:
      process.env.FOUNDRY_AI_OBSIDIAN_DIR ||
      path.join(os.homedir(), 'Documents', 'Obsidian', 'vault'),
    checkout: `${repo}-gate`,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--once') o.once = true;
    else if (a === '--interval') {
      o.interval = Number(value());
      if (!Number.isFinite(o.interval) || o.interval < 10)
        throw new Error('--interval is at least 10 seconds');
    } else if (a === '--vault') o.vault = value();
    else if (a === '--checkout') o.checkout = path.resolve(value());
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** @param {string} line */
const stamp = line => console.log(`merge-runner: ${new Date().toISOString()} ${line}`);

/** @param {ReturnType<typeof parseArgs>} o @returns {Deps} */
function realDeps(o) {
  const vaultGit = (/** @type {string[]} */ args) =>
    sh('git', ['-C', o.vault, ...args], { timeout: 60_000 });
  return {
    readBacklog: () => readUpstreamBacklog(vaultGit, m => stamp(`WARNING: ${m}`)),
    gh: args => sh('gh', args),
    prepare: r => {
      try {
        return prepareCheckout(o.checkout, r);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    gate: pr => {
      const copy = mainCopy(o.checkout, 'scripts/lane-merge.mjs', 'scripts/lane-merge');
      if (!copy) return { status: 1, stdout: '', stderr: 'no scripts/lane-merge.mjs on main' };
      try {
        const r = sh(process.execPath, [copy.file, ...gateArgs(pr, o.vault)], {
          cwd: o.checkout,
          timeout: GATE_TIMEOUT_MS,
        });
        for (const line of `${r.stdout}`.split(/\r?\n/).filter(Boolean)) stamp(`  ${line}`);
        if (r.timedOut) return { ...r, stdout: `${r.stdout}\n${KILLED_LINE}\n` };
        return r;
      } finally {
        copy.cleanup();
      }
    },
    backlog: args =>
      sh(process.execPath, [path.join(here, 'backlog.mjs'), ...args, '--vault', o.vault]),
    post: rawText => {
      // No local paths in a Discord line (gate reasons can name a log file or the checkout).
      const home = os.homedir();
      const esc = (/** @type {string} */ x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const text = home
        ? rawText.replace(new RegExp(`${esc(home)}|${esc(home.replace(/\\/g, '/'))}`, 'gi'), '~')
        : rawText;
      // From the runner's own repository: a missing or broken gate checkout must still be posted.
      const copy = mainCopy(path.resolve(here, '..'), 'packages/discord-bot/announce/announce.mjs');
      if (!copy) return stamp('WARNING: no announce sender on main; nothing posted');
      try {
        const r = sh(process.execPath, [copy.file, 'pr-note', text], { timeout: 15_000 });
        if (r.status !== 0)
          stamp(`WARNING: Discord line not posted (${oneLine(r.stdout || r.stderr, 200)})`);
      } finally {
        copy.cleanup();
      }
    },
    log: stamp,
    ...makeQueueDeps({ sh, stamp, repo: REPO }),
    selfCheck:
      makeSelfCheck({
        // backlog.mjs is started as its own process for every Backlog write: its code counts too.
        entry: [fileURLToPath(import.meta.url), path.join(here, 'backlog.mjs')],
        repoRoot: path.resolve(here, '..'),
        ref: MAIN,
        remote: 'aitool',
        branch: 'main',
        log: m => stamp(m),
      }) ?? undefined,
  };
}

/**
 * @param {string[]} argv
 * @param {{ deps?: Deps, lockFile?: string, sleep?: (ms: number) => Promise<void>,
 *   isRunner?: (pid: number) => boolean }} [inject]
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, inject = {}) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error(`merge-runner: ${e instanceof Error ? e.message : e}`);
    return 2;
  }
  const d = inject.deps ?? realDeps(o);
  const lockFile =
    inject.lockFile ?? path.join(os.homedir(), '.foundry-ai-tool', 'merge-runner.lock');
  const lock = takeRunnerLock(lockFile, process.pid, inject.isRunner);
  if (!lock.ok) {
    const why = `another merge runner runs (pid ${lock.holder || 'unknown'}, ${lockFile})`;
    d.log(`${why}; exiting`);
    d.post(`merge runner not started: ${why}`);
    return 1;
  }
  const sleep = inject.sleep ?? (ms => new Promise(res => setTimeout(res, ms)));
  try {
    d.log(`started (pid ${process.pid}, vault ${o.vault}, gate checkout ${o.checkout})`);
    /** @type {Set<string>} */
    const tried = new Set();
    /** @type {Map<string, number>} */
    const attempts = new Map();
    for (;;) {
      const sc = o.once ? null : d.selfCheck?.();
      if (sc) {
        d.log(`exiting: ${sc.why}`);
        if (sc.action === 'restart') return EXIT_RESTART;
        d.post(
          `merge runner stopped: ${sc.why}; update the main checkout, then start the runner again`
        );
        return EXIT_STOPPED;
      }
      const r = round(d, tried, attempts);
      if (r.stop) {
        d.log(`exiting: ${r.stop}`);
        return EXIT_STOPPED;
      }
      if (o.once) return 0;
      await sleep(o.interval * 1000);
    }
  } finally {
    lock.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const code = await main(argv);
  // The lock is released by now; a child takes it. Same output stream, same arguments. The first
  // process stays as the parent and starts one child after another; a child just exits with 75.
  process.exitCode =
    code === EXIT_RESTART
      ? reexec({
          script: fileURLToPath(import.meta.url),
          argv,
          log: stamp,
          post: t => realDeps(parseArgs(argv)).post(t),
        })
      : code;
}
