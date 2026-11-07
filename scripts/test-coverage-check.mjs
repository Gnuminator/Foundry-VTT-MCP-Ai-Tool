#!/usr/bin/env node
/**
 * Fails when a tracked test file is reached by no workflow command and no known runner, so a new
 * `*.test.*`, `*.spec.*` or `test_*.py` file cannot sit in the repo without ever running.
 *
 *   node scripts/test-coverage-check.mjs
 *
 * A file counts as run when its path (or a glob that matches it) is written in a `run:` command of
 * .github/workflows/*.yml (comments do not count) or in a root package.json script that such a
 * command starts with `npm run`, or when it falls under a RUNNERS pattern: a tool that
 * finds its own files (vitest includes, the Playwright test dirs, pytest in tools/*). Each RUNNERS
 * entry must still match a file, so a runner that is retired is noticed.
 *
 * Blind spots (a file can pass here without running): an inline `#` comment on a single-line
 * `run:` still counts as command text, a path only in `echo` text counts, a workflow that runs
 * only on workflow_dispatch counts, and a step behind an `if:` counts although it may be skipped.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciRunCommands } from './ci-yaml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A tracked path is a test file when its name says so. @param {string} p */
export const isTestFile = p =>
  /\.(test|spec)\.(mjs|cjs|js|ts|tsx)$/.test(p) || /(^|\/)test_[^/]+\.py$/.test(p);

/**
 * Files that a test runner finds by itself. Keep in step with the runner's own config named in the
 * reason.
 * @type {Record<string, string>}
 */
export const RUNNERS = {
  // vitest with its default include (any *.test or *.spec file outside node_modules and dist)
  'packages/mcp-server/src/**': 'vitest default include in packages/mcp-server',
  'packages/foundry-module/src/**': 'vitest default include in packages/foundry-module',
  'tools/livekit/recorder/test/**': 'vitest default include in tools/livekit/recorder (the Livekit recorder tests step)',
  // vitest with an explicit include list
  'shared/src/**/*.test.ts': 'vitest include in shared/vitest.config.ts (the shared unit-test step in ci.yml: npm test -w @gnuminator/shared)',
  'packages/obsidian-plugin/src/**/*.test.ts': 'vitest include in packages/obsidian-plugin/vitest.config.ts',
  'packages/discord-bot/src/**/*.test.ts': 'vitest include in packages/discord-bot/vitest.config.ts',
  'packages/discord-bot/announce/**/*.test.mjs': 'vitest include in packages/discord-bot/vitest.config.ts',
  'packages/cogm-dashboard/src/**/*.test.ts': 'vitest include in packages/cogm-dashboard/vitest.config.ts',
  'packages/cogm-dashboard/web/src/**/*.test.ts': 'vitest include in packages/cogm-dashboard/vitest.config.ts',
  'packages/cogm-dashboard/web/src/**/*.test.tsx': 'vitest include in packages/cogm-dashboard/vitest.config.ts',
  'packages/cogm-dashboard/scripts/**/*.test.mjs': 'vitest include in packages/cogm-dashboard/vitest.config.ts',
  'packages/cogm-dashboard/web/e2e/**': 'Playwright testDir in packages/cogm-dashboard/web/playwright.config.ts',
  'packages/cogm-dashboard/web/visual/**': 'Playwright testDir in playwright.visual.config.ts (dashboard-visual job)',
  'tools/*/tests/**/test_*.py': 'pytest loop in the python-tests job (every tools/<name>/ with pyproject.toml and tests/)',
};

/**
 * Extra conditions a runner needs before it picks a file up: the python-tests job skips a tool
 * folder without a pyproject.toml. Gets the file and the set of all tracked paths.
 * @type {Record<string, (file: string, tracked: Set<string>) => boolean>}
 */
const RUNNER_NEEDS = {
  'tools/*/tests/**/test_*.py': (f, tracked) => tracked.has(`${f.split('/').slice(0, 2).join('/')}/pyproject.toml`),
};

/** @param {string} glob @returns {RegExp} */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * The paths and globs written in command text (workflow files, package scripts).
 * @param {string} text
 * @returns {string[]}
 */
export function pathsIn(text) {
  return [...text.matchAll(/[\w@./*{}-]+\.(?:test|spec)\.[\w*]+/g)].map(m => m[0].replace(/^\.\//, ''));
}

/**
 * @param {string[]} files tracked test files
 * @param {string} commandText workflows and package scripts, joined
 * @param {Set<string>} [tracked] every tracked path, for runners that need a file beside the tests
 * @returns {{ unrun: string[], staleRunners: string[] }}
 */
export function checkCoverage(files, commandText, tracked = new Set(files)) {
  const written = pathsIn(commandText);
  const runnerRes = Object.keys(RUNNERS).map(g => [g, globToRegExp(g), RUNNER_NEEDS[g]]);
  const picks = ([, re, needs], f) => re.test(f) && (!needs || needs(f, tracked));
  const writtenRes = written.map(w => (w.includes('*') ? globToRegExp(w) : null));
  const unrun = files.filter(f => {
    if (written.includes(f)) return false;
    if (writtenRes.some(re => re && re.test(f))) return false;
    return !runnerRes.some(r => picks(r, f));
  });
  const staleRunners = runnerRes.filter(r => !files.some(f => picks(r, f))).map(([g]) => g);
  return { unrun, staleRunners };
}

/** The `run:` commands of every job of one workflow file (comments and `with:` text excluded). @param {string} yaml */
export function workflowCommands(yaml) {
  const jobs = [];
  let inJobs = false;
  for (const line of yaml.split(/\r?\n/)) {
    if (/^jobs:\s*$/.test(line)) inJobs = true;
    else if (inJobs) {
      const m = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(line);
      if (m) jobs.push(m[1]);
    }
  }
  return jobs.flatMap(j => ciRunCommands(yaml, j));
}

/**
 * Commands plus the root package scripts they start with `npm run <name>` (followed to any depth).
 * A script nobody invokes does not count.
 * @param {string[]} commands @param {Record<string, string>} scripts
 */
export function expandCommands(commands, scripts) {
  const out = [];
  const seen = new Set();
  const queue = [...commands];
  while (queue.length) {
    const c = queue.shift();
    out.push(c);
    for (const m of c.matchAll(/npm run ([\w:.-]+)/g)) {
      if (!seen.has(m[1]) && scripts[m[1]]) {
        seen.add(m[1]);
        queue.push(scripts[m[1]]);
      }
    }
  }
  return out;
}

function main() {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\0')
    .filter(Boolean);
  const files = tracked.filter(isTestFile);
  const wfDir = path.join(ROOT, '.github', 'workflows');
  const workflows = fs
    .readdirSync(wfDir)
    .filter(n => n.endsWith('.yml'))
    .map(n => fs.readFileSync(path.join(wfDir, n), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const text = expandCommands(workflows.flatMap(workflowCommands), pkg.scripts ?? {}).join('\n');
  const { unrun, staleRunners } = checkCoverage(files, text, new Set(tracked));
  if (unrun.length === 0 && staleRunners.length === 0) {
    console.log(`test-coverage: OK, ${files.length} test files all run somewhere`);
    return 0;
  }
  if (unrun.length) {
    console.error('test-coverage: these test files are reached by no workflow command or runner:');
    for (const f of unrun) console.error(`  ${f}`);
    console.error('Add them to a ci.yml step (and scripts/checks.mjs) or delete them.');
  }
  if (staleRunners.length) {
    console.error('test-coverage: RUNNERS entries that match no test file any more:');
    for (const g of staleRunners) console.error(`  ${g}`);
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
