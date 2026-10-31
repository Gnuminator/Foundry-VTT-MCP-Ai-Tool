#!/usr/bin/env node
// PostToolUse hook for Edit, Write and MultiEdit (insights report 2026-10-31): runs the repo's
// prettier on the file that was just edited, so format-only CI failures and format-fix commits stop.
//
// Only .ts .tsx .js .mjs .json .md files inside this repo that are new or prettier-clean at HEAD
// (see cleanAtHead); no eslint (too slow for a hook, the
// quick checks and CI do that). One prettier call on one file takes well under a second. Prettier
// finds .prettierrc and .prettierignore from the file's own folder, so an ignored or unparseable
// file is left as it is. Every failure is silent and exits 0: a hook must never block an edit.
// Reads the hook payload (JSON) on stdin; prints nothing, or a note when prettier changed the file.

import path from 'node:path';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');

const EXT = /\.(?:ts|tsx|js|mjs|json|md)$/i;
const SKIP_DIRS = /(?:^|\/)(?:node_modules|dist|build|coverage|\.git)\//i;

function normalize(p) {
  let s = String(p).replace(/\\/g, '/');
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(s); // git-bash /c/Users/...
  if (m) s = `${m[1]}:/${m[2]}`;
  return s;
}

/** The absolute file to format, or null when it is not one this hook formats. */
export function targetOf(input, repoRoot = REPO_ROOT) {
  const given = input?.tool_input?.file_path;
  if (typeof given !== 'string' || !given || !EXT.test(given)) return null;
  let t = normalize(given);
  if (!/^([a-zA-Z]:)?\//.test(t)) t = `${normalize(input.cwd || repoRoot)}/${t}`;
  t = path.posix.normalize(t);
  const root = normalize(repoRoot).replace(/\/+$/, '');
  if (!t.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return null;
  if (SKIP_DIRS.test(t.slice(root.length + 1))) return null;
  return t;
}

// A file that git has and that prettier would change at HEAD is left alone: formatting it would put
// a whole-file reformat in the diff (about 60 of the .mjs and .tsx files are not prettier-clean, and
// lint-staged only holds .ts, .js, .json and .md). Only a file git positively says is not in HEAD
// (or a folder that is no git repo) is formatted without the check; any other git failure (no git,
// a timeout) skips the file, because the safe error is a missed format, not a whole-file reformat.
function cleanAtHead(file, repoRoot, bin) {
  // the on-disk spelling of the path: git's tree lookup is case-sensitive, a Windows path is not
  let rel;
  try {
    rel = path
      .relative(realpathSync.native(repoRoot), realpathSync.native(file))
      .replace(/\\/g, '/');
  } catch {
    return false;
  }
  if (!rel || rel.startsWith('..')) return false;
  const shown = spawnSync('git', ['show', `HEAD:${rel}`], {
    cwd: repoRoot,
    timeout: 2000,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (shown.status !== 0) {
    return /does not exist in|exists on disk, but not in|not a git repository|unknown revision|bad revision/.test(
      String(shown.stderr)
    );
  }
  const check = spawnSync(
    process.execPath,
    [bin, '--check', '--log-level', 'silent', '--stdin-filepath', file],
    { cwd: repoRoot, timeout: 3000, input: shown.stdout, stdio: ['pipe', 'ignore', 'ignore'] }
  );
  return check.status === 0;
}

/** Formats the edited file; returns true when prettier ran and exited 0. */
export function formatEdited(input, repoRoot = REPO_ROOT, prettierRoot = repoRoot) {
  try {
    const file = targetOf(input, repoRoot);
    if (!file || !existsSync(file)) return false;
    const bin = path.join(prettierRoot, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
    if (!existsSync(bin)) return false;
    if (!cleanAtHead(file, repoRoot, bin)) return false;
    const r = spawnSync(process.execPath, [bin, '--write', '--log-level', 'silent', file], {
      cwd: repoRoot,
      timeout: 4000,
      stdio: 'ignore',
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function main() {
  let input = null;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  const file = targetOf(input);
  let before = null;
  try {
    before = file ? readFileSync(file, 'utf8') : null;
  } catch {
    // unreadable: nothing to compare
  }
  if (!formatEdited(input) || before === null) return;
  try {
    if (readFileSync(file, 'utf8') !== before) {
      // the next Edit's old_string must come from the formatted text
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: `${path.basename(file)} was reformatted by prettier: Read it again before the next Edit.`,
          },
        })}\n`
      );
    }
  } catch {
    // never block
  }
}

const self = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href
) {
  main();
}
