#!/usr/bin/env node
/**
 * Drift check: run before posting "PR ready". Lanes merge in parallel, and some guards only fail
 * once another lane's PR is on main: tool counts and sizes in the docs, the generated tool
 * reference, the tool-set budgets, the lint and em-dash baselines, the changelog fragments, the
 * usage catalog, the docs links. This script merges the newest main into a copy of the branch in a
 * throwaway git worktree, runs those guards there, and removes the worktree. The lane's own working
 * tree is never touched, and nothing is committed or pushed.
 *
 *   npm run drift:check                  fetch main, trial-merge it aside, run the guards
 *   npm run drift:check -- --remote NAME take main from this remote
 *
 * The remote is --remote, else the one local main tracks, else `aitool`, else a remote whose URL
 * is this repository. It checks the last commit, so it needs a clean working tree (commit first).
 * A merge conflict names the files: merge main into the branch yourself, resolve, push, and run it
 * again. The worktree borrows this checkout's node_modules (junctions), so workspace packages
 * resolve to this checkout's build; when main changed package-lock.json those would not match, so
 * it asks for the real merge and `npm ci` first. A worktree left by a killed run is removed by the
 * next run.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The guards that fail when two PRs are each green alone but not together. */
export const CHECKS = [
  { name: 'lint baseline', command: 'npm run lint:ratchet' },
  { name: 'em-dash baseline', command: 'npm run emdash:ratchet' },
  { name: 'changelog fragments', command: 'npm run changelog:check' },
  { name: 'usage catalog', command: 'npm run usage:catalog:check' },
  { name: 'version sync', command: 'npm run version:check' },
  { name: 'docs lint', command: 'npm run docs:lint' },
  { name: 'docs links', command: 'npm run docs:links' },
  {
    name: 'mcp-server tests (tool counts, tool reference, tool sets)',
    command: 'npx vitest run',
    cwd: 'packages/mcp-server',
  },
  {
    name: 'module write gate',
    command: 'npx vitest run src/write-gate.test.ts',
    cwd: 'packages/foundry-module',
  },
];

const REPO_URL = /github\.com[/:]Gnuminator\/Foundry-VTT-MCP-Ai-Tool(\.git)?$/i;
const WORKTREE_PREFIX = 'drift-check-';
/** Windows reports a child stopped by Ctrl+C as STATUS_CONTROL_C_EXIT, not as a signal. */
const CTRL_C_EXIT = 3221225786;

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/**
 * The remote to take main from: `wanted`, else local main's remote, else `aitool`, else a remote
 * whose URL is this repository. Null when none fits (never a guessed `origin`).
 * @param {string} cwd @param {string | undefined} wanted
 */
export function pickRemote(cwd, wanted) {
  if (wanted) return wanted;
  const upstream = git(cwd, ['config', '--get', 'branch.main.remote']);
  if (upstream.ok && upstream.out && upstream.out !== '.') return upstream.out;
  const remotes = git(cwd, ['remote']).out.split('\n').filter(Boolean);
  if (remotes.includes('aitool')) return 'aitool';
  return remotes.find(r => REPO_URL.test(git(cwd, ['remote', 'get-url', r]).out)) ?? null;
}

/** The node_modules folders of a checkout, relative to its root. @param {string} root */
function nodeModulesDirs(root) {
  const dirs = ['.', 'shared'];
  const packages = path.join(root, 'packages');
  if (fs.existsSync(packages)) {
    for (const p of fs.readdirSync(packages)) dirs.push(path.join('packages', p));
  }
  return dirs.map(d => path.join(d, 'node_modules')).filter(d => fs.existsSync(path.join(root, d)));
}

/**
 * Removes a throwaway worktree: its junctions first (unlinked, so nothing behind them is deleted),
 * then the worktree itself. @param {string} cwd @param {string} dir
 */
function removeWorktree(cwd, dir) {
  for (const rel of [
    'node_modules',
    'shared/node_modules',
    ...listPackages(dir).map(p => `packages/${p}/node_modules`),
  ]) {
    const link = path.join(dir, rel);
    try {
      if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    } catch {
      // not there
    }
  }
  git(cwd, ['worktree', 'remove', '--force', dir]);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  git(cwd, ['worktree', 'prune']);
}

/** @param {string} dir */
function listPackages(dir) {
  try {
    return fs.readdirSync(path.join(dir, 'packages'));
  } catch {
    return [];
  }
}

/** Worktrees a killed run left behind. @param {string} cwd */
function staleWorktrees(cwd) {
  return git(cwd, ['worktree', 'list', '--porcelain'])
    .out.split('\n')
    .filter(l => l.startsWith('worktree '))
    .map(l => l.slice('worktree '.length))
    .filter(p => path.basename(p).startsWith(WORKTREE_PREFIX));
}

/**
 * Runs the drift check for the repo at `cwd`. Returns the exit code (0 all green, 1 a guard failed
 * or a conflict, 2 it could not start, 130 stopped). `checks` and `log` are replaceable for tests.
 * @param {{ cwd: string, remote?: string, checks?: typeof CHECKS, log?: (line: string) => void }} opts
 */
export function runDriftCheck({ cwd, remote, checks = CHECKS, log = console.log }) {
  const dirty = git(cwd, ['status', '--porcelain', '--untracked-files=no']);
  if (!dirty.ok) {
    log(`drift-check: not a git repository (${dirty.err})`);
    return 2;
  }
  if (dirty.out) {
    log('drift-check: the working tree has uncommitted changes; commit them first.');
    return 2;
  }
  const name = pickRemote(cwd, remote);
  if (!name) {
    log('drift-check: no remote for this repository found; pass --remote NAME.');
    return 2;
  }
  const fetched = git(cwd, ['fetch', '--quiet', name, 'main']);
  if (!fetched.ok) {
    log(`drift-check: git fetch ${name} main failed: ${fetched.err}`);
    return 2;
  }
  const main = `${name}/main`;
  const mainSha = git(cwd, ['rev-parse', '--short', main]);
  if (!mainSha.ok) {
    log(`drift-check: ${main} not found; pass --remote NAME.`);
    return 2;
  }
  for (const stale of staleWorktrees(cwd)) removeWorktree(cwd, stale);

  if (git(cwd, ['merge-base', '--is-ancestor', main, 'HEAD']).ok) {
    log(`drift-check: the branch already contains ${main} (${mainSha.out}).`);
    return runChecks(cwd, checks, log, main, mainSha.out, false);
  }

  // The worktree borrows this checkout's node_modules, which would not match main's lockfile (a
  // new ESLint, say) and give false results.
  if (!git(cwd, ['diff', '--quiet', 'HEAD', main, '--', 'package-lock.json']).ok) {
    log(`drift-check: ${main} (${mainSha.out}) changed package-lock.json.`);
    log('Merge main into the branch, run `npm ci`, and run this again.');
    return 2;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), WORKTREE_PREFIX));
  const cleanup = () => removeWorktree(cwd, dir);
  const onSignal = () => {
    cleanup();
    process.exit(130);
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGHUP', onSignal);
  try {
    const added = git(cwd, ['worktree', 'add', '--quiet', '--detach', dir, 'HEAD']);
    if (!added.ok) {
      log(`drift-check: git worktree add failed: ${added.err}`);
      return 2;
    }
    // git wants an identity even for --no-commit; the trial merge is never committed.
    const merge = git(dir, [
      '-c',
      'user.name=drift-check',
      '-c',
      'user.email=drift-check@localhost',
      'merge',
      '--no-commit',
      '--no-ff',
      main,
    ]);
    if (!merge.ok) {
      const conflicts = git(dir, ['diff', '--name-only', '--diff-filter=U']).out;
      if (!conflicts) {
        log(`drift-check: git merge ${main} failed: ${merge.err || merge.out}`);
        return 2;
      }
      log(`drift-check: merging ${main} (${mainSha.out}) conflicts in:`);
      for (const file of conflicts.split('\n')) log(`  ${file}`);
      log('Merge main into the branch, resolve, push, and run this again.');
      return 1;
    }
    for (const rel of nodeModulesDirs(cwd)) {
      const link = path.join(dir, rel);
      if (!fs.existsSync(path.dirname(link)) || fs.existsSync(link)) continue;
      fs.symlinkSync(path.join(cwd, rel), link, 'junction');
    }
    log(`drift-check: trial merge of ${main} (${mainSha.out}) in a throwaway worktree.`);
    return runChecks(dir, checks, log, main, mainSha.out, true);
  } finally {
    process.off('SIGTERM', onSignal);
    process.off('SIGHUP', onSignal);
    cleanup();
  }
}

/**
 * @param {string} dir @param {typeof CHECKS} checks @param {(line: string) => void} log
 * @param {string} main @param {string} sha @param {boolean} merged
 */
function runChecks(dir, checks, log, main, sha, merged) {
  const failed = [];
  for (const check of checks) {
    const r = spawnSync(check.command, {
      cwd: path.join(dir, check.cwd ?? '.'),
      env: { ...process.env, CI: 'true' },
      shell: true,
      encoding: 'utf8',
    });
    if (r.signal || r.status === CTRL_C_EXIT) {
      log(`  stopped during ${check.name}`);
      return 130;
    }
    const ok = r.status === 0;
    log(`  ${ok ? 'ok  ' : 'FAIL'} ${check.name}`);
    if (!ok) {
      failed.push(check.name);
      const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n');
      for (const line of output.slice(-15)) log(`       ${line}`);
    }
  }
  if (failed.length === 0) {
    log(`drift-check: green with ${main} (${sha}).`);
    return 0;
  }
  log(
    merged
      ? `drift-check: ${failed.length} guard(s) fail once ${main} is merged in: merge main, fix, push.`
      : `drift-check: ${failed.length} guard(s) fail on this branch.`
  );
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--remote');
  const remote = at >= 0 ? args[at + 1] : undefined;
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  // Ctrl+C reaches the running guard too; staying alive lets `finally` remove the worktree.
  process.on('SIGINT', () => {});
  process.exit(runDriftCheck({ cwd: repoRoot, remote }));
}
