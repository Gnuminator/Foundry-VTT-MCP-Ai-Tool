#!/usr/bin/env node
/**
 * Dashboard screenshot baselines before the PR (CI failure review 2026-10-27, fix 1).
 *
 *   npm run visual:baselines -- <branch>
 *
 * Starts .github/workflows/visual-baselines.yml ON a pushed branch (it must contain the file: cut
 * the branch from main after the workflow merged, or merge main in), waits for it,
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
export const pickRun = (runs, nonce, branch) =>
  runs.find(
    r =>
      r.displayTitle?.split(' ').includes(nonce) &&
      (branch === undefined || r.headBranch === undefined || r.headBranch === branch)
  );

/**
 * Refuses a run that is not for this branch and the sha the branch had when we dispatched.
 * Empty string = fine. Fields come from `gh run list --json headBranch,headSha`.
 * @param {{databaseId:number,headBranch?:string,headSha?:string}} run
 * @param {string} branch
 * @param {string} expectedSha  branch head at dispatch time ('' = unknown, skip the sha check)
 */
export const runProblem = (run, branch, expectedSha) => {
  if (run.headBranch && run.headBranch !== branch) {
    return `Run ${run.databaseId} is for branch ${run.headBranch}, not ${branch}: refusing its PNGs.`;
  }
  if (expectedSha && run.headSha && run.headSha !== expectedSha) {
    return `Run ${run.databaseId} rendered ${run.headSha.slice(0, 8)} but ${branch} was at ${expectedSha.slice(0, 8)} when it started (a push in between?). Refusing its PNGs; run it again.`;
  }
  return '';
};

/**
 * The artifact's head.txt must name the commit the run was started on.
 * @param {string} headText
 * @param {string} runSha
 */
export const artifactProblem = (headText, runSha) => {
  const h = headText.trim();
  if (h && runSha && h !== runSha) {
    return `The artifact was rendered at ${h.slice(0, 8)} but the run is for ${runSha.slice(0, 8)}: it is another run's output. Refusing it.`;
  }
  return '';
};

/** Per-branch log file name, so lanes running at once never share one. @param {string} branch */
export const logPathFor = branch =>
  path.join(os.tmpdir(), `visual-baselines-${branch.replace(/[^A-Za-z0-9._-]/g, '_')}.log`);

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

/**
 * The run's png-count.txt is the number of PNGs git saw in the workflow's checkout; the artifact
 * must hold that many. A missing marker or a mismatch means the collect step lost files (#533:
 * six shots differed, the artifact held none, and this script said "No baselines changed").
 * @param {string} countText
 * @param {number} foundCount
 */
export const collectProblem = (countText, foundCount) => {
  const text = countText.trim();
  if (!/^\d+$/.test(text)) {
    return 'The run left no png-count.txt marker (a run of an old workflow file?). Merge aitool/main into the branch and run it again.';
  }
  const expected = Number(text);
  if (expected !== foundCount) {
    return `git saw ${expected} changed or new PNG(s) in the run but the artifact holds ${foundCount}. The collect step lost files: see the run log.`;
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
  const logFile = logPathFor(branch);
  fs.writeFileSync(logFile, '');
  for (const m of ['log', 'warn', 'error']) {
    const orig = console[m].bind(console);
    console[m] = (...a) => {
      orig(...a);
      try {
        fs.appendFileSync(logFile, `${a.join(' ')}\n`);
      } catch {
        /* the log is a convenience */
      }
    };
  }
  console.log(`Log for this branch: ${logFile}`);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const refs = gh(['api', `repos/${REPO}/git/matching-refs/heads/${branch}`, '--jq', '.[].ref']);
  if (!refs.split('\n').includes(`refs/heads/${branch}`)) {
    console.error(`Branch ${branch} is not pushed to ${REPO}. Push it first.`);
    return 2;
  }
  try {
    gh(['api', `repos/${REPO}/contents/.github/workflows/${WORKFLOW}?ref=${branch}`, '--silent']);
  } catch {
    console.error(
      `Branch ${branch} does not contain .github/workflows/${WORKFLOW} (the workflow runs on the branch). Merge main into it, then push.`
    );
    return 2;
  }
  const expectedSha = gh(['api', `repos/${REPO}/commits/${branch}`, '--jq', '.sha']).trim();
  const since = Date.now();
  const nonce = `n${since.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  gh([
    'workflow', 'run', WORKFLOW, '--repo', REPO, '--ref', branch, '-f', `nonce=${nonce}`
  ]);
  console.log(`Started ${WORKFLOW} for ${branch}. Waiting for the run...`);

  let run;
  while (!run) {
    if (Date.now() - since > TIMEOUT_MS) throw new Error('The run never appeared.');
    await sleep(5000);
    const list = JSON.parse(
      gh([
        'run', 'list', '--repo', REPO, '--workflow', WORKFLOW, '--event', 'workflow_dispatch',
        '--limit', '30', '--json', 'databaseId,displayTitle,headBranch,headSha'
      ])
    );
    run = pickRun(list, nonce, branch);
  }
  const bad = runProblem(run, branch, expectedSha);
  if (bad) throw new Error(bad);
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
        if (safeTarget(rel)) changed.push(rel);
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
  const problem =
    artifactProblem(readText('head.txt'), run.headSha ?? '') ||
    renderProblem(readText('playwright-exit.txt'), changed.length) ||
    collectProblem(readText('png-count.txt'), changed.length);
  if (!problem) {
    for (const rel of changed) {
      const dest = path.join(repoRoot, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(tmp, rel), dest);
    }
  }
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
