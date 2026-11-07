/** scripts/gamenight-watch-pi.mjs: the session gate, the five probes and one round (tick). No outside network. */
import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';

import { DEFAULTS, initialState, safeUrl, scrubUrls, postToChannel } from './gamenight-watch.mjs';
import {
  CHECKS,
  END_AFTER,
  accessHeaders,
  controlCall,
  formatCheckAlert,
  gateStep,
  probeBridgeLink,
  probeDashboard,
  probePublic,
  probeRecorder,
  readSessionOpen,
  tick,
} from './gamenight-watch-pi.mjs';

const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('gateStep: opens at once, ends after two closed readings, an unknown reading changes nothing', () => {
  let g = { active: false, closedRun: 0 };
  assert.equal(gateStep(g, false).event, null);
  const started = gateStep(g, true);
  assert.equal(started.event, 'started');
  g = started.gate;
  assert.equal(gateStep(g, true).event, null);
  assert.equal(gateStep(g, null).gate, g);
  assert.equal(END_AFTER, 2);
  const one = gateStep(g, false);
  assert.equal(one.event, null);
  assert.equal(one.gate.active, true);
  // an open reading in between resets the count
  assert.equal(gateStep(one.gate, true).gate.closedRun, 0);
  const two = gateStep(one.gate, false);
  assert.equal(two.event, 'ended');
  assert.equal(two.gate.active, false);
});

test('controlCall, link_status and the session reading against a real loopback server', async () => {
  const seen = [];
  let module = 'connected';
  let open = true;
  const server = net.createServer(socket => {
    socket.on('data', chunk => {
      const msg = JSON.parse(chunk.toString('utf8'));
      seen.push(msg.method);
      if (msg.method === 'link_status') {
        socket.write(`${JSON.stringify({ id: msg.id, result: { ok: true, module } })}\n`);
      } else if (msg.method === 'call_tool' && msg.params.name === 'get-play-session') {
        const text = JSON.stringify({ success: true, open });
        socket.write(`${JSON.stringify({ id: msg.id, result: { content: [{ type: 'text', text }] } })}\n`);
      } else {
        socket.write(`${JSON.stringify({ id: msg.id, error: 'nope' })}\n`);
      }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    assert.equal((await probeBridgeLink(port)).ok, true);
    module = 'disconnected';
    const down = await probeBridgeLink(port);
    assert.equal(down.ok, false);
    assert.match(down.error, /not connected/);
    assert.equal(await readSessionOpen(port), true);
    open = false;
    assert.equal(await readSessionOpen(port), false);
    await assert.rejects(controlCall(port, '127.0.0.1', 'other'), /refused/);
  } finally {
    server.close();
  }
  // nothing listens any more: the answers are fixed words, never an address
  const gone = await probeBridgeLink(port);
  assert.equal(gone.ok, false);
  assert.doesNotMatch(gone.error, /127\.0\.0\.1|\d{4,}/);
  assert.equal(await readSessionOpen(port), null);
});

test('probeDashboard: healthy, bridge lost, unhealthy, HTTP error, no answer', async () => {
  const ok = await probeDashboard('http://d', 1000, async () =>
    jsonRes(200, { ok: true, controlChannel: 'connected' })
  );
  assert.equal(ok.ok, true);
  const lost = await probeDashboard('http://d', 1000, async () =>
    jsonRes(200, { ok: true, controlChannel: 'disconnected' })
  );
  assert.match(lost.error, /lost the bridge/);
  assert.equal((await probeDashboard('http://d', 1000, async () => jsonRes(200, { ok: false }))).ok, false);
  assert.equal((await probeDashboard('http://d', 1000, async () => jsonRes(503, {}))).error, 'HTTP 503');
  const none = await probeDashboard('http://secret-host:9?token=abc', 1000, async () => {
    throw new Error('connect ECONNREFUSED http://secret-host:9?token=abc');
  });
  assert.equal(none.error, 'no answer');
});

test('probeRecorder: unit inactive, active, status problems, status unreachable', async () => {
  const base = { unit: 'u', timeoutMs: 1000 };
  assert.match((await probeRecorder({ ...base, isActive: async () => false })).error, /not running/);
  assert.equal((await probeRecorder({ ...base, isActive: async () => true })).ok, true);
  const status = body => async () => jsonRes(200, body);
  const withProblems = await probeRecorder({
    ...base,
    isActive: async () => true,
    statusUrl: 'http://127.0.0.1:3110/status',
    fetchImpl: status({ recording: true, problems: [{}, {}] }),
  });
  assert.equal(withProblems.error, 'the recorder reports 2 problems');
  const fine = await probeRecorder({
    ...base,
    isActive: async () => true,
    statusUrl: 'http://127.0.0.1:3110/status',
    fetchImpl: status({ recording: false, problems: [] }),
  });
  assert.equal(fine.ok, true);
  const broken = await probeRecorder({
    ...base,
    isActive: async () => true,
    statusUrl: 'http://127.0.0.1:3110/status',
    fetchImpl: async () => {
      throw new Error('boom');
    },
  });
  assert.match(broken.error, /status no answer/);
});

test('probePublic sends the Access headers and words an Access refusal', async () => {
  let sent;
  const good = await probePublic('https://pub.example', { 'CF-Access-Client-Id': 'i.access', 'CF-Access-Client-Secret': 's' }, 1000, async (url, init) => {
    sent = { url: String(url), headers: init.headers };
    return jsonRes(200, { active: true });
  });
  assert.equal(good.ok, true);
  assert.equal(sent.url, 'https://pub.example/api/status');
  assert.equal(sent.headers['CF-Access-Client-Id'], 'i.access');
  const refused = await probePublic('https://pub.example', {}, 1000, async () => jsonRes(302, {}));
  assert.equal(refused.error, 'Cloudflare Access turned the service token away');
  const down = await probePublic('https://pub.example', {}, 1000, async () => jsonRes(502, {}));
  assert.equal(down.error, 'HTTP 502');
});

test('accessHeaders needs both halves', () => {
  const env = { CF_ACCESS_CLIENT_ID: 'a', CF_ACCESS_CLIENT_SECRET: 'b' };
  assert.deepEqual(accessHeaders(k => env[k]), {
    'CF-Access-Client-Id': 'a',
    'CF-Access-Client-Secret': 'b',
  });
  assert.equal(accessHeaders(k => ({ CF_ACCESS_CLIENT_ID: 'a' })[k]), null);
  assert.equal(accessHeaders(() => undefined), null);
});

test('safeUrl and scrubUrls drop query strings and fragments (the --post address leak)', () => {
  assert.equal(safeUrl('https://x.example/path?token=SECRET#frag'), 'https://x.example/path');
  assert.equal(safeUrl('http://u:p@pi:30000/?a=1'), 'http://pi:30000');
  assert.equal(
    scrubUrls('down at https://x.example/a?token=SECRET and http://pi:3000/?k=v#f.'),
    'down at https://x.example/a and http://pi:3000/'
  );
  assert.equal(scrubUrls('no address here?'), 'no address here?');
});

test('postToChannel scrubs addresses in the posted text', async () => {
  let body;
  await postToChannel({ token: 't', channelId: '1' }, 'see https://x.example/a?token=SECRET', async (_u, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200 };
  });
  assert.equal(body.content, 'see https://x.example/a');
});

test('formatCheckAlert has no address and pings the given users', () => {
  const c = CHECKS.find(x => x.key === 'bridge');
  assert.equal(formatCheckAlert(c, 'down', { ms: 1, error: 'the bridge no answer' }), 'The bridge link to Foundry is not working (the bridge no answer).');
  assert.match(formatCheckAlert(c, 'recovered', { ms: 1 }, DEFAULTS, ['7']), /^<@7> .* is working again\.$/);
  assert.match(formatCheckAlert(CHECKS[0], 'slow', { ms: 5000 }), /5000 ms, the limit is 3000 ms/);
});

function makeRt(over = {}) {
  const calls = { open: [], logs: [] };
  const answers = { open: false, foundry: { ok: true, ms: 10 }, bridge: { ok: true, ms: 5 } };
  const rt = {
    cfg: DEFAULTS,
    mentions: [],
    gate: { active: false, closedRun: 0 },
    states: {},
    pending: [],
    always: false,
    checks: CHECKS,
    readOpen: async () => answers.open,
    probes: { foundry: async () => answers.foundry, bridge: async () => answers.bridge },
    log: m => calls.logs.push(m),
    now: () => 1000,
    ...over,
  };
  return { rt, answers, calls };
}

test('tick: idle without a session, posts on start, on a state change, on recovery and at the end', async () => {
  const { rt, answers } = makeRt();
  await tick(rt);
  assert.equal(rt.pending.length, 0); // no session marked: nothing probed, nothing posted

  answers.open = true;
  await tick(rt);
  assert.equal(rt.pending.length, 1);
  assert.match(rt.pending[0].text, /^Game-night watch started\./);
  assert.match(rt.pending[0].text, /Foundry: ok/);
  assert.match(rt.pending[0].text, /Not checked: The dashboard, The Discord recorder, The public address\./);
  rt.pending.length = 0;

  answers.bridge = { ok: false, ms: 5, error: 'the Foundry module is not connected to the bridge' };
  await tick(rt); // one miss: not yet
  assert.equal(rt.pending.length, 0);
  await tick(rt);
  assert.equal(rt.pending.length, 1);
  assert.match(rt.pending[0].text, /bridge link to Foundry is not working/);
  rt.pending.length = 0;
  await tick(rt); // still down: no repeat
  assert.equal(rt.pending.length, 0);

  answers.bridge = { ok: true, ms: 5 };
  await tick(rt);
  await tick(rt);
  assert.match(rt.pending.at(-1).text, /is working again/);
  rt.pending.length = 0;

  answers.open = false;
  await tick(rt);
  assert.equal(rt.pending.length, 0); // one closed reading is not the end
  await tick(rt);
  assert.match(rt.pending[0].text, /^Game-night watch stopped: the session is marked ended\.$/);
  const n = rt.pending.length;
  await tick(rt);
  assert.equal(rt.pending.length, n); // idle again
});

test('tick: an unknown session reading keeps the watch as it was', async () => {
  const { rt, answers } = makeRt();
  answers.open = true;
  await tick(rt);
  rt.pending.length = 0;
  rt.readOpen = async () => null;
  await tick(rt);
  assert.equal(rt.gate.active, true);
  assert.equal(rt.pending.length, 0);
  const idle = makeRt({ readOpen: async () => null });
  await tick(idle.rt);
  assert.equal(idle.rt.gate.active, false);
});

test('tick: a slow bridge link is never called slow (no speed limit on it)', async () => {
  const { rt, answers } = makeRt({ always: true });
  answers.bridge = { ok: true, ms: 60000 };
  for (let i = 0; i < 6; i++) await tick(rt);
  assert.equal(rt.states.bridge.mode, 'up');
});

test('tick: always mode needs no session, and a start post carries no address', async () => {
  const { rt } = makeRt({ always: true });
  await tick(rt);
  assert.match(rt.pending[0].text, /^Game-night watch started/);
  assert.doesNotMatch(rt.pending[0].text, /https?:\/\//);
  assert.equal(rt.states.foundry.mode, initialState().mode);
});
