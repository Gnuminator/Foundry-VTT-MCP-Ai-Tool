/** deploy/scheduled-tasks/game-day-brief/SKILL.md stays read-only and off the paid API (D-066). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const text = read('../deploy/scheduled-tasks/game-day-brief/SKILL.md');

const ALLOWED = new Set(['get-preflight', 'get-prep-digest', 'PushNotification', 'foundry-mcp-prep']);

test('front matter names the task', () => {
  assert.match(text, /^---\nname: game-day-brief\ndescription: .+\n---\n/);
});

test('every backticked name is on the allowlist', () => {
  const names = [...text.matchAll(/`([A-Za-z][A-Za-z0-9-]*)`/g)].map((m) => m[1]);
  for (const n of ['get-preflight', 'get-prep-digest', 'PushNotification']) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  for (const n of names) {
    assert.ok(ALLOWED.has(n), `name not allowed: ${n}`);
  }
});

test('both tools are read tools of the prep set', () => {
  for (const [file, tool] of [
    ['preflight.ts', 'get-preflight'],
    ['prep-digest.ts', 'get-prep-digest'],
  ]) {
    const src = read(`../packages/mcp-server/src/tools/modules/${file}`);
    const re = new RegExp(`'${tool}': \\{[^}]*set: 'prep'[^}]*kind: 'read'`);
    assert.match(src, re, tool);
  }
});

test('states the no-paid-API rule', () => {
  assert.match(text, /paid service/);
});

test('has no em dash', () => {
  assert.ok(!text.includes(String.fromCharCode(0x2014)));
});
