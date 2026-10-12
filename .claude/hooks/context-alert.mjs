#!/usr/bin/env node
// Context alert hook (D-122): tells a session when its context passes the handover lines. Runs on
// PostToolUse (every tool) and UserPromptSubmit, so it must be fast: it reads only the last 512 KB
// of the transcript (transcripts reach tens of MB), no network, no full-file read.
//
// Rule: plan the handover at 350k tokens, be out by 400k. While the weekly limit is above 50% the
// lines are 200k and 250k (low mode: env CONTEXT_ALERT_LOW=1, or the file
// ~/.foundry-ai-tool/context-thresholds.json = { "plan": n, "out": n }, which the planner writes;
// the file wins over the env).
//
// Context = input + cache read + cache creation tokens of the last main-thread assistant response.
// Each line prints once per session (state: <tmp>/context-alert/<session_id>.json); the state
// resets when the context drops under the plan line again (after a /compact or a new start).
//
// Output: JSON with `systemMessage` (shown to the user) and `hookSpecificOutput.additionalContext`
// (for Claude), or nothing at all. Any failure prints nothing and exits 0: a hook must never block.
//
// Overrides (tests and checks): CONTEXT_ALERT_LOW, CONTEXT_ALERT_THRESHOLDS_FILE,
// CONTEXT_ALERT_STATE_DIR.

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

export const PLAN_AT = 350_000;
export const OUT_AT = 400_000;
export const LOW_PLAN_AT = 200_000;
export const LOW_OUT_AT = 250_000;
export const TAIL_BYTES = 512 * 1024;

// --- thresholds ----------------------------------------------------------------------------

function validPair(plan, out) {
  return Number.isFinite(plan) && Number.isFinite(out) && plan > 0 && out > plan
    ? { plan, out }
    : null;
}

export function thresholdsFile(env = process.env) {
  return (
    env.CONTEXT_ALERT_THRESHOLDS_FILE ||
    path.join(os.homedir(), '.foundry-ai-tool', 'context-thresholds.json')
  );
}

export function thresholdsFor(env = process.env) {
  try {
    const data = JSON.parse(readFileSync(thresholdsFile(env), 'utf8').replace(/^﻿/, ''));
    const pair = validPair(Number(data?.plan), Number(data?.out));
    if (pair) return pair;
  } catch {
    // no file, or unreadable: the env or the defaults
  }
  if (env.CONTEXT_ALERT_LOW === '1') return { plan: LOW_PLAN_AT, out: LOW_OUT_AT };
  return { plan: PLAN_AT, out: OUT_AT };
}

// --- the transcript tail -------------------------------------------------------------------

export function contextOf(usage) {
  const n = v => (Number.isFinite(v) ? v : 0);
  return (
    n(usage.input_tokens) + n(usage.cache_read_input_tokens) + n(usage.cache_creation_input_tokens)
  );
}

// The last main-thread assistant response with usage in the given text lines (a partial first
// line is the caller's business). Returns the context in tokens, or null.
export function lastContextIn(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"usage"')) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j?.type !== 'assistant' || j.isSidechain || !j.message?.usage) continue;
    return contextOf(j.message.usage);
  }
  return null;
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
    return lastContextIn(readTailLines(file, tailBytes));
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

export function messageFor(level, context, { plan, out }, eventName) {
  const hookEventName = eventName || 'PostToolUse';
  if (level === 2) {
    return {
      systemMessage: `Context ${k(context)}: hand over now.`,
      hookSpecificOutput: {
        hookEventName,
        additionalContext: `Context is ${k(context)} tokens (D-122 hard line ${k(out)}): stop taking new work and write the handover prompt now (lane skill), then stop.`,
      },
    };
  }
  return {
    systemMessage: `Context ${k(context)}: plan the handover (lane skill).`,
    hookSpecificOutput: {
      hookEventName,
      additionalContext: `Context is ${k(context)} tokens (D-122 handover line ${k(plan)}): finish the current step, then write the handover prompt and stop. Out by ${k(out)}.`,
    },
  };
}

// The whole decision for one hook call: the JSON to print, or '' for nothing.
export function run(input, env = process.env) {
  try {
    if (!input || typeof input !== 'object' || !input.transcript_path) return '';
    // A tool call inside a subagent carries agent_id and reads the parent's transcript: staying quiet
    // (and leaving the state alone) keeps the line for the main thread.
    if (input.agent_id || input.agent_type) return '';
    const sessionId = input.session_id || 'unknown';
    const context = contextFromTranscript(input.transcript_path);
    if (context === null) return '';
    const thresholds = thresholdsFor(env);
    const level = context >= thresholds.out ? 2 : context >= thresholds.plan ? 1 : 0;
    const announced = readLevel(sessionId, env);
    if (level === 0) {
      if (announced) writeLevel(sessionId, 0, env);
      return '';
    }
    if (level <= announced) return '';
    writeLevel(sessionId, level, env);
    return JSON.stringify(messageFor(level, context, thresholds, input.hook_event_name));
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
