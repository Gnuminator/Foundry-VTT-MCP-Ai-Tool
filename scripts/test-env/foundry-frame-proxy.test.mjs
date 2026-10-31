import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import {
  createProxy,
  portProblem,
  rewriteHeaders,
  rewriteRequestHeaders,
} from './foundry-frame-proxy.mjs';

test('rewriteHeaders drops X-Frame-Options and any CSP, then frames the dashboard only', () => {
  const out = rewriteHeaders(
    {
      'X-Frame-Options': 'DENY',
      'content-security-policy': "default-src 'none'",
      'Content-Type': 'text/html',
    },
    'http://localhost:3100'
  );
  assert.deepEqual(out, {
    'Content-Type': 'text/html',
    'content-security-policy': 'frame-ancestors http://localhost:3100',
  });
});

test('rewriteRequestHeaders drops Sec-Fetch-Dest for a frame and leaves other requests alone', () => {
  assert.deepEqual(rewriteRequestHeaders({ 'sec-fetch-dest': 'iframe', accept: 'text/html' }), {
    accept: 'text/html',
  });
  assert.deepEqual(rewriteRequestHeaders({ 'sec-fetch-dest': 'frame' }), {});
  const doc = { 'sec-fetch-dest': 'document' };
  assert.equal(rewriteRequestHeaders(doc), doc);
  const script = { 'sec-fetch-dest': 'script' };
  assert.equal(rewriteRequestHeaders(script), script);
});

test('portProblem refuses live and rehearsal ports and junk', () => {
  assert.equal(portProblem(30091, 'listen port'), null);
  for (const port of [31414, 31415, 31416, 30100, 31614, 31615, 3300]) {
    assert.match(portProblem(port, 'listen port'), /live or rehearsal/);
  }
  assert.match(portProblem(NaN, 'target port'), /not a port/);
});

test('the proxy forwards the page and replaces the frame headers', async () => {
  const foundry = http.createServer((_req, res) => {
    res.writeHead(200, { 'X-Frame-Options': 'DENY', 'Content-Type': 'text/plain' });
    res.end('join');
  });
  await new Promise(resolve => foundry.listen(0, '127.0.0.1', resolve));
  const proxy = createProxy({
    listen: 0,
    target: foundry.address().port,
    dashboard: 'http://localhost:3100',
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${proxy.address().port}/join`);
    assert.equal(await res.text(), 'join');
    assert.equal(res.headers.get('x-frame-options'), null);
    assert.equal(
      res.headers.get('content-security-policy'),
      'frame-ancestors http://localhost:3100'
    );
  } finally {
    proxy.close();
    foundry.close();
  }
});
