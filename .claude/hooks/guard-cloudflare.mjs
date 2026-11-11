#!/usr/bin/env node
// PreToolUse guard for the Cloudflare connector's `execute` tool (Claude Code hook).
//
// The connector exposes `mcp__<connector id>__execute`, which runs JavaScript that calls
// `cloudflare.request({ method, path, ... })`. The tool used to sit on the allow list, so reads and
// writes ran with no prompt. The user decided (2026-11-11) that Claude carries out the Cloudflare
// changes it proposes, and that the APP enforces the approval, not good manners.
//
// This hook makes the app ask ("ask") unless the code is on a strict allow-list. The code is parsed
// (acorn) and only this shape runs without a prompt:
//   - every use of the name `cloudflare` is the callee object of `cloudflare.request(<one inline
//     object>)` (no alias, destructuring, bracket access, optional call or spread of it);
//   - that object has exactly one `method` property, written plainly (not computed, not a getter,
//     not shorthand, not a spread, no escaped name) with the string literal 'GET';
//   - the code does not use a blocklist of escape hatches (eval, Function, globalThis, this,
//     import(), prototype and descriptor tricks, fetch, computed property names, HTML-style
//     comment markers). The blocklist is best effort on top of the strict shape above; it also
//     makes other connectors' execute code that uses these names ask.
// Code that never mentions "cloudflare" and has none of those escapes (another connector's execute)
// passes. A parse error, a missing parser, a non-string `code` or an odd payload asks (fail closed).
// The reason lists the methods and paths found.
//
// Anything the hook cannot read as GET-only asks, even when it is harmless. Whether "ask" beats an
// allow-list entry was tested headless (see PR); if the user's `.claude/settings.local.json` still
// allows the tool and no prompt appears, remove that entry.
//
// If the hook process itself fails (crash, timeout, missing file) Claude Code lets the call run;
// the user accepted that residual risk on 2026-11-11.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

let acorn = null;
try {
  acorn = await import('acorn');
} catch {
  acorn = null; // asks for every call below
}

const MAX_CODE = 200_000;
// Names that can reach the Cloudflare object, or build a call, without writing `cloudflare.request(`.
const ESCAPES = new Set([
  'eval', 'Function', 'AsyncFunction', 'globalThis', 'global', 'self', 'window', 'Reflect',
  'Proxy', 'process', 'require', 'module', 'arguments', 'fetch',
]);
// Dangerous even as a property name (`x.constructor`, `Object.getPrototypeOf`, `String.prototype`).
const PROP_ESCAPES = new Set([
  'constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__', 'defineProperty',
  'defineProperties', 'setPrototypeOf', 'getPrototypeOf', 'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors', 'prepareStackTrace', 'captureStackTrace', 'getThis', 'getFunction',
]);

function children(node) {
  const out = [];
  for (const [k, v] of Object.entries(node)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    if (Array.isArray(v)) for (const x of v) if (x && typeof x.type === 'string') out.push(x);
    if (v && typeof v.type === 'string') out.push(v);
  }
  return out;
}

const textOf = n => {
  if (!n) return '(none)';
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'TemplateLiteral') return n.quasis.map(q => q.value.cooked ?? '').join('${..}');
  return '(computed)';
};

const keyName = p => {
  if (p.computed) return null;
  if (p.key.type === 'Identifier') return p.key.name;
  if (p.key.type === 'Literal') return String(p.key.value);
  return null;
};

/** Analyse the code. Returns { kind: 'other' | 'read' | 'ask', calls, problems }. */
export function classify(code) {
  const ask = (...problems) => ({ kind: 'ask', calls: [], problems });
  if (typeof code !== 'string') return ask('the code is not a string');
  if (code.length > MAX_CODE) return ask('the code is too long to check');
  if (!acorn) return ask('the parser (acorn) is not installed, run npm ci');
  if (code.includes('<!--') || code.includes('-->')) return ask('the code has an HTML-style comment marker');
  let ast;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      // Module mode sees at least as much code as script mode, whichever the runtime uses
      // (script mode reads "<!--" as a comment start, module mode does not).
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    });
  } catch (e) {
    return ask(`the code does not parse (${String(e.message).replace(/\s*\(\d+:\d+\)$/, '')})`);
  }
  const problems = [];
  const calls = [];
  let mentions = false;
  const walk = (node, parent, grand) => {
    if (node.type === 'Identifier' || node.type === 'PrivateIdentifier') {
      // `p.require` is a data field, not the global; only `.constructor` is dangerous as a property.
      const asProperty =
        (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
        (parent?.type === 'Property' && parent.key === node && !parent.computed);
      if ((ESCAPES.has(node.name) && !asProperty) || PROP_ESCAPES.has(node.name)) {
        problems.push(`the code uses ${node.name}`);
      }
      if (node.name === 'cloudflare') {
        mentions = true;
        const isCallee =
          parent?.type === 'MemberExpression' &&
          parent.object === node &&
          !parent.computed &&
          !parent.optional &&
          parent.property.type === 'Identifier' &&
          parent.property.name === 'request' &&
          grand?.type === 'CallExpression' &&
          grand.callee === parent &&
          !grand.optional;
        if (!isCallee) problems.push('cloudflare is used other than as a direct cloudflare.request(...) call');
        else checkCall(grand);
      }
    } else if (node.type === 'ThisExpression') {
      problems.push('the code uses this');
    } else if (node.type === 'MemberExpression' && node.computed && !(node.property.type === 'Literal' && typeof node.property.value === 'number')) {
      problems.push('the code uses a computed property name');
    } else if (node.type === 'Literal' && typeof node.value === 'string' && (ESCAPES.has(node.value) || PROP_ESCAPES.has(node.value))) {
      problems.push(`the code names ${node.value} in a string`);
    } else if (node.type === 'ImportExpression' || node.type === 'MetaProperty') {
      problems.push('the code uses import()');
    } else if (node.type === 'Literal' && typeof node.value === 'string' && /cloudflare/i.test(node.value)) {
      // A string that spells the name could feed a dynamic lookup; the lookup itself is blocked by
      // ESCAPES, so this only marks the code as Cloudflare-related.
      mentions = true;
    } else if (node.type === 'TemplateLiteral' && node.quasis.some(q => /cloudflare/i.test(q.value.raw))) {
      mentions = true;
    }
    for (const c of children(node)) walk(c, node, parent);
  };
  const checkCall = call => {
    if (call.arguments.length !== 1 || call.arguments[0].type !== 'ObjectExpression') {
      problems.push('a cloudflare.request call whose options are not one inline object');
      calls.push({ method: '(unknown)', path: '(unknown)' });
      return;
    }
    const props = call.arguments[0].properties;
    let method = null;
    let methodCount = 0;
    let pathText = '(none)';
    for (const p of props) {
      if (p.type !== 'Property') {
        problems.push('a cloudflare.request call with a spread');
        continue;
      }
      if (p.computed) {
        problems.push('a cloudflare.request call with a computed key');
        continue;
      }
      const name = keyName(p);
      if (name === 'path' || name === 'url') pathText = textOf(p.value);
      if (name !== 'method') continue;
      methodCount++;
      const ok = p.kind === 'init' && !p.shorthand && !p.method && p.value.type === 'Literal' && typeof p.value.value === 'string';
      method = ok ? p.value.value : `(${p.value.type})`;
      if (!ok) problems.push('the method is not a plain string literal');
      else if (method !== 'GET') problems.push(`method is ${method}, not GET`);
    }
    if (methodCount === 0) {
      problems.push('a cloudflare.request call with no method');
      method = '(none)';
    } else if (methodCount > 1) {
      problems.push('a cloudflare.request call with more than one method');
    }
    calls.push({ method, path: pathText });
  };
  walk(ast, null, null);
  if (problems.length) return { kind: 'ask', calls, problems: [...new Set(problems)] };
  return { kind: mentions ? 'read' : 'other', calls, problems: [] };
}

/** The ask reason for a tool call, or null when the call may run. */
export function decide(toolName, input) {
  if (!/^mcp__.+__execute$/.test(toolName)) return null;
  const code = input && typeof input === 'object' ? input.code : undefined;
  if (typeof code !== 'string') {
    return 'the execute call has no readable `code`, so it cannot be classified.';
  }
  const r = classify(code);
  if (r.kind !== 'ask') return null;
  const seen = r.calls.map(c => `${c.method} ${c.path}`);
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
