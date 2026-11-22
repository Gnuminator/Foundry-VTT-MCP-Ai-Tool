// Coverage tests for cloudflare-compare.mjs (route path, origin Access, tunnels, Transform Rules,
// Worker routes, service tokens):  node --test scripts/cloudflare-compare-coverage.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMPARED, compare, tokenWarnings } from './cloudflare-compare.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const full = () => ({
  apps: [
    {
      name: 'app-a',
      hostname: 'a.example.test',
      session_duration: '24h',
      auto_redirect_to_identity: true,
      http_only_cookie_attribute: true,
      policies: [{ name: 'friends', kind: 'allow:email', count: 5 }],
    },
  ],
  tunnel: {
    names: ['main'],
    routes: [
      {
        hostname: 'a.example.test',
        path: '',
        service: 'http://localhost:1',
        access_required: true,
        aud_count: 1,
      },
      {
        hostname: 'a.example.test',
        path: '^/mcp/player$',
        service: 'http://localhost:2',
        access_required: false,
        aud_count: 0,
      },
    ],
  },
  dns: [{ name: 'a.example.test', type: 'CNAME', proxied: true }],
  transform_rules: [
    {
      phase: 'http_response_headers_transform',
      description: 'frame',
      enabled: true,
      action: 'rewrite',
      expression: 'true',
      parameters: '{}',
    },
  ],
  worker_routes: [{ pattern: 'a.example.test/join*', script: 'join-veil' }],
  service_tokens: [{ name: 'tok', expires_at: '2027-10-14' }],
});

test('identical full states have no drift', () => {
  assert.deepEqual(compare(full(), full()), []);
});

test('a route path, origin Access, a second route and a tunnel name are reported', () => {
  const live = full();
  live.tunnel.routes[0].access_required = false;
  live.tunnel.routes[0].aud_count = 0;
  live.tunnel.routes[1].path = '^/other$';
  live.tunnel.names.push('spare');
  const d = compare(live, full());
  assert.ok(
    d.some(x => /tunnel route a\.example\.test: access_required is false, expected true/.test(x))
  );
  assert.ok(d.some(x => /tunnel route a\.example\.test: aud_count is 0, expected 1/.test(x)));
  assert.ok(d.some(x => /tunnel route a\.example\.test\^\/mcp\/player\$: missing in live/.test(x)));
  assert.ok(
    d.some(x => /tunnel route a\.example\.test\^\/other\$: in live but not expected/.test(x))
  );
  assert.ok(d.includes('tunnel spare: in live but not expected'));
});

test('a changed, removed or added Transform Rule and Worker route are reported', () => {
  const live = full();
  live.transform_rules[0].enabled = false;
  live.transform_rules.push({
    phase: 'http_request_transform',
    description: 'new',
    enabled: true,
    action: 'rewrite',
    expression: 'x',
    parameters: '{}',
  });
  live.worker_routes = [{ pattern: 'a.example.test/join*', script: 'other' }];
  const d = compare(live, full());
  assert.ok(
    d.some(x => /transform rule http_response_headers_transform frame: enabled is false/.test(x))
  );
  assert.ok(
    d.some(x => /transform rule http_request_transform new: in live but not expected/.test(x))
  );
  assert.ok(d.some(x => /worker route a\.example\.test\/join\*: script is "other"/.test(x)));
  const gone = full();
  gone.transform_rules = [];
  gone.worker_routes = [];
  const g = compare(gone, full());
  assert.ok(g.some(x => /transform rule .*frame: missing in live/.test(x)));
  assert.ok(g.some(x => /worker route .*: missing in live/.test(x)));
});

test('a service token expiry change is drift; under 60 days is a warning, not drift', () => {
  const live = full();
  live.service_tokens[0].expires_at = '2026-12-01';
  assert.ok(
    compare(live, full()).some(x => /service token tok: expires_at is "2026-12-01"/.test(x))
  );
  const now = new Date('2026-11-22T00:00:00Z');
  assert.deepEqual(tokenWarnings(full(), now), []);
  assert.match(tokenWarnings(live, now)[0], /tok: expires in 9 days \(2026-12-01\)/);
  live.service_tokens[0].expires_at = '2026-11-01';
  assert.match(tokenWarnings(live, now)[0], /expired/);
  live.service_tokens[0].expires_at = '';
  assert.match(tokenWarnings(live, now)[0], /no readable expiry/);
});

// Top-level keys of the object literal whose "{" is at openAt (plain keys and shorthand).
function topLevelKeys(text, openAt) {
  let depth = 0;
  let entry = '';
  const entries = [];
  for (let i = openAt; i < text.length; i++) {
    const c = text[i];
    if ('{(['.includes(c)) {
      depth++;
      if (depth === 1) continue;
    } else if ('})]'.includes(c)) {
      depth--;
      if (depth === 0) break;
    } else if (c === ',' && depth === 1) {
      entries.push(entry);
      entry = '';
      continue;
    }
    entry += c;
  }
  entries.push(entry);
  return entries.map(e => e.trim().match(/^(\w+)\s*(?::|$)/)?.[1]).filter(Boolean);
}

test('every field the skill read code produces is compared, and the reverse', () => {
  const skill = readFileSync(
    path.join(HERE, '..', '.claude', 'skills', 'cloudflare-work', 'SKILL.md'),
    'utf8'
  );
  const markers = [...skill.matchAll(/\/\/ fields:(\w+)\n/g)];
  assert.deepEqual(
    markers.map(m => m[1]).sort(),
    Object.keys(COMPARED).sort(),
    'one marker per compared section'
  );
  for (const m of markers) {
    const rest = skill.slice(m.index + m[0].length);
    const lit = rest.match(/(?:=> \(|push\()\{/);
    assert.ok(lit, `no object literal after the ${m[1]} marker`);
    const read = topLevelKeys(skill, m.index + m[0].length + lit.index + lit[0].length - 1);
    assert.ok(read.length >= 2, `could not read the fields of ${m[1]}`);
    for (const k of read)
      assert.ok(COMPARED[m[1]].includes(k), `${m[1]}: field "${k}" is read but not compared`);
    for (const k of COMPARED[m[1]])
      assert.ok(read.includes(k), `${m[1]}: field "${k}" is compared but not read`);
  }
});
