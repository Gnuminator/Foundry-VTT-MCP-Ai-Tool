#!/usr/bin/env node
/**
 * Drift check: run before posting "PR ready". Lanes merge in parallel, and some guards only fail
 * once another lane's PR is on main: tool counts and sizes in the docs, the generated tool
 * reference, the lint and em-dash baselines, the changelog fragments, the usage catalog. This
 * script tries the branch merged with the newest main, runs those guards on the result, and puts
 * the branch back exactly as it was. It never commits or pushes.
 *
 *   npm run drift:check                  fetch main, trial-merge it, run the guards, undo the merge
 *   npm run drift:check -- --remote NAME use this remote (default: local main's remote, else origin)
 *
 * It needs a clean working tree (commit first). A merge conflict is reported and undone: merge
 * main into the branch yourself, resolve, push, and run it again. When main changed
 * package-lock.json, run `npm ci` after merging; the guards here run on your current node_modules.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** The guards that fail when two PRs are each green alone but not together. */
export const CHECKS = [
  { name: 'lint baseline', command: 'npm run lint:ratchet' },
  { name: 'em-dash baseline', command: 'npm run emdash:ratchet' },
  { name: 'changelog fragments', command: 'npm run changelog:check' },
  { name: 'usage catalog', command: 'npm run usage:catalog:check' },
  { name: 'version sync', command: 'npm run version:check' },
  {
    name: 'tool counts and tool reference',
    command: 'npx vitest run src/tool-catalog.test.ts src/tool-reference.test.ts',
    cwd: 'packages/mcp-server',
  },
];

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/** The remote to take main from: --remote, else local main's remote, else origin. */
export function pickRemote(cwd, wanted) {
  if (wanted) return wanted;
  const upstream = git(cwd, ['config', '--get', 'branch.main.remote']);
  return upstream.ok && upstream.out ? upstream.out : 'origin';
}

/**
 * Runs the drift check in the repo at `cwd`. Returns the exit code (0 all green, 1 a guard failed
 * or a conflict, 2 it could not start). `checks` and `log` are replaceable for tests.
 * @param {{ cwd: string, remote?: string, checks?: typeof CHECKS, log?: (line: string) => void, fetch?: boolean }} opts
 */
export function runDriftCheck({ cwd, remote, checks = CHECKS, log = console.log, fetch = true }) {
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
  if (fetch) {
    const fetched = git(cwd, ['fetch', '--quiet', name, 'main']);
    if (!fetched.ok) {
      log(`drift-check: git fetch ${name} main failed: ${fetched.err}`);
      return 2;
    }
  }
  const main = `${name}/main`;
  const mainSha = git(cwd, ['rev-parse', '--short', main]);
  if (!mainSha.ok) {
    log(`drift-check: ${main} not found; pass --remote NAME.`);
    return 2;
  }

  const upToDate = git(cwd, ['merge-base', '--is-ancestor', main, 'HEAD']).ok;
  let merged = false;
  if (upToDate) {
    log(`drift-check: the branch already contains ${main} (${mainSha.out}).`);
  } else {
    const lockChanged = !git(cwd, ['diff', '--quiet', 'HEAD', main, '--', 'package-lock.json']).ok;
    const merge = git(cwd, ['merge', '--no-commit', '--no-ff', main]);
    if (!merge.ok) {
      const conflicts = git(cwd, ['diff', '--name-only', '--diff-filter=U']).out;
      git(cwd, ['merge', '--abort']);
      if (!conflicts) {
        log(`drift-check: git merge ${main} failed: ${merge.err || merge.out}`);
        return 2;
      }
      log(`drift-check: merging ${main} (${mainSha.out}) conflicts in:`);
      for (const file of conflicts.split('\n')) log(`  ${file}`);
      log('Merge main into the branch, resolve, push, and run this again.');
      return 1;
    }
    merged = true;
    log(`drift-check: trial merge of ${main} (${mainSha.out}), undone at the end.`);
    if (lockChanged) log('  main changed package-lock.json: run `npm ci` after the real merge.');
  }

  const failed = [];
  try {
    for (const check of checks) {
      const r = spawnSync(check.command, {
        cwd: path.join(cwd, check.cwd ?? '.'),
        env: { ...process.env, CI: 'true' },
        shell: true,
        encoding: 'utf8',
      });
      if (r.signal) {
        // Ctrl-C reaches the guard too: stop here, and let `finally` undo the trial merge.
        log(`  stopped (${r.signal}) during ${check.name}`);
        failed.push(check.name);
        break;
      }
      const ok = r.status === 0;
      log(`  ${ok ? 'ok  ' : 'FAIL'} ${check.name}`);
      if (!ok) {
        failed.push(check.name);
        const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n');
        for (const line of output.slice(-15)) log(`       ${line}`);
      }
    }
  } finally {
    if (merged) {
      const undone = git(cwd, ['merge', '--abort']);
      if (!undone.ok) log(`drift-check: could not undo the trial merge: ${undone.err}`);
    }
  }

  if (failed.length === 0) {
    log(`drift-check: green with ${main} (${mainSha.out}).`);
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
  // Survive Ctrl-C long enough to undo the trial merge (the running guard gets it and stops).
  process.on('SIGINT', () => {});
  process.exit(runDriftCheck({ cwd: repoRoot, remote }));
}
