#!/usr/bin/env node
// PreToolUse guard for Agent, Task and start_session (Claude Code hook).
//
// An unset `model` inherits the caller's, so an Opus session that starts a worker or a lane
// without one runs that worker on Opus (measured 2026-10-16: 110 unset subagents all ran Opus;
// PR #359 "Open": cards created without `model` from an Opus session). CLAUDE.md "Models" says to
// set `model` on every Agent call and every start_session. This hook refuses the call when it is
// blank and names the rule.
//
// Exempt, because the model is not a choice there:
//   - Agent/Task with `subagent_type: "fork"` (a fork always inherits the parent model).
//   - start_session with `context: "fork"`, or `target: "cloud"` (the model does not apply there).
//   - start_session with a `proposal_id` and no `prompt` (starting a card; its model was set when
//     the card was proposed).
//   - start_session with `initiation: "offer"` and no `prompt` (the title-only offer card).
//
// Still denied on purpose:
//   - An agent type whose definition sets its own model: the call's `model` wins over it, and
//     CLAUDE.md asks for one on every call. (The deny text then says "inherits"; read it as "not set".)
//   - start_session with a `preset`: a preset may not set a model.
//
// The two tools take different forms: Agent takes the aliases "sonnet", "haiku", "opus"; start_session
// takes a model id ("claude-sonnet-5-5"), so an alias there is denied (it may be ignored by the app).
//
// Reads the hook payload (JSON) on stdin; prints a deny decision or nothing. Like the sibling
// hooks it fails open on an unparseable payload; a matched tool without `tool_input` is denied.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AGENT_TOOLS = new Set(['Agent', 'Task']);
const SESSION_TOOLS = new Set(['mcp__ccd_session__start_session']);

const blank = v => typeof v !== 'string' || v.trim() === '';

/** The deny reason for a tool call, or null when the call is allowed. */
export function decide(toolName, input) {
  const args = input && typeof input === 'object' ? input : {};
  if (AGENT_TOOLS.has(toolName)) {
    if (!blank(args.model)) return null;
    if (String(args.subagent_type ?? '').trim() === 'fork') return null;
    return 'this Agent call has no `model`, so it inherits the caller\'s (an Opus session starts Opus workers). Set `model` ("sonnet" for code, "haiku" for reading and simple edits, "opus" only for design and risky reviews).';
  }
  if (SESSION_TOOLS.has(toolName)) {
    if (String(args.context ?? '').trim() === 'fork') return null;
    if (String(args.target ?? '').trim() === 'cloud') return null;
    const noPrompt = blank(args.prompt);
    if (noPrompt && !blank(args.proposal_id)) return null;
    if (noPrompt && String(args.initiation ?? '').trim() === 'offer') return null;
    if (blank(args.model)) {
      return 'this start_session call has no `model`, so the new session inherits the caller\'s (an Opus session starts Opus lanes). Set `model` to a full model id: "claude-sonnet-5-5" for coding lanes, "claude-haiku-5-5" for reading and mechanical work, "claude-opus-5-5" only for the planner, design and risky reviews.';
    }
    if (!/^claude-/.test(args.model.trim())) {
      return `this start_session call sets \`model: "${args.model.trim()}"\`, but the tool takes a model id, and an alias it does not know may be ignored (the session then inherits the caller's). Use "claude-sonnet-5-5", "claude-haiku-5-5" or "claude-opus-5-5".`;
    }
    return null;
  }
  return null;
}

export function run(input) {
  try {
    const reason = decide(String(input?.tool_name ?? ''), input?.tool_input);
    if (!reason) return '';
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Blocked by .claude/hooks/guard-model.mjs (CLAUDE.md "Models": set \`model\` on every Agent call and every start_session): ${reason}`,
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
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href) {
  main();
}
