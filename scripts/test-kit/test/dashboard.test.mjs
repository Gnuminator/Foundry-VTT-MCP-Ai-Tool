import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDashboardClient, isReadTool } from '../lib/dashboard.mjs';
import { EnvError, KitToolError } from '../lib/errors.mjs';

/** @type {http.Server} */
let server;
let base = '';
/** @type {Array<{method: string, url: string, headers: any, body: any}>} */
let seen = [];
let gmActions = false;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      seen.push({ method: req.method || '', url: req.url || '', headers: req.headers, body });
      const send = (status, obj) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/api/health') return send(200, { ok: true, controlChannel: 'connected' });
      if (req.url === '/api/tools')
        return send(200, { tools: [{ name: 'get-world-info' }], gmActionsEnabled: gmActions });
      if (req.url === '/api/control') {
        gmActions = body.value;
        return send(200, { ok: true });
      }
      if (req.url === '/player') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<p>hi</p>');
      }
      if (req.url === '/api/tool') {
        switch (body.name) {
          case 'get-world-info':
            return send(200, { ok: true, result: { id: 'w' } });
          case 'bad-kind':
            return send(422, { ok: false, kind: 'validation', error: 'nope\nline' });
          case 'gm-needed':
            return send(403, { ok: false, code: 'gm-required' });
          case 'text-error':
            return send(200, { ok: true, result: 'Parameter error: missing x' });
          case 'plan-thing':
            return send(200, { ok: true, result: { planId: 'p1', risk: body.args.risk } });
          case 'apply-planned-change':
            return send(200, { ok: true, result: { changeId: 'c1' } });
          case 'undo-change':
            return send(200, { ok: true, result: { mode: 'undo' } });
          default:
            return send(200, { ok: true, result: { echoed: body.name } });
        }
      }
      send(404, { ok: false });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(r => server.close(r)));

test('read tool detection', () => {
  for (const n of [
    'get-x',
    'list-x',
    'search-x',
    'measure-x',
    'plan-x',
    'suggest-x',
    'check-secret-terms',
    'open-in-foundry',
    'mark-play-session',
  ])
    assert.ok(isReadTool(n), n);
  for (const n of ['apply-planned-change', 'undo-change', 'update-token', 'delete-map-note'])
    assert.ok(!isReadTool(n), n);
});

test('health, tools and a successful tool call', async () => {
  const c = createDashboardClient({ base, token: '' });
  assert.deepEqual(await c.health(), { ok: true, controlChannel: 'connected' });
  assert.equal((await c.tools()).tools[0].name, 'get-world-info');
  assert.deepEqual(await c.tool('get-world-info'), { id: 'w' });
});

test('confirm flags: none for reads, confirm for writes, both for destructive', async () => {
  seen = [];
  const c = createDashboardClient({ base, token: '' });
  await c.tool('get-world-info');
  await c.tool('update-thing', { a: 1 });
  await c.tool('undo-change', { changeId: 'x' });
  await c.tool('delete-map-note', { id: 'n' });
  const bodies = seen.filter(s => s.url === '/api/tool').map(s => s.body);
  assert.equal(bodies[0].confirm, undefined);
  assert.equal(bodies[1].confirm, true);
  assert.equal(bodies[1].confirmDestructive, undefined);
  assert.equal(bodies[2].confirm, true);
  assert.equal(bodies[2].confirmDestructive, true);
  assert.equal(bodies[3].confirmDestructive, true);
});

test('explicit flags win over the automatic ones', async () => {
  seen = [];
  const c = createDashboardClient({ base, token: '' });
  await c.tool('update-thing', {}, { confirm: false });
  assert.equal(seen.at(-1).body.confirm, false);
});

test('tool errors carry kind, status, error and the tool name', async () => {
  const c = createDashboardClient({ base, token: '' });
  await assert.rejects(c.tool('bad-kind'), e => {
    assert.ok(e instanceof KitToolError);
    assert.equal(e.kind, 'validation');
    assert.equal(e.status, 422);
    assert.equal(e.error, 'nope line');
    assert.equal(e.tool, 'bad-kind');
    assert.match(e.message, /^bad-kind: nope line$/);
    return true;
  });
  await assert.rejects(
    c.tool('text-error'),
    e => e instanceof KitToolError && /Parameter error/.test(e.message)
  );
  await assert.rejects(c.tool('gm-needed'), EnvError);
});

test('the GM token header is sent when set', async () => {
  seen = [];
  const c = createDashboardClient({ base, token: 'tok' });
  await c.health();
  assert.equal(seen[0].headers['x-cogm-token'], 'tok');
  const d = createDashboardClient({ base, token: '' });
  await d.health();
  assert.equal(seen[1].headers['x-cogm-token'], undefined);
});

test('GM actions: get and set', async () => {
  const c = createDashboardClient({ base, token: '' });
  gmActions = false;
  assert.equal(await c.getGmActions(), false);
  await c.setGmActions(true);
  assert.equal(await c.getGmActions(), true);
});

test('planApply and undo', async () => {
  seen = [];
  const c = createDashboardClient({ base, token: '' });
  const r = await c.planApply('plan-thing', { risk: 'destructive' });
  assert.deepEqual([r.planId, r.changeId], ['p1', 'c1']);
  const apply = seen.filter(s => s.url === '/api/tool').at(-1).body;
  assert.equal(apply.confirm, true);
  assert.equal(apply.confirmDestructive, true);
  const r2 = await c.planApply('plan-thing', { risk: 'safe' });
  assert.equal(seen.filter(s => s.url === '/api/tool').at(-1).body.confirmDestructive, undefined);
  assert.equal(r2.changeId, 'c1');
  const u = await c.undo('c1');
  assert.equal(u.mode, 'undo');
  const last = seen.filter(s => s.url === '/api/tool').at(-1).body;
  assert.deepEqual([last.confirm, last.confirmDestructive], [true, true]);
});

test('http can return text', async () => {
  const c = createDashboardClient({ base, token: '' });
  const r = await c.http('/player', { text: true });
  assert.equal(r.data, '<p>hi</p>');
});

test('a refused connection is an EnvError', async () => {
  const srv = http.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise(r => srv.close(r));
  const c = createDashboardClient({ base: `http://127.0.0.1:${port}`, token: '' });
  await assert.rejects(c.health(), EnvError);
  await assert.rejects(c.tool('get-world-info'), EnvError);
});
