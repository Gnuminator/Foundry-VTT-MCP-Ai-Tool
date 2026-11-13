#!/usr/bin/env node
// PreToolUse guard: lanes write the vault Backlog only through scripts/backlog.mjs (item `backlog-tool`).
//
// Hand edits of Backlog.md from many sessions raced the live board, which rewrites the file, and a
// fold script once doubled it. `scripts/backlog.mjs` pulls, makes a one-item edit, checks it, commits
// and pushes with retries. This hook refuses the other ways a lane could write the file:
//   - Edit, Write, MultiEdit or NotebookEdit on vault `Dev/Foundry AI Tool/Backlog.md` or
//     `Backlog done.md`;
//   - a Bash or PowerShell command that names one of those files and writes it (a `>` redirect to it,
//     writeFileSync or appendFileSync, Set-Content, Add-Content, Out-File, tee, sed -i, perl -i,
//     Move-Item, Copy-Item, mv, cp, git add or git commit, or a script that opens it for writing:
//     python open(f, 'w'), fs.openSync, write_text), unless it runs scripts/backlog.mjs;
//   - a git add or commit in the vault that sweeps files in without naming them (commit -a, add -A,
//     add . or a directory), since that would take Backlog.md along.
// Only for a lane (see isLane: CLAUDE_PROJECT_DIR or the transcript folder, never the payload cwd).
// The planner (main checkout) and the board stay free to edit. Reads are always allowed.
//
// Reads the hook payload (JSON) on stdin; prints a deny decision or nothing. Fails open on an
// unparseable payload, like the sibling hooks.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const BACKLOG_PATH = /(^|\/)dev\/foundry ai tool\/backlog( done)?\.md$/;
const NAMES = /backlog( done)?\.md/i;
const WRITES = [
  />>?\s*["']?[^|;&<>]*backlog( done)?\.md/i,
  /\b(writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream)\b/,
  /\b(Set-Content|Add-Content|Out-File|Move-Item|Copy-Item|Remove-Item)\b/i,
  /\btee\b/,
  /\b(sed|perl)\b[^|;&]*\s-i/,
  /(^|[\s;&|])(mv|cp|rm)\s/,
  /\bgit\b[^|;&]*\b(add|commit|checkout|restore)\b[^|;&]*backlog( done)?\.md/i,
  // a script that opens the file for writing: python open(f, 'w'), fs.openSync(f, 'a'), Path.write_text
  /\bopen(Sync)?\s*\([^,)]*,\s*(mode\s*=\s*)?["'][rbtU]*[wax+]/,
  /\b(write_text|write_bytes)\s*\(/,
];

/** The vault repo: the command or the working directory names it. */
const VAULT_CTX = /obsidian[\\/]+vault|(\bcd|\s-C)\s+["']?[^\s"']*vault\b/i;

/**
 * A `git add` or `git commit` in the vault that sweeps in files without naming them, so it would
 * take Backlog.md along: `commit -a`/`-am`/`--all`, `add -A`/`-u`/`--all`, `add .` or `*`, or a
 * directory. A named file that is not the Backlog (`git add Waiting.md`) stays allowed.
 */
export function sweepsVault(/** @type {string} */ cmd, /** @type {string} */ cwd = '') {
  if (!VAULT_CTX.test(cmd) && !VAULT_CTX.test(norm(cwd))) return false;
  for (const seg of cmd.split(/[;&|\n]+/)) {
    const words = (seg.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(w => w.replace(/^["']|["']$/g, ''));
    const g = words.findIndex(w => /^git(\.exe)?$/i.test(w.replace(/^.*[\\/]/, '')));
    if (g < 0) continue;
    const sub = words.findIndex((w, i) => i > g && /^(add|commit)$/.test(w));
    if (sub < 0) continue;
    const rest = words.slice(sub + 1);
    if (words[sub] === 'commit') {
      // -m takes a value, which is not a flag; a combined `-am` carries -a
      const flags = rest.filter(
        (w, i) => /^--?[a-zA-Z]/.test(w) && !/^(-m|--message|-F|--file|-C|-c)$/.test(rest[i - 1] ?? '')
      );
      if (flags.some(w => w === '--all' || (/^-[a-zA-Z]+$/.test(w) && w.includes('a')))) return true;
      continue;
    }
    for (const w of rest) {
      if (/^(--all|--update|--no-all|--ignore-removal)$/.test(w) || /^-[a-zA-Z]*[Au]/.test(w)) return true;
      if (w.startsWith('-')) continue;
      const last = w.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
      if (/[\\/]$/.test(w) || w === '*' || !/\.[A-Za-z0-9]+$/.test(last)) return true;
    }
  }
  return false;
}

const norm = (/** @type {unknown} */ p) =>
  String(p ?? '')
    .replace(/\\/g, '/')
    .toLowerCase();

const WORKTREE_DIR = /\/\.claude\/worktrees\//;
const WORKTREE_PROJECT = /--claude-worktrees-/i;

/**
 * A lane session, found the way context-alert.mjs does it (never by the payload cwd, which moves
 * with every cd): the project dir is inside `.claude/worktrees/`, or the transcript sits in a
 * worktree project folder.
 */
export function isLane(/** @type {{ transcript_path?: string }} */ input, env = process.env) {
  return (
    WORKTREE_DIR.test(`${norm(env.CLAUDE_PROJECT_DIR)}/`) ||
    WORKTREE_PROJECT.test(String(input?.transcript_path ?? ''))
  );
}

/** Main's copy of the tool: a lane branched before it merged has none of its own. */
export function toolPath(env = process.env) {
  const dir = String(env.CLAUDE_PROJECT_DIR ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  const root = dir.replace(/\/\.claude\/worktrees\/.*$/i, '');
  return root ? `${root}/scripts/backlog.mjs` : 'scripts/backlog.mjs';
}

export const advice = (/** @type {NodeJS.ProcessEnv} */ env = process.env) =>
  "lanes write the Backlog only through scripts/backlog.mjs (it pulls, edits one item, checks, commits and pushes with retries); run main's copy: " +
  `\`node "${toolPath(env)}" claim <id> "<session title>" --link <claude:// link>\`, ` +
  '`progress <id> "<text>"` (replaces the progress line), `release <id>`, `low <area> "<text>"`, `status` to read. ' +
  'The planner and the board edit the file directly.';

/** A command that is one plain call of the tool: no second command, pipe or redirect outside quotes. */
const isToolCall = (/** @type {string} */ cmd) =>
  /^\s*(&\s*)?node(\.exe)?\s+["']?[^\s"']*scripts[\\/]backlog\.mjs/i.test(cmd) &&
  !/[;&|<>`\n]|\$\(/.test(cmd.replace(/"[^"]*"|'[^']*'/g, ''));

/** The deny reason, or null when the call is allowed. */
export function decide(
  /** @type {string} */ toolName,
  /** @type {any} */ input,
  env = process.env
) {
  if (!isLane(input ?? {}, env)) return null;
  const args = input?.tool_input ?? {};
  if (FILE_TOOLS.has(toolName)) {
    const file = norm(args.file_path ?? args.notebook_path);
    return BACKLOG_PATH.test(file)
      ? `this ${toolName} targets the vault Backlog; ${advice(env)}`
      : null;
  }
  if (SHELL_TOOLS.has(toolName)) {
    const cmd = String(args.command ?? '');
    if (isToolCall(cmd)) return null;
    if (sweepsVault(cmd, input?.cwd))
      return `this git add or commit in the vault would take Backlog.md along (commit -a, add -A, add . or a directory); name the files you mean. ${advice(env)}`;
    if (!NAMES.test(cmd)) return null;
    // a commit message may name the file; its text is not a path
    const body = cmd.replace(/(\s(-m|--message)[\s=]*)("[^"]*"|'[^']*')/g, '$1');
    if (WRITES.some(re => re.test(body)))
      return `this command looks like it writes the vault Backlog; ${advice(env)}`;
  }
  return null;
}

export function run(/** @type {any} */ input, env = process.env) {
  try {
    const reason = decide(String(input?.tool_name ?? ''), input, env);
    if (!reason) return '';
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Blocked by .claude/hooks/guard-backlog.mjs: ${reason}`,
      },
    });
  } catch {
    return '';
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return; // not a payload we understand: allow
  }
  const out = run(input);
  if (out) process.stdout.write(`${out}\n`);
}

const self = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href
) {
  main();
}
