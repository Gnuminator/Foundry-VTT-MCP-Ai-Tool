#!/usr/bin/env node
/**
 * Main went red: rerun once, then open a DRAFT revert PR of the merge that turned it red.
 * Run by .github/workflows/main-red-revert.yml when a CI run on a push to main ends in failure.
 *
 *   node scripts/main-red-revert.mjs --run <run id> --attempt <n> --sha <head sha> [--dry-run]
 *
 * - attempt 1 only (a later attempt is a person's rerun and is left alone). The event is minutes
 *   old, so the run is read first: if a person already reran it by hand (attempt 2 or more), this
 *   job waits for that attempt instead of rerunning. Otherwise `gh run rerun <id> --failed`, then wait in this same job until attempt 2 has finished (a rerun started with
 *   GITHUB_TOKEN may not fire a second workflow_run, so nothing depends on one). Green: done.
 * - Red again: find the merge that started the current red streak (the oldest consecutive
 *   non-green main CI push run ending at this sha), revert it on a branch `auto-revert/<sha7>` and
 *   open a draft PR. The PR is never merged here: the planner skill's "Main is red" section stays
 *   in force (a revert needs the user's OK). No-ops when main already healed (a newer run is
 *   green), when an auto-revert PR is already open, or when the revert conflicts (the job then
 *   fails with the reason, so the red shows in Actions).
 * A push with GITHUB_TOKEN starts no CI on the PR: close and reopen the draft PR (or push to its
 * branch) to start it.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BRANCH_PREFIX = 'auto-revert/';

/**
 * Where the rerun stands, from the run as the API reports it.
 * @param {{ status: string, run_attempt: number, conclusion: string | null }} r
 * @returns {'waiting' | 'green' | 'red'}
 */
export function rerunState(r) {
  if (r.run_attempt < 2 || r.status !== 'completed') return 'waiting';
  return r.conclusion === 'success' ? 'green' : 'red';
}

/**
 * The commit that started the red streak ending at `failedSha`.
 * @param {Array<{ head_sha: string, conclusion: string | null }>} runs completed CI push runs on
 *   main, newest first
 * @param {string} failedSha
 * @returns {{ culprit: string | null, reason: string, streak: Array<{ head_sha: string, conclusion: string | null }> }}
 *   culprit null when nothing should be done; streak is the whole red run, newest first (a
 *   cancelled run counts as red and is marked in the PR body)
 */
export function findCulprit(runs, failedSha) {
  const none = reason => ({ culprit: null, reason, streak: [] });
  const at = runs.findIndex(r => r.head_sha === failedSha);
  if (at < 0) return none('the failed run is not in the recent main runs');
  if (runs[at].conclusion === 'success') return none('that run is green');
  if (runs.slice(0, at).some(r => r.conclusion === 'success')) {
    return none('a newer main run is green: main already healed');
  }
  const streak = [runs[at]];
  for (let i = at + 1; i < runs.length; i++) {
    if (runs[i].conclusion === 'success') {
      return { culprit: streak[streak.length - 1].head_sha, reason: 'ok', streak };
    }
    streak.push(runs[i]);
  }
  return none('no green run in the recent history: cannot name a culprit');
}

/**
 * The streak as a markdown list for the PR body, oldest first; a cancelled run never finished, so
 * it is no proof that its commit broke anything.
 * @param {Array<{ head_sha: string, conclusion: string | null }>} streak
 */
export function streakLines(streak) {
  return [...streak].reverse().map(r => {
    const note = r.conclusion === 'cancelled' ? ' (cancelled: no verdict, may be innocent)' : '';
    return `- ${r.head_sha.slice(0, 7)}: ${r.conclusion ?? 'unknown'}${note}`;
  });
}

/**
 * A readable name for a commit: a squash subject as is; a merge commit's subject ("Merge pull
 * request #1 from ...") is replaced by the PR title, which is the first line of its body.
 * @param {string} subject @param {string} body
 */
export function commitTitle(subject, body) {
  let t = subject;
  if (/^Merge (pull request|branch)/.test(subject)) {
    t = body.split('\n').find(l => l.trim()) ?? '';
  }
  t = t.replace(/\s*\(#\d+\)$/, '').trim();
  return t || 'a merge to main';
}

/** @param {string[]} args @param {{ allowFail?: boolean }} [opt] */
function run(cmd, args, opt = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0 && !opt.allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  }
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const o = { dryRun: false, run: '', attempt: 1, sha: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') o.dryRun = true;
    else if (argv[i] === '--run') o.run = argv[++i] ?? '';
    else if (argv[i] === '--attempt') o.attempt = Number(argv[++i]);
    else if (argv[i] === '--sha') o.sha = argv[++i] ?? '';
  }
  return o;
}

/**
 * Everything main() touches outside itself, so a test can pass fakes.
 * @typedef {object} Io
 * @property {(args: string[], opt?: { allowFail?: boolean }) => { ok: boolean, out: string, err: string }} gh
 * @property {(args: string[], opt?: { allowFail?: boolean }) => { ok: boolean, out: string, err: string }} git
 * @property {(ms: number) => void} sleep
 * @property {() => number} now
 * @property {(p: string, text: string) => void} writeFile
 * @property {(m: string) => void} log
 * @property {Record<string, string | undefined>} env
 * @returns {Io}
 */
export function realIo() {
  return {
    gh: (args, opt) => run('gh', args, opt),
    git: (args, opt) => run('git', args, opt),
    sleep: ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    now: () => Date.now(),
    writeFile: (p, text) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
    },
    log: m => console.log(m),
    env: process.env,
  };
}

/** The run as the API reports it now, or null when the call failed. @param {Io} io @param {string} id */
function readRun(io, id) {
  const r = io.gh(
    ['api', `repos/{owner}/{repo}/actions/runs/${id}`, '--jq', '{status, run_attempt, conclusion}'],
    { allowFail: true }
  );
  if (!r.ok) return null;
  try {
    return JSON.parse(r.out);
  } catch {
    return null;
  }
}

/** Like readRun, but a few tries: one blip must not turn a hand-made rerun into a second one. */
function readRunWithRetry(io, id) {
  for (let i = 0; i < 3; i++) {
    if (i > 0) io.sleep(5 * 1000);
    const r = readRun(io, id);
    if (r) return r;
  }
  return null;
}

/**
 * Polls the run until attempt 2 has finished. True when it ended red. A failed or unreadable poll
 * is retried until the deadline: one API blip must not end the wait.
 * @param {Io} io @param {string} id
 */
function waitForRerun(io, id) {
  const deadline = io.now() + 50 * 60 * 1000;
  while (io.now() < deadline) {
    io.sleep(30 * 1000);
    const r = readRun(io, id);
    if (!r) {
      io.log('could not read the run state: trying again');
      continue;
    }
    const state = rerunState(r);
    if (state === 'green') {
      io.log('the rerun passed: a flaky red, nothing to revert');
      return false;
    }
    if (state === 'red') return true;
  }
  throw new Error('the rerun did not finish within 50 minutes');
}

/** @param {string[]} argv @param {Io} [io] */
export function main(argv, io = realIo()) {
  const { gh, git } = io;
  const o = parseArgs(argv);
  if (!o.run || !o.sha || !Number.isInteger(o.attempt)) {
    io.log('usage: main-red-revert.mjs --run <id> --attempt <n> --sha <sha> [--dry-run]');
    return 2;
  }
  if (o.attempt > 1) {
    io.log(`attempt ${o.attempt} is a manual rerun: nothing to do`);
    return 0;
  }
  if (!o.dryRun) {
    // The event is minutes old: someone may have rerun it by hand since. Read the run first.
    const live = readRunWithRetry(io, o.run);
    if (live && live.run_attempt > 1) {
      io.log('the run was already rerun by hand: waiting for that attempt instead of rerunning');
    } else {
      io.log(`attempt 1 failed on ${o.sha.slice(0, 7)}: rerunning the failed jobs once`);
      gh(['run', 'rerun', o.run, '--failed']);
    }
    if (!waitForRerun(io, o.run)) return 0;
  }
  const listed = JSON.parse(
    gh([
      'api',
      'repos/{owner}/{repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=40',
      '--jq',
      '[.workflow_runs[] | {head_sha, conclusion}]',
    ]).out
  );
  const { culprit, reason, streak } = findCulprit(listed, o.sha);
  if (!culprit) {
    io.log(`no revert PR: ${reason}`);
    return 0;
  }
  const short = culprit.slice(0, 7);
  const branch = `${BRANCH_PREFIX}${short}`;
  const open = gh([
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'headRefName',
    '--jq',
    `[.[] | select(.headRefName | startswith("${BRANCH_PREFIX}"))] | length`,
  ]).out;
  if (Number(open) > 0) {
    io.log('no revert PR: an auto-revert PR is already open');
    return 0;
  }
  const subject = git(['log', '-1', '--format=%s', culprit]).out;
  const title = commitTitle(subject, git(['log', '-1', '--format=%b', culprit]).out);
  const parents = git(['rev-list', '--parents', '-n', '1', culprit]).out.split(' ').length - 1;
  io.log(`main red since ${short} (${title}); reverting on ${branch}`);
  if (o.dryRun) return 0;

  git(['config', 'user.name', 'github-actions[bot]']);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  // A branch left by an earlier reaction (a closed draft, or a failed PR create) is reused, never
  // force-pushed: people may have pushed to it.
  const branchExists = git(['ls-remote', '--exit-code', '--heads', 'origin', branch], {
    allowFail: true,
  }).ok;
  if (!branchExists) {
    git(['fetch', 'origin', 'main']);
    git(['checkout', '-b', branch, 'origin/main']);
    const revert = git(['revert', '--no-edit', ...(parents > 1 ? ['-m', '1'] : []), culprit], {
      allowFail: true,
    });
    if (!revert.ok) {
      git(['revert', '--abort'], { allowFail: true });
      throw new Error(`the revert of ${short} conflicts (later merges build on it): ${revert.err}`);
    }
    io.writeFile(
      `changelog.d/auto-revert-${short}.md`,
      `### Fixes\n\n- **Main reverted:** reverted ${short} (${title}) because main CI was red.\n`
    );
    git(['add', `changelog.d/auto-revert-${short}.md`]);
    git(['commit', '-m', `Add changelog fragment for the revert of ${short}`]);
    git(['push', 'origin', `${branch}:${branch}`]);
  }
  const url = `${io.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${io.env.GITHUB_REPOSITORY ?? ''}/actions/runs/${o.run}`;
  const body = [
    `Main CI is red since ${culprit} (${title}); the failed run was rerun once and failed again: ${url}`,
    '',
    'The red streak, oldest first (the first one is reverted here):',
    ...streakLines(streak),
    '',
    '**Draft on purpose, never merged automatically.** The planner decides: a revert needs the',
    "user's OK (planner skill, Main is red). A pushed token starts no CI here: close and reopen",
    'this PR to start it, then merge through the gate.',
    '',
    `Unblocks main: reverts ${culprit} (${title})`,
    'Backlog: main-red-auto-revert',
  ].join('\n');
  const created = gh(
    [
      'pr',
      'create',
      '--draft',
      '--base',
      'main',
      '--head',
      branch,
      '--title',
      `Revert ${short}: main CI is red`,
      '--body',
      body,
    ],
    { allowFail: true }
  );
  if (!created.ok) {
    throw new Error(
      `branch ${branch} is pushed but the draft PR could not open (is "Allow GitHub Actions to create pull requests" on?): ${created.err}`
    );
  }
  io.log(created.out);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
