#!/usr/bin/env node
/**
 * Lane heartbeat: write `- last seen: <YYYY-MM-DD HH:MM> <step>` under the lane's claim in the vault
 * Backlog, so the PM board's lane card shows the step and its age and the stale rule counts it.
 *
 *   npm run lane:beat -- "<lane name>" "<step>"
 *   npm run lane:beat -- board-today "PR open"
 *
 * The lane name is the one written after `- claimed:` (the session title). Every claimed item of
 * that lane gets the line (an existing `- last seen:` line is replaced). The time is Copenhagen
 * time, the board's zone. Milestones, from the `lane` skill: claimed, PR open, review, fixes,
 * ready to merge, handed over.
 *
 * Vault rules: pull, commit only Backlog.md, push (one retry). A vault problem is a WARNING line and
 * exit 0, so a heartbeat never stops a lane; exit 1 is for a call that cannot work (no lane name,
 * no step, no claimed item for the lane in the Backlog). The vault is $FOUNDRY_AI_OBSIDIAN_DIR or
 * ~/Documents/Obsidian/vault; --vault overrides it. --dry-run prints the edit and writes nothing.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKLOG_PATH = 'Dev/Foundry AI Tool/Backlog.md';
export const STEP_MAX = 60;
const TZ = 'Europe/Copenhagen';
const GIT_TIMEOUT_MS = 30000;

const zoneFmt = new Intl.DateTimeFormat('sv', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

/**
 * `2026-10-23 16:40` in Copenhagen time. In the hour the October clock change repeats (02:00 to 02:59
 * twice) the wall time is ambiguous, so it carries its offset (`2026-10-25 02:30+02:00`).
 * @param {Date} date
 */
export function stampOf(date) {
  const wall = zoneFmt.format(date);
  const ambiguous = [-1, 1].some(h => zoneFmt.format(new Date(date.getTime() + h * 36e5)) === wall);
  if (!ambiguous) return wall;
  const asUtc = Date.parse(`${wall.replace(' ', 'T')}:00Z`);
  const hours = Math.round((asUtc - Math.floor(date.getTime() / 6e4) * 6e4) / 36e5);
  return `${wall}+${String(hours).padStart(2, '0')}:00`;
}

/** One line of at most STEP_MAX characters, no control characters. @param {string} text */
export const cleanStep = text =>
  String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, STEP_MAX)
    .trim();

/** The lane name of a claim value (`<lane> <YYYY-MM-DD> [kind: x] [server: y]`). @param {string} value */
export function claimLane(value) {
  const rest = String(value)
    .replace(/\s+kind:\s*[\p{L}-]+/iu, '')
    .replace(/\s+server:\s*\S+/i, '')
    .trim();
  return rest.replace(/\s*\d{4}-\d{2}-\d{2}\s*$/, '').trim() || rest;
}

/**
 * Put the heartbeat under every `- claimed:` line of the lane (replacing a `- last seen:` line the
 * item already has). Keeps the note's line endings. -> { text, items } (items = how many got it).
 * @param {string} text @param {string} lane @param {string} stamp @param {string} step
 */
export function setBeat(text, lane, stamp, step) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const isClaim = (/** @type {string} */ l) => {
    const m = /^-\s+claimed\s*:\s*(.*?)\s*$/i.exec(l);
    return !!m && claimLane(m[1]) === lane;
  };
  const out = [];
  let items = 0;
  // an item is the lines from its heading (`# ` or `## `) to the next one
  for (let start = 0; start < lines.length; ) {
    let end = start + 1;
    while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
    const block = lines.slice(start, end);
    // only a `## S|M|L <title>` item counts, as on the board: not the preamble or a `# ` chapter heading
    if (/^##\s+[SML]\s/.test(block[0]) && block.some(isClaim)) {
      items++;
      let put = false;
      for (const l of block) {
        if (/^-\s+last seen\s*:/i.test(l)) continue; // the item's old heartbeat
        out.push(l);
        if (!put && isClaim(l)) {
          out.push(`- last seen: ${stamp}${step ? ` ${step}` : ''}`);
          put = true;
        }
      }
    } else {
      out.push(...block);
    }
    start = end;
  }
  return { text: out.join(nl), items };
}

/** @typedef {(cmd: string, args: string[]) => { status: number | null, stdout: string, stderr: string }} Run */

/** @type {Run} */
const defaultRun = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.error ? String(r.error.message) : (r.stderr ?? '') };
};

const firstLine = (/** @type {string} */ s) => String(s).trim().split(/\r?\n/)[0] ?? '';

/**
 * Write the heartbeat into the vault Backlog and push it. Never throws: every vault problem is a
 * warning text (empty when all went well); `items` is 0 when the lane has no claim.
 * @param {{ vault: string, lane: string, step: string, now: Date, run?: Run, dryRun?: boolean }} o
 * @returns {{ warning: string, items: number, line: string }}
 */
export function publishBeat({ vault, lane, step, now, run = defaultRun, dryRun = false }) {
  const stamp = stampOf(now);
  const line = `- last seen: ${stamp}${step ? ` ${step}` : ''}`;
  const git = (/** @type {string[]} */ ...a) => run('git', ['-C', vault, ...a]);
  const why = (/** @type {{ stderr: string, stdout: string }} */ r) => firstLine(r.stderr || r.stdout) || 'failed';
  const skipped = (/** @type {string} */ w) => ({ warning: `heartbeat not written: ${w}`, items: -1, line });
  try {
    const file = path.join(vault, ...BACKLOG_PATH.split('/'));
    if (!fs.existsSync(path.join(vault, '.git')) || !fs.existsSync(file)) {
      return skipped(`no vault checkout with ${BACKLOG_PATH} at ${vault}`);
    }
    if (dryRun) return { warning: '', items: setBeat(fs.readFileSync(file, 'utf8'), lane, stamp, step).items, line };
    // The vault is shared with the planner, other lanes and open Obsidian notes: never rebase or autostash in it.
    // Backlog.md with edits nobody committed yet is left alone; fetch plus a fast-forward does the pull.
    const dirty = git('status', '--porcelain', '--', BACKLOG_PATH);
    if (dirty.status !== 0) return skipped(`vault status failed (${why(dirty)})`);
    if (dirty.stdout.trim()) return skipped('Backlog.md has uncommitted edits in the vault (another session is editing it)');
    let pushError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const fetched = git('fetch');
      if (fetched.status !== 0) return skipped(`vault fetch failed (${why(fetched)})`);
      const merged = git('merge', '--ff-only', '@{u}');
      if (merged.status !== 0) return skipped(`vault pull failed (${why(merged)})`);
      const set = setBeat(fs.readFileSync(file, 'utf8'), lane, stamp, step);
      if (set.items === 0) return { warning: '', items: 0, line };
      fs.writeFileSync(file, set.text);
      const added = git('add', '--', BACKLOG_PATH);
      if (added.status !== 0) return { warning: `heartbeat not committed (${why(added)})`, items: set.items, line };
      const committed = git('commit', '-m', `Lane beat: ${lane}${step ? `, ${step}` : ''}`, '--', BACKLOG_PATH);
      if (committed.status !== 0) {
        git('restore', '--staged', '--worktree', '--', BACKLOG_PATH);
        return { warning: `heartbeat not committed (${why(committed)})`, items: set.items, line };
      }
      const pushed = git('push');
      if (pushed.status === 0) return { warning: '', items: set.items, line };
      pushError = why(pushed);
      // take our own commit back, so the vault is left as it was and the next try starts clean
      git('reset', '--soft', 'HEAD~1');
      git('restore', '--staged', '--worktree', '--', BACKLOG_PATH);
    }
    return { warning: `heartbeat not pushed (${pushError})`, items: -1, line };
  } catch (e) {
    return skipped(e instanceof Error ? e.message : String(e));
  }
}

/**
 * @param {string[]} argv
 * @param {{ env?: NodeJS.ProcessEnv, home?: string, now?: () => Date, run?: Run, log?: (s: string) => void, err?: (s: string) => void }} [o]
 */
export function main(argv, o = {}) {
  const env = o.env ?? process.env;
  const log = o.log ?? console.log;
  const err = o.err ?? console.error;
  const pos = [];
  let vault = '';
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--vault') vault = argv[++i] ?? '';
    else if (argv[i] === '--dry-run') dryRun = true;
    else pos.push(argv[i]);
  }
  const lane = String(pos[0] ?? '').trim();
  const step = cleanStep(pos.slice(1).join(' '));
  if (!lane || !step) {
    err('usage: npm run lane:beat -- "<lane name>" "<step>"   (steps: claimed, PR open, review, fixes, ready to merge, handed over)');
    return 1;
  }
  vault ||= env.FOUNDRY_AI_OBSIDIAN_DIR || path.join(o.home ?? os.homedir(), 'Documents', 'Obsidian', 'vault');
  const r = publishBeat({ vault, lane, step, now: (o.now ?? (() => new Date()))(), ...(o.run ? { run: o.run } : {}), dryRun });
  if (r.warning) err(`lane:beat: WARNING: ${r.warning}`);
  if (r.items === 0) {
    err(`lane:beat: no \`- claimed: ${lane} ...\` line in the Backlog, so nothing was written (the lane name is the one after claimed:).`);
    return 1;
  }
  if (r.items > 0 && !r.warning) log(`lane:beat: ${dryRun ? 'would write' : 'wrote'} "${r.line}" under ${r.items} claimed item${r.items === 1 ? '' : 's'} of ${lane}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
