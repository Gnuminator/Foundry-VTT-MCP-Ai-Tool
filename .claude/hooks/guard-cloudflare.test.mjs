// Tests for guard-cloudflare.mjs:  node --test .claude/hooks/guard-cloudflare.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classify, decide, run } from './guard-cloudflare.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, 'guard-cloudflare.mjs');
const TOOL = 'mcp__abc-123__execute';
const call = code => decide(TOOL, { code });

test('GET-only code runs (single and double quotes, several calls)', () => {
  assert.equal(call("return await cloudflare.request({ method: 'GET', path: '/accounts' });"), null);
  assert.equal(call('return await cloudflare.request({ method: "GET", path: `/zones` });'), null);
  assert.equal(
    call(
      "const a = await cloudflare.request({ method: 'GET', path: '/a' });\nconst b = await cloudflare.request({\n  path: '/b',\n  method: 'GET',\n  query: { per_page: 50 },\n});\nreturn [a, b];"
    ),
    null
  );
});

test('each write method asks and the reason names the method and the path', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const reason = call(`await cloudflare.request({ method: '${method}', path: '/x/y', body: {} })`);
    assert.ok(reason, method);
    assert.match(reason, new RegExp(method));
    assert.match(reason, /\/x\/y/);
  }
  assert.ok(call("await cloudflare.request({ method: 'put', path: '/x' })"), 'lower case is not the literal GET');
});

test('a method held in a variable or computed asks', () => {
  assert.ok(call("const m = 'GET'; await cloudflare.request({ method: m, path: '/a' })"));
  assert.ok(call("await cloudflare.request({ method: ['GET'][0], path: '/a' })"));
  assert.ok(call("await cloudflare.request({ method: 'G' + 'ET', path: '/a' })"));
  assert.ok(call("await cloudflare.request({ ['meth' + 'od']: 'POST', path: '/a' })"));
});

test('a call with no method, options built elsewhere, a spread or an alias asks', () => {
  assert.ok(call("await cloudflare.request({ path: '/a' })"), 'no method');
  assert.ok(call("const o = { method: 'GET', path: '/a' }; await cloudflare.request(o)"), 'options elsewhere');
  assert.ok(call("await cloudflare.request({ ...opts, method: 'GET', path: '/a' })"), 'spread');
  assert.ok(call("const r = cloudflare.request; await r({ method: 'POST', path: '/a' })"), 'alias');
  assert.ok(call("const { request } = cloudflare; await request({ method: 'POST', path: '/a' })"), 'destructured');
  assert.ok(call("await cloudflare['request']({ method: 'POST', path: '/a' })"), 'bracket call');
  assert.ok(call('await cloudflare.request()'), 'no arguments');
});

test('mixed code (a GET and a write) asks', () => {
  const reason = call(
    "await cloudflare.request({ method: 'GET', path: '/a' });\nawait cloudflare.request({ method: 'DELETE', path: '/b' });"
  );
  assert.ok(reason);
  assert.match(reason, /DELETE/);
});

test('a nested body key called method is data, not the HTTP method', () => {
  assert.equal(call("await cloudflare.request({ method: 'GET', path: '/a', body: { method: 'POST' } })"), null);
});

test('review H1 bypass shapes all ask', () => {
  const shapes = [
    "cloudflare.request({ method: 'GET'\n  && 'POST', path: '/x' })",
    "const method = 'POST'; cloudflare.request({ method: 'GET', path: '/x', method })",
    "cloudflare.request({ method: 'GET', path: '/x', get method() { return 'POST' } })",
    "cloudflare.request({ method: 'GET', '\\u006dethod': 'POST', path: '/x' })",
    "cloudflare.request({ method: 'GET', \\u006dethod: 'POST', path: '/x' })",
    "cloudflare.request({ method: 'GET', /**/method:/**/'POST', path: '/x' })",
    "const m = 'DELETE'; cloudflare.request({ /* { */ method: m /* } */, path: '/x' })",
    "\\u0063loudflare.request({ method: 'POST', path: '/x' })",
    "globalThis['cloud' + 'flare'].request({ method: 'POST', path: '/x' })",
    "eval(\"cloudflare.request({method:'POST',path:'/x'})\")",
    "new Function('return 1')()",
    "const f = async () => (await import('x'))",
    "cloudflare.request({ method: 'GET', path: '/x', method() { return 'POST' } })",
    "cloudflare?.request({ method: 'GET', path: '/x' })",
    "cloudflare.request?.({ method: 'GET', path: '/x' })",
    'cloudflare.request({ method: `GET`, path: "/x" })',
    // round 2: HTML-style comment hides a write in script mode only
    "async () => { let b = 1; 0 <!--b, cloudflare.request({ method: 'DELETE', path: '/x' })\n}",
    // round 2: string-keyed access to the constructor, no identifiers
    "[]['constructor']['constructor'](\"return cloudflare.request({method:'DELETE',path:'/x'})\")()",
    "[]['cons' + 'tructor']['constructor']('return 1')()",
    "Object.getOwnPropertyDescriptor(Object.getPrototypeOf(async () => {}), 'constructor').value('x')",
    // round 2: changing the realm before a literal GET
    "String.prototype.toUpperCase = () => 'DELETE'; await cloudflare.request({ method: 'GET', path: '/x' })",
    "fetch = (u, o) => g(u, { ...o, method: 'DELETE' }); await cloudflare.request({ method: 'GET', path: '/x' })",
    "Object.defineProperty(Object.prototype, 'headers', { value: {} }); await cloudflare.request({ method: 'GET', path: '/x' })",
  ];
  for (const s of shapes) assert.ok(call(s), s);
});

test('a missing parser or unparseable code asks', () => {
  assert.ok(call('async () => {'));
  assert.ok(call('this is not javascript'));
});

test('a nested method key cannot stand in for the top-level one', () => {
  assert.ok(call("await cloudflare.request({ body: { method: 'GET' }, path: '/a' })"), 'only nested GET');
});

test('an unbalanced or unreadable call asks', () => {
  assert.ok(call("await cloudflare.request({ method: 'GET', path: '/a'"));
  assert.ok(call(undefined));
  assert.ok(decide(TOOL, null));
  assert.ok(decide(TOOL, { code: 42 }));
  assert.ok(decide(TOOL, {}));
});

test('a non-Cloudflare execute and other tools pass', () => {
  assert.equal(call("return await other.send({ method: 'POST', url: 'https://example.com' })"), null);
  assert.ok(call("return await fetch('https://example.com', { method: 'POST' })"), 'fetch is on the blocklist, so it asks');
  assert.equal(call('return 1 + 1'), null);
  assert.equal(decide('Bash', { command: "cloudflare.request({method:'POST'})" }), null);
  assert.equal(decide('mcp__abc__search', { code: "cloudflare.request({method:'POST'})" }), null);
  assert.equal(classify('return 1').kind, 'other');
});

test('run prints an ask decision for a write and nothing for a read', () => {
  const out = run({ tool_name: TOOL, tool_input: { code: "cloudflare.request({ method: 'POST', path: '/nope' })" } });
  const j = JSON.parse(out);
  assert.equal(j.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(j.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /POST \/nope/);
  assert.equal(run({ tool_name: TOOL, tool_input: { code: "cloudflare.request({ method: 'GET', path: '/a' })" } }), '');
});

test('the hook as a process: write asks, read is silent, garbage stdin asks', () => {
  const go = stdin => spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8' });
  const w = go(JSON.stringify({ tool_name: TOOL, tool_input: { code: "cloudflare.request({ method: 'PUT', path: '/a' })" } }));
  assert.equal(w.status, 0);
  assert.equal(JSON.parse(w.stdout).hookSpecificOutput.permissionDecision, 'ask');
  const r = go(JSON.stringify({ tool_name: TOOL, tool_input: { code: "cloudflare.request({ method: 'GET', path: '/a' })" } }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const g = go('not json');
  assert.equal(JSON.parse(g.stdout).hookSpecificOutput.permissionDecision, 'ask');
});

test('the skill\'s read-only drift code is classified as a read and has no trailing semicolon', () => {
  const skill = readFileSync(path.join(here, '..', 'skills', 'cloudflare-work', 'SKILL.md'), 'utf8');
  const m = /```text\n(async \(\) => \{[\s\S]*?\n\})\n```/.exec(skill);
  assert.ok(m, 'the skill holds the code in a text fence');
  assert.equal(classify(m[1]).kind, 'read');
  assert.equal(call(m[1]), null);
});

test('.claude/settings.json wires the hook as PreToolUse on every mcp execute tool', () => {
  const settings = JSON.parse(readFileSync(path.join(here, '..', 'settings.json'), 'utf8'));
  const entry = (settings.hooks?.PreToolUse ?? []).find(e =>
    (e.hooks ?? []).some(h => String(h.command).includes('guard-cloudflare.mjs'))
  );
  assert.ok(entry, 'guard-cloudflare.mjs is wired under PreToolUse');
  assert.ok(new RegExp(`^(?:${entry.matcher})$`).test(TOOL), 'the matcher matches an execute tool');
  assert.ok(!new RegExp(`^(?:${entry.matcher})$`).test('mcp__abc__search'));
});
