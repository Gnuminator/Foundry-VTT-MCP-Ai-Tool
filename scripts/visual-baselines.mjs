#!/usr/bin/env node
/**
 * Dashboard screenshot baselines before the PR (CI failure review 2026-10-27, fix 1).
 *
 *   npm run visual:baselines -- <branch>
 *
 * Starts .github/workflows/visual-baselines.yml from main for a pushed branch, waits for it,
 * downloads the artifact and copies the changed or new PNGs into
 * packages/cogm-dashboard/web/visual/__screenshots__/ of THIS checkout, then prints the files.
 * Look at the images, commit them, then open the PR. Needs `gh` signed in; the branch must be
 * pushed to the aitool repo, and this checkout should be on it (the PNGs are written here).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = 'Gnuminator/Foundry-VTT-MCP-Ai-Tool';
export const WORKFLOW = 'visual-baselines.yml';
export const SCREENSHOTS = 'packages/cogm-dashboard/web/visual/__screenshots__/';
const POLL_MS = 15000;
const TIMEOUT_MS = 40 * 60 * 1000;

/** @param {string} branch */
export const validBranch = branch =>
  /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) && !branch.includes('..');

/** Only PNGs under the screenshots folder, no traversal. @param {string} rel */
export const safeTarget = rel => {
  const norm = rel.split(path.sep).join('/');
  return (
    norm.startsWith(SCREENSHOTS) && norm.endsWith('.png') && !norm.split('/').includes('..')
  );
};

/**
 * The run whose title (the workflow's run-name) carries this invocation's nonce, so two lanes
 * dispatching at the same time never take each other's run.
 * @param {{databaseId:number,displayTitle:string}[]} runs
 * @param {string} nonce
 */
export const pickRun = (runs, nonce) => runs.find(r => r.displayTitle?.split(' ').includes(nonce));

/**
 * What the run's playwright-exit.txt says. A non-zero exit with no changed PNG means nothing
 * rendered, which must not read as "the screenshots already match".
 * @param {string} exitText
 * @param {number} changedCount
 */
export const renderProblem = (exitText, changedCount) => {
  const code = exitText.trim();
  if (code === '') return 'The run left no Playwright exit code.';
  if (code !== '0' && changedCount === 0) {
    return `Playwright exited ${code} and no baseline changed: nothing rendered. See the run log.`;
  }
  return '';
};

/** @param {string[]} args */
const gh = args => {
  const r = spawnSync('gh', args, { encoding: 'utf8', shell: false });
  if (r.error) throw new Error(`gh failed to start: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  }
  return r.stdout;
};
const sleep = ms => new Promise(res => setTimeout(res, ms));

async function main() {
  const branch = process.argv[2];
  if (!branch || !validBranch(branch)) {
    console.error('Usage: npm run visual:baselines -- <branch>   (a branch pushed to aitool)');
    return 2;
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const refs = gh(['api', `repos/${REPO}/git/matching-refs/heads/${branch}`, '--jq', '.[].ref']);
  if (!refs.split('\n').includes(`refs/heads/${branch}`)) {
    console.error(`Branch ${branch} is not pushed to ${REPO}. Push it first.`);
    return 2;
  }
  const since = Date.now();
  const nonce = `n${since.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  gh([
    'workflow', 'run', WORKFLOW, '--repo', REPO, '--ref', 'main',
    '-f', `branch=${branch}`, '-f', `nonce=${nonce}`
  ]);
  console.log(`Started ${WORKFLOW} for ${branch}. Waiting for the run...`);

  let run;
  while (!run) {
    if (Date.now() - since > TIMEOUT_MS) throw new Error('The run never appeared.');
    await sleep(5000);
    const list = JSON.parse(
      gh([
        'run', 'list', '--repo', REPO, '--workflow', WORKFLOW, '--event', 'workflow_dispatch',
        '--limit', '10', '--json', 'databaseId,displayTitle'
      ])
    );
    run = pickRun(list, nonce);
  }
  console.log(`Run ${run.databaseId}: https://github.com/${REPO}/actions/runs/${run.databaseId}`);

  for (;;) {
    if (Date.now() - since > TIMEOUT_MS) throw new Error('Timed out waiting for the run.');
    const v = JSON.parse(
      gh(['run', 'view', String(run.databaseId), '--repo', REPO, '--json', 'status,conclusion'])
    );
    if (v.status === 'completed') {
      if (v.conclusion !== 'success') throw new Error(`The run ended ${v.conclusion}. See the link above.`);
      break;
    }
    await sleep(POLL_MS);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-baselines-'));
  gh(['run', 'download', String(run.databaseId), '--repo', REPO, '-n', 'visual-baselines', '-D', tmp]);
  /** @type {string[]} */
  const changed = [];
  /** @param {string} dir */
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else {
        const rel = path.relative(tmp, full).split(path.sep).join('/');
        if (!safeTarget(rel)) continue;
        const dest = path.join(repoRoot, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(full, dest);
        changed.push(rel);
      }
    }
  };
  walk(tmp);
  const readText = name => {
    try {
      return fs.readFileSync(path.join(tmp, name), 'utf8');
    } catch {
      return '';
    }
  };
  const problem = renderProblem(readText('playwright-exit.txt'), changed.length);
  const rendered = readText('head.txt').trim();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (problem) throw new Error(problem);
  const local = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
  if (rendered && local && rendered !== local) {
    console.warn(
      `Warning: rendered ${rendered.slice(0, 8)} but this checkout is at ${local.slice(0, 8)}. Push your latest commit and run it again if the screen changed since.`
    );
  }

  if (changed.length === 0) {
    console.log('No baselines changed: the committed screenshots already match.');
  } else {
    console.log(`${changed.length} baseline PNG(s) written:`);
    for (const f of changed) console.log(`  ${f}`);
    console.log(
      'Look at them, then commit them before you open the PR. Never copy baselines from a failed PR run.'
    );
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    code => process.exit(code),
    err => {
      console.error(`visual:baselines: ${err.message}`);
      process.exit(1);
    }
  );
}
