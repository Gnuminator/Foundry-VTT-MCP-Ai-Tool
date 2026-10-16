#!/usr/bin/env node
// PostToolUse check for Edit, Write, Bash and PowerShell (Claude Code hook): warns when a changed
// source file gains ASCII control bytes other than tab, LF and CR (for example \x08, a backspace
// that a shell or python escape wrote where a backslash and a letter were meant).
//
// It warns and never blocks. It runs next to the context-alert hook on tool calls, so it stays
// cheap: Edit and Write read the one file they touched; Bash and PowerShell look only at files the
// command names, plus the tracked files git reports as modified in the last minute, and only when
// the command looks like it writes (so `git status` or `npm test` cost nothing).
//
// "Gains" means more control bytes than the file has at HEAD, so a file that legitimately contains
// one (a test fixture with an ESC byte) stays quiet until it gets another.
//
// Output: JSON with `systemMessage` and `hookSpecificOutput.additionalContext`, or nothing.
// Any failure prints nothing and exits 0.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE_EXT = /\.(?:ts|tsx|js|mjs|ps1|sh|json|yml|md)$/i;
const PATH_TOKEN = /[^\s"'=;|&<>()`,]+\.(?:json|tsx|ts|mjs|js|ps1|sh|yml|md)(?=$|[\s"'`;|&)<>,\]])/gi;
const WRITEY =
  /\b(?:sed|perl|python\d*|py|node|tee|patch|awk|ruby|cp|copy|mv|move|git\s+(?:apply|checkout|restore|merge|pull|rebase|stash|cherry-pick))\b|Set-Content|Add-Content|Out-File|WriteAll|-replace|<<|>>?\s*[^&\s]/i;
const MAX_BYTES = 2 * 1024 * 1024;
const RECENT_MS = 60_000;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Offsets of control bytes (0x00-0x1F except tab, LF, CR; also 0x7F) in a buffer. */
export function controlBytes(buf) {
  const hits = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if ((b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f) hits.push(i);
  }
  return hits;
}

function describe(buf, hits) {
  const spots = hits.slice(0, 3).map(off => {
    let line = 1;
    for (let i = 0; i < off; i++) if (buf[i] === 0x0a) line++;
    return `\\x${buf[off].toString(16).padStart(2, '0')} at line ${line}`;
  });
  return `${hits.length} (${spots.join(', ')}${hits.length > 3 ? ', ...' : ''})`;
}

function headCount(rel, cwd) {
  try {
    const out = execFileSync('git', ['show', `HEAD:${rel}`], {
      cwd,
      maxBuffer: MAX_BYTES * 2,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    return controlBytes(out).length;
  } catch {
    return 0; // new file, or git unavailable
  }
}

/** Returns a problem line for one file, or null. */
export function checkFile(file, cwd = REPO_ROOT) {
  try {
    if (!SOURCE_EXT.test(file)) return null;
    const st = statSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    const buf = readFileSync(file);
    const hits = controlBytes(buf);
    if (hits.length === 0) return null;
    const rel = path.relative(cwd, file).replace(/\\/g, '/');
    const before = rel.startsWith('..') ? 0 : headCount(rel, cwd);
    if (hits.length <= before) return null;
    return `${rel || file}: ${describe(buf, hits)}`;
  } catch {
    return null;
  }
}

function changedByCommand(command, cwd, now) {
  const files = new Set();
  for (const t of command.match(PATH_TOKEN) ?? []) {
    if (/^[$~%]/.test(t)) continue;
    files.add(path.resolve(cwd, t.replace(/^\/([a-zA-Z])\//, '$1:/')));
  }
  if (WRITEY.test(command)) {
    try {
      const out = execFileSync('git', ['diff', '--name-only', '-z'], {
        cwd,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      }).toString('utf8');
      const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      })
        .toString('utf8')
        .trim();
      for (const rel of out.split('\0').filter(Boolean)) {
        const abs = path.resolve(top, rel);
        try {
          if (now - statSync(abs).mtimeMs < RECENT_MS) files.add(abs);
        } catch {
          // deleted file
        }
      }
    } catch {
      // not a git checkout: only the named files are checked
    }
  }
  return [...files];
}

export function filesFor(input, now = Date.now()) {
  const cwd = input.cwd || REPO_ROOT;
  const tool = input.tool_name;
  const ti = input.tool_input ?? {};
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
    return ti.file_path ? [path.resolve(cwd, String(ti.file_path))] : [];
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    return changedByCommand(String(ti.command ?? ''), cwd, now);
  }
  return [];
}

export function run(input, now = Date.now()) {
  try {
    if (!input || typeof input !== 'object') return '';
    const cwd = input.cwd || REPO_ROOT;
    const problems = filesFor(input, now)
      .map(f => checkFile(f, cwd))
      .filter(Boolean);
    if (problems.length === 0) return '';
    const list = problems.join('; ');
    return JSON.stringify({
      systemMessage: `Control bytes written to source: ${list}`,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `Warning (.claude/hooks/warn-control-bytes.mjs): this change put ASCII control bytes (not tab, LF or CR) into ${list}. That is usually a mangled escape: a backslash letter such as \\b or \\n that a shell or python script turned into a real backspace or newline byte. Open the spot and fix it with the Edit tool.`,
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
    return;
  }
  const out = run(input);
  if (out) process.stdout.write(`${out}\n`);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href) {
  main();
}
