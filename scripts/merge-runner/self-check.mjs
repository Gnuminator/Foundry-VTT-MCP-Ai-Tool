/**
 * The merge runner keeps its own code in memory (D-140): after a PR changes scripts/merge-runner.mjs
 * or a module it imports, a runner that was started earlier keeps running the old code. This module
 * lets the runner notice that at the start of a round and start itself again.
 *
 *   - `importClosure` lists the runner's own files: the entry plus every file it (transitively)
 *     imports by a relative specifier, as loaded from disk at start.
 *   - `makeSelfCheck` fingerprints them once at start (git blob shas, so the CRLF checkout of
 *     Windows hashes like the repository does) and, each round, fetches aitool/main and compares.
 *   - Different: it brings the main checkout to aitool/main (fast-forward only, branch main, no
 *     tracked changes), checks the files on disk now match main, and answers `restart`. Anything
 *     that stops that (not on main, dirty, no fast-forward, a mismatch after it) answers `stop`.
 *   - `reexec` is the restart: the scheduled task has no restart count, so the old process runs the
 *     new code as a child (same arguments, same output) and exits with the child's code.
 *
 * Not covered on purpose: scripts/backlog.mjs runs as its own process each time (so it reads the
 * pulled file), and the gate and the Discord sender run from `git show aitool/main:` copies.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Restarts nested in one task run before the runner stops and asks for a manual start. */
export const MAX_RESTART_DEPTH = 20;
/** Environment variable that carries the nesting depth to the child. */
export const DEPTH_ENV = 'MERGE_RUNNER_DEPTH';
/** The exit code `main` returns when the process should start itself again. */
export const EXIT_RESTART = 75;

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)(['"])(\.{1,2}\/[^'"]+)\1/gm;

/**
 * The entry file and every file it imports (static, `export from`, dynamic with a literal) by a
 * relative specifier, transitively, as `/` separated paths relative to `repoRoot`, sorted.
 * @param {string} entry absolute path @param {string} repoRoot
 * @param {(file: string) => string} [read]
 * @returns {string[]}
 */
export function importClosure(entry, repoRoot, read = f => fs.readFileSync(f, 'utf8')) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Set<string>} */
  const missing = new Set();
  const todo = [path.resolve(entry)];
  while (todo.length) {
    const file = /** @type {string} */ (todo.pop());
    if (seen.has(file) || missing.has(file)) continue;
    let text;
    try {
      text = read(file);
    } catch {
      // A specifier in a comment or string that names no file: not a runner file.
      missing.add(file);
      continue;
    }
    seen.add(file);
    for (const m of text.matchAll(SPECIFIER)) {
      const target = path.resolve(path.dirname(file), m[2]);
      if (/\.(mjs|js|cjs)$/.test(target)) todo.push(target);
    }
  }
  return [...seen]
    .map(f => path.relative(repoRoot, f).split(path.sep).join('/'))
    .filter(f => !f.startsWith('..'))
    .sort();
}

/**
 * @typedef {{ status: number, stdout: string, stderr: string }} Ran
 * @typedef {(args: string[]) => Ran} Git runs `git` in the runner's own checkout
 */

/**
 * Blob shas of files as they are on disk (clean filters applied, so CRLF checkouts match).
 * Null when git cannot answer.
 * @param {Git} git @param {string[]} files @returns {Map<string, string> | null}
 */
export function diskShas(git, files) {
  const r = git(['hash-object', '--', ...files]);
  const shas = r.stdout.split(/\r?\n/).filter(Boolean);
  if (r.status !== 0 || shas.length !== files.length) return null;
  return new Map(files.map((f, i) => [f, shas[i]]));
}

/**
 * Blob shas of files on `ref`. A file missing there is left out of the map.
 * @param {Git} git @param {string} ref @param {string[]} files @returns {Map<string, string> | null}
 */
export function refShas(git, ref, files) {
  const r = git(['ls-tree', ref, '--', ...files]);
  if (r.status !== 0) return null;
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const line of r.stdout.split(/\r?\n/).filter(Boolean)) {
    const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (m) out.set(m[2], m[1]);
  }
  return out;
}

/**
 * Files whose sha differs from main's (or that main no longer has).
 * @param {Map<string, string>} loaded @param {Map<string, string>} onMain
 */
export const changedFiles = (loaded, onMain) =>
  [...loaded].filter(([f, sha]) => onMain.get(f) !== sha).map(([f]) => f);

/**
 * Bring the main checkout to `ref`: only a clean fast-forward of the checked-out branch `main`.
 * Returns a problem, or null.
 * @param {Git} git @param {string} ref
 */
export function updateCheckout(git, ref) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch.status !== 0 || branch.stdout.trim() !== 'main') {
    return `the runner's checkout is on ${branch.stdout.trim() || 'an unknown branch'}, not main`;
  }
  const dirty = git(['status', '--porcelain', '--untracked-files=no']);
  if (dirty.status !== 0 || dirty.stdout.trim())
    return 'the runner checkout has uncommitted changes';
  const merged = git(['merge', '--ff-only', '-q', ref]);
  if (merged.status !== 0) {
    return `git merge --ff-only ${ref} failed (${(merged.stderr || merged.stdout).trim().split(/\r?\n/)[0]})`;
  }
  return null;
}

/**
 * @typedef {{ action: 'restart' | 'stop', why: string, files: string[] }} SelfCheckResult
 */

/**
 * The per-round check. `loaded` is fixed when the runner started. Returns null when nothing changed
 * (or main cannot be read this round: a warning is logged and the next round tries again).
 * @param {{
 *   loaded: Map<string, string>,
 *   fetchMain: () => string | null,
 *   mainShas: (files: string[]) => Map<string, string> | null,
 *   update: () => string | null,
 *   diskShas: (files: string[]) => Map<string, string> | null,
 *   log: (line: string) => void,
 * }} d
 * @returns {SelfCheckResult | null}
 */
export function selfCheck(d) {
  const files = [...d.loaded.keys()];
  const problem = d.fetchMain();
  if (problem) {
    d.log(`WARNING: code check skipped: ${problem}`);
    return null;
  }
  const onMain = d.mainShas(files);
  if (!onMain) {
    d.log('WARNING: code check skipped: could not read the runner files on main');
    return null;
  }
  const changed = changedFiles(d.loaded, onMain);
  if (!changed.length) return null;
  const list = changed.join(', ');
  const failed = d.update();
  if (failed) {
    return {
      action: 'stop',
      why: `its code changed on main (${list}) but the checkout could not be updated: ${failed}`,
      files: changed,
    };
  }
  const now = d.diskShas(files);
  if (!now || changedFiles(now, onMain).length) {
    return {
      action: 'stop',
      why: `its code changed on main (${list}) but the checkout still differs from main after the update`,
      files: changed,
    };
  }
  return {
    action: 'restart',
    why: `its code changed on main (${list}); starting again`,
    files: changed,
  };
}

/**
 * The real check for a runner whose entry file is `entry` in the checkout `repoRoot`. Fingerprints
 * the files now; returns a function for `Deps.selfCheck`, or null when git cannot fingerprint them.
 * @param {{ entry: string, repoRoot: string, ref: string, remote: string, branch: string,
 *   log: (line: string) => void, run?: (args: string[], cwd: string) => Ran }} o
 * @returns {(() => SelfCheckResult | null) | null}
 */
export function makeSelfCheck(o) {
  const run =
    o.run ??
    ((args, cwd) => {
      const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120_000 });
      return {
        status: r.status ?? 1,
        stdout: r.stdout ?? '',
        stderr: r.stderr ?? r.error?.message ?? '',
      };
    });
  /** @type {Git} */
  const git = args => run(args, o.repoRoot);
  const files = importClosure(o.entry, o.repoRoot);
  const loaded = diskShas(git, files);
  if (!loaded) {
    o.log('WARNING: could not fingerprint the runner files; the code check is off');
    return null;
  }
  return () =>
    selfCheck({
      loaded,
      fetchMain: () => {
        const r = git(['fetch', '-q', o.remote, o.branch]);
        return r.status === 0 ? null : `git fetch ${o.remote} ${o.branch} failed`;
      },
      mainShas: f => refShas(git, o.ref, f),
      update: () => updateCheckout(git, o.ref),
      diskShas: f => diskShas(git, f),
      log: o.log,
    });
}

/**
 * Run the runner again as a child (same node, script, arguments and output) and return its exit
 * code. The depth cap keeps a mismatch that no update can fix from nesting forever.
 * @param {{ script: string, argv: string[], env?: NodeJS.ProcessEnv,
 *   spawn?: typeof spawnSync, log: (line: string) => void }} o
 * @returns {number}
 */
export function reexec(o) {
  const env = o.env ?? process.env;
  const depth = Number(env[DEPTH_ENV] ?? 0) || 0;
  if (depth >= MAX_RESTART_DEPTH) {
    o.log(`exiting: restarted ${depth} times in this task run; start the runner again by hand`);
    return 3;
  }
  const spawn = o.spawn ?? spawnSync;
  const r = spawn(process.execPath, [o.script, ...o.argv], {
    stdio: 'inherit',
    env: { ...env, [DEPTH_ENV]: String(depth + 1) },
  });
  return r.status ?? 1;
}
