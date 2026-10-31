#!/usr/bin/env node
// PostToolUse hook for Edit, Write and MultiEdit (insights report 2026-10-31): runs the repo's
// prettier on the file that was just edited, so format-only CI failures and format-fix commits stop.
//
// Only .ts .tsx .js .mjs .json .md files inside this repo that are new or prettier-clean at HEAD
// (see cleanAtHead); no eslint (too slow for a hook, the
// quick checks and CI do that). One prettier call on one file takes well under a second. Prettier
// finds .prettierrc and .prettierignore from the file's own folder, so an ignored or unparseable
// file is left as it is. Every failure is silent and exits 0: a hook must never block an edit.
// Reads the hook payload (JSON) on stdin; prints nothing.

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
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
// lint-staged only holds .ts, .js, .json and .md). A new file, or one git cannot show, is formatted.
function cleanAtHead(file, repoRoot, bin) {
  const rel = path.posix.relative(normalize(repoRoot), file);
  const shown = spawnSync('git', ['show', `HEAD:${rel}`], {
    cwd: repoRoot,
    timeout: 4000,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (shown.status !== 0 || typeof shown.stdout !== 'string') return true;
  const check = spawnSync(
    process.execPath,
    [bin, '--check', '--log-level', 'silent', '--stdin-filepath', file],
    { cwd: repoRoot, timeout: 6000, input: shown.stdout, stdio: ['pipe', 'ignore', 'ignore'] }
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
      timeout: 8000,
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
  formatEdited(input);
}

const self = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href
) {
  main();
}
