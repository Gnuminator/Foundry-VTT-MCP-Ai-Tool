#!/usr/bin/env node
/**
 * Planner wake watcher: wait until a `- progress:` line in the vault Backlog is new or changed,
 * then exit, so the app wakes the planner (it is run with run_in_background).
 *
 *   node scripts/planner-wake.mjs [--vault <dir>] [--interval <s>] [--cold-after <s>] [--max-wait <s>]
 *
 * The baseline is the progress lines at start. Each round fast-forwards the vault (never a rebase or
 * autostash), reads Backlog.md and compares. Exit codes:
 *   0  a progress line changed and the planner has been waiting less than --cold-after (default 3600 s)
 *   3  a progress line changed after --cold-after: the planner is cold, so it starts a fresh planner
 *      with the printed brief instead of working on in its old context
 *   4  nothing changed within --max-wait (default 14400 s): a quiet fallback wake
 *   1  usage error or no Backlog.md
 * The wait starts when the planner arms the watcher at the end of its turn, so "waiting" is the time
 * the planner has been idle. Output: one line per changed item, `<id>: <progress line>`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
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
      const progress = block.map(l => /^-\s+progress\s*:\s*(.*?)\s*$/i.exec(l)).find(Boolean)?.[1];
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

/** Fast-forward the vault; a problem is ignored (the next round retries). @param {string} vault */
function pullVault(vault) {
  spawnSync('git', ['-C', vault, 'pull', '--ff-only', '-q'], {
    timeout: 30000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  });
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`planner-wake: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  const file = path.join(o.vault, ...BACKLOG_PATH.split('/'));
  const read = () => parseProgress(fs.readFileSync(file, 'utf8'));
  if (!fs.existsSync(file)) {
    console.error(`planner-wake: no ${BACKLOG_PATH} in ${o.vault}`);
    process.exit(1);
  }
  const before = read();
  const started = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, o.interval * 1000));
    const waited = (Date.now() - started) / 1000;
    pullVault(o.vault);
    let changes;
    try {
      changes = changedProgress(before, read());
    } catch {
      continue; // the vault rewrote the file under us: try again next round
    }
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
