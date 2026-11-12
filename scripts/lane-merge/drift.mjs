// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAIN } from './constants.mjs';

/** @import { Run } from './run.mjs' */

/** Run by `node -e`: import main's drift-check copy and run it in the current folder. */
export const DRIFT_RUNNER =
  'import(process.argv[1]).then(m => process.exit(m.runDriftCheck({ cwd: process.cwd() })), e => { console.error(String(e)); process.exit(1); });';

/** Does a module import another file of the repo (relative specifier)? @param {string} text */
export function hasRelativeImports(text) {
  return (
    /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+['"]\.{1,2}\//.test(text) ||
    /\bimport\s*\(\s*['"]\.{1,2}\//.test(text) ||
    /(?:^|\n)\s*import\s+['"]\.{1,2}\//.test(text)
  );
}

/**
 * drift-check from main's copy (a temp file), not the branch's own `npm run drift:check`: the branch
 * could have edited either. Falls back to the local script, with a note, when main's copy has no
 * `runDriftCheck` export or imports other repo files.
 * @param {Run} run @param {string} tmpdir @param {string[]} notes
 */
export function runDrift(run, tmpdir, notes) {
  const show = run('git', ['show', `${MAIN}:scripts/drift-check.mjs`]);
  if (show.status !== 0) {
    notes.push(
      `drift-check: ${MAIN} has no scripts/drift-check.mjs yet; using this checkout's npm run drift:check`
    );
    return run('npm', ['run', 'drift:check']);
  }
  if (hasRelativeImports(show.stdout) || !/export function runDriftCheck\b/.test(show.stdout)) {
    notes.push(
      `drift-check: main's copy imports other repo files or lacks runDriftCheck; using this checkout's npm run drift:check`
    );
    return run('npm', ['run', 'drift:check']);
  }
  const dir = fs.mkdtempSync(path.join(tmpdir, 'lane-merge-drift-'));
  const file = path.join(dir, 'drift-check.mjs');
  fs.writeFileSync(file, show.stdout);
  // One high-priority heavy-check hold around the whole drift run, from main's copy of the lock (as
  // for drift-check, the branch must not bring its own): the guards inside see the held marker and
  // do not queue again each, so a merge never waits behind a green once per guard.
  const lock = run('git', ['show', `${MAIN}:scripts/heavy-lock.mjs`]);
  if (lock.status !== 0 || hasRelativeImports(lock.stdout) || /"/.test(dir)) {
    notes.push(
      `drift-check: no usable scripts/heavy-lock.mjs on ${MAIN}; each heavy guard takes the lock on its own`
    );
    return run('node', ['--input-type=module', '-e', DRIFT_RUNNER, pathToFileURL(file).href]);
  }
  // The lock runs its command through the shell, so the runner is a file (no quotes in the command).
  // The lock's entry check compares file names: it must be called heavy-lock.mjs.
  const lockFile = path.join(dir, 'heavy-lock.mjs');
  const runner = path.join(dir, 'drift-run.mjs');
  fs.writeFileSync(lockFile, lock.stdout);
  fs.writeFileSync(
    runner,
    DRIFT_RUNNER.replace('process.argv[1]', JSON.stringify(pathToFileURL(file).href))
  );
  return run('node', [
    lockFile,
    'run',
    '--label',
    'drift-check (merge gate)',
    '--priority',
    'high',
    '--',
    'node',
    `"${runner}"`,
  ]);
}
