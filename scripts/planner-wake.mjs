#!/usr/bin/env node
/**
 * Planner wake watcher: wait until a `- progress:` line in the vault Backlog is new or changed,
 * then exit, so the app wakes the planner (it is run with run_in_background).
 *
 *   node scripts/planner-wake.mjs [--vault <dir>] [--interval <s>] [--max-wait <s>]
 *
 * The baseline is the progress lines at start. Each round runs `git fetch` in the vault and reads
 * Backlog.md from the upstream commit (`git show @{u}:...`), so the shared working tree is never
 * touched and uncommitted vault edits cannot hide a change. Exit codes:
 *   0  a progress line changed
 *   4  nothing changed within --max-wait (default 14400 s): a quiet fallback wake (the message says
 *      how many fetches or reads failed, each also printed to stderr as it happened)
 *   1  usage error or no Backlog.md
 * There is no standing planner (D-141): no exit starts a successor. The merge runner
 * (scripts/merge-runner.mjs) reads the ready lines itself and shares readUpstreamBacklog. Output:
 * one line per changed item, `<id>: <progress line>`; a multi-line value repeats the prefix on each
 * line. Exit codes are set with process.exitCode.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProgress } from './backlog-items.mjs';

export const BACKLOG_PATH = 'Dev/Foundry AI Tool/Backlog.md';
export const DEFAULTS = { interval: 60, maxWait: 14400 };

// The item parser is shared with scripts/backlog.mjs.
export { parseProgress };

/**
 * Items whose progress line is new or different. A removed line (item merged) is not a change.
 * @param {Map<string, string>} before @param {Map<string, string>} after
 * @returns {{ id: string, progress: string }[]}
 */
export function changedProgress(before, after) {
  const out = [];
  for (const [id, progress] of after) if (before.get(id) !== progress) out.push({ id, progress });
  return out;
}

/**
 * Output lines for changed items: every line of a multi-line progress value gets the id prefix.
 * @param {{ id: string, progress: string }[]} changes
 * @returns {string[]}
 */
export const formatChanges = changes =>
  changes.flatMap(c => c.progress.split('\n').map(line => `${c.id}: ${line}`));

/**
 * @param {string[]} argv
 * @returns {{ vault: string, interval: number, maxWait: number }}
 */
export function parseArgs(argv) {
  const o = {
    vault:
      process.env.FOUNDRY_AI_OBSIDIAN_DIR ||
      path.join(os.homedir(), 'Documents', 'Obsidian', 'vault'),
    ...DEFAULTS,
  };
  const num = (/** @type {string} */ name, /** @type {string | undefined} */ v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1) throw new Error(`${name} needs a positive number of seconds`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vault') o.vault = argv[++i] ?? '';
    else if (a === '--interval') o.interval = num(a, argv[++i]);
    else if (a === '--max-wait') o.maxWait = num(a, argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.vault) throw new Error('--vault needs a directory');
  return o;
}

/** @typedef {(args: string[]) => { status: number | null, stdout: string }} Git */

/** @type {(vault: string) => Git} */
const gitIn = vault => args => {
  const r = spawnSync('git', ['-C', vault, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return { status: r.status, stdout: r.stdout ?? '' };
};

/**
 * Backlog.md as the vault's upstream branch has it: fetch, then `git show @{u}:<path>`. Never touches
 * the working tree (the vault is shared with the planner, lanes and open Obsidian notes, and may be
 * dirty). A failed fetch is reported through `warn` and the last fetched copy is read. Returns null
 * (after a `warn` line) when unreadable.
 * @param {Git} git
 * @param {(message: string) => void} [warn]
 * @returns {string | null}
 */
export function readUpstreamBacklog(git, warn = m => console.error(`planner-wake: ${m}`)) {
  const fetched = git(['fetch', '-q']);
  if (fetched.status !== 0)
    warn(`git fetch failed (status ${fetched.status}); reading the last fetched copy`);
  const r = git(['show', `@{u}:${BACKLOG_PATH}`]);
  if (r.status === 0 && r.stdout) return r.stdout;
  warn(`cannot read ${BACKLOG_PATH} from the upstream branch (git show status ${r.status})`);
  return null;
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`planner-wake: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
    return;
  }
  const git = gitIn(o.vault);
  const first = readUpstreamBacklog(git);
  if (first === null) {
    process.exitCode = 1;
    return;
  }
  const before = parseProgress(first);
  const started = Date.now();
  let failed = 0;
  for (;;) {
    await new Promise(r => setTimeout(r, o.interval * 1000));
    const waited = (Date.now() - started) / 1000;
    const text = readUpstreamBacklog(git, m => {
      failed++;
      console.error(`planner-wake: ${m}`);
    });
    const changes = text === null ? [] : changedProgress(before, parseProgress(text));
    if (changes.length) {
      for (const line of formatChanges(changes)) console.log(line);
      process.exitCode = 0;
      return;
    }
    if (waited >= o.maxWait) {
      const note = failed
        ? ` (${failed} fetch or read problems, see stderr: the vault may be unreachable)`
        : '';
      console.log(`planner-wake: no progress change in ${Math.round(waited / 60)} min${note}`);
      process.exitCode = 4;
      return;
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  await main();
