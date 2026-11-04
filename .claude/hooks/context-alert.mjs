#!/usr/bin/env node
// Context alert hook (D-122): tells a session when its context passes the handover lines. Runs on
// PostToolUse (every tool) and UserPromptSubmit, so it must be fast: it reads only the last 512 KB
// of the transcript (transcripts reach tens of MB), no network, no full-file read.
//
// Rule (the user 2026-11-03, lanes eased 2026-11-04): plan the handover at 200k tokens, be out by
// 250k; a lane (session project dir under .claude/worktrees/) plans at 250k and is out by 300k.
//
// Context = input + cache read + cache creation tokens of the last main-thread assistant response
// (of its last sampling pass when the response has several, see contextOf), counted only when the
// response before it was at least as big (a backstop, see confirmedContextIn).
// Each line prints once per session (state: <tmp>/context-alert/<session_id>.json); the state
// resets when the context drops under the plan line again (after a /compact or a new start).
//
// Output: JSON with `systemMessage` (shown to the user) and `hookSpecificOutput.additionalContext`
// (for Claude), or nothing at all. Any failure prints nothing and exits 0: a hook must never block.
//
// Override (tests and checks): CONTEXT_ALERT_STATE_DIR.

import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PLAN_AT = 200_000;
export const OUT_AT = 250_000;
export const LANE_PLAN_AT = 250_000;
export const LANE_OUT_AT = 300_000;
export const TAIL_BYTES = 512 * 1024;

// A lane works in a worktree under .claude/worktrees/; the planner and other sessions in the main
// checkout keep the lower lines. A path we cannot read as a lane gets the lower lines. Callers pass
// CLAUDE_PROJECT_DIR (fixed for the session), falling back to the payload cwd.
export function limitsFor(dir) {
  const lane = typeof dir === 'string' && /[\\/]\.claude[\\/]worktrees[\\/]/i.test(dir);
  return lane ? { plan: LANE_PLAN_AT, out: LANE_OUT_AT } : { plan: PLAN_AT, out: OUT_AT };
}

// --- the transcript tail -------------------------------------------------------------------

// A response that called a server-side tool (the advisor) is sampled more than once, and its
// top-level usage is the sum of those passes: a call at 164k reads 328k. `usage.iterations` lists
// the passes; the last one of type "message" is the context the session now holds ("advisor_message"
// entries are the advisor model's own read). All 210 multi-pass responses from 2026-10-23 to
// 2026-10-31 were advisor calls (vault Design/Phantom context readings 2026-10-31). A pass with no
// token counts at all is ignored, so an unknown shape falls back to the top level, never to 0.
const FIELDS = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];

export function contextOf(usage) {
  const n = v => (Number.isFinite(v) ? v : 0);
  const passes = Array.isArray(usage.iterations)
    ? usage.iterations.filter(
        it => it && it.type === 'message' && FIELDS.some(f => Number.isFinite(it[f]))
      )
    : [];
  const u = passes.length ? passes[passes.length - 1] : usage;
  return FIELDS.reduce((sum, f) => sum + n(u[f]), 0);
}

// The main-thread assistant responses with usage in the given text lines (a partial first line is
// the caller's business), newest first, as context sizes in tokens, at most `max`. A response
// written as several transcript lines shares one message id and counts once.
export function recentContextsIn(lines, max = 2) {
  const out = [];
  const seen = new Set();
  for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
    const line = lines[i];
    if (!line || !line.includes('"usage"')) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j?.type !== 'assistant' || j.isSidechain || !j.message?.usage) continue;
    const id = j.message.id;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const ctx = contextOf(j.message.usage);
    if (ctx === 0 || j.message.model === '<synthetic>') continue; // an API error or interrupt note
    out.push(ctx);
  }
  return out;
}

// The last main-thread assistant response with usage in the given text lines.
// Returns the context in tokens, or null.
export function lastContextIn(lines) {
  const [last] = recentContextsIn(lines, 1);
  return last ?? null;
}

// The context to act on. An advisor call's top level reads about twice the real context (cache
// read 161,654 then 327,920 then 164,453), which caused 38 false handovers from 2026-10-23 to
// 2026-10-31 (and showed 574k and 607k for two that were due anyway); contextOf reads the last pass.
// As a backstop for any other one-off spike, a reading counts only when the response before it was
// also big, so the effective context is the smaller of the last two responses; with a single
// response it is that one.
export function confirmedContextIn(lines) {
  const [last, prev] = recentContextsIn(lines, 2);
  if (last === undefined) return null;
  return prev === undefined ? last : Math.min(last, prev);
}

// Reads the last `tailBytes` of a file; when the read starts mid-file the first (partial) line is
// dropped.
export function readTailLines(file, tailBytes = TAIL_BYTES) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, tailBytes);
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const n = readSync(fd, buf, got, len - got, size - len + got);
      if (n <= 0) break;
      got += n;
    }
    const lines = buf.subarray(0, got).toString('utf8').split('\n');
    if (size > len) lines.shift();
    return lines;
  } finally {
    closeSync(fd);
  }
}

export function contextFromTranscript(file, tailBytes = TAIL_BYTES) {
  try {
    return confirmedContextIn(readTailLines(file, tailBytes));
  } catch {
    return null;
  }
}

// --- once per threshold --------------------------------------------------------------------

export function stateDirFor(env = process.env) {
  return env.CONTEXT_ALERT_STATE_DIR || path.join(os.tmpdir(), 'context-alert');
}

function stateFile(sessionId, env) {
  return path.join(stateDirFor(env), `${String(sessionId).replace(/[^\w.-]/g, '_')}.json`);
}

// level: 0 nothing announced, 1 the plan line, 2 the out line.
function readLevel(sessionId, env) {
  try {
    const level = JSON.parse(readFileSync(stateFile(sessionId, env), 'utf8'))?.level;
    return level === 1 || level === 2 ? level : 0;
  } catch {
    return 0;
  }
}

function writeLevel(sessionId, level, env) {
  try {
    mkdirSync(stateDirFor(env), { recursive: true });
    writeFileSync(stateFile(sessionId, env), JSON.stringify({ level }));
  } catch {
    // no state: the line may print again next time, never an error
  }
}

// --- the message ---------------------------------------------------------------------------

const k = tokens => `${Math.round(tokens / 1000)}k`;

export function messageFor(level, context, eventName, limits = limitsFor()) {
  const hookEventName = eventName || 'PostToolUse';
  if (level === 2) {
    return {
      systemMessage: `Context ${k(context)}: hand over now.`,
      hookSpecificOutput: {
        hookEventName,
        additionalContext: `Context is ${k(context)} tokens (D-122 hard line ${k(limits.out)}): stop taking new work and write the handover prompt now (lane skill), then stop.`,
      },
    };
  }
  return {
    systemMessage: `Context ${k(context)}: plan the handover (lane skill).`,
    hookSpecificOutput: {
      hookEventName,
      additionalContext: `Context is ${k(context)} tokens (D-122 handover line ${k(limits.plan)}): finish the current step, then write the handover prompt and stop. Out by ${k(limits.out)}.`,
    },
  };
}

// The whole decision for one hook call: the JSON to print, or '' for nothing.
export function run(input, env = process.env) {
  try {
    if (!input || typeof input !== 'object' || !input.transcript_path) return '';
    // A tool call inside a subagent carries agent_id and reads the parent's transcript: staying quiet
    // (and leaving the state alone) keeps the line for the main thread.
    if (input.agent_id) return '';
    const sessionId = input.session_id || 'unknown';
    const context = contextFromTranscript(input.transcript_path);
    if (context === null) return '';
    // CLAUDE_PROJECT_DIR is fixed for the session; the payload cwd moves with a `cd`
    const limits = limitsFor(env.CLAUDE_PROJECT_DIR || input.cwd);
    const level = context >= limits.out ? 2 : context >= limits.plan ? 1 : 0;
    const announced = readLevel(sessionId, env);
    if (level === 0) {
      if (announced) writeLevel(sessionId, 0, env);
      return '';
    }
    if (level <= announced) return '';
    writeLevel(sessionId, level, env);
    return JSON.stringify(messageFor(level, context, input.hook_event_name, limits));
  } catch {
    return '';
  }
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  try {
    let input = null;
    try {
      input = JSON.parse(readStdin());
    } catch {
      return;
    }
    const out = run(input);
    if (out) process.stdout.write(`${out}\n`);
  } catch {
    // never block a tool call
  }
}

const self = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href
) {
  main();
}
