import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { startServer, DEFAULT_PORT } from '../server.mjs';

const FAKE = {
  version: 1,
  generatedAt: '2026-10-08T10:00:00.000Z',
  lanes: { rows: [], cap: { used: 0, max: 3, steward: null } },
};
let server;
let port;
let lastOpts;
let failNext = false;

// fetch() cannot set the Host header, so use http.request.
function request({ method = 'GET', path = '/', host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { host: host ?? `127.0.0.1:${port}` } },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  server = startServer({
    port: 0,
    buildSnapshot: async opts => {
      lastOpts = opts;
      if (failNext) throw new Error('boom');
      return FAKE;
    },
  });
  await once(server, 'listening');
  port = server.address().port;
});

after(() => new Promise(resolve => server.close(resolve)));

test('default port is 3200', () => {
  assert.equal(DEFAULT_PORT, 3200);
});

test('serves the page files with the right Host', async () => {
  for (const [path, type] of [
    ['/', 'text/html'],
    ['/app.js', 'text/javascript'],
    ['/style.css', 'text/css'],
  ]) {
    const res = await request({ path });
    assert.equal(res.status, 200, path);
    assert.ok(res.headers['content-type'].startsWith(type), path);
    assert.ok(res.body.length > 0, path);
  }
});

test('/snapshot.json returns the fake snapshot, uncached, asking for PRs', async () => {
  const res = await request({ path: '/snapshot.json' });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), FAKE);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(lastOpts, { withPrs: true });
});

test('a failing snapshot gives a short 500', async () => {
  failNext = true;
  try {
    const res = await request({ path: '/snapshot.json' });
    assert.equal(res.status, 500);
    assert.ok(res.body.length < 200);
  } finally {
    failNext = false;
  }
});

test('a wrong Host header gets 421', async () => {
  for (const host of [
    `localhost:${port}`,
    `evil.example:${port}`,
    '127.0.0.1',
    `127.0.0.1:${port + 1}`,
  ]) {
    const res = await request({ host });
    assert.equal(res.status, 421, host);
  }
});

test('only GET and HEAD are allowed', async () => {
  assert.equal((await request({ method: 'POST' })).status, 405);
  assert.equal((await request({ method: 'PUT', path: '/snapshot.json' })).status, 405);
  const head = await request({ method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
});

test('unknown paths and traversal get 404', async () => {
  for (const path of [
    '/../package.json',
    '/..%2fpackage.json',
    '/nope',
    '/server.mjs',
    '/page/app.js',
  ]) {
    assert.equal((await request({ path })).status, 404, path);
  }
});

test('security headers are on every response', async () => {
  for (const [method, path, host] of [
    ['GET', '/'],
    ['GET', '/snapshot.json'],
    ['GET', '/nope'],
    ['POST', '/'],
    ['GET', '/', 'evil.example'],
  ]) {
    const res = await request({ method, path, host: host && `${host}:${port}` });
    assert.equal(res.headers['x-content-type-options'], 'nosniff', `${method} ${path}`);
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.match(res.headers['content-security-policy'], /default-src 'self'/);
    assert.match(res.headers['content-security-policy'], /connect-src 'self'/);
  }
});

test('refuses the live bridge ports and non-loopback hosts', () => {
  for (const p of [31414, 31415, 31416]) {
    assert.throws(
      () => startServer({ port: p, buildSnapshot: async () => ({}) }),
      /live Foundry bridge/
    );
  }
  assert.throws(() => startServer({ port: 0, host: '0.0.0.0', buildSnapshot: async () => ({}) }));
});
