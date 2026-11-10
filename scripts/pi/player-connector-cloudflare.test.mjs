// Tests for scripts/pi/player-connector-cloudflare.mjs, with an in-memory Cloudflare and no network.
//   node --test scripts/pi/player-connector-cloudflare.test.mjs
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { main, promptHidden, REMOTE_FILE } from './player-connector-cloudflare.mjs';

const API_TOKEN = 'cfapitoken-SUPERSECRET-123456';
const HOST = 'player-ai.spennerit.com';
const USERS = {
  Anna: 'AAAAAAAAAAAAAAAA',
  Bo: 'BBBBBBBBBBBBBBBB',
  Cy: 'CCCCCCCCCCCCCCCC',
  Dee: 'DDDDDDDDDDDDDDDD',
};
const CATCH_ALL = { service: 'http_status:404' };
const OTHER = {
  hostname: 'dash.spennerit.com',
  service: 'http://localhost:3000',
  originRequest: { access: { required: true, teamName: 'spennerit', audTag: ['gm-aud'] } },
};

/** A tiny in-memory Cloudflare. `calls` records every request as "METHOD /path". */
function makeCloudflare(seed = {}) {
  const state = {
    tokens: seed.tokens ?? [],
    policies: seed.policies ?? [],
    apps: seed.apps ?? [],
    dns: seed.dns ?? [],
    ingress: seed.ingress ?? [OTHER, CATCH_ALL],
    calls: [],
    secretSeq: 0,
    nextId: 0,
  };
  const id = prefix => `${prefix}${++state.nextId}`;
  const reply = (result, status = 200) => ({
    ok: status < 400,
    status,
    json: async () =>
      status < 400
        ? { success: true, errors: [], result }
        : { success: false, errors: [{ message: result }], result: null },
  });
  const fetch = async (url, init) => {
    const u = new URL(url);
    const p = u.pathname.replace('/client/v4', '');
    const method = init.method;
    const body = init.body ? JSON.parse(init.body) : undefined;
    assert.equal(init.headers.Authorization, `Bearer ${API_TOKEN}`);
    state.calls.push(`${method} ${p}`);
    if (method === 'GET' && p === '/accounts') return reply([{ id: 'acc' }]);
    if (method === 'GET' && p === '/zones') return reply([{ id: 'zone1' }]);
    if (method === 'GET' && p === '/accounts/acc/cfd_tunnel') return reply([{ id: 'tun1' }]);
    if (p === '/accounts/acc/access/service_tokens') {
      if (method === 'GET') return reply(state.tokens);
      const made = {
        id: id('tok'),
        name: body.name,
        client_id: `cid-${body.name}`,
        client_secret: `secret-${++state.secretSeq}-${body.name}`,
      };
      state.tokens.push({ id: made.id, name: made.name, client_id: made.client_id });
      return reply(made);
    }
    const rotate = p.match(/^\/accounts\/acc\/access\/service_tokens\/(.+)\/rotate$/);
    if (rotate && method === 'POST') {
      const t = state.tokens.find(x => x.id === rotate[1]);
      return reply({
        id: t.id,
        client_id: t.client_id,
        client_secret: `rotated-${++state.secretSeq}-${t.name}`,
      });
    }
    if (p === '/accounts/acc/access/policies') {
      if (method === 'GET') return reply(state.policies);
      const made = { id: id('pol'), ...body };
      state.policies.push(made);
      return reply(made);
    }
    const pol = p.match(/^\/accounts\/acc\/access\/policies\/(.+)$/);
    if (pol && method === 'PUT') {
      Object.assign(
        state.policies.find(x => x.id === pol[1]),
        body
      );
      return reply({ id: pol[1], ...body });
    }
    if (p === '/accounts/acc/access/apps') {
      if (method === 'GET') return reply(state.apps);
      const made = {
        id: id('app'),
        aud: 'aud-1234',
        ...body,
        policies: body.policies.map(x => ({ id: x.id, precedence: 1 })),
      };
      state.apps.push(made);
      return reply(made);
    }
    const app = p.match(/^\/accounts\/acc\/access\/apps\/(.+)$/);
    if (app && method === 'PUT') {
      const found = state.apps.find(x => x.id === app[1]);
      Object.assign(found, body, { policies: body.policies.map(x => ({ id: x.id })) });
      return reply(found);
    }
    if (p === '/accounts/acc/cfd_tunnel/tun1/configurations') {
      if (method === 'GET')
        return reply({ config: { ingress: state.ingress, 'warp-routing': { enabled: false } } });
      state.ingress = body.config.ingress;
      assert.deepEqual(body.config['warp-routing'], { enabled: false });
      return reply({});
    }
    if (p === '/zones/zone1/dns_records') {
      if (method === 'GET') return reply(state.dns);
      state.dns.push(body);
      return reply(body);
    }
    return reply(`no route for ${method} ${p}`, 404);
  };
  return { state, fetch };
}

function setup(files = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pcc-test-'));
  const written = { stdout: '', stderr: '' };
  const spawned = { calls: [], stdin: '', exit: 0 };
  const spawn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = content => {
      spawned.stdin = content;
      setImmediate(() => child.emit('close', spawned.exit));
    };
    spawned.calls.push([cmd, ...args]);
    return child;
  };
  const usersText = JSON.stringify(files.users ?? USERS);
  const deps = {
    env: { CLOUDFLARE_API_TOKEN: API_TOKEN },
    readFile: () => usersText,
    stdout: s => (written.stdout += s),
    stderr: s => (written.stderr += s),
    spawn,
    fallbackDir: path.join(dir, 'home'),
    repoRoot: path.join(dir, 'repo'),
  };
  return { dir, written, spawned, deps };
}

const everything = w => w.stdout + w.stderr;
const writes = cf => cf.state.calls.filter(c => !c.startsWith('GET '));

describe('plan', () => {
  test('only reads, and prints no secret', async () => {
    const cf = makeCloudflare();
    const { written, deps } = setup();
    const code = await main(['--users', 'u.json'], { ...deps, fetch: cf.fetch });
    assert.equal(code, 0);
    assert.deepEqual(writes(cf), []);
    assert.match(written.stdout, /would create: service token player-anna/);
    assert.match(written.stdout, /would create: policy Player connector tokens/);
    assert.match(written.stdout, /dash\.spennerit\.com/);
    assert.ok(!everything(written).includes(API_TOKEN));
  });
});

describe('apply on an empty account', () => {
  test('creates everything, inserts the route before the catch-all, delivers four players', async () => {
    const cf = makeCloudflare();
    const { written, spawned, deps } = setup();
    const code = await main(['--apply', '--users', 'u.json', '--send-to', 'foundry-pi'], {
      ...deps,
      fetch: cf.fetch,
    });
    assert.equal(code, 0, written.stderr);
    assert.equal(cf.state.tokens.length, 4);
    assert.equal(cf.state.policies.length, 1);
    assert.equal(cf.state.policies[0].decision, 'non_identity');
    assert.equal(cf.state.policies[0].include.length, 4);
    assert.equal(cf.state.apps.length, 1);
    assert.equal(cf.state.apps[0].domain, HOST);
    assert.equal(cf.state.apps[0].app_launcher_visible, false);
    assert.equal(cf.state.apps[0].policies.length, 1);
    assert.deepEqual(cf.state.ingress, [
      OTHER,
      {
        hostname: HOST,
        path: '^/mcp/player$',
        service: 'http://localhost:3000',
        originRequest: { access: { required: true, teamName: 'spennerit', audTag: ['aud-1234'] } },
      },
      CATCH_ALL,
    ]);
    assert.deepEqual(cf.state.dns, [
      { type: 'CNAME', name: HOST, content: 'tun1.cfargotunnel.com', proxied: true, ttl: 1 },
    ]);
    assert.deepEqual(spawned.calls[0].slice(0, 2), ['ssh', 'foundry-pi']);
    assert.ok(spawned.calls[0][2].includes(REMOTE_FILE));
    assert.ok(!spawned.calls[0].join(' ').includes('secret-'));
    const sent = JSON.parse(spawned.stdin);
    assert.equal(sent.endpoint, `https://${HOST}/mcp/player`);
    assert.equal(sent.audience, 'aud-1234');
    assert.equal(sent.players.length, 4);
    assert.deepEqual(
      sent.players.map(p => p.userId),
      Object.values(USERS)
    );
    assert.ok(
      sent.players.every(p => p.clientId.startsWith('cid-') && p.clientSecret.startsWith('secret-'))
    );
    assert.match(written.stdout, /stage 30/);
    const all = everything(written);
    assert.ok(!all.includes(API_TOKEN));
    assert.ok(!all.includes('secret-'));
  });

  test('ssh failure writes a 0600 fallback file', async () => {
    const cf = makeCloudflare();
    const { written, spawned, deps } = setup();
    spawned.exit = 255;
    const code = await main(['--apply', '--users', 'u.json', '--send-to', 'foundry-pi'], {
      ...deps,
      fetch: cf.fetch,
    });
    assert.equal(code, 0);
    const target = path.join(deps.fallbackDir, 'player-connector.json.new');
    assert.ok(existsSync(target));
    if (process.platform !== 'win32') assert.equal(statSync(target).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(target, 'utf8')).players.length, 4);
    assert.match(written.stdout, /scp/);
    assert.ok(!everything(written).includes('secret-'));
  });

  test('--out writes the file; a path inside the repo is refused before any request', async () => {
    const cf = makeCloudflare();
    const { dir, deps } = setup();
    const outside = path.join(dir, 'out.json');
    assert.equal(
      await main(['--apply', '--users', 'u', '--out', outside], { ...deps, fetch: cf.fetch }),
      0
    );
    assert.equal(JSON.parse(readFileSync(outside, 'utf8')).players.length, 4);

    const cf2 = makeCloudflare();
    const w2 = setup();
    const inside = path.join(w2.deps.repoRoot, 'x', 'p.json');
    const code = await main(['--apply', '--users', 'u', '--out', inside], {
      ...w2.deps,
      fetch: cf2.fetch,
    });
    assert.equal(code, 2);
    assert.deepEqual(cf2.state.calls, []);
  });

  test('--out refuses an existing file and any folder under a .git, before any request', async () => {
    const { dir, deps } = setup();
    const taken = path.join(dir, 'taken.json');
    writeFileSync(taken, 'old');
    const cf = makeCloudflare();
    assert.equal(
      await main(['--apply', '--users', 'u', '--out', taken], { ...deps, fetch: cf.fetch }),
      2
    );
    assert.deepEqual(cf.state.calls, []);
    assert.equal(readFileSync(taken, 'utf8'), 'old');

    const checkout = path.join(dir, 'some-checkout');
    mkdirSync(path.join(checkout, '.git'), { recursive: true });
    mkdirSync(path.join(checkout, 'sub'), { recursive: true });
    const cf2 = makeCloudflare();
    assert.equal(
      await main(['--apply', '--users', 'u', '--out', path.join(checkout, 'sub', 'p.json')], {
        ...deps,
        fetch: cf2.fetch,
      }),
      2
    );
    assert.deepEqual(cf2.state.calls, []);
  });

  test('--host must be a name inside --zone', async () => {
    const cf = makeCloudflare();
    const { written, deps } = setup();
    const code = await main(['--users', 'u', '--host', 'player-ai.example.org'], {
      ...deps,
      fetch: cf.fetch,
    });
    assert.equal(code, 2);
    assert.match(written.stderr, /inside --zone/);
    assert.deepEqual(cf.state.calls, []);
    const ok = await main(
      ['--users', 'u', '--host', 'player.example.org', '--zone', 'example.org'],
      { ...deps, fetch: makeCloudflare().fetch }
    );
    assert.notEqual(ok, 2);
  });

  test('apply without --send-to or --out refuses before any request', async () => {
    const cf = makeCloudflare();
    const { written, deps } = setup();
    const code = await main(['--apply', '--users', 'u'], { ...deps, fetch: cf.fetch });
    assert.equal(code, 2);
    assert.deepEqual(cf.state.calls, []);
    assert.match(written.stderr, /--send-to/);
  });
});

describe('existing tokens', () => {
  const existingTokens = () =>
    Object.keys(USERS).map((n, i) => ({
      id: `t${i}`,
      name: `player-${n.toLowerCase()}`,
      client_id: `cid-${i}`,
    }));

  test('without --rotate apply stops before any write', async () => {
    const cf = makeCloudflare({ tokens: existingTokens().slice(0, 1) });
    const { written, deps } = setup();
    const code = await main(['--apply', '--users', 'u', '--send-to', 'foundry-pi'], {
      ...deps,
      fetch: cf.fetch,
    });
    assert.equal(code, 2);
    assert.deepEqual(writes(cf), []);
    assert.match(written.stderr, /player-anna exists and its secret cannot be read/);
  });

  test('with --rotate a second run changes nothing but the secrets', async () => {
    const cf = makeCloudflare();
    const first = setup();
    await main(['--apply', '--users', 'u', '--send-to', 'foundry-pi'], {
      ...first.deps,
      fetch: cf.fetch,
    });
    cf.state.calls.length = 0;

    const second = setup();
    const code = await main(['--apply', '--rotate', '--users', 'u', '--send-to', 'foundry-pi'], {
      ...second.deps,
      fetch: cf.fetch,
    });
    assert.equal(code, 0, second.written.stderr);
    const w = writes(cf);
    assert.equal(w.length, 4);
    assert.ok(
      w.every(c => /^POST \/accounts\/acc\/access\/service_tokens\/tok\d+\/rotate$/.test(c)),
      w.join('\n')
    );
    const sent = JSON.parse(second.spawned.stdin);
    assert.ok(sent.players.every(p => p.clientSecret.startsWith('rotated-')));
    assert.equal(sent.audience, 'aud-1234');
    const all = everything(second.written);
    assert.ok(!all.includes('rotated-') && !all.includes(API_TOKEN));
  });
});

describe('inputs and errors', () => {
  test('a users file with three players or a bad id is refused', async () => {
    for (const users of [
      { Anna: 'AAAAAAAAAAAAAAAA', Bo: 'BBBBBBBBBBBBBBBB', Cy: 'CCCCCCCCCCCCCCCC' },
      { ...USERS, Dee: 'short' },
      { ...USERS, Dee: 'DDDDDDDDDDDDDDD!' },
    ]) {
      const cf = makeCloudflare();
      const { deps } = setup({ users });
      assert.equal(await main(['--users', 'u'], { ...deps, fetch: cf.fetch }), 2);
      assert.deepEqual(cf.state.calls, []);
    }
  });

  test('an API failure is reported without the token, secrets or request body', async () => {
    const { written, deps } = setup();
    const fetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ success: false, errors: [{ message: 'Authentication error' }] }),
    });
    const code = await main(['--users', 'u'], { ...deps, fetch });
    assert.equal(code, 1);
    assert.match(
      written.stderr,
      /GET \/accounts\?per_page=50 failed: HTTP 403: Authentication error/
    );
    assert.ok(!everything(written).includes(API_TOKEN));
  });

  test('a network error does not leak the token even when the error text carries it', async () => {
    const { written, deps } = setup();
    const fetch = async () => {
      throw Object.assign(new Error(`connect failed ${API_TOKEN}`), { code: 'ECONNRESET' });
    };
    const code = await main(['--users', 'u'], { ...deps, fetch });
    assert.equal(code, 1);
    assert.match(written.stderr, /ECONNRESET/);
    assert.ok(!everything(written).includes(API_TOKEN));
  });

  test('a missing token with no terminal fails clearly', async () => {
    const { written, deps } = setup();
    const code = await main(['--users', 'u'], {
      ...deps,
      env: {},
      prompt: () => promptHidden('x', { stdin: { isTTY: false }, stderr: { write() {} } }),
      fetch: async () => assert.fail('no request expected'),
    });
    assert.equal(code, 2);
    assert.match(written.stderr, /no terminal/);
  });

  test('the hidden prompt reads typed text with backspace and does not echo it', async () => {
    const stdin = new EventEmitter();
    Object.assign(stdin, {
      isTTY: true,
      setRawMode() {},
      resume() {},
      pause() {},
      setEncoding() {},
    });
    let echoed = '';
    const pending = promptHidden('token: ', { stdin, stderr: { write: s => (echoed += s) } });
    stdin.emit('data', 'abcx\u007fd');
    stdin.emit('data', '\r');
    assert.equal(await pending, 'abcd');
    assert.ok(!echoed.includes('abc'));
  });
});

describe('ingress safety', () => {
  test('a plan on a finished setup shows nothing to create or change and makes no writes', async () => {
    const cf = makeCloudflare();
    const first = setup();
    await main(['--apply', '--users', 'u', '--send-to', 'foundry-pi'], {
      ...first.deps,
      fetch: cf.fetch,
    });
    // Forget the secrets as if tokens existed already: plan mode must show nothing to create or change.
    cf.state.calls.length = 0;
    const plan = setup();
    assert.equal(await main(['--users', 'u'], { ...plan.deps, fetch: cf.fetch }), 0);
    assert.deepEqual(writes(cf), []);
    assert.doesNotMatch(plan.written.stdout, /would (create|change): (policy|Access|tunnel|DNS)/);
  });

  test('a last entry with a hostname is refused and nothing is put', async () => {
    const cf = makeCloudflare({ ingress: [CATCH_ALL, OTHER] });
    const { written, deps } = setup();
    const code = await main(['--apply', '--users', 'u', '--send-to', 'foundry-pi'], {
      ...deps,
      fetch: cf.fetch,
    });
    assert.equal(code, 1);
    assert.match(written.stderr, /catch-all/);
    assert.ok(!writes(cf).some(c => c.startsWith('PUT /accounts/acc/cfd_tunnel')));
  });
});
