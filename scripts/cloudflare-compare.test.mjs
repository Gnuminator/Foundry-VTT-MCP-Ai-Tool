// Tests for cloudflare-compare.mjs:  node --test scripts/cloudflare-compare.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compare } from './cloudflare-compare.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cloudflare-compare.mjs');

const base = () => ({
  apps: [
    {
      name: 'app-a',
      hostname: 'a.example.test',
      session_duration: '24h',
      auto_redirect_to_identity: true,
      http_only_cookie_attribute: true,
      policies: [{ name: 'friends', kind: 'allow-emails', count: 5 }],
    },
  ],
  tunnel: { routes: [{ hostname: 'a.example.test', service: 'http://localhost:1' }] },
  dns: [{ name: 'a.example.test', type: 'CNAME', proxied: true }],
});

test('identical states have no drift', () => {
  assert.deepEqual(compare(base(), base()), []);
});

test('an app field, a policy count and a policy kind are reported', () => {
  const live = base();
  live.apps[0].session_duration = '720h';
  live.apps[0].http_only_cookie_attribute = false;
  live.apps[0].policies[0].count = 6;
  live.apps[0].policies[0].kind = 'bypass';
  const d = compare(live, base());
  assert.equal(d.length, 4);
  assert.ok(d.some(x => /session_duration is "720h"/.test(x)));
  assert.ok(d.some(x => /count is 6, expected 5/.test(x)));
});

test('a dropped or an added policy, app, route and DNS record are reported', () => {
  const live = base();
  live.apps[0].policies = [{ name: 'extra', kind: 'bypass', count: 0 }];
  live.apps.push({ name: 'app-b', hostname: 'b.example.test', policies: [] });
  live.tunnel.routes = [];
  live.dns = [
    { name: 'a.example.test', type: 'CNAME', proxied: false },
    { name: 'c.example.test', type: 'CNAME', proxied: true },
  ];
  const d = compare(live, base());
  assert.ok(d.includes('app app-a: policy friends missing in live'));
  assert.ok(d.includes('app app-a: policy extra is in live but not expected'));
  assert.ok(d.includes('app app-b: in live but not expected'));
  assert.ok(d.includes('tunnel route a.example.test: missing in live'));
  assert.ok(d.some(x => /dns a\.example\.test CNAME: proxied is false/.test(x)));
  assert.ok(d.includes('dns c.example.test CNAME: in live but not expected'));
});

test('several DNS records with one name (different types) are not a duplicate', () => {
  const both = base();
  both.dns.push({ name: 'a.example.test', type: 'TXT', proxied: false });
  assert.deepEqual(compare(both, both), []);
  assert.ok(compare(base(), both).some(x => /dns a\.example\.test TXT: missing in live/.test(x)));
});

test('an expected file with no apps is an error', () => {
  const empty = { apps: [], tunnel: { routes: [] }, dns: [] };
  assert.ok(compare(empty, empty).length > 0);
});

test('bad input is a difference, not a pass', () => {
  assert.ok(compare(null, base()).length > 0);
  assert.ok(compare(base(), []).length > 0);
  assert.ok(
    compare({}, base()).length > 0,
    'an empty live read cannot match a populated expectation'
  );
});

test('the command exits 0 on no drift, 1 on drift, 2 on usage or unreadable input', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cfcmp-'));
  const w = (name, obj) => {
    const f = path.join(dir, name);
    writeFileSync(f, JSON.stringify(obj));
    return f;
  };
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const a = w('a.json', base());
  const drift = base();
  drift.dns[0].proxied = false;
  const b = w('b.json', drift);
  assert.equal(run(a, a).status, 0);
  const r = run(b, a);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /DRIFT dns a\.example\.test CNAME/);
  assert.equal(run(a).status, 2);
  assert.equal(run(a, path.join(dir, 'missing.json')).status, 2);
});
