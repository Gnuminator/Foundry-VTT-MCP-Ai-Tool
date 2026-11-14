#!/usr/bin/env node
/**
 * The one writer of the vault Backlog for sessions (item `backlog-tool`). Lanes never edit
 * Backlog.md by hand: `.claude/hooks/guard-backlog.mjs` refuses it from a worktree.
 *
 *   node scripts/backlog.mjs status [--planner]             claimed items, then the top free ones;
 *                                         --planner adds PRs with CI and verdict, train, main CI, Waiting
 *   node scripts/backlog.mjs claim <id> <session title> [--link <claude:// link>]
 *   node scripts/backlog.mjs progress <id> <text>          replaces the item's progress line
 *   node scripts/backlog.mjs progress <id> --ready <PR> --head <sha> [--review <note path>]
 *                                         the ready line the merge runner acts on (readyText)
 *   node scripts/backlog.mjs progress <id> <text> --if-ready <PR>@<sha>
 *                                         only while that ready line is still the item's line
 *   node scripts/backlog.mjs release <id>                  removes the claimed and link lines
 *   node scripts/backlog.mjs done <id> <PR> [--sha <sha>] [--summary <text>] [--by <who>]
 *                                         [--pi-run <text>]
 *   node scripts/backlog.mjs add --id <slug> --size S|M|L --title <t> --board <area>
 *        --done-when <t> [--area --gate --blocked-by --touches --depends-on --source <t>]
 *        [--pi] [--private] [--after <id> | --chapter <heading text>]   or   add --file <block.md>
 *   node scripts/backlog.mjs low <area> <text>             appends to Lows/<area>.md
 *
 * Common flags: --vault <dir> (default env FOUNDRY_AI_OBSIDIAN_DIR, else ~/Documents/Obsidian/vault),
 * --date YYYY-MM-DD (default today), --dry-run (print what would be written, write nothing).
 *
 * Each write: take a lock in the vault's .git folder (the vault is one working tree shared by every
 * session), refuse when a file it writes has uncommitted changes, fetch and fast-forward (a rebase
 * only when the vault already has unpushed commits), read the file fresh (the live board rewrites
 * it), make the one-item edit, check it (`checkEdit` in backlog-items.mjs), commit only those files
 * and push. A rejected push drops that one commit (`git reset --keep`, only while it is still HEAD)
 * and starts again from the fetch, up to 5 times. The file keeps its own line endings. `status`
 * only reads (the upstream copy).
 *
 * Choices: `progress` adds today's date when the text does not start with one. `done` writes
 * `- <date> <id>: PR #<n> merged[ at <sha>][; <summary>] (<by>) | <board>[ | private]` above the
 * first dated line of `Backlog done.md`; `--pi-run` adds `- <date> <id>: <text>` to
 * `Pi sitting list.md` (made when missing). `add` with no `--after` or `--chapter` goes to the end of
 * `## Captured on the board (triage)` with a `- captured:` line. `low` needs an existing
 * `Lows/<area>.md`. `claim` refuses a claimed item, one whose progress says merged or fixed, and one
 * whose `blocked by` names an item still in the Backlog.
 *
 * Exit codes: 0 done, 1 refused or failed, 2 usage.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pidAlive, sleepSync } from './heavy-lock.mjs';
import { ghJson, plannerSections, REPO } from './planner-state.mjs';
import {
  checkEdit,
  findItem,
  isMerged,
  itemRefs,
  newestProgress,
  newlineOf,
  parseBacklog,
  parseReady,
  readyText,
  setField,
  splice,
  trimBlock,
} from './backlog-items.mjs';

export const DIR = 'Dev/Foundry AI Tool';
export const BACKLOG = `${DIR}/Backlog.md`;
export const DONE = `${DIR}/Backlog done.md`;
export const PI_LIST = `${DIR}/Pi sitting list.md`;
export const LOWS = `${DIR}/Lows`;
export const RETRIES = 5;
const TRIAGE = /^Captured on the board/i;

class Usage extends Error {}

/** @param {string} s */
const oneLine = s => {
  if (/[\r\n]/.test(s)) throw new Error('the text must be one line');
  return s.trim();
};
const dated = (/** @type {string} */ date, /** @type {string} */ s) =>
  /^\d{4}-\d{2}-\d{2}\b/.test(s) ? s : `${date} ${s}`;
const field = (/** @type {import('./backlog-items.mjs').Item} */ i, /** @type {string} */ n) =>
  i.fields.get(n)?.at(-1) ?? '';

// ---- edits: pure (text in, text out) -------------------------------------------------------------

/**
 * @param {string} text
 * @param {{ id: string, title: string, date: string, link?: string }} o
 */
export function claimEdit(text, o) {
  const p = parseBacklog(text);
  const item = findItem(p, o.id);
  const claimed = field(item, 'claimed');
  if (claimed) throw new Error(`${o.id} is already claimed: ${claimed}`);
  if (isMerged(item) || /\bfixed\b/i.test(newestProgress(item)))
    throw new Error(
      `${o.id} says it is merged or fixed (progress: ${newestProgress(item)}); ask the planner`
    );
  const open = new Set(p.items.map(i => i.id));
  const blockers = (item.fields.get('blocked by') ?? []).flatMap(itemRefs).filter(r => open.has(r));
  if (blockers.length)
    throw new Error(`${o.id} is blocked by open item(s): ${blockers.join(', ')}`);
  const { body, tail } = trimBlock(item);
  const add = [`- claimed: ${oneLine(o.title)} ${o.date}`];
  if (o.link) add.push(`- link: ${oneLine(o.link)}`);
  const next = setField(setField(body, 'link', [], []), 'claimed', add, []);
  const out = splice(p, item.start, item.end, [...next, ...tail]);
  checkEdit(text, out, { id: o.id, items: 0 });
  const waits = (item.fields.get('depends on') ?? []).flatMap(itemRefs).filter(r => open.has(r));
  return {
    text: out,
    notes: waits.length ? [`note: ${o.id} depends on open item(s) ${waits.join(', ')}`] : [],
  };
}

/**
 * `ifReady`: write only while the item's progress is still that PR's ready line at that head (the
 * merge runner's refusals must not overwrite a newer ready line).
 * @param {string} text
 * @param {{ id: string, text: string, date: string, ifReady?: { pr: number, head: string } }} o
 */
export function progressEdit(text, o) {
  const p = parseBacklog(text);
  const item = findItem(p, o.id);
  if (o.ifReady) {
    const now = parseReady(field(item, 'progress'));
    if (!now || now.pr !== o.ifReady.pr || now.head !== o.ifReady.head)
      throw new Error(
        `${o.id}: the progress line is no longer the ready line of PR #${o.ifReady.pr} at ${o.ifReady.head.slice(0, 7)}; not written`
      );
  }
  const { body, tail } = trimBlock(item);
  const line = `- progress: ${dated(o.date, oneLine(o.text))}`;
  const next = setField(body, 'progress', [line], ['link', 'claimed']);
  const out = splice(p, item.start, item.end, [...next, ...tail]);
  checkEdit(text, out, { id: o.id, items: 0 });
  return { text: out, notes: [] };
}

/** @param {string} text @param {{ id: string }} o */
export function releaseEdit(text, o) {
  const p = parseBacklog(text);
  const item = findItem(p, o.id);
  if (!field(item, 'claimed')) throw new Error(`${o.id} is not claimed`);
  const { body, tail } = trimBlock(item);
  const next = setField(setField(body, 'claimed', []), 'link', []);
  const out = splice(p, item.start, item.end, [...next, ...tail]);
  checkEdit(text, out, { id: o.id, items: 0, lines: next.length - body.length });
  return { text: out, notes: [] };
}

/**
 * Remove the item from Backlog.md and add its line at the top of the Backlog done list.
 * @param {string} text @param {string} doneText
 * @param {{ id: string, pr: string, date: string, sha?: string, summary?: string, by?: string }} o
 */
export function doneEdit(text, doneText, o) {
  const p = parseBacklog(text);
  const item = findItem(p, o.id);
  const pr = /^#?(\d+)$/.exec(o.pr.trim())?.[1];
  if (!pr) throw new Usage(`the PR must be a number, got "${o.pr}"`);
  const board = field(item, 'board') || field(item, 'area') || 'unsorted';
  let line = `- ${o.date} ${o.id}: PR #${pr} merged`;
  if (o.sha) line += ` at ${oneLine(o.sha).slice(0, 7)}`;
  if (o.summary) line += `; ${oneLine(o.summary)}`;
  line += ` (${oneLine(o.by || 'planner')}) | ${board}`;
  if (/^yes\b/i.test(field(item, 'private'))) line += ' | private';
  const out = splice(p, item.start, item.end, []);
  checkEdit(text, out, { id: o.id, items: -1, lines: -(item.end - item.start) });
  return { text: out, done: insertDoneLine(doneText, line), line };
}

/** @param {string} doneText @param {string} line */
export function insertDoneLine(doneText, line) {
  const nl = newlineOf(doneText);
  const lines = doneText.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error('Backlog done.md no longer starts with front matter');
  let at = lines.findIndex(l => /^- \d{4}-\d{2}-\d{2} /.test(l));
  if (at < 0) {
    at = lines.length;
    while (at > 0 && lines[at - 1] === '') at--;
  }
  lines.splice(at, 0, line);
  return lines.join(nl);
}

/** @param {string} piText (empty when the file is missing) @param {string} line @param {string} date */
export function piListEdit(piText, line, date) {
  if (!piText) {
    return [
      '---',
      'type: list',
      `updated: ${date}`,
      '---',
      '# Pi sitting list',
      '',
      'Merged items with only a Pi run left (item `pi-sitting-list`). `node scripts/backlog.mjs done <id> <PR> --pi-run "<text>"` adds a line; the next Pi sitting works down the list.',
      '',
      line,
      '',
    ].join('\n');
  }
  return appendLine(piText, line);
}

/** @param {string} text @param {string} line */
export function appendLine(text, line) {
  const nl = newlineOf(text);
  const lines = text.split(/\r?\n/);
  while (lines.length && lines.at(-1) === '') lines.pop();
  // A list follows a blank line after its heading or text; list lines follow each other.
  if (lines.length && !lines.at(-1)?.startsWith('- ')) lines.push('');
  return [...lines, line, ''].join(nl);
}

const ADD_FIELDS = [
  ['id', 'id'],
  ['board', 'board'],
  ['gate', 'gate'],
  ['area', 'area'],
  ['done-when', 'done when'],
  ['touches', 'touches'],
  ['blocked-by', 'blocked by'],
  ['depends-on', 'depends on'],
  ['source', 'source'],
];

/** The block for `add` from flags. @param {Record<string, string | boolean>} f */
export function blockFromFlags(f) {
  const need = ['id', 'size', 'title', 'board', 'done-when'].filter(k => !f[k]);
  if (need.length) throw new Usage(`add needs ${need.map(k => `--${k}`).join(', ')} (or --file)`);
  const size = String(f.size).toUpperCase();
  if (!/^[SML]$/.test(size)) throw new Usage('--size is S, M or L');
  const lines = [`## ${size} ${oneLine(String(f.title))}`, ''];
  for (const [flag, name] of ADD_FIELDS)
    if (typeof f[flag] === 'string') lines.push(`- ${name}: ${oneLine(f[flag])}`);
  if (f.pi) lines.push('- pi: yes');
  if (f.private) lines.push('- private: yes');
  return lines;
}

/** Paths in a `touches` value, without a trailing "(about lines ...)". @param {string} v */
const touchPaths = v =>
  v
    .split(',')
    .map(s =>
      s
        .replace(/\(.*?\)/g, '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
    )
    .filter(Boolean);
const overlaps = (/** @type {string} */ a, /** @type {string} */ b) =>
  a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/**
 * @param {string} text @param {string} doneText
 * @param {{ block: string[], date: string, after?: string, chapter?: string }} o
 */
export function addEdit(text, doneText, o) {
  const p = parseBacklog(text);
  const block = o.block.map(l => l.replace(/\s+$/, ''));
  while (block.length && block.at(-1) === '') block.pop();
  while (block.length && block[0] === '') block.shift();
  const head = parseBacklog(['---', '---', '# Backlog', ...block, ''].join('\n')).items;
  if (head.length !== 1 || head[0].start !== 3)
    throw new Usage(
      'the new item must be exactly one `## S|M|L <title>` block with no other headings'
    );
  const item = head[0];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(item.id))
    throw new Usage(
      `the item needs a \`- id:\` slug (lowercase, digits, dashes), got "${item.id}"`
    );
  if (p.items.some(i => i.id === item.id))
    throw new Error(`id ${item.id} is already in Backlog.md`);
  const idRe = new RegExp(`^- \\d{4}-\\d{2}-\\d{2} ${item.id}:`, 'm');
  if (idRe.test(doneText))
    throw new Error(`id ${item.id} was used before (Backlog done.md); ids are never reused`);
  const notes = [];
  const source = field(item, 'source');
  const touches = touchPaths(field(item, 'touches'));
  for (const other of p.items) {
    if (source && field(other, 'source') === source)
      notes.push(`same source: ${other.id} (${other.title})`);
    const shared = touchPaths(field(other, 'touches')).filter(t =>
      touches.some(u => overlaps(t, u))
    );
    if (shared.length)
      notes.push(`touches overlap: ${other.id} (${other.title}) on ${shared.join(', ')}`);
  }
  let body = block;
  let at;
  if (o.after) {
    const prev = findItem(p, o.after);
    at = prev.start + trimBlock(prev).body.length;
  } else {
    const chapter = o.chapter
      ? p.chapters.filter(c => c.title.toLowerCase().includes(String(o.chapter).toLowerCase()))
      : p.chapters.filter(c => TRIAGE.test(c.title));
    if (chapter.length > 1)
      throw new Usage(`--chapter "${o.chapter}" matches ${chapter.length} chapters; be more exact`);
    if (o.chapter && !chapter.length) throw new Usage(`no chapter matches "${o.chapter}"`);
    const c = chapter[0];
    const next = c ? p.chapters.find(n => n.start > c.start) : undefined;
    at = next ? next.start : p.lines.length;
    while (at > 0 && p.lines[at - 1] === '') at--;
    if (!o.chapter && !item.fields.has('captured')) body = [...block, `- captured: ${o.date}`];
  }
  const insert = ['', ...body];
  if (at >= p.lines.length || p.lines[at] !== '') insert.push('');
  const out = splice(p, at, at, insert);
  checkEdit(text, out, { id: item.id, items: 1, lines: insert.length });
  return { text: out, notes, id: item.id };
}

/** @param {string} text @param {string} line */
export function lowEdit(text, line) {
  if (text.split(/\r?\n/).includes(line)) throw new Error('that low is already in the file');
  return appendLine(text, line);
}

// ---- status ----------------------------------------------------------------------------------------

const cut = (/** @type {string} */ s, /** @type {number} */ words) => {
  const w = s.split(/\s+/).filter(Boolean);
  return w.length > words ? `${w.slice(0, words).join(' ')} ...` : w.join(' ');
};

/** @param {string} text @param {{ free?: number }} [o] */
export function statusText(text, o = {}) {
  const p = parseBacklog(text);
  const open = new Set(p.items.map(i => i.id));
  const claimed = p.items.filter(i => field(i, 'claimed'));
  const out = [`Claimed (${claimed.length}):`];
  for (const i of claimed) {
    const progress = field(i, 'progress');
    // The claim text often repeats the title; its date (and a "released" note) is what matters.
    const claim = field(i, 'claimed');
    const when = /\d{4}-\d{2}-\d{2}/.exec(claim)?.[0] ?? 'claimed';
    const by = /released/i.test(claim) ? `${when}, released` : when;
    out.push(`- ${i.id} (${by}): ${progress ? cut(progress, 14) : 'no progress yet'}`);
  }
  const free = p.items.filter(i => {
    if (!i.id || field(i, 'claimed')) return false;
    if (isMerged(i) || /\bfixed\b/i.test(newestProgress(i))) return false;
    return !(i.fields.get('blocked by') ?? []).flatMap(itemRefs).some(r => open.has(r));
  });
  const n = o.free ?? 6;
  out.push(`Top free (${Math.min(n, free.length)} of ${free.length}):`);
  for (const i of free.slice(0, n)) {
    const blocked = field(i, 'blocked by');
    out.push(
      `- ${i.id} (${i.size}): ${cut(i.title, 12)}${blocked ? ` [blocked by ${cut(blocked, 6)}]` : ''}`
    );
  }
  return out.join('\n');
}

/**
 * The Pi sitting list line of `status` (item `pi-sitting-list`): how many runs wait on the list, and
 * the open items whose newest progress line says merged for more than 3 days (code done, so they
 * either wait for a Pi run that belongs on the list or should be closed with `done`).
 * @param {string} backlogText
 * @param {string} piText empty when the list does not exist
 * @param {string} todayDate YYYY-MM-DD
 */
export function piListStatus(backlogText, piText, todayDate) {
  const runs = piText.split(/\r?\n/).filter(l => l.startsWith('- ')).length;
  /** @type {string[]} */
  const stale = [];
  for (const i of parseBacklog(backlogText).items) {
    const progress = newestProgress(i);
    if (!i.id || !isMerged(i)) continue;
    const d = /^(\d{4}-\d{2}-\d{2})/.exec(progress)?.[1];
    // An undated progress line counts as old.
    const age = d ? (Date.parse(todayDate) - Date.parse(d)) / 86400000 : Infinity;
    if (age > 3) stale.push(i.id);
  }
  const out = [`Pi sitting list: ${runs} run${runs === 1 ? '' : 's'} waiting`];
  if (stale.length) {
    const shown = stale.slice(0, 8).join(', ');
    out.push(
      `Merged more than 3 days ago and still open (${stale.length}): ${shown}${stale.length > 8 ? ', ...' : ''}; Pi run left: \`done --pi-run\`, nothing left: \`done\``
    );
  }
  return out.join('\n');
}

// ---- git -------------------------------------------------------------------------------------------

/** @typedef {(args: string[]) => { status: number | null, stdout: string, stderr: string }} Git */

/** @type {(vault: string) => Git} */
export const gitIn = vault => args => {
  const r = spawnSync('git', ['-C', vault, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

// A live holder keeps its lock: five attempts of fetch, rebase and push can take minutes, so only a
// dead pid (or a lock far older than any run) counts as stale.
export const LOCK_STALE_MS = 15 * 60 * 1000;
export const LOCK_WAIT_MS = 30 * 1000;

/** The lock file's text when it is stale, else null. @param {string} lockFile @param {number} now */
function staleLockText(lockFile, now) {
  let text;
  try {
    text = fs.readFileSync(lockFile, 'utf8');
  } catch {
    return null; // gone: the next open decides
  }
  try {
    const { pid, start } = JSON.parse(text);
    return !pidAlive(Number(pid)) || now - Number(start) > LOCK_STALE_MS ? text : null;
  } catch {
    // Unreadable: a holder may be writing it right now; stale only by the file's age.
    try {
      return now - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS ? text : null;
    } catch {
      return null;
    }
  }
}

/**
 * The vault is one working tree shared by the planner and every lane, so two writers must not
 * overlap: an exclusive file in the vault's .git folder (pid and start time), taken over when its
 * pid is dead or it is older than 15 minutes. Waits up to `waitMs`, then refuses.
 * @param {string} gitDir @param {number} waitMs @returns {() => void} release
 */
export function takeLock(gitDir, waitMs = LOCK_WAIT_MS) {
  const lockFile = path.join(gitDir, 'backlog-tool.lock');
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      const mine = JSON.stringify({ pid: process.pid, start: Date.now() });
      const fd = fs.openSync(lockFile, 'wx');
      fs.writeSync(fd, mine);
      fs.closeSync(fd);
      // Release only a lock that still holds this run's text, never one taken over meanwhile.
      return () => {
        try {
          if (fs.readFileSync(lockFile, 'utf8') === mine) fs.rmSync(lockFile, { force: true });
        } catch {
          // already gone
        }
      };
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    }
    const stale = staleLockText(lockFile, Date.now());
    if (stale !== null) {
      // Take over by renaming to a unique name: only one waiter wins the rename. If what we
      // renamed is not the stale text we judged (a fresh lock slipped in), put it back.
      const aside = `${lockFile}.stale-${process.pid}-${Date.now()}`;
      try {
        fs.renameSync(lockFile, aside);
        if (fs.readFileSync(aside, 'utf8') === stale) fs.rmSync(aside, { force: true });
        else if (!fs.existsSync(lockFile)) fs.renameSync(aside, lockFile);
        else fs.rmSync(aside, { force: true });
      } catch {
        // someone else won the takeover: loop and try to open again
      }
      continue;
    }
    if (Date.now() >= until)
      throw new Error(
        `another session is writing the Backlog right now (${lockFile}); retry in a minute`
      );
    sleepSync(250);
  }
}

/**
 * Lock, pull, read, edit, check, commit and push, retrying on a rejected push.
 * @param {{ vault: string, git: Git, paths: string[], message: string,
 *   edit: (read: (rel: string) => string) => Record<string, string>,
 *   beforePush?: (attempt: number) => void, retries?: number, log?: (s: string) => void,
 *   lockWaitMs?: number }} o
 * @returns {{ attempts: number, changed: boolean }}
 */
export function writeWithRetry(o) {
  const must = (/** @type {string[]} */ args, /** @type {string} */ what) => {
    const r = o.git(args);
    if (r.status !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout).trim()}`);
    return r;
  };
  const gitDir = must(['rev-parse', '--absolute-git-dir'], 'git rev-parse').stdout.trim();
  const release = takeLock(gitDir, o.lockWaitMs);
  // A kill mid-run must not leave the shared vault in a rebase or the lock held.
  const onSignal = (/** @type {NodeJS.Signals} */ sig) => {
    o.git(['rebase', '--abort']); // fails harmlessly when no rebase is running
    release();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    return writeLocked(o, must);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    release();
  }
}

/**
 * Bring the vault up to its upstream without touching other sessions' uncommitted files: a
 * fast-forward when there is nothing local, a plain rebase only when the vault already has unpushed
 * commits and no tracked file is dirty (a rebase would have to stash it), else it refuses.
 * @param {(args: string[], what: string) => { stdout: string }} must @param {(s: string) => void} log
 */
function syncVault(must, log) {
  must(['fetch', '-q'], 'git fetch');
  const ahead = Number(must(['rev-list', '--count', '@{u}..HEAD'], 'git rev-list').stdout.trim());
  if (ahead === 0) {
    must(['merge', '--ff-only', '-q', '@{u}'], 'git merge --ff-only');
    return;
  }
  const edits = must(['status', '--porcelain', '--untracked-files=no'], 'git status').stdout.trim();
  if (edits)
    throw new Error(
      `the vault has ${ahead} unpushed commit(s) and uncommitted edits by another session; retry in a minute:\n${edits}`
    );
  log(`backlog: the vault has ${ahead} unpushed commit(s); rebasing them (they are pushed too)`);
  try {
    must(['rebase', '-q', '@{u}'], 'git rebase');
  } catch (e) {
    // Never leave the shared vault in the middle of a rebase.
    must(['rebase', '--abort'], 'git rebase --abort');
    throw e;
  }
}

/**
 * @param {Parameters<typeof writeWithRetry>[0]} o
 * @param {(args: string[], what: string) => { stdout: string }} must
 */
function writeLocked(o, must) {
  const log = o.log ?? (s => console.error(s));
  const retries = o.retries ?? RETRIES;
  for (let attempt = 1; attempt <= retries; attempt++) {
    syncVault(must, log);
    // After the sync, on every attempt: a half edit of another session must not enter our commit.
    const dirty = must(['status', '--porcelain', '--', ...o.paths], 'git status').stdout.trim();
    if (dirty)
      throw new Error(
        `another session has uncommitted changes in a file this writes; retry in a minute, or ask the user:\n${dirty}`
      );
    const read = (/** @type {string} */ rel) => {
      const f = path.join(o.vault, rel);
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    };
    const files = o.edit(read);
    const changed = Object.entries(files).filter(([rel, t]) => read(rel) !== t);
    if (!changed.length) return { attempts: attempt, changed: false };
    for (const [rel, t] of changed) fs.writeFileSync(path.join(o.vault, rel), t);
    const rels = changed.map(([rel]) => rel);
    must(['add', '--', ...rels], 'git add');
    must(['commit', '-q', '-m', o.message, '--', ...rels], 'git commit');
    const mine = must(['rev-parse', 'HEAD'], 'git rev-parse').stdout.trim();
    const parent = must(['rev-parse', 'HEAD~1'], 'git rev-parse').stdout.trim();
    o.beforePush?.(attempt);
    const pushed = o.git(['push', '-q']);
    if (pushed.status === 0) return { attempts: attempt, changed: true };
    // A push that landed but reported failure (timeout, dropped connection) is a success.
    if (
      o.git(['fetch', '-q']).status === 0 &&
      o.git(['merge-base', '--is-ancestor', mine, '@{u}']).status === 0
    )
      return { attempts: attempt, changed: true };
    log(`backlog: push rejected (attempt ${attempt} of ${retries}); pulling and redoing the edit`);
    // Drop only our own commit: if something committed on top meanwhile, resetting would lose it.
    if (must(['rev-parse', 'HEAD'], 'git rev-parse').stdout.trim() !== mine)
      throw new Error(
        `the vault HEAD moved after this commit (${mine.slice(0, 7)}), so it was left as it is; ask the user to check the vault`
      );
    must(['reset', '-q', '--keep', parent], 'git reset --keep');
  }
  throw new Error(`the push was rejected ${retries} times; nothing was written`);
}

// ---- CLI -------------------------------------------------------------------------------------------

const BOOLEAN = new Set(['dry-run', 'pi', 'planner', 'private']);

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {string[]} */
  const pos = [];
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const name = a.slice(2);
    if (BOOLEAN.has(name)) flags[name] = true;
    else {
      const v = argv[++i];
      if (v === undefined) throw new Usage(`${a} needs a value`);
      flags[name] = v;
    }
  }
  return { cmd: pos[0] ?? '', pos: pos.slice(1), flags };
}

const today = () => new Date().toLocaleDateString('sv-SE');

/**
 * Run one command. Returns the exit code; prints to `out` and `err`.
 * @param {string[]} argv
 * @param {{ vault?: string, git?: Git, gh?: (a: string[]) => any, beforePush?: (attempt: number) => void,
 *   out?: (s: string) => void, err?: (s: string) => void, lockWaitMs?: number }} [env]
 */
export function run(argv, env = {}) {
  const out = env.out ?? (s => console.log(s));
  const err = env.err ?? (s => console.error(s));
  try {
    const { cmd, pos, flags } = parseArgs(argv);
    const vault =
      String(flags.vault ?? '') ||
      env.vault ||
      process.env.FOUNDRY_AI_OBSIDIAN_DIR ||
      path.join(os.homedir(), 'Documents', 'Obsidian', 'vault');
    const date = String(flags.date ?? '') || today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Usage('--date is YYYY-MM-DD');
    const git = env.git ?? gitIn(vault);
    const readNow = (/** @type {string} */ rel) => {
      const f = path.join(vault, rel);
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    };
    if (!fs.existsSync(path.join(vault, BACKLOG))) throw new Error(`no ${BACKLOG} under ${vault}`);
    const id = pos[0] ?? '';
    const needId = () => {
      if (!id) throw new Usage(`${cmd} needs an item id`);
    };
    /** @type {{ paths: string[], message: string, edit: (read: (rel: string) => string) => Record<string, string> }} */
    let job;
    /** @type {string[]} */
    let notes = [];
    switch (cmd) {
      case 'status': {
        // Read-only: the upstream copy, never the shared working tree.
        if (git(['fetch', '-q']).status !== 0)
          err('backlog: git fetch failed; the last fetched copy');
        const up = git(['show', `@{u}:${BACKLOG}`]);
        if (up.status !== 0) err('backlog: no upstream copy; showing the local file');
        const text = up.status === 0 ? up.stdout : readNow(BACKLOG);
        const pi = git(['show', `@{u}:${PI_LIST}`]);
        const sections = flags.planner
          ? plannerSections({
              devDir: path.join(vault, path.dirname(BACKLOG)),
              backlog: text,
              today: date,
              gh: env.gh,
            })
          : [];
        out(
          [
            statusText(text),
            piListStatus(text, pi.status === 0 ? pi.stdout : '', date),
            ...sections,
          ].join('\n')
        );
        return 0;
      }
      case 'claim': {
        needId();
        const title = pos.slice(1).join(' ');
        if (!title) throw new Usage('claim <id> <session title>');
        const link = typeof flags.link === 'string' ? flags.link : undefined;
        job = {
          paths: [BACKLOG],
          message: `Backlog: claim ${id} (${title})`,
          edit: read => {
            const r = claimEdit(read(BACKLOG), { id, title, date, link });
            notes = r.notes;
            return { [BACKLOG]: r.text };
          },
        };
        break;
      }
      case 'progress': {
        needId();
        const ready = typeof flags.ready === 'string';
        if (ready && pos.length > 1) throw new Usage('progress <id> --ready takes no text');
        const text = ready
          ? readyText(
              String(flags.ready),
              String(flags.head ?? ''),
              typeof flags.review === 'string' ? oneLine(flags.review) : undefined
            )
          : pos.slice(1).join(' ');
        if (!text) throw new Usage('progress <id> <text>');
        let ifReady;
        if (typeof flags['if-ready'] === 'string') {
          const m = /^(\d+)@([0-9a-f]{40})$/.exec(flags['if-ready']);
          if (!m) throw new Usage('--if-ready <PR>@<40-character sha>');
          ifReady = { pr: Number(m[1]), head: m[2] };
        }
        job = {
          paths: [BACKLOG],
          message: `Backlog: progress ${id}`,
          edit: read => ({
            [BACKLOG]: progressEdit(read(BACKLOG), { id, text, date, ifReady }).text,
          }),
        };
        break;
      }
      case 'release': {
        needId();
        job = {
          paths: [BACKLOG],
          message: `Backlog: release ${id}`,
          edit: read => ({ [BACKLOG]: releaseEdit(read(BACKLOG), { id }).text }),
        };
        break;
      }
      case 'done': {
        needId();
        if (!pos[1]) throw new Usage('done <id> <PR>');
        const piRun = typeof flags['pi-run'] === 'string' ? oneLine(flags['pi-run']) : '';
        const paths = [BACKLOG, DONE, ...(piRun ? [PI_LIST] : [])];
        // The merge commit comes from GitHub (a PR head is not on main after a squash merge);
        // --sha overrides, and a PR gh cannot answer for gets a line without a sha.
        const prNo = pos[1].replace(/^#/, '');
        let sha = typeof flags.sha === 'string' ? flags.sha : undefined;
        if (!sha && /^\d+$/.test(prNo)) {
          const view = (env.gh ?? ghJson)([
            'pr',
            'view',
            prNo,
            '-R',
            REPO,
            '--json',
            'state,mergeCommit',
          ]);
          const oid = view?.state === 'MERGED' ? view?.mergeCommit?.oid : undefined;
          if (typeof oid === 'string' && /^[0-9a-f]{7,40}$/.test(oid)) sha = oid;
          else notes.push(`note: no merge commit from gh for PR #${prNo}; the line has no sha`);
        }
        const baseNotes = notes; // the edit reruns on a push retry: it must not append twice
        job = {
          paths,
          message: `Backlog: done ${id} (PR #${pos[1].replace(/^#/, '')})`,
          edit: read => {
            const r = doneEdit(read(BACKLOG), read(DONE), {
              id,
              pr: pos[1],
              date,
              sha,
              summary: typeof flags.summary === 'string' ? flags.summary : undefined,
              by: typeof flags.by === 'string' ? flags.by : undefined,
            });
            notes = [...baseNotes, r.line];
            /** @type {Record<string, string>} */
            const files = { [BACKLOG]: r.text, [DONE]: r.done };
            if (piRun)
              files[PI_LIST] = piListEdit(read(PI_LIST), `- ${date} ${id}: ${piRun}`, date);
            return files;
          },
        };
        break;
      }
      case 'add': {
        const block =
          typeof flags.file === 'string'
            ? fs.readFileSync(flags.file, 'utf8').split(/\r?\n/)
            : blockFromFlags(flags);
        const after = typeof flags.after === 'string' ? flags.after : undefined;
        const chapter = typeof flags.chapter === 'string' ? flags.chapter : undefined;
        if (after && chapter) throw new Usage('give --after or --chapter, not both');
        const newId = parseBacklog(['---', '---', '# Backlog', ...block].join('\n')).items[0]?.id;
        job = {
          paths: [BACKLOG],
          message: `Backlog: add ${newId ?? 'item'}`,
          edit: read => {
            const r = addEdit(read(BACKLOG), read(DONE), { block, date, after, chapter });
            notes = r.notes;
            return { [BACKLOG]: r.text };
          },
        };
        break;
      }
      case 'low': {
        const area = pos[0] ?? '';
        const text = pos.slice(1).join(' ');
        if (!area || !text) throw new Usage('low <area> <text>');
        const dir = path.join(vault, LOWS);
        const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')) : [];
        const file = files.find(f => f.slice(0, -3).toLowerCase() === area.toLowerCase());
        if (!file)
          throw new Error(
            `no Lows/${area}.md; areas: ${files.map(f => f.slice(0, -3)).join(', ') || 'none'}`
          );
        const rel = `${LOWS}/${file}`;
        const line = `- ${dated(date, oneLine(text))}`;
        job = {
          paths: [rel],
          message: `Lows: ${file.slice(0, -3)}`,
          edit: read => ({ [rel]: lowEdit(read(rel), line) }),
        };
        break;
      }
      default:
        throw new Usage(
          `unknown command "${cmd}"; use status, claim, progress, release, done, add or low`
        );
    }
    if (flags['dry-run']) {
      const files = job.edit(readNow);
      for (const [rel, t] of Object.entries(files)) {
        const before = readNow(rel).split(/\r?\n/);
        const after = t.split(/\r?\n/);
        out(`${rel}: ${before.length} -> ${after.length} lines`);
        const was = new Set(before);
        for (const l of after) if (!was.has(l)) out(`+ ${l}`);
        const now = new Set(after);
        for (const l of before) if (!now.has(l)) out(`- ${l}`);
      }
      for (const n of notes) out(n);
      out('backlog: dry run, nothing written');
      return 0;
    }
    const r = writeWithRetry({
      vault,
      git,
      ...job,
      beforePush: env.beforePush,
      log: err,
      lockWaitMs: env.lockWaitMs,
    });
    for (const n of notes) out(n);
    out(r.changed ? `backlog: ${job.message} (pushed)` : 'backlog: nothing to change');
    return 0;
  } catch (e) {
    err(`backlog: ${e instanceof Error ? e.message : e}`);
    if (e instanceof Usage) err('usage: see the header of scripts/backlog.mjs');
    return e instanceof Usage ? 2 : 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  process.exitCode = run(process.argv.slice(2));
