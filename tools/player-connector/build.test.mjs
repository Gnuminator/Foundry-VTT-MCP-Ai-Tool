// node --test tools/player-connector/build.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { build } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, 'server', 'index.js');
const ID = 'test-client-id-1234.access';
const SECRET = 'test-secret-value-abcdef0123456789';

/** A fake player endpoint. `mode` picks the behaviour; `seen` records what arrived. */
let fake;
let base;
let mode = 'ok';
const seen = [];
const sessions = new Set();
let sessionCount = 0;

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
        else if (rpc.method === 'initialize') {
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
      if (mode === 'status403') {
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
  const { createForwarder, handleMessage } = createRequire(import.meta.url)(SERVER);
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
  const { createForwarder, handleMessage } = createRequire(import.meta.url)(SERVER);
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
  const { replies, stderr } = await run([call(1)], {
    FOUNDRY_PLAYER_ENDPOINT: 'http://127.0.0.1:1/mcp/player',
  });
  assert.match(replies[0].result.content[0].text, /Could not reach the table/);
  assert.ok(!stderr.includes(SECRET));
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
