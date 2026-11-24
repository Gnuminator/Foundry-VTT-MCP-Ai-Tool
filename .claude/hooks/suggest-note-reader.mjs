#!/usr/bin/env node
// PreToolUse hook on Read (Claude Code): when a session reads a whole long file inside the
// Obsidian vault (over 300 lines, no offset or limit), it adds one hint to use the Haiku
// `note-reader` agent (.claude/agents/note-reader.md) instead, so the file does not ride along in
// every later turn. It never blocks and never denies: it only adds context, once per file per
// session (a marker file in the temp directory). Any failure prints nothing and exits 0.
//
// scripts/backlog.mjs reads the vault with fs, not the Read tool, so it never meets this hook.

import { closeSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LINE_LIMIT = 300;
const MAX_BYTES = 8 * 1024 * 1024;

export function vaultDir(env = process.env) {
  return path.resolve(
    env.FOUNDRY_AI_OBSIDIAN_DIR || path.join(os.homedir(), 'Documents', 'Obsidian', 'vault')
  );
}

function inside(root, file) {
  const norm = p => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = path.relative(norm(root), norm(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function countLines(file) {
  const buf = readFileSync(file);
  let n = 0;
  for (const b of buf) if (b === 0x0a) n++;
  return n;
}

/** Claims the once-per-session marker for this file; false when it was already claimed. */
function firstTime(sessionId, file, tmp) {
  try {
    const dir = path.join(tmp, 'foundry-note-reader');
    mkdirSync(dir, { recursive: true });
    const key = Buffer.from(`${sessionId}|${file}`).toString('hex').slice(0, 120);
    closeSync(openSync(path.join(dir, key), 'wx'));
    return true;
  } catch {
    return false;
  }
}

export function run(input, { env = process.env, tmp = os.tmpdir() } = {}) {
  try {
    if (!input || input.tool_name !== 'Read') return '';
    const ti = input.tool_input ?? {};
    if (!ti.file_path || ti.offset != null || ti.limit != null) return '';
    const cwd = input.cwd || process.cwd();
    const file = path.resolve(cwd, String(ti.file_path));
    if (!inside(vaultDir(env), file)) return '';
    if (!/\.md$/i.test(file)) return '';
    const st = statSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return '';
    const lines = countLines(file);
    if (lines <= LINE_LIMIT) return '';
    if (!firstTime(String(input.session_id ?? 'none'), file, tmp)) return '';
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `Hint (.claude/hooks/suggest-note-reader.mjs): ${path.basename(file)} has ${lines} lines. Reading it whole keeps all of it in your context for every later turn. Prefer the Agent tool with subagent_type "note-reader" and model "haiku": give it the path and your questions, and it answers in 15 lines with quoted lines. If you need only one part, Grep for it and Read with offset and limit. Reading it whole still works; this hint is shown once per file.`,
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
    return;
  }
  const out = run(input);
  if (out) process.stdout.write(`${out}\n`);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href) {
  main();
}
