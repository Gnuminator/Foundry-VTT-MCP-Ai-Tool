#!/usr/bin/env node
// PreToolUse guard for the Cloudflare connector's `execute` tool (Claude Code hook).
//
// The connector exposes `mcp__<connector id>__execute`, which runs JavaScript that calls
// `cloudflare.request({ method, path, ... })`. The tool used to sit on the allow list, so reads and
// writes ran with no prompt. The user decided (2026-11-11) that Claude carries out the Cloudflare
// changes it proposes, and that the APP enforces the approval, not good manners.
//
// This hook makes the app ask ("ask") for every call that is not provably read-only:
//   - code with no `cloudflare.request` is not ours: pass (another connector's `execute`);
//   - every `method:` value must be the literal 'GET' / "GET" / `GET`, and every `cloudflare.request`
//     call must carry exactly one; otherwise ask. A missing method, a method held in a variable, an
//     options object built elsewhere, a spread, an unreadable `code` or an odd input shape all ask
//     (fail closed). The reason lists the methods and paths found.
// A GET-only call prints nothing and runs under the normal permission rules.
//
// Whether "ask" beats an allow-list entry is documented in the PR; if the user's
// `.claude/settings.local.json` still allows the tool, the reason says to remove that entry.
//
// Reads the hook payload (JSON) on stdin. An unparseable payload asks too: the matcher only
// routes `mcp__*__execute` calls here, so we cannot tell whether it is a Cloudflare one.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_CODE = 200_000;

/** Index of the matching close bracket for the opener at `open`, skipping strings; -1 if unbalanced. */
function matchClose(code, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  let i = open;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < code.length && code[i] !== q) {
        if (code[i] === '\\') i++;
        i++;
      }
    } else if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
    } else if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end < 0) return -1;
      i = end + 1;
    } else if (pairs[c]) {
      stack.push(pairs[c]);
    } else if (c === ')' || c === '}' || c === ']') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
    i++;
  }
  return -1;
}

const METHOD_RE = /(?:^|[\s,{])["']?method["']?\s*:\s*([^,}\n]*)/g;
const PATH_RE = /(?:^|[\s,{])["']?(?:path|url)["']?\s*:\s*((["'`])(?:(?!\2)[^\\]|\\.)*\2)/g;
const LITERAL_GET = /^(["'`])GET\1$/;

/** Analyse the code. Returns { kind, calls, problems } where kind is 'other' | 'read' | 'ask'. */
export function classify(code) {
  if (typeof code !== 'string') return { kind: 'ask', calls: [], problems: ['the code is not a string'] };
  if (code.length > MAX_CODE) return { kind: 'ask', calls: [], problems: ['the code is too long to check'] };
  if (!/\bcloudflare\b/.test(code)) {
    return { kind: 'other', calls: [], problems: [] };
  }
  const problems = [];
  const calls = [];
  // Aliasing the function (const r = cloudflare.request; r(...)) or passing it on is not analysable.
  const callRe = /cloudflare\s*\.\s*request\s*\(/g;
  const totalRefs = (code.match(/\bcloudflare\b/g) ?? []).length;
  let m;
  let callCount = 0;
  while ((m = callRe.exec(code))) {
    callCount++;
    const open = m.index + m[0].length - 1;
    const close = matchClose(code, open);
    if (close < 0) {
      problems.push('a cloudflare.request call could not be read to its end');
      continue;
    }
    const args = code.slice(open + 1, close);
    const trimmed = args.trim();
    if (!trimmed.startsWith('{') || matchClose(trimmed, 0) !== trimmed.length - 1) {
      problems.push('a cloudflare.request call whose options are not one inline object');
      calls.push({ method: '?', path: '?' });
      continue;
    }
    // Spread or computed keys hide the method.
    if (/(^|[\s,{])\.\.\./.test(trimmed) || /(^|[\s,{])\[/.test(trimmed)) {
      problems.push('a cloudflare.request call with a spread or computed key');
    }
    // Only look at top-level properties of the options object (depth 1), so a nested body
    // that happens to contain "method:" cannot satisfy or confuse the check.
    const top = topLevel(trimmed);
    const methods = [...top.matchAll(METHOD_RE)].map(x => x[1].trim());
    const paths = [...top.matchAll(PATH_RE)].map(x => x[1]);
    let method;
    if (methods.length === 0) {
      method = '(none)';
      problems.push('a cloudflare.request call with no method');
    } else if (methods.length > 1) {
      method = methods.join('|');
      problems.push('a cloudflare.request call with more than one method');
    } else if (LITERAL_GET.test(methods[0])) {
      method = 'GET';
    } else {
      method = methods[0] || '(empty)';
      problems.push(`method is not the literal GET: ${method}`);
    }
    calls.push({ method, path: paths[0] ?? '(computed or none)' });
  }
  if (callCount === 0) problems.push('cloudflare is used but not as a direct cloudflare.request call');
  else if (totalRefs > callCount) problems.push('cloudflare is referenced in a way that is not a direct cloudflare.request call');
  // Any other occurrence of a write verb as a method value anywhere is reported for the reader.
  for (const w of code.matchAll(/method["']?\s*:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/gi)) {
    problems.push(`a ${w[1].toUpperCase()} appears in the code`);
  }
  return { kind: problems.length ? 'ask' : 'read', calls, problems: [...new Set(problems)] };
}

/** The text of an object literal with everything nested deeper than depth 1 blanked out. */
function topLevel(obj) {
  let depth = 0;
  let out = '';
  let i = 0;
  while (i < obj.length) {
    const c = obj[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let j = i + 1;
      while (j < obj.length && obj[j] !== q) {
        if (obj[j] === '\\') j++;
        j++;
      }
      const lit = obj.slice(i, j + 1);
      out += depth === 1 ? lit : ' '.repeat(lit.length);
      i = j + 1;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') {
      depth++;
      out += depth === 1 ? c : ' ';
    } else if (c === '}' || c === ']' || c === ')') {
      out += depth === 1 ? c : ' ';
      depth--;
    } else {
      out += depth === 1 ? c : ' ';
    }
    i++;
  }
  return out;
}

/** The ask reason for a tool call, or null when the call may run. */
export function decide(toolName, input) {
  if (!/^mcp__.+__execute$/.test(toolName)) return null;
  const code = input && typeof input === 'object' ? input.code : undefined;
  if (typeof code !== 'string') {
    // No readable code: we cannot say it is not Cloudflare, so ask.
    return 'the execute call has no readable `code`, so it cannot be classified.';
  }
  const r = classify(code);
  if (r.kind === 'other') return null;
  if (r.kind === 'read') return null;
  const bare = s => String(s).replace(/^(["'`])(.*)\1$/, '$2');
  const seen = r.calls.map(c => `${bare(c.method)} ${bare(c.path)}`);
  const list = seen.length ? ` Calls found: ${[...new Set(seen)].join('; ')}.` : '';
  return `this Cloudflare call is not provably read-only (${r.problems.join('; ')}).${list} Approve only the change the user was shown. If this prompt did not appear, remove the allow entry for this execute tool from .claude/settings.local.json.`;
}

export function run(input) {
  let reason;
  try {
    reason = decide(String(input?.tool_name ?? ''), input?.tool_input);
  } catch {
    reason = 'the guard failed to classify this execute call (failing closed).';
  }
  if (!reason) return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: `Cloudflare guard (.claude/hooks/guard-cloudflare.mjs): ${reason}`,
    },
  });
}

function main() {
  let input = null;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    // Unparseable payload on a matched execute tool: fail closed.
    process.stdout.write(
      `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'Cloudflare guard: the hook payload could not be read (failing closed).' } })}\n`
    );
    return;
  }
  const out = run(input);
  if (out) process.stdout.write(`${out}\n`);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href) {
  main();
}
