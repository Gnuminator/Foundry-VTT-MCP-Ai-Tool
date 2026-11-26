#!/usr/bin/env node
// Token budget hook (idea 4.12): a running token total per session, printed against a budget.
// Runs on Stop (end of every turn). It reads only the transcript bytes written since the last turn
// (a per-file offset in the state file), so it stays fast however large the transcript gets.
//
// Counting matches `npm run usage:week`: the tokens of a response are its context (input + cache
// read + cache creation, the last sampling pass of an advisor call, see contextOf in
// context-alert.mjs) and every API response counts once (by message id). Subagent transcripts
// (<session>/subagents/*.jsonl) count into the same session total. Cost sums read the same fields
// as usage-week; the phantom doubled advisor readings are handled by contextOf.
//
// State: <home>/.claude/token-budget/<session_id>.json, one file per session, read by
// scripts/dev/token-budget.mjs which groups sessions by git branch and PR and writes the vault
// note the PM board shows. The hook never calls the network or gh.
//
// Output on Stop: JSON with `systemMessage` ("lane at 14.2 M of 18 M") once at 70% and once at
// 100% of the budget, or nothing. A lane at 100% keeps working; the planner decides what to do.
// Any failure prints nothing and exits 0: a hook must never block.
//
// Overrides (tests): TOKEN_BUDGET_STATE_DIR, TOKEN_BUDGET_LIMIT (tokens, default 18 000 000).

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  fstatSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contextOf } from './context-alert.mjs';

export const DEFAULT_LIMIT = 18_000_000;
export const WARN_FRACTION = 0.7;
export const CHUNK_BYTES = 8 * 1024 * 1024;

export function stateDirFor(env = process.env) {
  return env.TOKEN_BUDGET_STATE_DIR || path.join(os.homedir(), '.claude', 'token-budget');
}

export function limitFor(env = process.env) {
  const n = Number(env.TOKEN_BUDGET_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT;
}

export function stateFileFor(sessionId, env = process.env) {
  return path.join(stateDirFor(env), `${String(sessionId).replace(/[^\w.-]/g, '_')}.json`);
}

export function readState(sessionId, env = process.env) {
  try {
    const s = JSON.parse(readFileSync(stateFileFor(sessionId, env), 'utf8'));
    if (s && typeof s === 'object' && s.files) return s;
  } catch {
    // none yet
  }
  return { sessionId, branch: null, tokens: 0, lastContext: null, level: 0, files: {} };
}

export function writeState(state, env = process.env) {
  const file = stateFileFor(state.sessionId, env);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, file);
}

// Folds new complete transcript lines into `entry` ({offset, last:{id,tokens}}) and returns
// {tokens added, lastContext, branch}. A response written as several lines shares one message id;
// its tokens replace the earlier reading instead of adding to it.
export function foldLines(lines, entry, { main }) {
  let added = 0;
  let lastContext = null;
  let branch = null;
  for (const line of lines) {
    if (!line) continue;
    if (!branch && line.includes('"gitBranch"')) {
      const m = /"gitBranch":"([^"]+)"/.exec(line);
      if (m) branch = m[1];
    }
    if (!line.includes('"usage"')) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j?.type !== 'assistant' || !j.message?.usage) continue;
    if (j.message.model === '<synthetic>') continue;
    const tokens = contextOf(j.message.usage);
    if (tokens === 0) continue;
    const id = j.message.id;
    if (id && entry.last && entry.last.id === id) {
      added += tokens - entry.last.tokens;
    } else {
      added += tokens;
    }
    entry.last = { id: id ?? null, tokens };
    if (main && !j.isSidechain) lastContext = tokens;
  }
  return { added, lastContext, branch };
}

// Reads the bytes of `file` after entry.offset (whole lines only) and folds them in.
export function advance(file, entry, opts) {
  let fd;
  try {
    fd = openSync(file, 'r');
  } catch {
    return { added: 0, lastContext: null, branch: null };
  }
  try {
    const size = fstatSync(fd).size;
    if (size < entry.offset) {
      // the file was replaced or truncated: start over for this file, keep the total
      entry.offset = 0;
      entry.last = null;
    }
    let added = 0;
    let lastContext = null;
    let branch = null;
    while (entry.offset < size) {
      const len = Math.min(size - entry.offset, CHUNK_BYTES);
      const buf = Buffer.alloc(len);
      let got = 0;
      while (got < len) {
        const n = readSync(fd, buf, got, len - got, entry.offset + got);
        if (n <= 0) break;
        got += n;
      }
      const text = buf.subarray(0, got).toString('utf8');
      const cut = text.lastIndexOf('\n');
      if (cut < 0) break; // no complete line yet (or one line over the chunk: wait for more)
      const consumed = Buffer.byteLength(text.slice(0, cut + 1), 'utf8');
      const r = foldLines(text.slice(0, cut).split('\n'), entry, opts);
      added += r.added;
      if (r.lastContext !== null) lastContext = r.lastContext;
      branch ??= r.branch;
      entry.offset += consumed;
    }
    return { added, lastContext, branch };
  } finally {
    closeSync(fd);
  }
}

export function transcriptsOf(transcriptPath) {
  const out = [{ file: transcriptPath, main: true }];
  const dir = path.join(
    path.dirname(transcriptPath),
    path.basename(transcriptPath, '.jsonl'),
    'subagents'
  );
  try {
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (name.endsWith('.jsonl')) out.push({ file: path.join(dir, name), main: false });
      }
    }
  } catch {
    // no subagents
  }
  return out;
}

// Brings the session's state up to date and returns it.
export function update(sessionId, transcriptPath, env = process.env) {
  const state = readState(sessionId, env);
  state.sessionId = sessionId;
  for (const { file, main } of transcriptsOf(transcriptPath)) {
    const entry = (state.files[file] ??= { offset: 0, last: null });
    const r = advance(file, entry, { main });
    state.tokens += r.added;
    if (r.lastContext !== null) state.lastContext = r.lastContext;
    if (main && r.branch) state.branch = r.branch;
  }
  state.updated = new Date().toISOString();
  return state;
}

export const mTokens = tokens => `${(tokens / 1e6).toFixed(1)} M`;

// The line to print, and the level announced (0 none, 1 at 70%, 2 at 100%).
export function lineFor(state, limit) {
  const level = state.tokens >= limit ? 2 : state.tokens >= limit * WARN_FRACTION ? 1 : 0;
  if (level === 0 || level <= (state.level ?? 0)) return { level: state.level ?? 0, line: '' };
  const pct = Math.round((state.tokens / limit) * 100);
  const line =
    level === 2
      ? `Token budget: lane at ${mTokens(state.tokens)} of ${mTokens(limit)} (${pct}%). Keep working; the planner decides what to do at the limit.`
      : `Token budget: lane at ${mTokens(state.tokens)} of ${mTokens(limit)} (${pct}%).`;
  return { level, line };
}

export function run(input, env = process.env) {
  try {
    if (!input || typeof input !== 'object' || !input.transcript_path) return '';
    if (input.agent_id) return '';
    const sessionId = input.session_id || path.basename(input.transcript_path, '.jsonl');
    const state = update(sessionId, input.transcript_path, env);
    const { level, line } = lineFor(state, limitFor(env));
    state.level = level;
    writeState(state, env);
    return line ? JSON.stringify({ systemMessage: line }) : '';
  } catch {
    return '';
  }
}

function main() {
  try {
    let input = null;
    try {
      input = JSON.parse(readFileSync(0, 'utf8'));
    } catch {
      return;
    }
    const out = run(input);
    if (out) process.stdout.write(`${out}\n`);
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
