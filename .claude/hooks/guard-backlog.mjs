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
//     Move-Item, Copy-Item, mv, cp, git add or git commit), unless it runs scripts/backlog.mjs.
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
  /\bgit\b[^|;&]*\b(add|checkout|restore)\b[^|;&]*backlog( done)?\.md/i,
];

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
    if (!NAMES.test(cmd) || isToolCall(cmd)) return null;
    if (WRITES.some(re => re.test(cmd)))
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
  let input = null;
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
