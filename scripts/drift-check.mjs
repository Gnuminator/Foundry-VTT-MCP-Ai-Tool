#!/usr/bin/env node
/**
 * Drift check: run before posting "PR ready". Lanes merge in parallel, and some guards only fail
 * once another lane's PR is on main: tool counts and sizes in the docs, the generated tool
 * reference, the tool-set budgets, the lint and em-dash baselines, the changelog fragments, the
 * usage catalog, the docs links, and (when the branch or main touched the dashboard or shared) the
 * dashboard build and bundle budget. This script merges the newest main into a copy of the branch in a
 * throwaway git worktree, runs those guards there, and removes the worktree. The lane's tracked
 * files are never touched (only gitignored build output is rebuilt: a missing or stale `shared/dist`, and `packages/cogm-dashboard/dist` when a branch that already has main runs the dashboard build in place), and nothing is committed or pushed.
 *
 *   npm run drift:check                  fetch main, trial-merge it aside, run the guards
 *   npm run drift:check -- --remote NAME take main from this remote
 *
 * The remote is --remote, else the one local main tracks, else `aitool`, else a remote whose URL
 * is this repository. It checks the last commit, so it needs a clean working tree (commit first).
 * A merge conflict names the files: merge main into the branch yourself, resolve, push, and run it
 * again. The worktree borrows this checkout's node_modules (junctions); when main changed
 * package-lock.json those would not match, so it asks for the real merge and `npm ci` first (a
 * lockfile change made by the branch itself does not count). The workspace links (`@gnuminator/*`)
 * point at this checkout's own packages, and `@gnuminator/shared` is consumed through its build
 * (`shared/dist`): when the merge changed `shared/`, the worktree gets its own workspace links and
 * builds its own `shared`, so the guards test the merged tree against a shared built from it. Before
 * any of that, a checkout whose `shared/dist` is missing or older than `shared/src` gets `shared`
 * built (ensureSharedBuilt), so a lane that never built it does not fail the mcp-server tests. A worktree left by a killed run is removed by the next run; one whose run is still
 * alive (another lane's, same repository) and younger than an hour is left alone.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A guard with `when` runs only if the branch or main since the merge base changed a file under it. */
const DASHBOARD_PATH = ['packages/cogm-dashboard/', 'shared/']; // the web bundle imports shared/src

/** The guards that fail when two PRs are each green alone but not together. */
export const CHECKS = [
  { name: 'lint baseline', command: 'npm run lint:ratchet', heavy: true },
  { name: 'em-dash baseline', command: 'npm run emdash:ratchet' },
  { name: 'changelog fragments', command: 'npm run changelog:check' },
  { name: 'usage catalog', command: 'npm run usage:catalog:check' },
  { name: 'version sync', command: 'npm run version:check' },
  { name: 'docs lint', command: 'npm run docs:lint' },
  { name: 'docs links', command: 'npm run docs:links' },
  {
    name: 'mcp-server tests (tool counts, tool reference, tool sets)',
    // The probe test runs the built dist/index.js, which the merged worktree never builds;
    // CI and `npm run green` run it after a build.
    command: 'npx vitest run --exclude src/mcp-modern-probe.test.ts',
    cwd: 'packages/mcp-server',
    heavy: true,
  },
  {
    name: 'module write gate',
    command: 'npx vitest run src/write-gate.test.ts',
    cwd: 'packages/foundry-module',
    heavy: true,
  },
  // The dashboard first-load budget is a limit two PRs can overflow together while each fits alone
  // (#642 and #648 turned main red for 11.5 hours on 2026-10-30). The build and the budget run on
  // the merged tree, and only when the branch or main since the merge base touched the dashboard.
  {
    name: 'dashboard build',
    command: 'npm run build -w @gnuminator/cogm-dashboard',
    heavy: true,
    when: DASHBOARD_PATH,
  },
  {
    name: 'dashboard bundle budget',
    command: 'npm run bundle:budget -w @gnuminator/cogm-dashboard',
    when: DASHBOARD_PATH,
    needs: 'dashboard build',
  },
];

const REPO_URL = /github\.com[/:]Gnuminator\/Foundry-VTT-MCP-Ai-Tool(\.git)?$/i;
const WORKTREE_PREFIX = 'drift-check-';
/** Written into each drift-check worktree: the pid of the run that owns it. */
const PID_FILE = '.drift-check-pid';
/** A drift-check worktree older than this is abandoned even if its pid was reused. */
const STALE_MS = 60 * 60 * 1000;
/** How the merged tree's `shared` is built, run in its `shared` folder. */
const SHARED_BUILD = 'npm run build';
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
  unlinkOwnModules(path.join(dir, 'node_modules'));
  git(cwd, ['worktree', 'remove', '--force', dir]);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  git(cwd, ['worktree', 'prune']);
}

/**
 * A worktree's own root node_modules (see `linkOwnWorkspace`) holds only junctions: unlinks them,
 * and those of its `@gnuminator` folder, so removing the folder never reaches a target.
 * @param {string} modules
 */
function unlinkOwnModules(modules) {
  try {
    if (fs.lstatSync(modules).isSymbolicLink()) return;
    for (const entry of fs.readdirSync(modules)) {
      const p = path.join(modules, entry);
      if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p);
      else if (entry === '@gnuminator') unlinkOwnModules(p);
    }
  } catch {
    // not there
  }
}

/** @param {string} dir */
function listPackages(dir) {
  try {
    return fs.readdirSync(path.join(dir, 'packages'));
  } catch {
    return [];
  }
}

/** @param {number} pid */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM';
  }
}

/**
 * Whether a drift-check worktree is abandoned: its run's pid is gone, or it is older than an hour.
 * Lanes share one repository's worktree list, so a live run of another lane must stay. A worktree
 * with no pid file yet (just created) is judged by its age alone.
 * @param {string} dir
 */
function isStale(dir) {
  const file = path.join(dir, PID_FILE);
  try {
    const age = Date.now() - fs.statSync(file).mtimeMs;
    const pid = Number.parseInt(fs.readFileSync(file, 'utf8'), 10);
    return age > STALE_MS || !Number.isInteger(pid) || !pidAlive(pid);
  } catch {
    try {
      return Date.now() - fs.statSync(dir).mtimeMs > STALE_MS;
    } catch {
      return true; // the folder is gone; only git's record is left
    }
  }
}

/**
 * Points the worktree's `@gnuminator/*` workspace links at the worktree's own packages, not this
 * checkout's: its root node_modules becomes a real folder of junctions to this checkout's entries,
 * except `@gnuminator`. @param {string} cwd @param {string} dir
 */
function linkOwnWorkspace(cwd, dir) {
  const own = path.join(dir, 'node_modules');
  const borrowed = path.join(cwd, 'node_modules');
  fs.unlinkSync(own); // the junction to the borrowed folder
  fs.mkdirSync(own);
  for (const entry of fs.readdirSync(borrowed)) {
    if (entry === '@gnuminator') continue;
    const from = path.join(borrowed, entry);
    if (fs.statSync(from).isDirectory()) fs.symlinkSync(from, path.join(own, entry), 'junction');
  }
  const scope = path.join(own, '@gnuminator');
  fs.mkdirSync(scope);
  for (const name of fs.readdirSync(path.join(borrowed, '@gnuminator'))) {
    const target = [
      path.join(dir, name === 'shared' ? 'shared' : path.join('packages', name)),
    ].find(d => fs.existsSync(path.join(d, 'package.json')));
    if (target) fs.symlinkSync(target, path.join(scope, name), 'junction');
  }
}

/**
 * The guards read `@gnuminator/shared` through its build. When the merge changed `shared/`, the
 * borrowed build is out of date (a PR that added an export, merged under one that did not), so the
 * worktree gets its own workspace links and builds its own shared. Returns an error text, or null.
 * @param {string} cwd @param {string} dir @param {string} buildCommand
 * @param {(line: string) => void} log
 */
function buildMergedShared(cwd, dir, buildCommand, log) {
  if (git(dir, ['diff', '--quiet', 'HEAD', '--', 'shared']).ok) return null;
  if (!fs.existsSync(path.join(cwd, 'node_modules', '@gnuminator'))) return null;
  linkOwnWorkspace(cwd, dir);
  log('drift-check: the merge changed shared/; building shared in the worktree.');
  const r = spawnSync(buildCommand, {
    cwd: path.join(dir, 'shared'),
    shell: true,
    encoding: 'utf8',
  });
  if (r.status === 0) return null;
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n');
}

/** Newest mtime of any file under `dir` (0 when there is none). @param {string} dir */
function newestMtime(dir) {
  let newest = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return newest;
}

/** The package entry named by `main` in shared/package.json, or null. @param {string} shared */
function sharedEntry(shared) {
  try {
    const main = JSON.parse(fs.readFileSync(path.join(shared, 'package.json'), 'utf8')).main;
    return typeof main === 'string' ? path.join(shared, main) : null;
  } catch {
    return null;
  }
}

/**
 * The guards read `@gnuminator/shared` through its build (`shared/dist`). A lane checkout whose
 * dist is missing or older than `shared/src` (a docs-only lane that never built it) would fail the
 * mcp-server tests with "Failed to resolve entry", so it is built here first. Returns an error
 * text, or null. @param {string} cwd @param {string} buildCommand @param {(line: string) => void} log
 */
export function ensureSharedBuilt(cwd, buildCommand, log) {
  const shared = path.join(cwd, 'shared');
  if (!fs.existsSync(path.join(shared, 'package.json')) || !fs.existsSync(path.join(shared, 'src'))) {
    return null;
  }
  const dist = path.join(shared, 'dist');
  const entry = sharedEntry(shared);
  const distTime = entry && !fs.existsSync(entry) ? 0 : newestMtime(dist);
  if (distTime && distTime >= newestMtime(path.join(shared, 'src'))) return null;
  if (!fs.existsSync(path.join(cwd, 'node_modules'))) {
    return 'shared/dist is missing or out of date and node_modules is missing: run npm ci, then npm run build -w @gnuminator/shared';
  }
  log(`drift-check: shared/dist is ${distTime ? 'older than shared/src' : 'missing'}; building shared.`);
  const r = spawnSync(buildCommand, { cwd: shared, shell: true, encoding: 'utf8' });
  if (r.status === 0) {
    if (entry && !fs.existsSync(entry)) {
      return `the build ran but emitted no ${path.relative(cwd, entry).replaceAll('\\', '/')}; delete shared/*.tsbuildinfo and run again`;
    }
    // shared is `composite`: tsc skips outputs whose content did not change, so a touched src could
    // leave dist older than src for good. The stamp records that the build ran after the sources.
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, '.built-stamp'), new Date().toISOString());
    return null;
  }
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n');
}

/**
 * Files changed on the branch, or on main, since their merge base. Null when git cannot tell, which
 * runs every guard. @param {string} cwd @param {string} main
 */
function changedFiles(cwd, main) {
  const base = git(cwd, ['merge-base', 'HEAD', main]);
  if (!base.ok) return null;
  const files = [];
  for (const tip of ['HEAD', main]) {
    const d = git(cwd, ['-c', 'core.quotePath=false', 'diff', '--name-only', '--no-renames', base.out, tip]);
    if (!d.ok) return null;
    files.push(...d.out.split('\n').filter(Boolean));
  }
  return files;
}

/** Worktrees a killed run left behind. @param {string} cwd */
function staleWorktrees(cwd) {
  return git(cwd, ['worktree', 'list', '--porcelain'])
    .out.split('\n')
    .filter(l => l.startsWith('worktree '))
    .map(l => l.slice('worktree '.length))
    .filter(p => path.basename(p).startsWith(WORKTREE_PREFIX))
    .filter(isStale);
}

/**
 * Runs the drift check for the repo at `cwd`. Returns the exit code (0 all green, 1 a guard failed
 * or a conflict, 2 it could not start, 130 stopped). `checks` and `log` are replaceable for tests.
 * @param {{ cwd: string, remote?: string, checks?: typeof CHECKS, log?: (line: string) => void, sharedBuild?: string }} opts
 */
export function runDriftCheck({
  cwd,
  remote,
  checks = CHECKS,
  log = console.log,
  sharedBuild = SHARED_BUILD,
}) {
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

  const sharedError = ensureSharedBuilt(cwd, sharedBuild, log);
  if (sharedError !== null) {
    log('drift-check: shared is not built and building it failed:');
    log(sharedError);
    return 2;
  }

  if (git(cwd, ['merge-base', '--is-ancestor', main, 'HEAD']).ok) {
    log(`drift-check: the branch already contains ${main} (${mainSha.out}).`);
    return runChecks(cwd, checks, log, main, mainSha.out, false, changedFiles(cwd, main));
  }

  // The worktree borrows this checkout's node_modules, which would not match main's lockfile (a
  // new ESLint, say) and give false results. Only a lockfile change on main since the branch point
  // counts: a branch that bumped a dependency itself still matches its own node_modules.
  const base = git(cwd, ['merge-base', 'HEAD', main]);
  if (!base.ok || !git(cwd, ['diff', '--quiet', base.out, main, '--', 'package-lock.json']).ok) {
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
    fs.writeFileSync(path.join(dir, PID_FILE), String(process.pid));
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
    const buildError = buildMergedShared(cwd, dir, sharedBuild, log);
    if (buildError !== null) {
      log('drift-check: building shared from the merged tree failed:');
      log(buildError);
      return 1;
    }
    log(`drift-check: trial merge of ${main} (${mainSha.out}) in a throwaway worktree.`);
    return runChecks(dir, checks, log, main, mainSha.out, true, changedFiles(cwd, main));
  } finally {
    process.off('SIGTERM', onSignal);
    process.off('SIGHUP', onSignal);
    cleanup();
  }
}

/**
 * A heavy guard runs through the heavy-check lock (scripts/heavy-lock.mjs in the merged tree), so
 * two drift checks, a green and a lint ratchet take turns instead of loading the PC together. The
 * lock is reached through its CLI, not an import: the merge gate runs a copy of this file that may
 * not import other repo files. A tree without the script (main before the lock existed) runs the
 * guard as it always did.
 * @param {{ name: string, command: string, heavy?: boolean }} check @param {string} dir
 */
export function lockedCommand(check, dir) {
  const script = path.join(dir, 'scripts', 'heavy-lock.mjs');
  // The command goes through the shell twice, so only plain words are wrapped (as green's isShellSafe).
  if (!check.heavy || !fs.existsSync(script) || !/^[\w .:/@=-]+$/.test(check.command)) {
    return check.command;
  }
  const label = `drift-check ${check.name.split('(')[0].replace(/[^\w -]/g, '').trim()}`;
  // High priority: a merge waits on it, so it goes ahead of queued greens (an older lock ignores the flag).
  return `node "${script}" run --label "${label}" --priority high -- ${check.command}`;
}

/**
 * @param {string} dir @param {typeof CHECKS} checks @param {(line: string) => void} log
 * @param {string} main @param {string} sha @param {boolean} merged
 * @param {string[] | null} [changed] files changed since the merge base; null runs every guard
 */
export function runChecks(dir, checks, log, main, sha, merged, changed = null) {
  const failed = [];
  for (const check of checks) {
    const when = check.when ? [check.when].flat() : null;
    if (when && changed && !changed.some(f => when.some(p => f.startsWith(p)))) {
      log(`  skip ${check.name} (nothing under ${when.join(' or ')} changed)`);
      continue;
    }
    if (check.needs && failed.includes(check.needs)) {
      log(`  skip ${check.name} (${check.needs} failed)`);
      continue;
    }
    const r = spawnSync(lockedCommand(check, dir), {
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
    // The tool-set size test prints how much room each set has left; show it, and mark a low one.
    for (const line of `${r.stdout ?? ''}`.split('\n')) {
      const m = /tool-set headroom: .*/.exec(line);
      if (m) log(`       ${m[0].trim()}`);
      // The heavy-check lock says when this guard waited its turn.
      if (line.startsWith('heavy-lock:')) log(`       ${line.trim()}`);
    }
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
