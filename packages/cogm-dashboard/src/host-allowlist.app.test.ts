/**
 * The DNS rebinding guard in the real app (host-allowlist.ts): mounted before
 * everything, in both modes, on every method and path. Requests go through
 * `http.request` with an explicit Host, or a raw socket for what `http` will
 * not send (no Host, two Hosts, an absolute-form target).
 */
import * as http from 'http';
import * as net from 'net';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { HOST_NOT_ALLOWED, HOST_NOT_ALLOWED_MESSAGE, parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';
import { OPEN_PAGE_CSP } from './open-route.js';

const GM_TOKEN = 'gm-token-for-the-host-guard';
const ACTOR = 'Actor.aaaaaaaaaaaaaaaa';

const SPLIT_OFF: AuthConfig = {
  ...config.auth,
  splitEnabled: false,
  gmToken: '',
  playerToken: '',
  gmEmails: [],
};
const SPLIT_ON: AuthConfig = { ...SPLIT_OFF, splitEnabled: true, gmToken: GM_TOKEN };
const MODES: Array<[string, AuthConfig]> = [
  ['split off (legacy: every caller is the GM)', SPLIT_OFF],
  ['split on', SPLIT_ON],
];

/** A bridge that records the tools called. */
class FakeBridge {
  readonly calls: string[] = [];
  readonly isConnected = true;
  listTools = (): Promise<unknown[]> => Promise.resolve([]);
  callTool = <T>(name: string): Promise<T> => {
    this.calls.push(name);
    const result =
      name === 'open-in-foundry'
        ? { opened: true, documentName: 'Actor', name: 'Wolf', userId: 'GmAaaaaaaaaaaaaa' }
        : { id: 'world', title: 'World' };
    return Promise.resolve(result as T);
  };
}

/** Keeps every warning (the guard logs through `logger.child('host')`). */
class CapturingLogger extends Logger {
  readonly warnings: Array<{ message: string; meta: unknown }> = [];
  constructor() {
    super('error', 'host-test');
  }
  override child(): Logger {
    return this;
  }
  override warn(message: string, meta?: unknown): void {
    this.warnings.push({ message, meta });
  }
}

const fakeCoGm = {
  enabled: false,
  isBusy: false,
  setWorld: (): void => undefined,
  abortActive: (): void => undefined,
} as unknown as CoGm;

interface Harness {
  port: number;
  bridge: FakeBridge;
  logger: CapturingLogger;
  close(): Promise<void>;
}

const running: Harness[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map(h => h.close()));
});

async function start(auth: AuthConfig, overrides: Partial<Config> = {}): Promise<Harness> {
  const bridge = new FakeBridge();
  const logger = new CapturingLogger();
  const testConfig: Config = {
    ...config,
    host: '127.0.0.1',
    allowedHosts: parseAllowedHosts(''),
    ...overrides,
    auth,
  };
  const dashboard = createDashboard({ config: testConfig, logger, client: bridge, coGm: fakeCoGm });
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const harness: Harness = {
    port: (server.address() as AddressInfo).port,
    bridge,
    logger,
    close: () =>
      new Promise<void>(resolve => {
        dashboard.close();
        server.close(() => resolve());
      }),
  };
  running.push(harness);
  return harness;
}

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  json: Record<string, unknown> | null;
}

/** One request with exactly this Host; `stream` resolves on the headers and drops the body. */
function request(
  h: Harness,
  method: string,
  rawPath: string,
  host: string,
  headers: Record<string, string> = {},
  body?: string,
  stream = false
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: h.port,
        method,
        path: rawPath,
        agent: false,
        headers: {
          ...headers,
          host,
          ...(body !== undefined ? { 'content-length': String(Buffer.byteLength(body)) } : {}),
        },
      },
      res => {
        if (stream) {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json: null });
          res.destroy();
          return;
        }
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () => {
          let json: Record<string, unknown> | null = null;
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Write raw HTTP and read until the server closes: the status and the body. */
function raw(h: Harness, text: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(h.port, '127.0.0.1', () => socket.write(text));
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      data += chunk;
    });
    socket.on('error', reject);
    socket.on('close', () => {
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(data)?.[1] ?? 0);
      resolve({ status, body: data.split('\r\n\r\n').slice(1).join('\r\n\r\n') });
    });
  });
}

function expectRefused(label: string, answer: Answer): void {
  expect([label, answer.status]).toEqual([label, 421]);
  expect(answer.headers['content-type']).toMatch(/^application\/json/);
  expect(answer.headers['cache-control']).toBe('no-store');
  expect(answer.headers['content-security-policy']).toBeUndefined();
  expect(answer.json).toEqual({ code: HOST_NOT_ALLOWED, error: HOST_NOT_ALLOWED_MESSAGE });
}

const GM_JSON = { 'content-type': 'application/json', 'x-cogm-token': GM_TOKEN };
const READ_TOOL = JSON.stringify({ name: 'get-world-info', args: {} });

describe.each(MODES)('the Host guard with the %s', (_label, auth) => {
  it('answers the loopback names on any port', async () => {
    const h = await start(auth);
    for (const host of [
      `127.0.0.1:${h.port}`,
      `localhost:${h.port}`,
      `LOCALHOST:${h.port}`,
      'localhost',
      '127.0.0.1:1',
      `[::1]:${h.port}`,
      `[0:0:0:0:0:0:0:1]:${h.port}`,
      '[::1]',
    ]) {
      const answer = await request(h, 'GET', '/api/health', host);
      expect([host, answer.status]).toEqual([host, 200]);
      expect(answer.json).toMatchObject({ ok: true });
    }
    expect(h.logger.warnings).toEqual([]);
  });

  it('refuses every other Host with 421, and nothing reaches the bridge', async () => {
    const h = await start(auth);
    for (const host of [
      `evil.example:${h.port}`,
      'evil.example',
      `localhost.:${h.port}`,
      `localhost.evil.com:${h.port}`,
      `127.0.0.1.nip.io:${h.port}`,
      `127.0.0.2:${h.port}`,
      `0.0.0.0:${h.port}`,
      `[::]:${h.port}`,
      `[::2]:${h.port}`,
      `[::ffff:127.0.0.1]:${h.port}`,
      `evil@127.0.0.1:${h.port}`,
      `localhost:${h.port}, evil.example`,
      `[fe80::1%25eth0]:${h.port}`,
    ]) {
      expectRefused(host, await request(h, 'GET', '/api/health', host));
      expectRefused(host, await request(h, 'POST', '/api/tool', host, GM_JSON, READ_TOOL));
    }
    expect(h.bridge.calls).toEqual([]);
    // Control: the same GM call with the dashboard's own Host reaches the bridge.
    const own = await request(h, 'POST', '/api/tool', `localhost:${h.port}`, GM_JSON, READ_TOOL);
    expect(own.status).toBe(200);
    expect(h.bridge.calls).toEqual(['get-world-info']);
  });

  it('refuses on every method and path: pages, static files, SSE, the open route', async () => {
    const h = await start(auth);
    const openHeaders = { ...GM_JSON, 'x-cogm-request': 'open' };
    const calls: Array<[string, string, Record<string, string>, string | undefined]> = [
      ['GET', '/', {}, undefined],
      ['GET', '/index.html', {}, undefined],
      ['GET', '/app.js', {}, undefined],
      ['GET', '/player', {}, undefined],
      ['GET', '/player.html', {}, undefined],
      ['GET', `/open?uuid=${ACTOR}`, {}, undefined],
      ['GET', '/open.js', {}, undefined],
      ['GET', '/not-there', {}, undefined],
      ['GET', '/api/state', GM_JSON, undefined],
      ['GET', '/api/stream', GM_JSON, undefined],
      ['GET', '/api/player/state', {}, undefined],
      ['GET', '/api/player/stream', {}, undefined],
      ['GET', '/api/tools', GM_JSON, undefined],
      ['POST', '/api/control', GM_JSON, JSON.stringify({ action: 'set-gm-actions', value: true })],
      ['POST', '/api/post-chat', GM_JSON, JSON.stringify({ text: 'hello' })],
      ['POST', '/api/ask', GM_JSON, JSON.stringify({ question: 'what now?' })],
      ['POST', '/api/open', openHeaders, JSON.stringify({ uuid: ACTOR })],
      ['OPTIONS', '/api/open', { 'access-control-request-method': 'POST' }, undefined],
      ['PUT', '/api/tool', GM_JSON, READ_TOOL],
      ['DELETE', '/api/tool', {}, undefined],
    ];
    for (const host of [`evil.example:${h.port}`, `localhost.evil.com:${h.port}`]) {
      for (const [method, rawPath, headers, body] of calls) {
        const answer = await request(h, method, rawPath, host, headers, body);
        expectRefused(`${method} ${rawPath} ${host}`, answer);
      }
      const head = await request(h, 'HEAD', '/', host);
      expect(head.status).toBe(421);
    }
    expect(h.bridge.calls).toEqual([]);
  });

  it('refuses a missing Host, two Hosts and a target that is not a path', async () => {
    const h = await start(auth);
    const local = `localhost:${h.port}`;
    const http10 = await raw(h, 'GET /api/health HTTP/1.0\r\n\r\n');
    expect(http10.status).toBe(421);
    expect(http10.body).toContain(HOST_NOT_ALLOWED);
    // HTTP/1.1 without a Host: Node answers 400 itself (Node 20+), else the guard refuses.
    const http11 = await raw(h, 'GET /api/health HTTP/1.1\r\nConnection: close\r\n\r\n');
    expect([400, 421]).toContain(http11.status);
    // An empty Host (`http` would replace it with its own, so it goes raw).
    const empty = await raw(h, 'GET /api/health HTTP/1.1\r\nHost: \r\nConnection: close\r\n\r\n');
    expect(empty.status).toBe(421);
    for (const hosts of [
      [local, 'evil.example'],
      ['evil.example', local],
      [local, local],
    ]) {
      const lines = hosts.map(value => `Host: ${value}\r\n`).join('');
      const answer = await raw(h, `GET /api/health HTTP/1.1\r\n${lines}Connection: close\r\n\r\n`);
      expect([hosts, answer.status]).toEqual([hosts, 421]);
    }
    for (const [method, target] of [
      ['GET', 'http://evil.example/api/health'],
      ['GET', `http://${local}/api/health`],
      ['OPTIONS', '*'],
    ]) {
      const answer = await raw(
        h,
        `${method} ${target} HTTP/1.1\r\nHost: ${local}\r\nConnection: close\r\n\r\n`
      );
      expect([target, answer.status]).toEqual([target, 421]);
    }
    const ok = await raw(
      h,
      `GET /api/health HTTP/1.1\r\nHost: ${local}\r\nConnection: close\r\n\r\n`
    );
    expect(ok.status).toBe(200);
    expect(h.bridge.calls).toEqual([]);
  });

  it('answers the DASHBOARD_ALLOWED_HOSTS names, with and without ports', async () => {
    const h = await start(auth, {
      allowedHosts: parseAllowedHosts('cogm.example.com, pi.local:3000, tunnel.example:443'),
    });
    const expectations: Array<[string, number]> = [
      ['cogm.example.com', 200],
      ['COGM.example.com:8443', 200],
      ['www.cogm.example.com', 421],
      ['cogm.example.com.', 421],
      ['pi.local:3000', 200],
      ['pi.local:3001', 421],
      ['pi.local', 421],
      ['tunnel.example', 200],
      ['tunnel.example:443', 200],
      ['tunnel.example:8443', 421],
      [`localhost:${h.port}`, 200],
      ['evil.example', 421],
    ];
    for (const [host, status] of expectations) {
      const answer = await request(h, 'GET', '/api/health', host);
      expect([host, answer.status]).toEqual([host, status]);
    }
  });

  it('answers a specific DASHBOARD_HOST, never a wildcard one', async () => {
    const health = async (h: Harness, host: string): Promise<number> =>
      (await request(h, 'GET', '/api/health', host)).status;
    const lan = await start(auth, { host: '192.168.1.20' });
    expect(await health(lan, '192.168.1.20:3000')).toBe(200);
    expect(await health(lan, '192.168.1.21:3000')).toBe(421);
    const v6 = await start(auth, { host: 'fd00::5' });
    expect(await health(v6, '[fd00::5]:3000')).toBe(200);
    for (const bind of ['0.0.0.0', '::']) {
      const wildcard = await start(auth, { host: bind });
      for (const host of ['0.0.0.0:3000', '[::]:3000', '192.168.1.20:3000']) {
        expect([bind, host, await health(wildcard, host)]).toEqual([bind, host, 421]);
      }
      expect(await health(wildcard, `localhost:${wildcard.port}`)).toBe(200);
    }
  });

  it('serves the Obsidian /open links on localhost and stops a rebinding page', async () => {
    const h = await start(auth);
    const local = `localhost:${h.port}`;
    const page = await request(h, 'GET', `/open?uuid=${ACTOR}`, local);
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toBe(OPEN_PAGE_CSP);
    const open = (host: string): Promise<Answer> =>
      request(
        h,
        'POST',
        '/api/open',
        host,
        {
          ...GM_JSON,
          'x-cogm-request': 'open',
          origin: `http://${host}`,
          'sec-fetch-site': 'same-origin',
        },
        JSON.stringify({ uuid: ACTOR })
      );
    // The confirm page's own call.
    expect((await open(local)).status).toBe(200);
    // The same call from a rebinding page: same-origin to the browser, but its Host is the
    // attacker's name.
    expectRefused('rebinding', await open(`attacker.example:${h.port}`));
    expect(h.bridge.calls).toEqual(['open-in-foundry']);
  });

  it('still streams to an allowed Host', async () => {
    const h = await start(auth);
    const answer = await request(
      h,
      'GET',
      '/api/stream',
      `127.0.0.1:${h.port}`,
      GM_JSON,
      undefined,
      true
    );
    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toMatch(/^text\/event-stream/);
  });
});

describe('the Host guard log', () => {
  it('warns about ignored DASHBOARD_ALLOWED_HOSTS entries without echoing them', async () => {
    const h = await start(SPLIT_OFF, {
      allowedHosts: parseAllowedHosts('ok.example, https://SECRET-CANARY@x.example/?token=abc'),
    });
    expect(h.logger.warnings).toHaveLength(1);
    const text = JSON.stringify(h.logger.warnings);
    expect(text).toContain('DASHBOARD_ALLOWED_HOSTS');
    for (const secret of ['SECRET', 'CANARY', 'token=abc', 'x.example']) {
      expect(text).not.toContain(secret);
    }
    // The valid entry still counts.
    expect((await request(h, 'GET', '/api/health', 'ok.example')).status).toBe(200);
  });

  it('logs each refused host name once, and stops after 20', async () => {
    const h = await start(SPLIT_OFF);
    for (let i = 0; i < 3; i += 1) await request(h, 'GET', '/', `evil.example:${h.port}`);
    await request(h, 'GET', '/', 'other.example');
    await request(h, 'GET', '/', 'user@evil.example');
    expect(h.logger.warnings.map(w => w.meta)).toEqual([
      { reason: 'not-allowed', host: 'evil.example' },
      { reason: 'not-allowed', host: 'other.example' },
      { reason: 'malformed' },
    ]);
    for (let i = 0; i < 30; i += 1) await request(h, 'GET', '/', `evil-${i}.example`);
    expect(h.logger.warnings).toHaveLength(21);
    expect(h.logger.warnings[20]?.message).toMatch(/not logging them all/);
  });
});
