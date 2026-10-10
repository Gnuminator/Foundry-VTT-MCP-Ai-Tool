#!/usr/bin/env node
/**
 * Keep-green: runs locally what the CI job `build-test` (.github/workflows/ci.yml) runs, in the same
 * order, minus `npm ci` and the artifact uploads. Quiet by design (D-122): every step writes its
 * stdout and stderr to a log file under the temp folder, and the run prints one line at the end:
 *
 *   green: OK, 35 steps in 6m12s
 *   green: FAILED at typecheck (C:\...\green-20261010-101500\01-typecheck.log)   + the last 30 log lines
 *
 *   npm run green                       run every step, stop at the first failure
 *   npm run green -- --all              run every step, report every failed step
 *   npm run green -- --list             print the step names
 *   npm run green -- --only a,b         run only these steps
 *   npm run green -- --from NAME        start at this step
 *   npm run green -- --skip a,b         leave these steps out
 *
 * The steps run in the repository the command is started in (the git top level of the current
 * directory). scripts/green.test.mjs compares the list below with ci.yml: a CI command that is
 * neither covered by a step nor in CI_ONLY (with a reason) fails the test, which keeps green and CI
 * in step.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  nodeTest('gate-scripts', 'scripts/green.test.mjs', 'scripts/lane-merge.test.mjs'),
  nodeTest('usage-week', 'scripts/dev/usage-week.test.mjs'),
  nodeTest('pi-space-check', 'scripts/pi/space-check.test.mjs'),
  nodeTest('pi-backup-record', 'scripts/pi/backup-pull-record.test.mjs'),
  nodeTest('pi-world-refs', 'scripts/pi/world-refs.test.mjs'),
  nodeTest('pi-assistant-gm', 'scripts/pi/assistant-gm.test.mjs'),
  nodeTest('pi-gm-passwords', 'scripts/pi/gm-passwords.test.mjs'),
  nodeTest('pi-player-creation', 'scripts/pi/player-creation.test.mjs'),
  nodeTest('plan-b', 'scripts/plan-b/plan-b.test.mjs'),
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
  { name: 'project-dashboard-test', cmd: 'npm', args: ['run', 'project-dashboard:test'], env: CI },
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
      commands.push(rest.replace(/^(['"])(.*)\1$/, '$2'));
    }
  }
  return commands.filter(c => normalizeCommand(c) !== 'npm ci');
}

/**
 * @param {string[]} argv
 * @returns {{ list: boolean, all: boolean, only: string[], skip: string[], from: string | null, error: string | null }}
 */
export function parseArgs(argv) {
  const out = { list: false, all: false, only: [], skip: [], from: null, error: null };
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
 * The default step runner: stdout and stderr of the step go straight to the log file.
 * @param {Step} step @param {number} fd @param {string} cwd
 * @returns {number} exit status (1 when the process could not start or was killed)
 */
function spawnStep(step, fd, cwd) {
  const r = spawnSync(step.cmd, step.args, {
    cwd,
    shell: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...step.env },
  });
  return r.status ?? 1;
}

/**
 * @param {{
 *   argv?: string[], steps?: Step[], cwd?: string, tmpdir?: string, now?: () => number,
 *   isTTY?: boolean, log?: (line: string) => void, write?: (text: string) => void,
 *   runStep?: (step: Step, fd: number, cwd: string) => number,
 * }} [options]
 * @returns {number} the process exit code
 */
export function main(options = {}) {
  const {
    argv = process.argv.slice(2),
    steps = STEPS,
    cwd = repoRoot(),
    tmpdir = os.tmpdir(),
    now = Date.now,
    isTTY = Boolean(process.stdout.isTTY),
    log = console.log,
    write = text => process.stdout.write(text),
    runStep = spawnStep,
  } = options;

  const opts = parseArgs(argv);
  if (opts.error) {
    log(`green: ${opts.error}`);
    return 2;
  }
  if (opts.list) {
    for (const s of steps) log(s.name);
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

  const logDir = path.join(tmpdir, `green-${stamp(new Date(now()))}`);
  fs.mkdirSync(logDir, { recursive: true });
  const started = now();
  /** @type {{ name: string, logFile: string }[]} */
  const failed = [];
  picked.steps.forEach((step, i) => {
    if (failed.length > 0 && !opts.all) return;
    const nn = String(steps.indexOf(step) + 1).padStart(2, '0');
    const logFile = path.join(logDir, `${nn}-${step.name}.log`);
    if (isTTY) write(`\x1b[2K\rgreen: [${i + 1}/${picked.steps.length}] ${step.name}`);
    const fd = fs.openSync(logFile, 'w');
    let status;
    try {
      status = runStep(step, fd, cwd);
    } finally {
      fs.closeSync(fd);
    }
    if (status !== 0) failed.push({ name: step.name, logFile });
  });
  if (isTTY) write('\x1b[2K\r');

  if (failed.length === 0) {
    log(`green: OK, ${picked.steps.length} steps in ${formatDuration(now() - started)}`);
    return 0;
  }
  for (const f of failed) log(`green: FAILED at ${f.name} (${f.logFile})`);
  const tail = tailOf(failed[0].logFile);
  if (tail) log(tail);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
