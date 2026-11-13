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
  /\.open\s*\(\s*(mode\s*=\s*)?["'][rbtU]*[wax+]/, // pathlib.Path(f).open('w')
  /\b(write_text|write_bytes)\s*\(/,
  /\b(WriteAll(Text|Lines|Bytes)|AppendAll(Text|Lines)|StreamWriter)\b/i, // [IO.File]::WriteAllText
  /\b(shutil\.(copy\w*|move)|os\.(replace|rename)|(copyFile|rename)(Sync)?)\s*\(/,
];

/** A path that is the vault repo or inside it (`player-vault` does not count). */
const VAULT_PATH = /obsidian[\\/]+vault|(^|[\\/])vault([\\/]|$)/i;
const CD = /(?:\bcd|\bpushd|\bSet-Location|\bPush-Location|\s-C)\s+(?:-Path\s+|-LiteralPath\s+)?("[^"]*"|'[^']*'|\S+)/gi;
const unquote = (/** @type {string} */ w) => w.replace(/^["']|["']$/g, '');
const isGlob = (/** @type {string} */ w) => /[*?[]/.test(w);
/** A pathspec that names no single file: `.`, a directory, a glob. */
const sweepsPath = (/** @type {string} */ w) => {
  const last = w.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  return /[\\/]$/.test(w) || isGlob(w) || !/\.[A-Za-z0-9]+$/.test(last);
};

/**
 * A git command in the vault that sweeps in files without naming them, so it would take (or
 * throw away) Backlog.md along: `commit -a`/`--all` or a commit with a directory or glob,
 * `add -A`/`-u`/`--all`/`.`/a directory/a glob, `checkout`/`restore` of `.` or a directory,
 * `reset --hard`, `stash`. A named file that is not the Backlog (`git add Waiting.md`) stays allowed.
 * The vault context is tracked per command segment: the payload cwd, a `cd`/`pushd`/`Set-Location`/
 * `-C` into the vault, or a vault path in the segment; a `cd` elsewhere ends it.
 */
export function sweepsVault(/** @type {string} */ cmd, /** @type {string} */ cwd = '') {
  let inVault = VAULT_PATH.test(norm(cwd));
  // a commit message and a redirect are not arguments
  const body = cmd
    .replace(/(\s(?:-m|--message)[\s=]*)("[^"]*"|'[^']*')/g, '$1')
    // redirects only outside quotes: a quoted `<b@x>` is a value
    .replace(/"[^"]*"|'[^']*'|[^"']+/g, q =>
      /^["']/.test(q) ? q : q.replace(/\*?\d*>&\d+|\*?\d*>>?\s*\S+|<\s*\S+/g, ' ')
    );
  for (const seg of body.split(/[;&|\n]+/)) {
    let gitC = false; // `git -C <path>` applies to this command only
    for (const m of seg.matchAll(CD)) {
      if (/^\s-C/.test(m[0])) gitC = VAULT_PATH.test(unquote(m[1]));
      else {
        // a relative move that stays below the current folder keeps the context; a path that
        // starts elsewhere (absolute, `~`, a variable, a drive, `..`) is tested afresh
        const t = unquote(m[1]);
        if (VAULT_PATH.test(t) || /^([\\/]|~|\$|[A-Za-z]:|\.\.)/.test(t)) inVault = VAULT_PATH.test(t);
      }
    }
    const words = (seg.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote);
    const g = words.findIndex(w => /^git(\.exe)?$/i.test(w.replace(/^.*[\\/]/, '')));
    if (g < 0) continue;
    if (!inVault && !gitC && !VAULT_PATH.test(seg)) continue;
    const sub = words.findIndex(
      (w, i) => i > g && /^(add|commit|checkout|restore|reset|stash)$/.test(w)
    );
    if (sub < 0) continue;
    const rest = words.slice(sub + 1);
    const takesValue = (/** @type {number} */ i) =>
      /^(-m|--message|-F|--file|-C|-c|--author|--date|--fixup|--squash|--trailer|-t|--template)$/.test(
        rest[i - 1] ?? ''
      );
    const flag = (/** @type {string} */ w, /** @type {number} */ i) =>
      /^--?[a-zA-Z]/.test(w) && !takesValue(i);
    const paths = rest.filter((w, i) => w !== '--' && !flag(w, i) && !takesValue(i));
    const afterDashes = rest.includes('--') ? rest.slice(rest.indexOf('--') + 1) : [];
    const flags = rest.filter(flag);
    switch (words[sub]) {
      case 'commit':
        // a combined `-am` carries -a; -m takes a value, which is not a flag
        if (flags.some(w => w === '--all' || (/^-[a-zA-Z]+$/.test(w) && w.includes('a')))) return true;
        if (paths.some(sweepsPath)) return true;
        break;
      case 'add':
        if (flags.some(w => /^(--all|--update|--no-all|--ignore-removal)$/.test(w) || /^-[a-zA-Z]*[Au]/.test(w)))
          return true;
        if (paths.some(sweepsPath)) return true;
        break;
      case 'restore':
        // restore never takes a branch: every path word must be one file
        if (paths.some(sweepsPath)) return true;
        break;
      case 'checkout':
        // a branch name is not a path: only `.`, a directory or a glob, or the words after `--`
        if (flags.some(w => w === '-f' || w === '--force')) return true;
        if (paths.some(w => w === '.' || /[\\/]$/.test(w) || isGlob(w))) return true;
        if (afterDashes.some(sweepsPath)) return true;
        break;
      case 'reset':
        if (flags.includes('--hard')) return true;
        break;
      case 'stash':
        if (paths.length === 0 || /^(push|save)$/.test(paths[0])) return true;
        break;
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
