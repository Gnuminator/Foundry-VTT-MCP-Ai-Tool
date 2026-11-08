// node --test tools/player-connector/build.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { build } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, 'server', 'index.js');

/** Load the server file as a library (it starts itself unless told not to). */
function loadServer() {
  process.env.FOUNDRY_PLAYER_NO_MAIN = '1';
  try {
    return createRequire(import.meta.url)(SERVER);
  } finally {
    delete process.env.FOUNDRY_PLAYER_NO_MAIN;
  }
}
const ID = 'test-client-id-1234.access';
const SECRET = 'test-secret-value-abcdef0123456789';

/** A fake player endpoint. `mode` picks the behaviour; `seen` records what arrived. */
let fake;
let base;
let mode = 'ok';
const seen = [];
const sessions = new Set();
let sessionCount = 0;
let initError = false;

before(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, headers: req.headers, body });
      const rpc = JSON.parse(body || '{}');
      if (mode === 'session') {
        const sid = req.headers['mcp-session-id'];
        if (rpc.method === 'test/reset') sessions.clear();
        else if (rpc.method === 'test/deny') return res.writeHead(403).end();
        else if (rpc.method === 'test/redirect')
          return res.writeHead(302, { location: 'https://example.cloudflareaccess.com/' }).end();
        else if (rpc.method === 'initialize' && initError) {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id,
              error: { code: -32001, message: 'no room' },
            })
          );
        } else if (rpc.method === 'initialize') {
          const fresh = `s${++sessionCount}`;
          sessions.add(fresh);
          res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': fresh });
          return res.end(
            JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { session: fresh } })
          );
        } else if (!sessions.has(sid)) {
          return res.writeHead(404).end();
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(
          JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { sid: sid ?? null } })
        );
      }
      if (mode === 'emptybody') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      } else if (mode === 'status403') {
        res.writeHead(403).end(`denied ${ID} ${SECRET}`);
      } else if (mode === 'status401') {
        res.writeHead(401).end();
      } else if (mode === 'redirect') {
        res.writeHead(302, { location: 'https://example.cloudflareaccess.com/login' }).end();
      } else if (mode === 'status500') {
        res.writeHead(500).end('boom');
      } else if (mode === 'hang') {
        // never answer
      } else if (mode === 'echo-secret') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { leak: SECRET } }));
      } else if (mode === 'sse') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { via: 'sse' } })}\n\n`
        );
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 999,
            result: { method: rpc.method, params: rpc.params ?? null },
          })
        );
      }
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${fake.address().port}/mcp/player`;
});
after(() => fake.closeAllConnections?.() ?? fake.close());

/** Run the server with stdin lines; resolve with parsed stdout lines and the raw stderr. */
function run(lines, env = {}, { wait = 0 } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SERVER], {
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        FOUNDRY_PLAYER_ENDPOINT: base,
        FOUNDRY_PLAYER_CLIENT_ID: ID,
        FOUNDRY_PLAYER_CLIENT_SECRET: SECRET,
        ...env,
      },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('close', () => {
      resolve({
        replies: out
          .split('\n')
          .filter(Boolean)
          .map(l => JSON.parse(l)),
        stdout: out,
        stderr: err,
      });
    });
    setTimeout(() => {
      for (const l of lines) child.stdin.write(JSON.stringify(l) + '\n');
      child.stdin.end();
    }, wait);
  });
}

const call = (id, name = 'get-my-character') => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: { x: 1 } },
});

test('forwards initialize, tools/list and tools/call with the two Access headers', async () => {
  mode = 'ok';
  seen.length = 0;
  const { replies } = await run([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    call(3),
  ]);
  assert.equal(seen.length, 3, 'the notification is not forwarded');
  for (const s of seen) {
    assert.equal(s.method, 'POST');
    assert.equal(s.headers['cf-access-client-id'], ID);
    assert.equal(s.headers['cf-access-client-secret'], SECRET);
    assert.match(s.headers['content-type'], /application\/json/);
  }
  assert.deepEqual(
    seen.map(s => JSON.parse(s.body).method),
    ['initialize', 'tools/list', 'tools/call']
  );
  // The reply carries the caller's id, not whatever id the endpoint used.
  assert.deepEqual(replies.map(r => r.id).sort(), [1, 2, 3]);
  const r3 = replies.find(r => r.id === 3);
  assert.equal(r3.result.params.name, 'get-my-character');
});

test('trims spaces and newlines around the pasted values', async () => {
  mode = 'ok';
  seen.length = 0;
  const { replies } = await run([call(1)], {
    FOUNDRY_PLAYER_CLIENT_ID: `  ${ID}\n`,
    FOUNDRY_PLAYER_CLIENT_SECRET: `${SECRET} \r\n`,
  });
  assert.equal(replies[0].result.method, 'tools/call');
  assert.equal(seen[0].headers['cf-access-client-id'], ID);
  assert.equal(seen[0].headers['cf-access-client-secret'], SECRET);
});

test('a forgotten session (404) starts a new one and retries once', async () => {
  mode = 'session';
  sessions.clear();
  sessionCount = 0;
  seen.length = 0;
  const { createForwarder, handleMessage } = loadServer();
  const fwd = createForwarder(
    {
      FOUNDRY_PLAYER_ENDPOINT: base,
      FOUNDRY_PLAYER_CLIENT_ID: ID,
      FOUNDRY_PLAYER_CLIENT_SECRET: SECRET,
    },
    (...a) => fetch(...a)
  );
  const ask = (id, method, params) => handleMessage({ jsonrpc: '2.0', id, method, params }, fwd);
  assert.equal((await ask(1, 'initialize', {})).result.session, 's1');
  assert.equal((await ask(2, 'tools/list')).result.sid, 's1');
  // A passing refusal (403) must not cost us the live session.
  assert.match((await ask(20, 'test/deny')).error.message, /HTTP 403/);
  assert.equal((await ask(21, 'tools/list')).result.sid, 's1');
  await ask(3, 'test/reset'); // the server forgets every session
  const healed = await ask(4, 'tools/list');
  assert.equal(healed.result.sid, 's2', 'a new session was started and the call retried');
  assert.equal(sessionCount, 2);
  // A second 404 with no session to heal is reported, not looped.
  sessions.clear();
  const fresh = createForwarder(
    {
      FOUNDRY_PLAYER_ENDPOINT: base,
      FOUNDRY_PLAYER_CLIENT_ID: ID,
      FOUNDRY_PLAYER_CLIENT_SECRET: SECRET,
    },
    (...a) => fetch(...a)
  );
  const r = await handleMessage({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, fresh);
  assert.match(r.result.tools[0].description, /HTTP 404/);
});

test('answers ping locally', async () => {
  seen.length = 0;
  const { replies } = await run([{ jsonrpc: '2.0', id: 'p', method: 'ping' }]);
  assert.deepEqual(replies, [{ jsonrpc: '2.0', id: 'p', result: {} }]);
  assert.equal(seen.length, 0);
});

test('reads a text/event-stream answer', async () => {
  mode = 'sse';
  const { replies } = await run([{ jsonrpc: '2.0', id: 7, method: 'tools/list' }]);
  assert.deepEqual(replies[0].result, { via: 'sse' });
});

for (const m of ['status401', 'status403', 'redirect']) {
  test(`${m} gives login text on a tool call and never the secret`, async () => {
    mode = m;
    const { replies, stdout, stderr } = await run([call(1)]);
    assert.equal(replies[0].result.isError, true);
    assert.match(replies[0].result.content[0].text, /refused the login/);
    assert.match(replies[0].result.content[0].text, /Client ID and Client Secret/);
    for (const text of [stdout, stderr]) {
      assert.ok(!text.includes(SECRET) && !text.includes(ID));
    }
  });
}

test('a 403 on initialize and tools/list is answered locally with the reason', async () => {
  mode = 'status403';
  const { replies } = await run([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'resources/list' },
  ]);
  assert.equal(replies[0].result.serverInfo.name, 'foundry-player');
  assert.equal(replies[0].result.protocolVersion, '2025-06-18');
  const tool = replies[1].result.tools[0];
  assert.equal(tool.name, 'connection-status');
  assert.match(tool.description, /HTTP 403/);
  assert.ok(!tool.description.includes('denied'), 'the response body is not echoed');
  assert.equal(replies[2].error.code, -32000);
  assert.match(replies[2].error.message, /HTTP 403/);
});

test('after a failed initialize the table comes back: one new session, list_changed, status call', async () => {
  mode = 'status401';
  const { createForwarder, handleMessage } = loadServer();
  const fwd = createForwarder(
    {
      FOUNDRY_PLAYER_ENDPOINT: base,
      FOUNDRY_PLAYER_CLIENT_ID: ID,
      FOUNDRY_PLAYER_CLIENT_SECRET: SECRET,
    },
    (...a) => fetch(...a)
  );
  let recovered = 0;
  fwd.onRecovered = () => recovered++;
  const ask = (id, method, params) => handleMessage({ jsonrpc: '2.0', id, method, params }, fwd);
  const init = await ask(1, 'initialize', { protocolVersion: '2025-06-18' });
  assert.equal(init.result.capabilities.tools.listChanged, true);
  const down = await ask(2, 'tools/call', { name: 'connection-status' });
  assert.equal(down.result.isError, true);
  assert.match(down.result.content[0].text, /refused the login/);
  assert.equal(recovered, 0);
  mode = 'ok';
  seen.length = 0;
  const [a, b] = await Promise.all([ask(3, 'tools/list'), ask(4, 'resources/list')]);
  assert.equal(a.result.method, 'tools/list');
  assert.equal(b.result.method, 'resources/list');
  assert.equal(recovered, 1);
  assert.equal(seen.filter(s => JSON.parse(s.body).method === 'initialize').length, 1);
  const status = await ask(5, 'tools/call', { name: 'connection-status' });
  assert.match(status.result.content[0].text, /Connected to the table/);
});

test('network down: initialize and tools/list are answered locally, no secret shown', async () => {
  const { replies } = await run(
    [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ],
    { FOUNDRY_PLAYER_ENDPOINT: 'http://127.0.0.1:1/mcp/player' }
  );
  assert.equal(replies[0].result.serverInfo.name, 'foundry-player');
  assert.match(replies[1].result.tools[0].description, /Could not reach the table/);
  assert.ok(!JSON.stringify(replies).includes(SECRET));
});

test('a 500 is mapped to a server-problem text', async () => {
  mode = 'status500';
  const { replies } = await run([call(1)]);
  assert.match(replies[0].result.content[0].text, /HTTP 500/);
});

test('network down gives a plain text', async () => {
  const { replies, stdout, stderr } = await run([call(1)], {
    FOUNDRY_PLAYER_ENDPOINT: 'http://127.0.0.1:1/mcp/player',
  });
  assert.match(replies[0].result.content[0].text, /Could not reach the table/);
  for (const text of [stdout, stderr]) assert.ok(!text.includes(SECRET) && !text.includes(ID));
});

test('a timeout gives a plain text', async () => {
  mode = 'hang';
  const { replies } = await run([call(1)], { FOUNDRY_PLAYER_TIMEOUT_MS: '300' });
  assert.match(replies[0].result.content[0].text, /did not answer in time/);
});

test('a secret that the endpoint echoes back is scrubbed', async () => {
  mode = 'echo-secret';
  const { replies, stdout } = await run([call(1)]);
  assert.ok(!stdout.includes(SECRET));
  assert.equal(replies[0].result.leak, '[hidden]');
});

test('plain http to a non-local address and a missing secret are refused without a request', async () => {
  seen.length = 0;
  let r = await run([call(1)], { FOUNDRY_PLAYER_ENDPOINT: 'http://example.com/mcp/player' });
  assert.match(r.replies[0].result.content[0].text, /must start with https/);
  r = await run([call(2)], { FOUNDRY_PLAYER_CLIENT_SECRET: '' });
  assert.match(r.replies[0].result.content[0].text, /empty/);
  r = await run([call(3)], { FOUNDRY_PLAYER_ENDPOINT: '' });
  assert.match(r.replies[0].result.content[0].text, /No endpoint address/);
  assert.equal(seen.length, 0);
});

test('bad JSON on stdin gives a parse error and the process stays up', async () => {
  const child = spawn(process.execPath, [SERVER], { env: { PATH: process.env.PATH } });
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stdin.write('not json\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
  await new Promise(r => setTimeout(r, 400));
  child.stdin.end();
  await new Promise(r => child.on('close', r));
  const lines = out
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
  assert.equal(lines[0].error.code, -32700);
  assert.deepEqual(lines[1].result, {});
});

test('the .mcpb is a zip with a valid manifest and the server, secrets marked sensitive', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'player-connector-'));
  try {
    const file = build(dir, 'https://player.example.org/mcp/player');
    const buf = readFileSync(file);
    const entries = new Map();
    let at = 0;
    while (buf.readUInt32LE(at) === 0x04034b50) {
      const packed = buf.readUInt32LE(at + 18);
      const nameLen = buf.readUInt16LE(at + 26);
      const extraLen = buf.readUInt16LE(at + 28);
      const name = buf.toString('utf8', at + 30, at + 30 + nameLen);
      const start = at + 30 + nameLen + extraLen;
      entries.set(name, inflateRawSync(buf.subarray(start, start + packed)).toString('utf8'));
      at = start + packed;
    }
    assert.deepEqual([...entries.keys()].sort(), ['manifest.json', 'server/index.js']);
    const m = JSON.parse(entries.get('manifest.json'));
    assert.equal(m.manifest_version, '0.3');
    assert.equal(m.server.type, 'node');
    assert.equal(m.server.entry_point, 'server/index.js');
    assert.equal(m.user_config.client_id.sensitive, true);
    assert.equal(m.user_config.client_secret.sensitive, true);
    assert.equal(m.user_config.endpoint_url.default, 'https://player.example.org/mcp/player');
    for (const key of Object.keys(m.server.mcp_config.env)) {
      assert.match(m.server.mcp_config.env[key], /^\$\{user_config\.\w+\}$/);
    }
    assert.equal(entries.get('server/index.js'), readFileSync(SERVER, 'utf8'));
    assert.throws(() => build(dir, 'http://plain.example.org/'), /https/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the committed manifest has no endpoint default and no secret', () => {
  const m = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8'));
  assert.equal(m.user_config.endpoint_url.default, undefined);
  assert.ok(!JSON.stringify(m).match(/cf-access|secret_/i));
});

test('a 200 with neither result nor error is a bad-body failure', async () => {
  mode = 'emptybody';
  const { replies } = await run([call(1)]);
  assert.match(replies[0].result.content[0].text, /something Claude cannot read/);
});

test('a pasted value with characters outside printable ASCII gives a paste-again text', async () => {
  seen.length = 0;
  const { replies, stdout, stderr } = await run([call(1)], {
    FOUNDRY_PLAYER_CLIENT_SECRET: 'sec–ret-with-dash',
  });
  assert.match(replies[0].result.content[0].text, /paste them again/);
  assert.equal(seen.length, 0);
  for (const text of [stdout, stderr]) assert.ok(!text.includes('sec–ret-with-dash'));
});

function sessionForwarder() {
  const { createForwarder, handleMessage } = loadServer();
  const fwd = createForwarder(
    {
      FOUNDRY_PLAYER_ENDPOINT: base,
      FOUNDRY_PLAYER_CLIENT_ID: ID,
      FOUNDRY_PLAYER_CLIENT_SECRET: SECRET,
    },
    (...a) => fetch(...a)
  );
  return (id, method, params) => handleMessage({ jsonrpc: '2.0', id, method, params }, fwd);
}

test('concurrent calls on a stale session share one new session', async () => {
  mode = 'session';
  initError = false;
  sessions.clear();
  sessionCount = 0;
  const ask = sessionForwarder();
  await ask(1, 'initialize', {});
  sessions.clear();
  const all = await Promise.all([ask(2, 'tools/list'), ask(3, 'tools/list'), ask(4, 'tools/list')]);
  assert.equal(sessionCount, 2, 'one reinit, not three');
  for (const r of all) assert.equal(r.result.sid, 's2');
});

test('a reinit that answers with a JSON-RPC error returns that error', async () => {
  mode = 'session';
  initError = false;
  sessions.clear();
  sessionCount = 0;
  const ask = sessionForwarder();
  await ask(1, 'initialize', {});
  sessions.clear();
  initError = true;
  try {
    const r = await ask(2, 'tools/list');
    assert.equal(r.error.code, -32001);
    assert.equal(r.error.message, 'no room');
    assert.equal(r.id, 2);
  } finally {
    initError = false;
  }
});

test('a 3xx keeps the session', async () => {
  mode = 'session';
  sessions.clear();
  sessionCount = 0;
  const ask = sessionForwarder();
  await ask(1, 'initialize', {});
  assert.match((await ask(2, 'test/redirect')).error.message, /refused the login/);
  assert.equal((await ask(3, 'tools/list')).result.sid, 's1');
  assert.equal(sessionCount, 1);
});

test('initialize answers with a supported protocol version, not whatever was asked', async () => {
  mode = 'status403';
  const { replies } = await run([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
    { jsonrpc: '2.0', id: 3, method: 'initialize', params: {} },
  ]);
  assert.equal(replies[0].result.protocolVersion, '2024-11-05');
  assert.equal(replies[1].result.protocolVersion, '2025-11-25');
  assert.equal(replies[2].result.protocolVersion, '2025-11-25');
});

test('tools/call after a failed initialize is a tool error with the reason', async () => {
  mode = 'status403';
  const { replies } = await run([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    call(2),
    call(3, 'connection-status'),
  ]);
  for (const r of replies.slice(1)) {
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /HTTP 403/);
  }
  assert.equal(replies[1].id, 2);
  assert.equal(replies[2].id, 3);
});

test('the first initialize is capped at 10 s even with a longer timeout', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { createForwarder } = loadServer();
    const signals = [];
    const fwd = createForwarder(
      {
        FOUNDRY_PLAYER_ENDPOINT: base,
        FOUNDRY_PLAYER_CLIENT_ID: ID,
        FOUNDRY_PLAYER_CLIENT_SECRET: SECRET,
        FOUNDRY_PLAYER_TIMEOUT_MS: '30000',
      },
      (_url, init) => {
        signals.push(init.signal);
        return new Promise((_res, rej) =>
          init.signal.addEventListener('abort', () =>
            rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          )
        );
      }
    );
    const init = fwd.forward({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    mock.timers.tick(9999);
    assert.equal(signals[0].aborted, false);
    mock.timers.tick(1);
    assert.equal(signals[0].aborted, true);
    const out = await init;
    assert.match(out.failure, /did not answer in time/);
  } finally {
    mock.timers.reset();
  }
});

test('a failed reinit keeps the old session id, so the next 404 tries again', async () => {
  mode = 'session';
  initError = false;
  sessions.clear();
  sessionCount = 0;
  const ask = sessionForwarder();
  await ask(1, 'initialize', {});
  sessions.clear();
  initError = true;
  try {
    assert.equal((await ask(2, 'tools/list')).error.message, 'no room');
  } finally {
    initError = false;
  }
  seen.length = 0;
  const again = await ask(3, 'tools/list');
  assert.equal(again.result.sid, 's2', 'the retry started a new session');
  assert.equal(seen[0].headers['mcp-session-id'], 's1', 'the first try still carried the old id');
});

test('a call that starts during a reinit waits for the new session', async () => {
  const { createForwarder } = loadServer();
  const sent = [];
  let releaseInit;
  const reply = (status, body, sid) =>
    Promise.resolve(
      new Response(status === 202 || status === 404 ? null : body, {
        status,
        headers: { 'content-type': 'application/json', ...(sid ? { 'mcp-session-id': sid } : {}) },
      })
    );
  const fwd = createForwarder(
    {
      FOUNDRY_PLAYER_ENDPOINT: base,
      FOUNDRY_PLAYER_CLIENT_ID: ID,
      FOUNDRY_PLAYER_CLIENT_SECRET: SECRET,
    },
    (_url, init) => {
      const rpc = JSON.parse(init.body);
      const sid = init.headers['mcp-session-id'] ?? null;
      sent.push({ method: rpc.method, sid });
      const ok = JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { sid } });
      if (rpc.method === 'initialize') {
        const count = sent.filter(s => s.method === 'initialize').length;
        if (count === 1) return reply(200, ok, 'old');
        return new Promise(r => (releaseInit = () => r(reply(200, ok, 'new'))));
      }
      if (rpc.method === 'notifications/initialized') return reply(202, '');
      return sid === 'new' ? reply(200, ok) : reply(404, '');
    }
  );
  await fwd.forward({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const first = fwd.forward({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  await new Promise(r => setTimeout(r, 50)); // the 404 came back, the reinit is waiting
  assert.ok(releaseInit, 'reinit is in flight');
  const second = fwd.forward({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  await new Promise(r => setTimeout(r, 50));
  assert.equal(
    sent.filter(s => s.method === 'tools/list').length,
    1,
    'the second call sent nothing while the reinit ran'
  );
  releaseInit();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.message.result.sid, 'new');
  assert.equal(b.message.result.sid, 'new');
});

test('a reinit after a 404 that hangs aborts near the 10 s cap, not at the tool limit', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { createForwarder } = loadServer();
    const signals = [];
    const reply = (status, body, sid) =>
      Promise.resolve(
        new Response(status === 404 ? null : body, {
          status,
          headers: {
            'content-type': 'application/json',
            ...(sid ? { 'mcp-session-id': sid } : {}),
          },
        })
      );
    let inits = 0;
    const fwd = createForwarder(
      {
        FOUNDRY_PLAYER_ENDPOINT: base,
        FOUNDRY_PLAYER_CLIENT_ID: ID,
        FOUNDRY_PLAYER_CLIENT_SECRET: SECRET,
        // the default, 70 s: the reinit must not wait for it
        FOUNDRY_PLAYER_TIMEOUT_MS: '70000',
      },
      (_url, init) => {
        const rpc = JSON.parse(init.body);
        const ok = JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: {} });
        if (rpc.method === 'initialize' && ++inits === 1) return reply(200, ok, 'old');
        if (rpc.method !== 'initialize') return reply(404, '');
        signals.push(init.signal);
        return new Promise((_res, rej) =>
          init.signal.addEventListener('abort', () =>
            rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          )
        );
      }
    );
    await fwd.forward({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const call = fwd.forward({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await new Promise(r => setImmediate(r)); // the 404 came back, the reinit hangs
    await new Promise(r => setImmediate(r));
    assert.equal(signals.length, 1, 'the reinit is in flight');
    mock.timers.tick(9999);
    assert.equal(signals[0].aborted, false);
    mock.timers.tick(1);
    assert.equal(signals[0].aborted, true, 'aborted at INIT_TIMEOUT_MS, long before 70 s');
    const out = await call;
    assert.match(out.failure, /did not answer in time/);
  } finally {
    mock.timers.reset();
  }
});

test('replies already started are flushed when stdin closes', async () => {
  mode = 'ok';
  const { replies } = await run([
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'ping' },
  ]);
  assert.deepEqual(replies.map(r => r.id).sort(), [1, 2, 3]);
});

test('a closed stdout pipe makes the process exit 0 without noise', async () => {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      FOUNDRY_PLAYER_ENDPOINT: base,
      FOUNDRY_PLAYER_CLIENT_ID: ID,
      FOUNDRY_PLAYER_CLIENT_SECRET: SECRET,
    },
  });
  let err = '';
  child.stderr.on('data', d => (err += d));
  child.stdout.destroy();
  // stdin stays open: only the stdout error handler can end the process.
  const code = await new Promise(resolve => {
    const giveUp = setTimeout(() => {
      child.kill();
      resolve('still running after 3 s');
    }, 3000);
    child.on('close', c => {
      clearTimeout(giveUp);
      resolve(c);
    });
    setTimeout(() => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
    }, 100);
  });
  assert.equal(code, 0);
  assert.equal(err, '');
});

test('answers initialize when loaded with require() by a launcher, not run as the entry file', async () => {
  // Claude Desktop may start extension servers through its own launcher: require.main is then not
  // this file. The process must still start and answer (it used to idle until Desktop gave up).
  // A minimal environment: nothing inherited (a FOUNDRY_PLAYER_* or NO_MAIN from the caller's
  // shell could change what the child does).
  const env = { PATH: process.env.PATH, FOUNDRY_PLAYER_ENDPOINT: '' };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const child = spawn(process.execPath, ['-e', 'require(process.argv[1])', SERVER], {
    env,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let out = '';
  child.stdout.on('data', d => {
    out += d;
  });
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  // The child may exit before the write lands; that must not crash the test run.
  child.stdin.on('error', () => undefined);
  child.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    }) + '\n'
  );
  const deadline = Date.now() + 5000;
  while (!out.includes('\n') && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  child.stdin.end();
  child.kill();
  await closed;
  const reply = JSON.parse(out.split('\n')[0] || 'null');
  assert.equal(reply?.id, 0);
  assert.equal(reply?.result?.serverInfo?.name, 'foundry-player');
});

test('the VERSION constant equals the manifest version', () => {
  const m = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8'));
  const v = /const VERSION = '([^']+)'/.exec(readFileSync(SERVER, 'utf8'));
  assert.ok(v, 'VERSION constant found');
  assert.equal(v[1], m.version);
});
