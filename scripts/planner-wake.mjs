#!/usr/bin/env node
/**
 * Planner wake watcher: wait until a `- progress:` line in the vault Backlog is new or changed,
 * then exit, so the app wakes the planner (it is run with run_in_background).
 *
 *   node scripts/planner-wake.mjs [--vault <dir>] [--interval <s>] [--cold-after <s>] [--max-wait <s>]
 *
 * The baseline is the progress lines at start. Each round runs `git fetch` in the vault and reads
 * Backlog.md from the upstream commit (`git show @{u}:...`), so the shared working tree is never
 * touched and uncommitted vault edits cannot hide a change. Exit codes:
 *   0  a progress line changed and the planner has been waiting less than --cold-after (default 3600 s)
 *   3  a progress line changed after --cold-after: the planner is cold, so it starts a fresh planner
 *      with the printed brief instead of working on in its old context
 *   4  nothing changed within --max-wait (default 14400 s): a quiet fallback wake
 *   1  usage error or no Backlog.md
 * The wait starts when the planner arms the watcher at the end of its turn, so "waiting" is the time
 * the planner has been idle. Output: one line per changed item, `<id>: <progress line>`.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKLOG_PATH = 'Dev/Foundry AI Tool/Backlog.md';
export const DEFAULTS = { interval: 60, coldAfter: 3600, maxWait: 14400 };

/**
 * Item id -> its `- progress:` text, for every `## S|M|L` item that has both lines.
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseProgress(text) {
  const map = new Map();
  const lines = text.split(/\r?\n/);
  for (let start = 0; start < lines.length; ) {
    let end = start + 1;
    while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
    const block = lines.slice(start, end);
    if (/^##\s+[SML]\s/.test(block[0])) {
      const id = block.map(l => /^-\s+id\s*:\s*(\S+)/i.exec(l)).find(Boolean)?.[1];
      const progress = block
        .map(l => /^-\s+progress\s*:\s*(.*?)\s*$/i.exec(l)?.[1])
        .filter(Boolean)
        .join('\n');
      if (id && progress) map.set(id, progress);
    }
    start = end;
  }
  return map;
}

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

/** @param {number} waitedSeconds @param {number} coldAfter */
export const isCold = (waitedSeconds, coldAfter) => waitedSeconds >= coldAfter;

/** The brief a cold planner gives its fresh successor. @param {{ id: string, progress: string }[]} changes */
export function freshBrief(changes) {
  return [
    'You are the Foundry AI Tool planner (load the `planner` skill, follow CLAUDE.md).',
    'The previous planner was idle over an hour; a lane reported:',
    ...changes.map(c => `- ${c.id}: ${c.progress}`),
    'Read every claimed item in vault Backlog.md (progress lines) and `gh pr list --state open`, merge what is ready,',
    'start or fix what is not, then arm the next `node scripts/planner-wake.mjs` watcher in the background.'
  ].join('\n');
}

/**
 * @param {string[]} argv
 * @returns {{ vault: string, interval: number, coldAfter: number, maxWait: number }}
 */
export function parseArgs(argv) {
  const o = {
    vault: process.env.FOUNDRY_AI_OBSIDIAN_DIR || path.join(os.homedir(), 'Documents', 'Obsidian', 'vault'),
    ...DEFAULTS
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
    else if (a === '--cold-after') o.coldAfter = num(a, argv[++i]);
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
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  });
  return { status: r.status, stdout: r.stdout ?? '' };
};

/**
 * Backlog.md as the vault's upstream branch has it: fetch, then `git show @{u}:<path>`. Never touches
 * the working tree (the vault is shared with the planner, lanes and open Obsidian notes, and may be
 * dirty). A fetch problem is ignored: the last fetched copy is read. Returns null when unreadable.
 * @param {Git} git
 * @returns {string | null}
 */
export function readUpstreamBacklog(git) {
  git(['fetch', '-q']);
  const r = git(['show', `@{u}:${BACKLOG_PATH}`]);
  return r.status === 0 && r.stdout ? r.stdout : null;
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`planner-wake: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  const git = gitIn(o.vault);
  const first = readUpstreamBacklog(git);
  if (first === null) {
    console.error(`planner-wake: cannot read ${BACKLOG_PATH} from the upstream branch of ${o.vault}`);
    process.exit(1);
  }
  const before = parseProgress(first);
  const started = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, o.interval * 1000));
    const waited = (Date.now() - started) / 1000;
    const text = readUpstreamBacklog(git);
    const changes = text === null ? [] : changedProgress(before, parseProgress(text));
    if (changes.length) {
      for (const c of changes) console.log(`${c.id}: ${c.progress}`);
      if (isCold(waited, o.coldAfter)) {
        console.log(`planner-wake: cold (waited ${Math.round(waited / 60)} min); start a fresh planner with this brief:`);
        console.log(freshBrief(changes));
        process.exit(3);
      }
      process.exit(0);
    }
    if (waited >= o.maxWait) {
      console.log(`planner-wake: no progress change in ${Math.round(waited / 60)} min`);
      process.exit(4);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
