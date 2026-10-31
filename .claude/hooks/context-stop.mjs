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
// The context is the confirmed one from context-alert.mjs: the last pass of an advisor response
// (its top level sums two passes), and a reading counts only when the response before it was also
// big, so a doubled phantom reading never stops a session.
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
  /obsidian[\\/]vault|scratchpad|side-session-notes|[\\/](?:temp|tmp)(?:[\\/\s"']|$)|\.foundry-ai-tool|\$env:te?mp|\$\{?TMPDIR|%te?mp%/i;

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
  /writeFile|appendFile|createWriteStream|(?<!stdout|stderr)\.write\(|write_text|write_bytes|open\([^,)]*,\s*['"][wa]/;

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

// The non-null redirect targets of a segment.
function redirectTargets(masked, raw) {
  const re = /(?<![=\-<>])\d?>>?(?!&)\s*([^\s|;&<>)]+)/g;
  const out = [];
  let m;
  while ((m = re.exec(masked))) {
    const at = m.index + m[0].length - m[1].length;
    const target = raw.slice(at, at + m[1].length).replace(/^["']+|["']+$/g, '');
    if (!NULL_TARGET.test(target)) out.push(target);
  }
  return out;
}

const TARGET_LAST = new Set(['cp', 'mv', 'tee', 'copy-item', 'move-item']);

// What decides whether a write leaves the repo: the redirect targets, the destination (last
// argument) of cp, mv, tee and the file cmdlets, else the whole segment. A source path that is
// outside the repo (`cp <scratchpad>/x src/x.ts`) must not exempt the write.
function targetProbe(raw, redirects) {
  if (redirects.length) return redirects.join(' ');
  const { word, rest } = firstWord(raw);
  if (TARGET_LAST.has(word)) {
    // quoted paths with spaces stay whole; flags and redirects are not the destination
    const tokens = rest.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    const at = tokens.findIndex(t => /^-destination$/i.test(t));
    if (at >= 0 && tokens[at + 1]) return tokens[at + 1];
    const args = tokens.slice(1).filter(t => !/^-/.test(t) && !/^\d?>/.test(t));
    return args[args.length - 1] ?? rest;
  }
  return raw;
}

// Segments of a command as aligned [masked, raw] pairs (masking keeps lengths, so the separators
// found in the masked text cut the raw text at the same places).
function segmentsOf(masked, raw) {
  const out = [];
  const sep = /&&|\|\||;|\||\r?\n/g;
  let from = 0;
  let m;
  while ((m = sep.exec(masked))) {
    out.push([masked.slice(from, m.index), raw.slice(from, m.index)]);
    from = m.index + m[0].length;
  }
  out.push([masked.slice(from), raw.slice(from)]);
  return out;
}

const CD = /^(?:cd|chdir|pushd|set-location|push-location|sl)\s+(?:-\w+\s+)*("[^"]*"|'[^']*'|\S+)/i;

/**
 * True when a Bash or PowerShell command writes inside the repo (heuristic, every doubt allows).
 * A write is exempt when its own segment names the vault, scratchpad or temp, or when the last
 * `cd` before it went there (or the command started outside the repo and the segment never names it).
 */
export function shellWritesRepo(command, cwd, repoRoot = REPO_ROOT) {
  try {
    const text = String(command ?? '');
    if (!text.trim() || text.length > MAX_ANALYZE) return false;
    const { outer, bodies } = splitBodies(text);
    const masked = maskQuotes(outer);
    const root = normalize(repoRoot).toLowerCase();
    const namesRepo = s => normalize(s).toLowerCase().includes(root);
    let away = Boolean(cwd) && !insideRepo(cwd, '', repoRoot);
    for (const [maskedSeg, rawSeg] of segmentsOf(masked, outer)) {
      const cd = CD.exec(firstWord(rawSeg).rest);
      if (cd) {
        const target = cd[1].replace(/^["']+|["']+$/g, '');
        const absolute = /^([a-zA-Z]:)?[\\/]/.test(target);
        if (OUTSIDE.test(target) || (absolute && !insideRepo(target, '', repoRoot))) away = true;
        else if (absolute) away = false;
        continue;
      }
      const redirects = redirectTargets(maskedSeg, rawSeg);
      if (!redirects.length && !segmentWrites(maskedSeg, rawSeg)) continue;
      const probe = targetProbe(rawSeg, redirects);
      if (OUTSIDE.test(probe) || (away && !namesRepo(rawSeg))) continue;
      return true;
    }
    // a node or python script fed on stdin: the heredoc body is the script
    const feeds = b => /\b(?:node|python3?|py)\s+(?:-\s*)?<</.test(b.intro);
    if (bodies.some(b => feeds(b) && SCRIPT_WRITES.test(b.body))) {
      return !(OUTSIDE.test(text) || (away && !namesRepo(text)));
    }
    return false;
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
    if (input.agent_id) return null; // agent_type alone also marks a main thread started with --agent
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
