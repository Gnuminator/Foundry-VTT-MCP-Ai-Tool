#!/usr/bin/env node
/**
 * Keep-green: runs locally what the CI job `build-test` (.github/workflows/ci.yml) runs, in the same
 * order, minus `npm ci` and the artifact uploads. Quiet by design (D-122): every step writes its
 * stdout and stderr to a log file under the temp folder, and the run prints one line at the end:
 *
 *   green: OK, 35 steps in 6m12s
 *   green: FAILED at typecheck (C:\...\green-20261010-101500-4242\01-typecheck.log)   + the last 30 log lines
 *
 *   npm run green                       run every step, stop at the first failure
 *   npm run green -- --all              run every step, report every failed step
 *   npm run green -- --list             print the step names
 *   npm run green -- --only a,b         run only these steps
 *   npm run green -- --from NAME        start at this step
 *   npm run green -- --skip a,b         leave these steps out
 *   npm run green -- --cloud            run CI on GitHub for the pushed HEAD instead (see cloudGreen)
 *   npm run green -- --quick            typecheck + unit tests of what changed vs aitool/main, no heavy lock
 *
 * The steps run in the repository the command is started in (the git top level of the current
 * directory). On Windows, when this process is not Node 22 (the global Node 24 crashes natively
 * in the socket tests), every step runs with the portable Node 22 first on PATH (see
 * portableNode22Dir). scripts/green.test.mjs compares the list below with ci.yml: a CI command that is
 * neither covered by a step nor in CI_ONLY (with a reason) fails the test, which keeps green and CI
 * in step.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELD_ENV, acquire, lockDir } from './heavy-lock.mjs';

/**
 * The steps that need a lot of RAM or CPU (lint, type check, build, the test suites, the browser
 * run). A run takes the heavy-check lock once, at its first heavy step, and keeps it until its last
 * one, so parallel greens, the pre-push hook and the gate's drift check take turns per run instead
 * of queueing again for every step (see scripts/heavy-lock.mjs).
 */
export const HEAVY_STEPS = new Set([
  'typecheck',
  'lint-ratchet',
  'build',
  'kit-test',
  'test-shared',
  'test-foundry-module',
  'test-mcp-server',
  'test-cogm-dashboard',
  'test-discord-bot',
  'e2e',
]);

/** The unit-test steps run with CI=true, as on the runner (vitest then runs once, not in watch mode). */
const CI = { CI: 'true' };

/**
 * @typedef {{ name: string, cmd: string, args: string[], env?: Record<string, string> }} Step
 */

/** A step that runs `node --test <file>`. @param {string} name @param {string} file @returns {Step} */
const nodeTest = (name, ...files) => ({ name, cmd: 'node', args: ['--test', ...files], env: CI });

/** A step that runs `npm test -w <workspace>`. @param {string} name @param {string} ws @returns {Step} */
const workspaceTest = (name, ws) => ({
  name,
  cmd: 'npm',
  args: ['test', '-w', `@gnuminator/${ws}`],
  env: CI,
});

/**
 * The steps of the CI job `build-test`, in CI order. A chained CI command (`a && b`) is one step per
 * part, so a failure names the part that broke.
 * @type {Step[]}
 */
export const STEPS = [
  { name: 'typecheck', cmd: 'npm', args: ['run', 'typecheck'] },
  { name: 'lint-ratchet', cmd: 'npm', args: ['run', 'lint:ratchet'] },
  { name: 'emdash-ratchet', cmd: 'npm', args: ['run', 'emdash:ratchet'] },
  { name: 'version-check', cmd: 'npm', args: ['run', 'version:check'] },
  { name: 'usage-catalog', cmd: 'npm', args: ['run', 'usage:catalog:check'] },
  { name: 'docs-lint', cmd: 'npm', args: ['run', 'docs:lint'] },
  { name: 'docs-links', cmd: 'npm', args: ['run', 'docs:links'] },
  nodeTest('hook-remote-guard', '.claude/hooks/guard-remote-commands.test.mjs'),
  nodeTest('hook-start-alerts', '.claude/hooks/start-alerts.test.mjs'),
  nodeTest('drift-check-test', 'scripts/drift-check.test.mjs'),
  nodeTest('hook-context-alert', '.claude/hooks/context-alert.test.mjs'),
  nodeTest(
    'hook-edit-guard',
    '.claude/hooks/guard-shell-edits.test.mjs',
    '.claude/hooks/warn-control-bytes.test.mjs',
    '.claude/hooks/guard-model.test.mjs'
  ),
  nodeTest('gate-scripts', 'scripts/green.test.mjs', 'scripts/lane-merge.test.mjs', 'scripts/visual-baselines.test.mjs', 'scripts/review-runner/lib.test.mjs', 'scripts/heavy-lock.test.mjs'),
  nodeTest('usage-week', 'scripts/dev/usage-week.test.mjs'),
  nodeTest('gamenight-watch', 'scripts/gamenight-watch.test.mjs'),
  nodeTest('pi-space-check', 'scripts/pi/space-check.test.mjs'),
  nodeTest('pi-backup-record', 'scripts/pi/backup-pull-record.test.mjs'),
  nodeTest('pi-world-refs', 'scripts/pi/world-refs.test.mjs'),
  nodeTest('pi-assistant-gm', 'scripts/pi/assistant-gm.test.mjs'),
  nodeTest('pi-gm-passwords', 'scripts/pi/gm-passwords.test.mjs'),
  nodeTest('pi-system-trial-guard', 'scripts/pi/system-trial-guard.test.mjs'),
  nodeTest('pi-player-creation', 'scripts/pi/player-creation.test.mjs'),
  nodeTest('pi-kit-session', 'scripts/pi/kit-session.test.mjs'),
  nodeTest('pi-fetch-kit-login', 'scripts/pi/fetch-kit-login.test.mjs'),
  nodeTest('pi-health-kit-line', 'scripts/pi/health-kit-line.test.mjs'),
  nodeTest('pi-runtime-imports', 'scripts/pi/runtime-imports.test.mjs'),
  nodeTest('pi-runuser-helper', 'scripts/pi/runuser-helper.test.mjs'),
  nodeTest('pi-stage5-load-check', 'scripts/pi/stage5-load-check.test.mjs'),
  nodeTest('pi-ssh-keys-only', 'scripts/pi/ssh-keys-only.test.mjs'),
  nodeTest('pi-board-status', 'scripts/pi/board-status.test.mjs'),
  nodeTest('pi-gh-runner', 'scripts/pi/gh-runner.test.mjs'),
  nodeTest('pi-stage7-foundry-url', 'scripts/pi/stage7-foundry-url.test.mjs'),
  nodeTest('pi-time-sync', 'scripts/pi/time-sync.test.mjs'),
  nodeTest('pi-join-page-look', 'scripts/pi/join-page-look.test.mjs'),
  nodeTest('pi-control-port-check', 'scripts/pi/control-port-check.test.mjs'),
  nodeTest('pi-stage-safety', 'scripts/pi/pi-stage-safety.test.mjs'),
  nodeTest('tunnel-client', 'installer/nsis/tunnel-client.test.mjs'),
  nodeTest('plan-b', 'scripts/plan-b/plan-b.test.mjs'),
  nodeTest('tv-table-viewer', 'scripts/tv/start-table-viewer.test.mjs'),
  { name: 'changelog', cmd: 'npm', args: ['run', 'changelog:check'] },
  nodeTest('gm-coach-test', 'tools/gm-coach/build.test.mjs'),
  { name: 'gm-coach-build', cmd: 'node', args: ['tools/gm-coach/build.mjs'] },
  { name: 'build', cmd: 'npm', args: ['run', 'build'] },
  {
    // CI runs this on Node 22 only; green is run on Node 22.
    name: 'bundle-budget',
    cmd: 'npm',
    args: ['run', 'bundle:budget', '-w', '@gnuminator/cogm-dashboard'],
  },
  { name: 'kit-test', cmd: 'npm', args: ['run', 'kit:test'], env: CI },
  { name: 'kit-check', cmd: 'node', args: ['scripts/test-kit/kit.mjs', 'check'] },
  {
    name: 'kit-fake',
    cmd: 'node',
    args: ['scripts/test-kit/kit.mjs', 'all', '--fake'],
    env: { TEST_KIT_HOME: path.join(os.tmpdir(), 'green-test-kit') },
  },
  workspaceTest('test-shared', 'shared'),
  workspaceTest('test-foundry-module', 'foundry-module'),
  workspaceTest('test-mcp-server', 'mcp-server'),
  workspaceTest('test-cogm-dashboard', 'cogm-dashboard'),
  workspaceTest('test-discord-bot', 'discord-bot'),
  { name: 'mcp-schema-smoke', cmd: 'node', args: ['scripts/mcp-schema-smoke-test.mjs'] },
  { name: 'standalone-smoke', cmd: 'node', args: ['scripts/standalone-smoke-test.mjs'] },
  { name: 'split-smoke', cmd: 'node', args: ['scripts/cogm-split-smoke-test.mjs'] },
  {
    // Needs Chromium for Playwright (`npx playwright install chromium`, once on this PC).
    name: 'e2e',
    cmd: 'npm',
    args: ['run', 'test:e2e', '-w', '@gnuminator/cogm-dashboard'],
    env: CI,
  },
  { name: 'validate-manifest', cmd: 'node', args: ['scripts/validate-manifest.js'] },
];

/**
 * CI commands of `build-test` that green does not run, each with the reason. The key is the command
 * with its whitespace collapsed. The parity test accepts a CI command that a step covers or that is
 * listed here.
 * @type {Record<string, string>}
 */
export const CI_ONLY = {
  'npm exec -w @gnuminator/cogm-dashboard -- playwright install --with-deps chromium':
    'Installs Chromium and its system packages on the CI runner; on a PC it is a one-time `npx playwright install chromium`.',
};

/** Lines of the failed step's log that are printed. */
const TAIL_LINES = 30;

/** Collapse whitespace so a command compares the same however the YAML wrapped it. @param {string} s */
export function normalizeCommand(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Every `run:` command of one job in a workflow file, in order: single-line `run: cmd` and
 * `run: |` blocks (one entry per non-empty, non-comment line), without `npm ci`. Simple line
 * parsing, no YAML dependency: it relies on the layout of this repo's workflow (jobs at two
 * spaces, steps at six).
 * @param {string} yamlText @param {string} [job]
 * @returns {string[]}
 */
export function ciRunCommands(yamlText, job = 'build-test') {
  const lines = yamlText.split(/\r?\n/);
  const start = lines.findIndex(l => l.trimEnd() === `  ${job}:`);
  if (start < 0) return [];
  const commands = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    // The next job (a two-space key) or a top-level key ends this job.
    if (/^ {0,2}[A-Za-z_][\w-]*:/.test(line)) break;
    const m = /^(\s*)(- )?run:\s*(.*)$/.exec(line);
    if (!m) continue;
    const indent = m[1].length + (m[2] ? 2 : 0);
    const rest = m[3].trim();
    if (/^[|>][+-]?$/.test(rest)) {
      for (let j = i + 1; j < lines.length; j++) {
        const body = lines[j];
        if (body.trim() === '') continue;
        if (body.length - body.trimStart().length <= indent) break;
        const text = body.trim();
        if (!text.startsWith('#')) commands.push(text);
        i = j;
      }
    } else if (rest) {
      // A plain (or quoted) scalar can go on over more lines, indented deeper than `run:`; YAML
      // folds them into one line with spaces.
      let text = rest;
      for (let j = i + 1; j < lines.length; j++) {
        const body = lines[j];
        if (body.trim() === '' || body.length - body.trimStart().length <= indent) break;
        text += ` ${body.trim()}`;
        i = j;
      }
      commands.push(text.replace(/^(['"])(.*)\1$/, '$2'));
    }
  }
  return commands.filter(c => normalizeCommand(c) !== 'npm ci');
}

/**
 * Parts of a job that change what a `run:` command does and that ciRunCommands does not follow
 * (`working-directory`). The parity test fails while there are any, so a new one is noticed.
 * @param {string} yamlText @param {string} [job]
 * @returns {string[]}
 */
export function ciUnsupported(yamlText, job = 'build-test') {
  const lines = yamlText.split(/\r?\n/);
  const start = lines.findIndex(l => l.trimEnd() === `  ${job}:`);
  if (start < 0) return [];
  const found = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {0,2}[A-Za-z_][\w-]*:/.test(lines[i])) break;
    if (/^\s*(- )?working-directory:/.test(lines[i])) found.push(lines[i].trim());
  }
  return found;
}

/**
 * @param {string[]} argv
 * @returns {{ list: boolean, all: boolean, cloud: boolean, quick: boolean, only: string[], skip: string[], from: string | null, error: string | null }}
 */
export function parseArgs(argv) {
  const out = { list: false, all: false, cloud: false, quick: false, only: [], skip: [], from: null, error: null };
  const csv = (/** @type {string} */ v) =>
    v
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    const inline = arg.startsWith('--') && eq > 0 ? arg.slice(eq + 1) : null;
    const value = () => {
      if (inline !== null) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return null;
      i++;
      return next;
    };
    if (flag === '--list') out.list = true;
    else if (flag === '--all') out.all = true;
    else if (flag === '--cloud') out.cloud = true;
    else if (flag === '--quick') out.quick = true;
    else if (flag === '--only' || flag === '--skip' || flag === '--from') {
      const v = value();
      if (v === null || v === '') {
        out.error = `${flag} needs a value`;
        return out;
      }
      if (flag === '--only') out.only.push(...csv(v));
      else if (flag === '--skip') out.skip.push(...csv(v));
      else out.from = v;
    } else {
      out.error = `unknown argument ${arg}`;
      return out;
    }
  }
  if (out.cloud && (out.list || out.all || out.only.length + out.skip.length > 0 || out.from)) {
    out.error = '--cloud runs the whole CI job and cannot be combined with --list, --all, --only, --skip or --from';
  }
  if (out.quick && (out.cloud || out.all || out.only.length + out.skip.length > 0 || out.from)) {
    out.error = '--quick builds its own step list and cannot be combined with --cloud, --all, --only, --skip or --from';
  }
  return out;
}

/**
 * The steps a run executes: from `--from`, then `--only`, then without `--skip`, in CI order.
 * @param {Step[]} steps @param {ReturnType<typeof parseArgs>} opts
 * @returns {{ steps: Step[], error: string | null }}
 */
export function selectSteps(steps, opts) {
  const names = steps.map(s => s.name);
  const unknown = [...opts.only, ...opts.skip, ...(opts.from ? [opts.from] : [])].filter(
    n => !names.includes(n)
  );
  if (unknown.length > 0) {
    return {
      steps: [],
      error: `unknown step ${unknown.join(', ')} (npm run green -- --list shows them)`,
    };
  }
  let selected = steps;
  if (opts.from) selected = selected.slice(names.indexOf(opts.from));
  if (opts.only.length > 0) selected = selected.filter(s => opts.only.includes(s.name));
  if (opts.skip.length > 0) selected = selected.filter(s => !opts.skip.includes(s.name));
  return { steps: selected, error: null };
}

/** @param {number} ms */
export function formatDuration(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m${total % 60}s`;
}

/** The last `n` lines of a text file ('' when it cannot be read). @param {string} file @param {number} n */
export function tailOf(file, n = TAIL_LINES) {
  try {
    const lines = fs.readFileSync(file, 'utf8').replace(/\s+$/, '').split(/\r?\n/);
    return lines.slice(-n).join('\n');
  } catch {
    return '';
  }
}

/** @param {Date} d */
function stamp(d) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** The git top level of the current directory, else the directory itself. */
function repoRoot() {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? path.resolve(r.stdout.trim()) : process.cwd();
}

/**
 * The tree hash of HEAD when the working tree has no uncommitted or untracked changes, else null.
 * A green run on a clean tree is "green on this commit".
 * @param {string} cwd
 * @returns {string | null}
 */
export function cleanTreeHash(cwd) {
  const git = (/** @type {string[]} */ args) =>
    spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  const status = git(['status', '--porcelain']);
  if (status.status !== 0 || status.stdout.trim() !== '') return null;
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  return tree.status === 0 ? tree.stdout.trim() : null;
}

/**
 * The tree hash the working tree would commit as with every change added (`git add -A`: changed,
 * new and deleted files, not ignored ones), without touching the real index: a copy of it is used.
 * A green run on a tree with uncommitted edits is then "green on the commit those edits become".
 * @param {string} cwd
 * @returns {string | null}
 */
export function worktreeTreeHash(cwd) {
  const git = (/** @type {string[]} */ args, /** @type {Record<string, string>} */ extra = {}) =>
    spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, ...extra } });
  const real = git(['rev-parse', '--git-path', 'index']);
  if (real.status !== 0 || !real.stdout.trim()) return null;
  const index = path.join(os.tmpdir(), `green-index-${process.pid}-${Date.now()}`);
  try {
    // A copy of the real index keeps git's file-stat cache, so `add -A` only hashes changed files.
    try {
      fs.copyFileSync(path.resolve(cwd, real.stdout.trim()), index);
    } catch {
      if (git(['read-tree', 'HEAD'], { GIT_INDEX_FILE: index }).status !== 0) return null;
    }
    if (git(['add', '-A'], { GIT_INDEX_FILE: index }).status !== 0) return null;
    const tree = git(['write-tree'], { GIT_INDEX_FILE: index });
    return tree.status === 0 && /^[0-9a-f]{40,64}$/.test(tree.stdout.trim()) ? tree.stdout.trim() : null;
  } finally {
    fs.rmSync(index, { force: true });
  }
}

/** Where a full green run records the tree it passed on (per worktree, inside its git dir). @param {string} cwd */
export function greenStampPath(cwd) {
  const r = spawnSync('git', ['rev-parse', '--git-path', 'green-ok'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  return r.status === 0 && r.stdout.trim() ? path.resolve(cwd, r.stdout.trim()) : null;
}

/**
 * Did `npm run green` pass on exactly this tree? (.git/green-ok holds the tree hash of the last full
 * OK run.) With `commits` (the commits a push sends, from the pre-push hook) every one of them must
 * have that tree, whatever the working tree holds now; without, the working tree must be clean and
 * HEAD must have it.
 * @param {string} cwd @param {string[]} [commits]
 */
export function greenPassedOnThisTree(cwd, commits = []) {
  const file = greenStampPath(cwd);
  if (!file) return false;
  let stamp;
  try {
    stamp = fs.readFileSync(file, 'utf8').trim();
  } catch {
    return false;
  }
  if (commits.length === 0) return cleanTreeHash(cwd) === stamp;
  return commits.every(sha => {
    const r = spawnSync('git', ['rev-parse', `${sha}^{tree}`], { cwd, encoding: 'utf8', windowsHide: true });
    return r.status === 0 && r.stdout.trim() === stamp;
  });
}

/**
 * Is this word safe in a shell line as it is? Letters, digits and `_ @ % + = : , . / -` only: no
 * space, quote, backslash or shell metacharacter, so a command line never needs quoting.
 * @param {string} word
 */
export function isShellSafe(word) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word);
}

/**
 * The command of a step as one shell line: the words joined by spaces, nothing quoted. A step with
 * an unsafe word is a bug in the step list and throws.
 * @param {Step} step
 */
export function commandLine(step) {
  const words = [step.cmd, ...step.args];
  const bad = words.filter(w => !isShellSafe(w));
  if (bad.length > 0) {
    throw new Error(
      `step ${step.name}: ${JSON.stringify(bad)} needs quoting; use plain words (put a script in a file)`
    );
  }
  return words.join(' ');
}

// A step list that would need quoting is refused when the module loads, not in the middle of a run.
for (const step of STEPS) commandLine(step);

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
 * The folder of the newest portable Node 22 (`%LOCALAPPDATA%\node22\node-v22.*`, the toolchain the
 * project uses on Windows), or null. Node 24.15 on Windows crashes natively (exit code 0xC0000409,
 * no message) in 20 to 40 percent of the co-GM dashboard socket test runs, which showed up as
 * vitest "Channel closed" on the fork pool; the same tests passed 60 of 60 runs on Node 22.22.2.
 * @param {{ platform?: string, localAppData?: string, major?: number,
 *   readdir?: (dir: string) => string[], exists?: (file: string) => boolean }} [o]
 * @returns {string | null} the folder to put first on PATH, or null (not Windows, already Node 22,
 *   or no portable Node 22 found)
 */
export function portableNode22Dir(o = {}) {
  const {
    platform = process.platform,
    localAppData = process.env.LOCALAPPDATA,
    major = Number(process.versions.node.split('.')[0]),
    readdir = (/** @type {string} */ d) => fs.readdirSync(d),
    exists = (/** @type {string} */ f) => fs.existsSync(f),
  } = o;
  if (platform !== 'win32' || major === 22 || !localAppData) return null;
  const root = path.join(localAppData, 'node22');
  let names;
  try {
    names = readdir(root);
  } catch {
    return null;
  }
  const version = (/** @type {string} */ n) => n.split('-')[1]?.split('.').map(Number) ?? [];
  const newest = names
    .filter(n => /^node-v22\.\d+\.\d+-win-x64$/.test(n))
    .sort((a, b) => {
      const [x, y] = [version(a), version(b)];
      return (y[1] ?? 0) - (x[1] ?? 0) || (y[2] ?? 0) - (x[2] ?? 0);
    })
    .find(n => exists(path.join(root, n, 'node.exe')));
  return newest ? path.join(root, newest) : null;
}

const NODE22_DIR = portableNode22Dir();

/**
 * The environment for the steps: `base`, with the portable Node 22 first on PATH when `node22Dir` is set.
 * Every PATH key is dropped and one is set (a parent that is an MSYS or Cygwin process can hand over both
 * `PATH` and `Path`, and Windows would then pick one of them, which could be the one without the pin).
 * @param {Record<string, string | undefined>} base @param {string | null} node22Dir
 * @param {string} [delimiter]
 */
export function stepEnvironment(base, node22Dir, delimiter = path.delimiter) {
  const env = { ...base };
  if (!node22Dir) return env;
  const keys = Object.keys(env).filter(k => k.toLowerCase() === 'path');
  const key = keys[0] ?? 'PATH';
  const old = env[key] ?? '';
  for (const k of keys) delete env[k];
  env[key] = `${node22Dir}${delimiter}${old}`;
  return env;
}

/**
 * The one line that says which Node the steps run on (Windows only, where the pin matters), or null.
 * Without it a missing portable Node 22 silently brings the native crashes back looking like flakes.
 * @param {{ platform?: string, major?: number, version?: string, dir?: string | null }} [o]
 * @returns {string | null}
 */
export function nodeNote(o = {}) {
  const {
    platform = process.platform,
    major = Number(process.versions.node.split('.')[0]),
    version = process.versions.node,
    dir = NODE22_DIR,
  } = o;
  if (platform !== 'win32') return null;
  if (dir) return `green: steps on Node 22 (${dir})`;
  return major === 22
    ? `green: steps on Node ${version}`
    : `green: no portable Node 22 found; steps run on Node ${version}`;
}

/**
 * The default step runner: stdout and stderr of the step go straight to the log file.
 * @param {Step} step @param {number} fd @param {string} cwd
 * @returns {number} exit status (1 when the process could not start or was killed)
 */
function spawnStep(step, fd, cwd) {
  const run = () => {
    // One command string with shell: true (a command plus an args array under a shell is DEP0190).
    const r = spawnSync(commandLine(step), {
      cwd,
      shell: true,
      stdio: ['ignore', fd, fd],
      env: {
        ...stepEnvironment(process.env, NODE22_DIR),
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        ...((step.name === 'e2e' || step.name === 'e2e-specs') && !process.env.E2E_PORT ? freePortEnv() : {}),
        ...step.env,
      },
    });
    return r.status ?? 1;
  };
  // The quick run's e2e spec step shares the e2e solo lock (same fixed state folder).
  if (step.name === 'e2e-specs') return soloLock('e2e', run);
  return SOLO_STEPS.has(step.name) ? soloLock(step.name, run) : run();
}

/**
 * Steps that two greens must never run at the same time, even each in its own heavy slot: the e2e
 * run starts the dashboard with a fixed state folder (%TEMP%\cogm-dashboard-e2e, set in its
 * playwright config). Measured 2026-10-30: two greens in e2e at once, one failed on the port.
 */
export const SOLO_STEPS = new Set(['e2e']);

/**
 * Run fn under a one-slot lock of its own (a `solo-<name>` folder next to the heavy-check slots).
 * The heavy lock's held marker is left out on purpose: holding a heavy slot does not mean holding
 * this one. Nothing waits for a heavy slot while holding this lock, so the two cannot deadlock.
 * @template T @param {string} name @param {() => T} fn @returns {T}
 */
function soloLock(name, fn) {
  const { [HELD_ENV]: _held, ...rest } = process.env;
  const lock = acquire(`green ${name}`, {
    env: { ...rest, HEAVY_LOCK_DIR: path.join(lockDir(), `solo-${name}`), HEAVY_LOCK_SLOTS: '1' },
    log: () => {},
  });
  try {
    return fn();
  } finally {
    lock.release();
  }
}

/**
 * A free port for the e2e dashboard (E2E_PORT, read by the playwright config), so a green never
 * fails because another run, of any version, sits on the default 3197. Empty when none was found.
 * @returns {Record<string, string>}
 */
function freePortEnv() {
  const r = spawnSync(
    process.execPath,
    ['-e', "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"],
    { encoding: 'utf8', windowsHide: true }
  );
  const port = Number(r.stdout?.trim());
  return Number.isInteger(port) && port > 1024 && ![31414, 31415, 31416].includes(port) ? { E2E_PORT: String(port) } : {};
}

/**
 * The heavy-check lock for one green run: taken at the first heavy step, beaten before each later
 * step (so a long run is never taken for stale), released after the last heavy step.
 * @param {Step[]} steps the steps this run executes
 * @param {(label: string) => ReturnType<typeof acquire>} take
 * @param {string} label
 * @param {Record<string, string | undefined>} env gets HELD_ENV while the lock is held, so a step's
 *   own lock (lint-ratchet) does not wait on this run
 */
export function runLock(steps, take, label, env = process.env) {
  const lastHeavy = steps.findLastIndex(s => HEAVY_STEPS.has(s.name));
  /** @type {ReturnType<typeof acquire> | null} */
  let lock = null;
  const release = () => {
    if (!lock) return;
    if (lock.held) delete env[HELD_ENV];
    lock.release();
    lock = null;
  };
  let waitedMs = 0;
  return {
    /** @param {number} i @param {Step} step */
    before(i, step) {
      if (i > lastHeavy) return;
      if (lock) {
        lock.beat(step.name);
        return;
      }
      if (!HEAVY_STEPS.has(step.name)) return;
      lock = take(label);
      waitedMs = lock.waitedMs;
      if (lock.held) {
        env[HELD_ENV] = String(process.pid);
        lock.beat(step.name);
      }
    },
    /** @param {number} i */
    after(i) {
      if (i >= lastHeavy) release();
    },
    release,
    get waitedMs() {
      return waitedMs;
    },
  };
}

/** Remote the lanes push to (CLAUDE.md: never the upstream repo). */
const CLOUD_REMOTE = 'aitool';
const CLOUD_WORKFLOW = 'ci.yml';

/** Sleep without a timer, so green.mjs can stay synchronous. @param {number} ms */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * @param {string} cmd @param {string[]} args @param {string} cwd
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function runCapture(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: `${r.stderr ?? ''}${r.error ? r.error.message : ''}` };
}

/** `owner/repo` from a GitHub remote URL (https or ssh), else null. @param {string} url */
export function repoFromUrl(url) {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\s*$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * `green --cloud`: the same checks on GitHub for the pushed HEAD, for when the local heavy-check
 * queue is long. No local heavy run, no heavy-check lock. It refuses a dirty tree and a HEAD that
 * is not on the remote branch, uses the CI run already started for that sha (a push to a PR branch
 * starts one) or else starts ci.yml by workflow_dispatch, waits, and prints one line.
 * @param {{
 *   cwd: string, git?: (args: string[]) => { status: number, stdout: string, stderr: string },
 *   gh?: (args: string[]) => { status: number, stdout: string, stderr: string },
 *   now?: () => number, sleep?: (ms: number) => void, log?: (line: string) => void,
 *   pollMs?: number, findMs?: number, timeoutMs?: number,
 * }} o
 * @returns {number} the process exit code
 */
export function cloudGreen(o) {
  const {
    cwd,
    git = args => runCapture('git', args, cwd),
    gh = args => runCapture('gh', args, cwd),
    now = Date.now,
    sleep = sleepSync,
    log = console.log,
    pollMs = 20_000,
    findMs = 90_000,
    timeoutMs = 60 * 60_000,
  } = o;
  const refuse = (/** @type {string} */ why) => {
    log(`green --cloud: ${why}`);
    return 1;
  };
  const out = (/** @type {string[]} */ args) => {
    const r = git(args);
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const dirty = git(['status', '--porcelain']);
  if (dirty.status !== 0) return refuse('git status failed');
  if (dirty.stdout.trim()) return refuse('the working tree has uncommitted changes; commit them (CI runs the pushed commit)');
  const branch = out(['rev-parse', '--abbrev-ref', 'HEAD']);
  const sha = out(['rev-parse', 'HEAD']);
  if (!branch || branch === 'HEAD' || !sha) return refuse('no branch checked out');
  if (branch === 'main') return refuse('CI on main runs on push; use the merge train, not --cloud');
  const remoteUrl = out(['remote', 'get-url', CLOUD_REMOTE]);
  const repo = remoteUrl && repoFromUrl(remoteUrl);
  if (!repo) return refuse(`no GitHub remote named ${CLOUD_REMOTE}`);
  const lsRemote = git(['ls-remote', CLOUD_REMOTE, `refs/heads/${branch}`]);
  if (lsRemote.status !== 0) return refuse(`could not reach ${CLOUD_REMOTE}: ${lsRemote.stderr.trim().split('\n')[0]}`);
  const remoteHead = lsRemote.stdout.trim().split(/\s+/)[0];
  if (remoteHead !== sha) {
    return refuse(`HEAD ${sha.slice(0, 8)} is not pushed to ${CLOUD_REMOTE}/${branch} (git push -u ${CLOUD_REMOTE} ${branch}:${branch})`);
  }

  const started = now();
  let ghError = '';
  /** @param {string[]} extra @returns {{ databaseId: number, status: string, conclusion: string, headSha: string }[] | null} null when gh failed */
  const listRuns = extra => {
    const r = gh(['run', 'list', '-R', repo, '-w', CLOUD_WORKFLOW, '--json', 'databaseId,status,conclusion,event,headSha', '-L', '20', ...extra]);
    if (r.status !== 0) {
      ghError = (r.stderr || r.stdout).trim().split('\n')[0];
      return null;
    }
    try {
      return JSON.parse(r.stdout).filter((/** @type {{ headSha: string }} */ x) => x.headSha === sha);
    } catch {
      return [];
    }
  };
  // A run that was cancelled or skipped says nothing about the commit.
  const usable = (/** @type {{ conclusion: string }} */ x) => x.conclusion !== 'cancelled' && x.conclusion !== 'skipped';
  const first = listRuns(['--commit', sha]);
  if (!first) return refuse(`could not list CI runs (gh: ${ghError}); not starting a second run blind`);
  let run = first.find(usable);
  const earlier = Boolean(run && run.status === 'completed');
  if (!run) {
    // A branch with an open PR gets a pull_request run a few seconds after the push: wait for it
    // instead of starting a second run (its concurrency group is the ref, not the PR's, so neither
    // would cancel the other).
    const pr = gh(['pr', 'list', '-R', repo, '--head', branch, '--state', 'open', '--json', 'number']);
    let hasPr = false;
    try {
      hasPr = pr.status === 0 && JSON.parse(pr.stdout).length > 0;
    } catch {
      hasPr = false;
    }
    while (hasPr && !run && now() - started < findMs) {
      sleep(Math.min(pollMs, 5000));
      run = listRuns(['--commit', sha])?.find(usable);
    }
  }
  if (!run) {
    const d = gh(['workflow', 'run', CLOUD_WORKFLOW, '-R', repo, '--ref', branch]);
    if (d.status !== 0) return refuse(`could not start ${CLOUD_WORKFLOW}: ${(d.stderr || d.stdout).trim().split('\n')[0]}`);
    const dispatchedAt = now();
    while (!run && now() - dispatchedAt < findMs) {
      sleep(Math.min(pollMs, 5000));
      run = listRuns(['--branch', branch, '--event', 'workflow_dispatch'])?.find(usable);
    }
    if (!run) return refuse(`started ${CLOUD_WORKFLOW} but found no run for ${sha.slice(0, 8)} within ${Math.round(findMs / 1000)} s`);
  }

  /** @type {{ status: string, conclusion: string, url: string, jobs: { name: string, conclusion: string, url: string, steps?: { name: string, conclusion: string }[] }[] } | null} */
  let view = null;
  let errors = 0;
  while (now() - started < timeoutMs) {
    const r = gh(['run', 'view', String(run.databaseId), '-R', repo, '--json', 'status,conclusion,url,jobs']);
    if (r.status === 0) {
      errors = 0;
      try {
        view = JSON.parse(r.stdout);
      } catch {
        view = null;
      }
      if (view?.status === 'completed') break;
    } else if (++errors >= 5) {
      return refuse(`gh failed 5 times in a row while waiting for run ${run.databaseId}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
    }
    sleep(pollMs);
  }
  if (!view || view.status !== 'completed') return refuse(`CI run ${run.databaseId} was still going after ${formatDuration(now() - started)}`);
  if (view.conclusion === 'success') {
    log(`green: OK (cloud), CI run ${view.url} for ${sha.slice(0, 8)} in ${formatDuration(now() - started)}`);
    return 0;
  }
  if (view.conclusion === 'cancelled') {
    log(`green: FAILED (cloud, cancelled) CI run ${view.url} was cancelled, probably replaced by a newer run on the same ref; run --cloud again`);
    return 1;
  }
  const bad = view.jobs.filter(j => j.conclusion && !['success', 'skipped', 'neutral'].includes(j.conclusion));
  const where = bad.map(j => {
    const step = j.steps?.find(s => s.conclusion === 'failure');
    return `${j.name}${step ? ` at step "${step.name}"` : ''} (${j.url})`;
  });
  const retry = earlier ? ` (an earlier run; gh run rerun ${run.databaseId} --failed to retry)` : '';
  log(`green: FAILED (cloud, ${view.conclusion}) ${where.length ? where.join('; ') : view.url}${retry}`);
  return 1;
}

/**
 * `green --quick`: the steps for the files a branch changed (CI on the pushed head is the green, the
 * lane skill 2026-10-30). Per touched workspace its typecheck and unit tests; a `shared/` change
 * typechecks every package (they build on it) and tests shared; a changed `*.test.mjs` (or the
 * script next to it) runs under node --test; a changed dashboard e2e spec builds the dashboard and
 * runs only that spec. None of these step names is in HEAVY_STEPS (hence `unit-*`, not `test-*`), so a quick run never takes a
 * heavy slot (the e2e spec step keeps the small solo lock the e2e port needs).
 * @param {string[]} files repo-relative paths, forward slashes
 * @returns {Step[]}
 */
export function quickSteps(files, cwd = process.cwd()) {
  /** @type {Step[]} */
  const steps = [];
  const pkgs = new Set();
  for (const f of files) {
    const m = /^packages\/([^/]+)\//.exec(f);
    if (m) pkgs.add(m[1]);
  }
  const sharedTouched = files.some(f => f.startsWith('shared/'));
  if (sharedTouched || pkgs.size > 0) steps.push({ name: 'build-shared', cmd: 'npm', args: ['run', 'build:shared'] });
  if (sharedTouched) {
    steps.push({ name: 'typecheck-all', cmd: 'npm', args: ['run', 'typecheck'] });
    steps.push({ name: 'unit-shared', cmd: 'npm', args: ['run', 'test', '-w', '@gnuminator/shared'] });
  } else {
    for (const p of [...pkgs].sort()) {
      steps.push({ name: `typecheck-${p}`, cmd: 'npm', args: ['run', 'typecheck', '-w', `@gnuminator/${p}`] });
    }
  }
  for (const p of [...pkgs].sort()) {
    steps.push({ name: `unit-${p}`, cmd: 'npm', args: ['run', 'test', '-w', `@gnuminator/${p}`] });
  }
  const nodeTests = new Set();
  for (const f of files) {
    if (/^(?:scripts|\.claude\/hooks)\/.*\.mjs$/.test(f) && isShellSafe(f)) {
      nodeTests.add(f.endsWith('.test.mjs') ? f : f.replace(/\.mjs$/, '.test.mjs'));
    }
  }
  const tests = [...nodeTests].filter(f => fs.existsSync(path.join(cwd, f))).sort();
  if (tests.length > 0) steps.push({ name: 'node-tests', cmd: 'node', args: ['--test', ...tests], env: CI });
  const specs = files
    .filter(f => /^packages\/cogm-dashboard\/web\/e2e\/.+\.spec\.ts$/.test(f) && isShellSafe(f))
    .map(f => f.replace('packages/cogm-dashboard/web/', ''))
    .sort();
  if (specs.length > 0) {
    steps.push({ name: 'build-dashboard', cmd: 'npm', args: ['run', 'build', '-w', '@gnuminator/cogm-dashboard'] });
    steps.push({
      name: 'e2e-specs',
      cmd: 'npm',
      args: ['run', 'test:e2e', '-w', '@gnuminator/cogm-dashboard', '--', ...specs],
      env: CI,
    });
  }
  return steps;
}

/**
 * The files this checkout changed against the base: committed since the merge base, uncommitted
 * and untracked. The base is aitool/main, else origin/main, else main.
 * @param {string} cwd
 * @returns {string[]}
 */
export function changedFiles(cwd) {
  const git = (/** @type {string[]} */ args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const base = ['aitool/main', 'origin/main', 'main'].find(
    b => git(['rev-parse', '--verify', '--quiet', b]).status === 0
  );
  if (!base) return [];
  const mb = git(['merge-base', base, 'HEAD']).stdout.trim() || base;
  const lines = (/** @type {string} */ t) => t.split(/\r?\n/).filter(Boolean);
  return [
    ...new Set([
      ...lines(git(['diff', '--name-only', '--diff-filter=d', mb]).stdout),
      ...lines(git(['ls-files', '--others', '--exclude-standard']).stdout),
    ]),
  ].map(f => f.replace(/\\/g, '/'));
}

/**
 * @param {{
 *   argv?: string[], steps?: Step[], cwd?: string, tmpdir?: string, now?: () => number,
 *   isTTY?: boolean, log?: (line: string) => void, write?: (text: string) => void,
 *   runStep?: (step: Step, fd: number, cwd: string) => number, note?: string | null,
 *   recordStamp?: boolean, changed?: string[], cloudOptions?: Partial<Parameters<typeof cloudGreen>[0]>, takeLock?: (label: string) => ReturnType<typeof acquire>,
 * }} [options]
 * @returns {number} the process exit code
 */
export function main(options = {}) {
  const {
    argv = process.argv.slice(2),
    steps: stepsOption = STEPS,
    cwd = repoRoot(),
    tmpdir = os.tmpdir(),
    now = Date.now,
    isTTY = Boolean(process.stdout.isTTY),
    log = console.log,
    write = text => process.stdout.write(text),
    runStep = spawnStep,
    note = nodeNote(),
    takeLock = label => acquire(label),
  } = options;

  const opts = parseArgs(argv);
  if (opts.error) {
    log(`green: ${opts.error}`);
    return 2;
  }
  if (opts.list) {
    for (const s of stepsOption) log(s.name);
    return 0;
  }
  const steps = opts.quick ? quickSteps(options.changed ?? changedFiles(cwd), cwd) : stepsOption;
  if (opts.quick && steps.length === 0) {
    log('green: OK (quick), nothing to check: no package, script test or e2e spec changed vs the base');
    return 0;
  }
  const picked = selectSteps(steps, opts);
  if (picked.error) {
    log(`green: ${picked.error}`);
    return 2;
  }
  if (picked.steps.length === 0) {
    log('green: no steps selected');
    return 2;
  }

  if (opts.cloud) return cloudGreen({ cwd, log, ...options.cloudOptions });

  if (note) log(note);
  // A full run (every step) is recorded with the tree it ran on (uncommitted edits included), so the
  // pre-push hook can skip its ratchets when it pushes a commit with exactly that tree.
  const treeBefore =
    options.recordStamp === false ||
    steps !== STEPS ||
    opts.only.length + opts.skip.length > 0 ||
    opts.from
      ? null
      : worktreeTreeHash(cwd);
  // The pid keeps two greens started in the same second (parallel lanes) out of each other's logs.
  const logDir = path.join(tmpdir, `green-${stamp(new Date(now()))}-${process.pid}`);
  fs.mkdirSync(logDir, { recursive: true });
  const started = now();
  /** @type {{ name: string, logFile: string }[]} */
  const failed = [];
  /** @type {{ step: string, ms: number, status: number }[]} */
  const timings = [];
  const lock = runLock(picked.steps, takeLock, `green ${path.basename(cwd)}`);
  try {
    picked.steps.forEach((step, i) => {
      if (failed.length > 0 && !opts.all) return;
      const nn = String(steps.indexOf(step) + 1).padStart(2, '0');
      const logFile = path.join(logDir, `${nn}-${step.name}.log`);
      if (isTTY) write(`\x1b[2K\rgreen: [${i + 1}/${picked.steps.length}] ${step.name}`);
      lock.before(i, step);
      const fd = fs.openSync(logFile, 'w');
      const stepStart = performance.now();
      let status = 1;
      try {
        status = runStep(step, fd, cwd);
      } finally {
        fs.closeSync(fd);
        lock.after(i);
      }
      timings.push({ step: step.name, ms: Math.round(performance.now() - stepStart), status });
      if (status !== 0) failed.push({ name: step.name, logFile });
    });
  } finally {
    lock.release();
  }
  if (isTTY) write('\x1b[2K\r');
  const ended = now();
  try {
    // For tuning the heavy-check lock: what each step took and how long the run waited for the lock.
    fs.writeFileSync(
      path.join(logDir, 'timings.json'),
      `${JSON.stringify({ totalMs: ended - started, lockWaitMs: lock.waitedMs, steps: timings }, null, 1)}\n`
    );
  } catch {
    // Timings are a nice-to-have.
  }
  const waited = lock.waitedMs >= 1000 ? ` (${formatDuration(lock.waitedMs)} of it waiting for the heavy-check lock)` : '';

  if (failed.length === 0) {
    if (treeBefore && worktreeTreeHash(cwd) === treeBefore) {
      const stamp = greenStampPath(cwd);
      try {
        if (stamp) fs.writeFileSync(stamp, `${treeBefore}\n`);
      } catch {
        // No stamp: the pre-push hook just runs its ratchets.
      }
    }
    log(`green: OK, ${picked.steps.length} steps in ${formatDuration(ended - started)}${waited}`);
    return 0;
  }
  for (const f of failed) log(`green: FAILED at ${f.name} (${f.logFile})`);
  const tail = tailOf(failed[0].logFile);
  if (tail) log(tail);
  return 1;
}

const self = fileURLToPath(import.meta.url);
if (isEntryModule(process.argv[1], self)) {
  process.exit(main());
} else if (process.argv[1] && path.basename(process.argv[1]) === path.basename(self)) {
  console.error(`green: started as ${process.argv[1]} but this module is ${self}`);
  process.exit(1);
}
