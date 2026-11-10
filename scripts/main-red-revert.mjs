#!/usr/bin/env node
/**
 * Main went red: rerun once, then open a DRAFT revert PR of the merge that turned it red.
 * Run by .github/workflows/main-red-revert.yml when a CI run on a push to main ends in failure.
 *
 *   node scripts/main-red-revert.mjs --run <run id> --attempt <n> --sha <head sha> [--dry-run]
 *
 * - attempt 1 only (a later attempt is a person's rerun and is left alone): `gh run rerun <id>
 *   --failed`, then wait in this same job until attempt 2 has finished (a rerun started with
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
 * @returns {{ culprit: string | null, reason: string }} culprit null when nothing should be done
 */
export function findCulprit(runs, failedSha) {
  const at = runs.findIndex(r => r.head_sha === failedSha);
  if (at < 0) return { culprit: null, reason: 'the failed run is not in the recent main runs' };
  if (runs[at].conclusion === 'success') return { culprit: null, reason: 'that run is green' };
  if (runs.slice(0, at).some(r => r.conclusion === 'success')) {
    return { culprit: null, reason: 'a newer main run is green: main already healed' };
  }
  let culprit = failedSha;
  for (let i = at + 1; i < runs.length; i++) {
    if (runs[i].conclusion === 'success') return { culprit, reason: 'ok' };
    culprit = runs[i].head_sha;
  }
  return { culprit: null, reason: 'no green run in the recent history: cannot name a culprit' };
}

/** @param {string[]} args @param {{ allowFail?: boolean }} [opt] */
function run(cmd, args, opt = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0 && !opt.allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  }
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const gh = (args, opt) => run('gh', args, opt);
const git = (args, opt) => run('git', args, opt);

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

/** Polls the run until attempt 2 has finished. True when it ended red. @param {string} id */
function waitForRerun(id) {
  const deadline = Date.now() + 50 * 60 * 1000;
  while (Date.now() < deadline) {
    spawnSync('node', ['-e', 'setTimeout(()=>{},30000)']);
    const r = JSON.parse(
      gh([
        'api',
        `repos/{owner}/{repo}/actions/runs/${id}`,
        '--jq',
        '{status, run_attempt, conclusion}',
      ]).out
    );
    const state = rerunState(r);
    if (state === 'green') {
      console.log('the rerun passed: a flaky red, nothing to revert');
      return false;
    }
    if (state === 'red') return true;
  }
  throw new Error('the rerun did not finish within 50 minutes');
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.run || !o.sha || !Number.isInteger(o.attempt)) {
    console.error('usage: main-red-revert.mjs --run <id> --attempt <n> --sha <sha> [--dry-run]');
    process.exitCode = 2;
    return;
  }
  if (o.attempt > 1) {
    console.log(`attempt ${o.attempt} is a manual rerun: nothing to do`);
    return;
  }
  if (!o.dryRun) {
    console.log(`attempt 1 failed on ${o.sha.slice(0, 7)}: rerunning the failed jobs once`);
    gh(['run', 'rerun', o.run, '--failed']);
    if (!waitForRerun(o.run)) return;
  }
  const listed = JSON.parse(
    gh([
      'api',
      'repos/{owner}/{repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=40',
      '--jq',
      '[.workflow_runs[] | {head_sha, conclusion}]',
    ]).out
  );
  const { culprit, reason } = findCulprit(listed, o.sha);
  if (!culprit) {
    console.log(`no revert PR: ${reason}`);
    return;
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
    console.log('no revert PR: an auto-revert PR is already open');
    return;
  }
  const subject = git(['log', '-1', '--format=%s', culprit]).out;
  const parents = git(['rev-list', '--parents', '-n', '1', culprit]).out.split(' ').length - 1;
  console.log(`main red since ${short} (${subject}); reverting on ${branch}`);
  if (o.dryRun) return;

  git(['config', 'user.name', 'github-actions[bot]']);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  // A branch left by an earlier reaction (a closed draft, or a failed PR create) is reused, never
  // force-pushed: people may have pushed to it.
  const branchExists = git(['ls-remote', '--exit-code', '--heads', 'origin', branch], {
    allowFail: true,
  }).ok;
  if (!branchExists) pushRevertBranch();
  function pushRevertBranch() {
    git(['fetch', 'origin', 'main']);
    git(['checkout', '-b', branch, 'origin/main']);
    const revert = git(['revert', '--no-edit', ...(parents > 1 ? ['-m', '1'] : []), culprit], {
      allowFail: true,
    });
    if (!revert.ok) {
      git(['revert', '--abort'], { allowFail: true });
      throw new Error(`the revert of ${short} conflicts (later merges build on it): ${revert.err}`);
    }
    fs.mkdirSync('changelog.d', { recursive: true });
    fs.writeFileSync(
      `changelog.d/auto-revert-${short}.md`,
      `### Fixes\n\n- **Main reverted:** reverted ${short} (${subject.replace(/#\d+/g, '').trim()}) because main CI was red.\n`
    );
    git(['add', `changelog.d/auto-revert-${short}.md`]);
    git(['commit', '-m', `Add changelog fragment for the revert of ${short}`]);
    git(['push', 'origin', `${branch}:${branch}`]);
  }
  const url = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY ?? ''}/actions/runs/${o.run}`;
  const body = [
    `Main CI is red since ${culprit} (${subject}); the failed run was rerun once and failed again: ${url}`,
    '',
    '**Draft on purpose, never merged automatically.** The planner decides: a revert needs the',
    "user's OK (planner skill, Main is red). A pushed token starts no CI here: close and reopen",
    'this PR to start it, then merge through the gate.',
    '',
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
  console.log(created.out);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
