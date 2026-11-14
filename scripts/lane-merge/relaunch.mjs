// @ts-check
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  REMOTE,
  MAIN,
  EXIT_CI_FAILED,
  EXIT_HEAD_MOVED,
  EXIT_WAIT_TIMEOUT,
  ENV_FROM_MAIN,
  ENV_FETCHED,
} from './constants.mjs';
import { riskyListLines } from './risky.mjs';
import { firstLine, lf } from './run.mjs';

/** @import { Run } from './run.mjs' */

/** The folder next to the entry file that holds the gate modules. */
export const MODULE_DIR = 'lane-merge';

/**
 * The module files of main's gate (scripts/lane-merge/*), read through git: main's copy runs from a
 * temp folder, so the entry file needs them beside it.
 * @param {Run} run
 * @returns {{ error: string | null, files: { name: string, text: string }[] }}
 */
export function mainModules(run) {
  const prefix = `scripts/${MODULE_DIR}/`;
  const list = run('git', ['ls-tree', '-r', '--name-only', '--full-tree', MAIN, prefix]);
  if (list.status !== 0) {
    return {
      error: `git ls-tree ${MAIN} ${prefix} failed (${firstLine(list.stderr || list.stdout)}); the gate cannot read main's modules`,
      files: [],
    };
  }
  /** @type {{ name: string, text: string }[]} */
  const files = [];
  for (const rel of list.stdout.split(/\r?\n/).filter(Boolean)) {
    const shown = run('git', ['show', `${MAIN}:${rel}`]);
    if (shown.status !== 0) {
      return {
        error: `git show ${MAIN}:${rel} failed (${firstLine(shown.stderr || shown.stdout)}); the gate cannot read main's modules`,
        files: [],
      };
    }
    files.push({ name: rel.slice(prefix.length), text: shown.stdout });
  }
  return { error: null, files };
}

/**
 * Is this checkout's gate (the entry file and every module beside it) the same as main's, line
 * endings aside? A module that main lacks, or lacks here, makes them differ.
 * @param {string} selfPath @param {string} mainEntry @param {{ name: string, text: string }[]} mainFiles
 */
export function sameGate(selfPath, mainEntry, mainFiles) {
  if (lf(mainEntry) !== lf(fs.readFileSync(selfPath, 'utf8'))) return false;
  const dir = path.join(path.dirname(selfPath), MODULE_DIR);
  /** @type {string[]} */
  let local = [];
  try {
    local = fs
      .readdirSync(dir, { recursive: true })
      .map(String)
      .filter(n => fs.statSync(path.join(dir, n)).isFile());
  } catch {
    // no module folder here: differs unless main has none either
  }
  if (local.length !== mainFiles.length) return false;
  return mainFiles.every(m => {
    try {
      return lf(m.text) === lf(fs.readFileSync(path.join(dir, m.name), 'utf8'));
    } catch {
      return false;
    }
  });
}

/**
 * The gate judges a branch, so the branch must not judge itself: when this file differs from
 * aitool/main's copy, run main's copy (the entry file and scripts/lane-merge/* in a temp folder, same arguments and cwd) and return its
 * exit code. Main without a gate (bootstrap) runs this copy, with one line saying so. Skipped for the
 * copy that was itself started from main, and for `--train` (read only).
 * @param {{ argv: string[], run: Run, selfPath: string, env: Record<string, string | undefined>,
 *   tmpdir: string, cwd?: string, log: (line: string) => void,
 *   spawn?: typeof spawnSync, execPath?: string }} o
 * @returns {{ relaunched: boolean, code: number, fetched: boolean, error: string | null, killed?: string | null }}
 */
export function relaunchFromMain(o) {
  const {
    argv,
    run,
    selfPath,
    env,
    tmpdir,
    log,
    spawn = spawnSync,
    execPath = process.execPath,
  } = o;
  const same = { relaunched: false, code: 0, fetched: env[ENV_FETCHED] === '1', error: null };
  if (env[ENV_FROM_MAIN] === '1' || argv.includes('--train')) return same;
  const fetch = run('git', ['fetch', REMOTE, 'main']);
  if (fetch.status !== 0) {
    return {
      ...same,
      error: `git fetch ${REMOTE} main failed (${firstLine(fetch.stderr || fetch.stdout)}); the gate cannot compare itself with main`,
    };
  }
  const show = run('git', ['show', `${MAIN}:scripts/lane-merge.mjs`]);
  if (show.status !== 0) {
    log(`lane:merge: ${MAIN} has no merge gate yet (bootstrap); running this checkout's copy`);
    return { ...same, fetched: true };
  }
  const parts = mainModules(run);
  if (parts.error) return { ...same, error: parts.error };
  if (sameGate(selfPath, show.stdout, parts.files)) return { ...same, fetched: true };
  const dir = fs.mkdtempSync(path.join(tmpdir, 'lane-merge-main-'));
  const file = path.join(dir, 'lane-merge.mjs');
  fs.writeFileSync(file, show.stdout);
  fs.mkdirSync(path.join(dir, MODULE_DIR), { recursive: true });
  for (const m of parts.files) {
    const target = path.join(dir, MODULE_DIR, m.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, m.text);
  }
  log(`lane:merge: this checkout's gate differs from ${MAIN}; running main's copy`);
  const r = spawn(execPath, [file, ...argv], {
    cwd: o.cwd ?? process.cwd(),
    stdio: 'inherit',
    env: { ...env, [ENV_FROM_MAIN]: '1', [ENV_FETCHED]: '1' },
  });
  // A child that was killed (a signal, or a caller's timeout) has no exit status; say so.
  const killed =
    r.status == null
      ? r.error
        ? `main's copy of the gate could not run (${r.error.message})`
        : `main's copy of the gate was killed (${r.signal ?? 'no exit status'})`
      : null;
  return { relaunched: true, code: r.status ?? 1, fetched: true, error: null, killed };
}

/**
 * The last line of every refusal (under `--wait-ci` the one before the `wait-ci ended:` verdict
 * line): every reason on one line, so a `tail` of the output shows why and not only the notices.
 * Several reasons are numbered (a reason can hold `;` itself).
 * @param {string[]} reasons
 */
export function refusedBecause(reasons) {
  const all = reasons.map(r => r.replace(/\s*\r?\n\s*/g, ' ').trim()).filter(Boolean);
  if (all.length === 0) return 'lane:merge: refused because of an unknown reason';
  if (all.length === 1) return `lane:merge: refused because ${all[0]}`;
  return `lane:merge: refused because ${all.map((r, i) => `(${i + 1}) ${r}`).join(' ')}`;
}

/** What each exit code of the gate means, for the `--wait-ci` verdict line. */
export const EXIT_REASONS = /** @type {Record<number, string>} */ ({
  0: 'ok (checks pass or merged)',
  1: 'refused (the "refused because" line above says why)',
  2: 'usage error',
  [EXIT_CI_FAILED]: 'a CI check failed',
  [EXIT_HEAD_MOVED]: 'the PR head moved while waiting',
  [EXIT_WAIT_TIMEOUT]: 'timed out waiting for CI',
});

/**
 * The one line a `--wait-ci` run ends with, whatever happened. Read it, not the exit code of a pipe.
 * @param {number} code @param {string} [reason] overrides the reason of the code
 */
export function verdictLine(code, reason) {
  return `lane:merge: wait-ci ended: exit ${code}, ${reason ?? EXIT_REASONS[code] ?? 'unknown'}`;
}

/**
 * The entry point's work: relaunch from main or run this copy, and for `--wait-ci` end with exactly
 * one verdict line. The relaunched child prints its own, so the parent adds one only when the child
 * ended without a status (a signal) or this process threw.
 * @param {{ argv: string[], relaunch: () => ReturnType<typeof relaunchFromMain>,
 *   runMain: (fetched: boolean) => number, log: (line: string) => void }} o
 * @returns {number} the process exit code
 */
export function runEntry({ argv, relaunch, runMain, log }) {
  if (argv.includes('--risky-list')) {
    if (argv.length !== 1) {
      log('lane:merge: --risky-list takes no other argument');
      return 2;
    }
    log('lane:merge: the Opus list of this checkout (the gate judges by main copy):');
    for (const line of riskyListLines()) log(line);
    return 0;
  }
  const wait = argv.includes('--wait-ci');
  try {
    const gate = relaunch();
    if (gate.error) {
      log(`lane:merge: NOT merged: ${gate.error}`);
      log(refusedBecause([gate.error]));
      if (wait) log(verdictLine(1, gate.error));
      return 1;
    }
    if (gate.relaunched) {
      if (gate.killed) log(refusedBecause([gate.killed]));
      if (wait && gate.killed) log(verdictLine(gate.code, gate.killed));
      return gate.code;
    }
    const code = runMain(gate.fetched);
    if (wait) log(verdictLine(code));
    return code;
  } catch (e) {
    const reason = `unexpected error: ${e instanceof Error ? e.message : String(e)}`;
    if (e instanceof Error && e.stack) console.error(e.stack);
    log(`lane:merge: NOT merged: ${reason}`);
    log(refusedBecause([reason]));
    if (wait) log(verdictLine(1, reason));
    return 1;
  }
}

/**
 * Is this module the script node was started with? Real paths on both sides, so a junction or a
 * drive-letter case cannot turn into a silent exit 0.
 * @param {string | undefined} argv1 @param {string} self
 */
export function isEntryModule(argv1, self) {
  if (!argv1) return false;
  const norm = (/** @type {string} */ p) => {
    let r;
    try {
      r = fs.realpathSync(p);
    } catch {
      r = path.resolve(p);
    }
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(argv1) === norm(self);
}

/**
 * 'run' when started directly, 'import' when another module loaded it, 'mismatch' when the started
 * file has this file's name but is not this file (the process must then fail, not exit 0 silently).
 * @param {string | undefined} argv1 @param {string} self
 */
export function entryDecision(argv1, self) {
  if (isEntryModule(argv1, self)) return 'run';
  if (argv1 && path.basename(argv1).toLowerCase() === path.basename(self).toLowerCase()) {
    return 'mismatch';
  }
  return 'import';
}
