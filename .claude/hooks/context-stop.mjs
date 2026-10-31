#!/usr/bin/env node
// Context hard stop (PreToolUse hook, insights report 2026-10-31): once the main thread is at or
// above the "out" line (400k, or the low-mode file ~/.foundry-ai-tool/context-thresholds.json, the
// same source as context-alert.mjs), no new work starts. The alert hook prints its line once and
// nothing enforced it; two lanes ran on to 574k and 607k.
//
// Denied above the line:
//   - Edit, Write, MultiEdit, NotebookEdit on a file inside this repo
//   - Agent and Task (a subagent is new work)
//   - Bash and PowerShell commands that write inside the repo: redirects, tee, sed/perl -i, rm, mv,
//     cp, mkdir, Set-Content and the other file cmdlets, npm ci/install/build, prettier --write,
//     eslint --fix, git checkout/reset/merge/rebase/stash/pull and similar, and node or python
//     scripts whose text writes a file
// Allowed above the line: everything else (Read, Grep, Glob, SendMessage, set_session_title,
// wrap_up, update_plan: the matcher in settings.json does not even send those here), and in a shell
// command git add/commit/push/fetch/status, gh, and any write whose command names the vault, the
// scratchpad or the temp folder (the handover note goes to the vault).
// Calls from a subagent (agent_id) are left alone. The deny lifts by itself once the confirmed
// context is under the line again (after a /compact): there is no state.
//
// The context is the confirmed one from context-alert.mjs (a reading counts only when the response
// before it was also big, so a doubled phantom reading never stops a session).
//
// A false deny at 400k costs a handover that was due anyway, but every doubt allows: a payload we
// do not understand, no transcript, a shell command that only reads. This is a nudge with a clear
// message, not a security boundary (a script run from a file can still write).
// Reads the hook payload (JSON) on stdin; prints a deny decision or nothing.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contextFromTranscript, thresholdsFor } from './context-alert.mjs';
import { maskQuotes, splitBodies } from './guard-shell-edits.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const MAX_ANALYZE = 100_000;

// --- paths ---------------------------------------------------------------------------------

function normalize(p) {
  let s = String(p).replace(/\\/g, '/');
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(s); // git-bash /c/Users/...
  if (m) s = `${m[1]}:/${m[2]}`;
  return s;
}

/** True when `target` (relative ones resolve against `cwd`) lies inside `repoRoot`. */
export function insideRepo(target, cwd, repoRoot = REPO_ROOT) {
  const root = normalize(repoRoot).replace(/\/+$/, '').toLowerCase();
  let t = normalize(target);
  if (!/^([a-zA-Z]:)?\//.test(t)) {
    const base = normalize(cwd || repoRoot).replace(/\/+$/, '');
    t = `${base}/${t}`;
  }
  t = path.posix.normalize(t).toLowerCase();
  return t === root || t.startsWith(`${root}/`);
}

// --- shell commands ------------------------------------------------------------------------

// Places a handover or a log legitimately writes: the vault, the scratchpad, temp, the tool's home.
const OUTSIDE =
  /obsidian|scratchpad|side-session-notes|[\\/](?:temp|tmp)(?:[\\/\s"']|$)|\.foundry-ai-tool/i;

const ALWAYS_OK =
  /^(?:git\s+(?:add|commit|push|fetch|status|diff|log|show|branch|rev-parse|ls-files|remote|config)\b|gh\b)/;

const WRITE_COMMANDS = new Set([
  'tee',
  'rm',
  'mv',
  'cp',
  'mkdir',
  'touch',
  'rmdir',
  'ln',
  'truncate',
  'patch',
  'set-content',
  'add-content',
  'out-file',
  'new-item',
  'remove-item',
  'copy-item',
  'move-item',
  'rename-item',
  'clear-content',
  'set-item',
]);

const NPM_WRITES =
  /^(?:npm|pnpm|yarn)\s+(?:ci|install|i|add|uninstall|update|version|run\s+(?:build|format|docs:|[\w:-]*(?:update|baseline))[\w:-]*)\b/;
const TOOL_WRITES = /^(?:npx\s+)?(?:prettier\b.*\s--write\b|eslint\b.*\s--fix\b)/;
const GIT_WRITES =
  /^git\s+(?:checkout|switch|reset|restore|merge|rebase|stash|apply|am|cherry-pick|clean|rm|mv|pull|revert)\b/;
const SCRIPT_WRITES =
  /writeFile|appendFile|createWriteStream|\.write\(|write_text|write_bytes|open\([^)]*['"][wa]/;

function firstWord(segment) {
  const s = segment.replace(/^[\s({&]+/, '').replace(/^(?:\w+=\S*\s+)+/, '');
  const m = /^[^\s]+/.exec(s);
  return { word: m ? m[0].toLowerCase().replace(/^.*[\\/]/, '') : '', rest: s };
}

function segmentWrites(masked, raw) {
  const { word, rest } = firstWord(masked);
  if (ALWAYS_OK.test(rest)) return false;
  if (WRITE_COMMANDS.has(word)) return true;
  if (/\b(?:sed|perl)\b[^|]*\s-[A-Za-z]*i\b/.test(rest)) return true;
  if (NPM_WRITES.test(rest) || TOOL_WRITES.test(rest) || GIT_WRITES.test(rest)) return true;
  if (/^(?:node|python|python3|py|pwsh|powershell)\b/.test(word) && SCRIPT_WRITES.test(raw)) {
    return true;
  }
  return false;
}

const NULL_TARGET = /^(?:\/dev\/null|nul|\$null|&\d)$/i;

function redirectWrites(masked, raw) {
  const re = /(?<![=\-<>])\d?>>?(?!&)\s*([^\s|;&<>]+)/g;
  let m;
  while ((m = re.exec(masked))) {
    const at = m.index + m[0].length - m[1].length;
    const target = raw.slice(at, at + m[1].length).replace(/^["']+|["']+$/g, '');
    if (!NULL_TARGET.test(target)) return true;
  }
  return false;
}

/** True when a Bash or PowerShell command writes inside the repo (heuristic, every doubt allows). */
export function shellWritesRepo(command, cwd, repoRoot = REPO_ROOT) {
  try {
    const text = String(command ?? '');
    if (!text.trim() || text.length > MAX_ANALYZE) return false;
    const { outer, bodies } = splitBodies(text);
    const masked = maskQuotes(outer);
    let writes = redirectWrites(masked, outer);
    if (!writes) {
      const maskedSegments = masked.split(/&&|\|\||;|\||\r?\n/);
      const rawSegments = outer.split(/&&|\|\||;|\||\r?\n/);
      // masking keeps lengths, but a split inside a quoted span differs between the two; compare by
      // index only when the counts agree, else judge the masked text alone
      writes = maskedSegments.some((seg, i) =>
        segmentWrites(seg, rawSegments.length === maskedSegments.length ? rawSegments[i] : seg)
      );
    }
    if (!writes) {
      // a node or python script fed on stdin: the heredoc body is the script
      const feeds = /\b(?:node|python3?|py)\b/.test(masked);
      writes = feeds && bodies.some(b => SCRIPT_WRITES.test(b.body));
    }
    if (!writes) return false;
    if (OUTSIDE.test(text)) return false;
    if (
      cwd &&
      !insideRepo(cwd, '', repoRoot) &&
      !normalize(text).toLowerCase().includes(normalize(repoRoot).toLowerCase())
    ) {
      return false; // run from outside the repo and never names it
    }
    return true;
  } catch {
    return false;
  }
}

// --- decision ------------------------------------------------------------------------------

const k = tokens => `${Math.round(tokens / 1000)}k`;

function denyMessage(context, out, what) {
  return `Context is ${k(context)}, at or above the hand-over line (${k(out)}): ${what} is new work. Hand over now: write the handover note to the vault (Handoff/<lane> prompt <date>.md), update the - progress: line on the Backlog item, git add/commit/push what is done, tell the newest Planner, and stop. Still allowed: Read, Grep, Glob, git add/commit/push, gh, writes to the vault and the scratchpad, SendMessage, set_session_title, wrap_up, update_plan. Under the line again (after /compact) this lifts by itself.`;
}

/** The deny reason for a hook payload, or null to allow. Never throws. */
export function decide(input, env = process.env, repoRoot = REPO_ROOT) {
  try {
    if (!input || typeof input !== 'object' || !input.transcript_path) return null;
    if (input.agent_id || input.agent_type) return null;
    const tool = String(input.tool_name ?? '');
    const args = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
    let what = null;
    if (AGENT_TOOLS.has(tool)) {
      what = 'starting a subagent';
    } else if (FILE_TOOLS.has(tool)) {
      const target = args.file_path ?? args.notebook_path;
      if (typeof target === 'string' && target && insideRepo(target, input.cwd, repoRoot)) {
        what = `editing ${path.basename(normalize(target))}`;
      }
    } else if (SHELL_TOOLS.has(tool)) {
      if (shellWritesRepo(args.command, input.cwd, repoRoot))
        what = 'a command that writes in the repo';
    }
    if (!what) return null;
    const context = contextFromTranscript(input.transcript_path);
    if (context === null) return null;
    const { out } = thresholdsFor(env);
    if (context < out) return null;
    return denyMessage(context, out, what);
  } catch {
    return null;
  }
}

export function run(input, env = process.env) {
  const reason = decide(input, env);
  if (!reason) return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Blocked by .claude/hooks/context-stop.mjs: ${reason}`,
    },
  });
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
