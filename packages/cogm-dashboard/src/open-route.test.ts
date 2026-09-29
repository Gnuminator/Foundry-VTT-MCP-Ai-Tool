/**
 * "Open in Foundry" (Obsidian O4, docs/design/OBSIDIAN-O4-DESIGN.md sections 6, 6.4 and 8).
 * `GET /open` is a static shell for every caller and never calls the bridge;
 * `POST /api/open` acts only for the GM, with the token from the `X-CoGM-Token`
 * header, from the dashboard's own origin, with `X-CoGM-Request: open`, and calls
 * `open-in-foundry` exactly once. Runs the real `createDashboard` against a fake
 * bridge that records every call; requests go through `http.request` so every
 * header (Origin, Sec-Fetch-Site, Host, Cookie) is exactly what the test sends.
 */
import { readFileSync, statSync } from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { FOUNDRY_UUID_MAX_LENGTH, FOUNDRY_UUID_SOURCE } from '@gnuminator/shared';
import { afterEach, describe, expect, it } from 'vitest';

import * as openPage from '../public/open.js';
import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard, type Dashboard, type DashboardDeps } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { ChannelError, TimeoutError, ToolError } from './feed/mcp-control-client.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';
import {
  OPEN_PAGE_CSP,
  OPEN_RATE_LIMIT,
  bridgeMessage,
  crossSiteRefusal,
  openPageStaticHeaders,
} from './open-route.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const GM_TOKEN = 'gm-token-for-the-open-route';
const PLAYER_TOKEN = 'player-token-for-the-open-route';
const WORLD_CANARY = 'CANARY-OPEN-ROUTE-WORLD';

const ACTOR = 'Actor.aaaaaaaaaaaaaaaa';
const PAGE = 'JournalEntry.bbbbbbbbbbbbbbbb.JournalEntryPage.cccccccccccccccc';
const GM_A = 'GmAaaaaaaaaaaaaa';
const GM_B = 'GmBbbbbbbbbbbbbb';
const GM_OFFLINE = 'GmOfflineeeeeeee';

const SPLIT_ON: Partial<AuthConfig> = {
  splitEnabled: true,
  gmToken: GM_TOKEN,
  playerToken: PLAYER_TOKEN,
  gmEmails: [],
};
const SPLIT_ON_OPEN_PLAYERS: Partial<AuthConfig> = { ...SPLIT_ON, playerToken: '' };
const SPLIT_OFF: Partial<AuthConfig> = {
  splitEnabled: false,
  gmToken: '',
  playerToken: '',
  gmEmails: [],
};

interface Call {
  name: string;
  args: Record<string, unknown>;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/** A bridge that records every call; handlers are swapped per test. */
class FakeBridge {
  readonly calls: Call[] = [];
  readonly isConnected = true;
  handlers: Record<string, ToolHandler> = {
    'open-in-foundry': args =>
      Promise.resolve({
        opened: true,
        documentName: 'Actor',
        name: 'Wolf',
        userId: typeof args.userId === 'string' ? args.userId : GM_A,
      }),
    'list-ref-choices': () =>
      Promise.resolve({
        kind: 'user',
        truncated: false,
        choices: [
          { id: GM_A, name: 'Anna', detail: 'Gamemaster, online', group: 'Gamemasters' },
          { id: GM_B, name: 'Bo', detail: 'Assistant GM, online', group: 'Gamemasters' },
          { id: GM_OFFLINE, name: 'Cy', detail: 'Gamemaster, offline', group: 'Gamemasters' },
          { id: 'not-a-user-id', name: 'Broken', detail: 'Gamemaster, online' },
        ],
      }),
    'get-world-info': () =>
      Promise.resolve({
        id: WORLD_CANARY,
        title: WORLD_CANARY,
        system: { id: 'dnd5e', version: '6.0.5' },
        foundry: { version: '14.368' },
        activeUsers: [{ name: WORLD_CANARY, isGM: true }],
      }),
  };

  listTools = (): Promise<unknown[]> => Promise.resolve([]);

  callTool = <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    this.calls.push({ name, args });
    const handler = this.handlers[name];
    return (
      handler ? handler(args) : Promise.reject(new Error(`unknown tool ${name}`))
    ) as Promise<T>;
  };

  named(name: string): Call[] {
    return this.calls.filter(c => c.name === name);
  }
}

const fakeCoGm = {
  enabled: false,
  isBusy: false,
  setWorld: (): void => undefined,
  abortActive: (): void => undefined,
} as unknown as CoGm;

interface Harness {
  base: string;
  port: number;
  bridge: FakeBridge;
  dashboard: Dashboard;
  clock: { t: number };
  close(): Promise<void>;
}

const running: Harness[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map(h => h.close()));
});

async function start(
  auth: Partial<AuthConfig>,
  openRoute: NonNullable<DashboardDeps['openRoute']> = {},
  overrides: Partial<Config> = {}
): Promise<Harness> {
  const bridge = new FakeBridge();
  const clock = { t: 1_000_000 };
  const testConfig: Config = { ...config, ...overrides, auth: { ...config.auth, ...auth } };
  const dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'open-route-test'),
    client: bridge,
    coGm: fakeCoGm,
    openRoute: { now: () => clock.t, ...openRoute },
  });
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const harness: Harness = {
    base: `http://127.0.0.1:${port}`,
    port,
    bridge,
    dashboard,
    clock,
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
  text: string;
  json: Record<string, unknown> | null;
}

/** One request with exactly these headers (plus Host, unless given). */
function request(
  h: Harness,
  method: string,
  rawPath: string,
  headers: Record<string, string> = {},
  body?: string
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
          ...(body !== undefined ? { 'content-length': String(Buffer.byteLength(body)) } : {}),
        },
      },
      res => {
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
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

interface PostOptions {
  token?: string;
  headers?: Record<string, string>;
  omit?: string[];
  path?: string;
}

/** POST /api/open like the confirm page does, with overrides; every answer is JSON. */
async function postOpen(h: Harness, body: unknown, opts: PostOptions = {}): Promise<Answer> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-cogm-request': 'open',
  };
  if (opts.token) headers['x-cogm-token'] = opts.token;
  for (const [name, value] of Object.entries(opts.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  for (const name of opts.omit ?? []) delete headers[name];
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const answer = await request(h, 'POST', opts.path ?? '/api/open', headers, payload);
  // Never a redirect, never HTML: JSON with a code on every error.
  expect(answer.status >= 300 && answer.status < 400).toBe(false);
  expect(answer.headers['content-type']).toMatch(/^application\/json/);
  expect(answer.json).not.toBeNull();
  if (answer.status !== 200) expect(typeof answer.json?.code).toBe('string');
  return answer;
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function expectPageHeaders(answer: Answer): void {
  expect(answer.headers['content-security-policy']).toBe(OPEN_PAGE_CSP);
  expect(answer.headers['referrer-policy']).toBe('no-referrer');
  expect(answer.headers['cache-control']).toBe('no-store');
}

describe('GET /open (the static confirm page)', () => {
  it('is served to every caller, holds no world data and never calls the bridge', async () => {
    const h = await start(SPLIT_ON);
    // Seed world data, and check (as a control) that the GM endpoint does show it.
    h.dashboard.handlers.onStatus({
      controlChannel: 'connected',
      foundry: 'reachable',
      lastError: null,
      lastPollAt: null,
    });
    await wait(150);
    const gmState = await request(h, 'GET', '/api/state', { 'x-cogm-token': GM_TOKEN });
    expect(gmState.text).toContain(WORLD_CANARY);

    const before = h.bridge.calls.length;
    for (const token of [undefined, PLAYER_TOKEN, GM_TOKEN]) {
      for (const p of [`/open?uuid=${ACTOR}`, '/open', '/open.html', '/open.js', '/open.css']) {
        const answer = await request(h, 'GET', p, token ? { 'x-cogm-token': token } : {});
        expect(answer.status).toBe(200);
        expect(answer.text).not.toContain(WORLD_CANARY);
        expect(answer.text).not.toContain(GM_TOKEN);
      }
    }
    expect(h.bridge.calls.length).toBe(before);

    const page = await request(h, 'GET', `/open?uuid=${ACTOR}`);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    expect(page.text).toContain('<script src="/open.js" type="module"></script>');
    expect(page.text).not.toContain(ACTOR); // the uuid is read by the script, never echoed
  });

  it('sends the strict headers on /open, /open.html and every alias of the page files', async () => {
    const h = await start(SPLIT_ON);
    for (const p of [
      '/open',
      `/open?uuid=${ACTOR}`,
      '/open/',
      '/OPEN',
      '/open.html',
      `/open.html?uuid=${ACTOR}`,
      '/open%2Ehtml',
      '/x/../open.html',
      '/open.js',
      '/open.css',
    ]) {
      const answer = await request(h, 'GET', p);
      expect([p, answer.status]).toEqual([p, 200]);
      expectPageHeaders(answer);
    }
    // A case-folded name is served only on a case-insensitive file system.
    const folded = await request(h, 'GET', '/OPEN.HTML');
    if (folded.status === 200) expectPageHeaders(folded);
  });

  it('leaves the other pages their own headers', async () => {
    const h = await start(SPLIT_ON);
    const index = await request(h, 'GET', '/');
    expect(index.status).toBe(200);
    expect(index.headers['content-security-policy']).not.toBe(OPEN_PAGE_CSP);
    expect(index.headers['cache-control']).not.toBe('no-store');
    const player = await request(h, 'GET', '/player');
    expect(player.headers['content-security-policy']).toContain("frame-ancestors 'self'");
  });

  it('recognizes the page files by identity, whatever name reached them', () => {
    const set: Record<string, string> = {};
    const res = { setHeader: (name: string, value: string): string => (set[name] = value) };
    const hook = openPageStaticHeaders(PUBLIC_DIR);
    // Another name for the same file (for example a Windows short name).
    hook(res as never, 'C:\\public\\OPEN~1.HTM', statSync(path.join(PUBLIC_DIR, 'open.html')));
    expect(set['Content-Security-Policy']).toBe(OPEN_PAGE_CSP);
    const other: Record<string, string> = {};
    const otherRes = { setHeader: (name: string, value: string): string => (other[name] = value) };
    hook(
      otherRes as never,
      path.join(PUBLIC_DIR, 'index.html'),
      statSync(path.join(PUBLIC_DIR, 'index.html'))
    );
    expect(other).toEqual({});
  });
});

describe('POST /api/open with the player/GM split on', () => {
  it('refuses without a token (401) and with a player token (403), calling nothing', async () => {
    const h = await start(SPLIT_ON);
    const none = await postOpen(h, { uuid: ACTOR });
    expect(none.status).toBe(401);
    expect(none.json).toMatchObject({ code: 'gm-required' });
    const wrong = await postOpen(h, { uuid: ACTOR }, { token: 'not-the-token' });
    expect(wrong.status).toBe(401);
    const player = await postOpen(h, { uuid: ACTOR }, { token: PLAYER_TOKEN });
    expect(player.status).toBe(403);
    expect(player.json).toMatchObject({ code: 'gm-required' });
    expect(h.bridge.calls).toEqual([]);
  });

  it('opens once for the GM, with exactly the uuid (and the chosen GM)', async () => {
    const h = await start(SPLIT_ON);
    const opened = await postOpen(h, { uuid: ACTOR }, { token: GM_TOKEN });
    expect(opened.status).toBe(200);
    expect(opened.json).toEqual({
      opened: true,
      documentName: 'Actor',
      name: 'Wolf',
      userId: GM_A,
    });
    expect(h.bridge.calls).toEqual([{ name: 'open-in-foundry', args: { uuid: ACTOR } }]);

    const chosen = await postOpen(h, { uuid: PAGE, userId: GM_B }, { token: GM_TOKEN });
    expect(chosen.status).toBe(200);
    expect(chosen.json).toMatchObject({ userId: GM_B });
    expect(h.bridge.calls[1]).toEqual({
      name: 'open-in-foundry',
      args: { uuid: PAGE, userId: GM_B },
    });
    expect(h.bridge.calls).toHaveLength(2);
    expect(opened.headers['cache-control']).toBe('no-store');
  });

  it('takes the token from the X-CoGM-Token header only, never the query or a cookie', async () => {
    const h = await start(SPLIT_ON);
    const query = await postOpen(h, { uuid: ACTOR }, { path: `/api/open?token=${GM_TOKEN}` });
    expect(query.status).toBe(401);
    const cookie = await postOpen(
      h,
      { uuid: ACTOR },
      { headers: { cookie: `cogm_token=${GM_TOKEN}` } }
    );
    expect(cookie.status).toBe(401);
    const both = await postOpen(
      h,
      { uuid: ACTOR },
      { path: `/api/open?token=${GM_TOKEN}`, headers: { cookie: `cogm_token=${GM_TOKEN}` } }
    );
    expect(both.status).toBe(401);
    expect(h.bridge.calls).toEqual([]);
    const header = await postOpen(h, { uuid: ACTOR }, { token: GM_TOKEN });
    expect(header.status).toBe(200);
  });

  it('answers 401 for no or a wrong token when the player view needs no token', async () => {
    const h = await start(SPLIT_ON_OPEN_PLAYERS);
    expect((await postOpen(h, { uuid: ACTOR })).status).toBe(401);
    expect((await postOpen(h, { uuid: ACTOR }, { token: 'stale-token' })).status).toBe(401);
    expect((await postOpen(h, { uuid: ACTOR }, { token: GM_TOKEN })).status).toBe(200);
    expect(h.bridge.named('open-in-foundry')).toHaveLength(1);
  });

  it('requires the X-CoGM-Request: open header', async () => {
    const h = await start(SPLIT_ON);
    const missing = await postOpen(
      h,
      { uuid: ACTOR },
      { token: GM_TOKEN, omit: ['x-cogm-request'] }
    );
    expect(missing.status).toBe(403);
    expect(missing.json).toMatchObject({ code: 'cross-site' });
    const wrong = await postOpen(
      h,
      { uuid: ACTOR },
      { token: GM_TOKEN, headers: { 'x-cogm-request': '1' } }
    );
    expect(wrong.status).toBe(403);
    expect(h.bridge.calls).toEqual([]);
  });

  it('refuses cross-site and same-site fetches', async () => {
    const h = await start(SPLIT_ON);
    for (const site of ['cross-site', 'same-site', 'Cross-Site']) {
      const refused = await postOpen(
        h,
        { uuid: ACTOR },
        { token: GM_TOKEN, headers: { 'sec-fetch-site': site } }
      );
      expect([site, refused.status]).toEqual([site, 403]);
      expect(refused.json).toMatchObject({ code: 'cross-site' });
    }
    expect(h.bridge.calls).toEqual([]);
    for (const site of ['same-origin', 'none']) {
      const ok = await postOpen(
        h,
        { uuid: ACTOR },
        { token: GM_TOKEN, headers: { 'sec-fetch-site': site } }
      );
      expect([site, ok.status]).toEqual([site, 200]);
    }
  });

  it('refuses a foreign or null Origin and accepts its own', async () => {
    // The tunnel's public name is in DASHBOARD_ALLOWED_HOSTS (host-allowlist.ts).
    const h = await start(SPLIT_ON, {}, { allowedHosts: parseAllowedHosts('cogm.example') });
    for (const origin of [
      'http://evil.example',
      'null',
      `http://localhost:${h.port}`, // another host name than the Host header
      `http://127.0.0.1:${h.port + 1}`,
      `${h.base}/`,
      '',
    ]) {
      const refused = await postOpen(h, { uuid: ACTOR }, { token: GM_TOKEN, headers: { origin } });
      expect([origin, refused.status]).toEqual([origin, 403]);
      expect(refused.json).toMatchObject({ code: 'cross-site' });
    }
    expect(h.bridge.calls).toEqual([]);
    const own = await postOpen(
      h,
      { uuid: ACTOR },
      { token: GM_TOKEN, headers: { origin: h.base, 'sec-fetch-site': 'same-origin' } }
    );
    expect(own.status).toBe(200);
    // Behind a tunnel the Host header carries the public name.
    const tunnel = await postOpen(
      h,
      { uuid: ACTOR },
      { token: GM_TOKEN, headers: { origin: 'https://cogm.example', host: 'cogm.example' } }
    );
    expect(tunnel.status).toBe(200);
  });

  it('refuses a bad uuid with 400 bad-uuid, calling nothing', async () => {
    const h = await start(SPLIT_ON);
    const long = `Actor.${'a'.repeat(16)}${'.Item.bbbbbbbbbbbbbbbb'.repeat(18)}`;
    expect(long.length).toBeGreaterThanOrEqual(400);
    expect(long.length).toBeGreaterThan(FOUNDRY_UUID_MAX_LENGTH);
    for (const uuid of [
      'Compendium.dnd5e.monsters.aaaaaaaaaaaaaaaa', // a compendium uuid without a type
      'javascript:alert(1)',
      long,
      'Actor.short',
      'actor.aaaaaaaaaaaaaaaa',
      `${ACTOR}\n`,
      '',
      42,
      null,
      undefined,
    ]) {
      const refused = await postOpen(h, { uuid }, { token: GM_TOKEN });
      expect([String(uuid), refused.status]).toEqual([String(uuid), 400]);
      expect(refused.json).toMatchObject({ code: 'bad-uuid' });
    }
    expect(h.bridge.calls).toEqual([]);
  });

  it('refuses a bad userId with 400 bad-request', async () => {
    const h = await start(SPLIT_ON);
    for (const userId of ['short', 'a'.repeat(17), 'GmAaaaaaaaaaaa-a', 7, null, '']) {
      const refused = await postOpen(h, { uuid: ACTOR, userId }, { token: GM_TOKEN });
      expect([String(userId), refused.status]).toEqual([String(userId), 400]);
      expect(refused.json).toMatchObject({ code: 'bad-request' });
    }
    expect(h.bridge.calls).toEqual([]);
  });

  it('accepts only a JSON object body', async () => {
    const h = await start(SPLIT_ON);
    const json = JSON.stringify({ uuid: ACTOR });
    const cases: Array<[string, string, string]> = [
      ['text/plain', json, 'text body'],
      ['application/x-www-form-urlencoded', `uuid=${ACTOR}`, 'form body'],
      ['application/json', '{"uuid": ', 'malformed JSON'],
      ['application/json', JSON.stringify([ACTOR]), 'an array'],
      ['application/json', JSON.stringify(ACTOR), 'a string'],
      ['application/json', JSON.stringify({ uuid: ACTOR, pad: 'x'.repeat(5000) }), 'too large'],
    ];
    for (const [type, body, label] of cases) {
      const refused = await postOpen(h, body, {
        token: GM_TOKEN,
        headers: { 'content-type': type },
      });
      expect([label, refused.status]).toEqual([label, 400]);
      expect(refused.json).toMatchObject({ code: 'bad-request' });
    }
    const noType = await postOpen(h, json, { token: GM_TOKEN, omit: ['content-type'] });
    expect(noType.status).toBe(400);
    expect(h.bridge.calls).toEqual([]);
  });

  it('answers 409 choose-gm with the online GMs when several are logged in', async () => {
    const h = await start(SPLIT_ON);
    h.bridge.handlers['open-in-foundry'] = (): Promise<never> =>
      Promise.reject(
        new ToolError(
          `Error: Query foundry-mcp-bridge.openDocumentForGm failed: Failed to open document: Several GMs are logged in (Anna [${GM_A}], Bo [${GM_B}]); pass userId`,
          'open-in-foundry'
        )
      );
    const answer = await postOpen(h, { uuid: ACTOR }, { token: GM_TOKEN });
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: 'choose-gm',
      gms: [
        { id: GM_A, name: 'Anna' },
        { id: GM_B, name: 'Bo' },
      ],
    });
    expect(h.bridge.named('open-in-foundry')).toHaveLength(1);
    expect(h.bridge.named('list-ref-choices')).toEqual([
      { name: 'list-ref-choices', args: { kind: 'user', filter: { role: 'gm' } } },
    ]);
  });

  it('answers 409 without the list when the GMs cannot be listed', async () => {
    const h = await start(SPLIT_ON);
    h.bridge.handlers['open-in-foundry'] = (): Promise<never> =>
      Promise.reject(new ToolError('Error: Several GMs are logged in (A, B); pass userId', 'x'));
    h.bridge.handlers['list-ref-choices'] = (): Promise<never> =>
      Promise.reject(new ChannelError('down'));
    const answer = await postOpen(h, { uuid: ACTOR }, { token: GM_TOKEN });
    expect(answer.status).toBe(409);
    expect(answer.json?.code).toBe('choose-gm');
    expect(answer.json).not.toHaveProperty('gms');
  });

  it('allows 10 opens per 10 s, counted after auth', async () => {
    const h = await start(SPLIT_ON);
    // Unauthenticated noise does not use up the GM's budget.
    for (let i = 0; i < 20; i++) {
      expect((await postOpen(h, { uuid: ACTOR })).status).toBe(401);
    }
    for (let i = 0; i < OPEN_RATE_LIMIT.max; i++) {
      h.clock.t += 100;
      expect((await postOpen(h, { uuid: ACTOR }, { token: GM_TOKEN })).status).toBe(200);
    }
    const limited = await postOpen(h, { uuid: ACTOR }, { token: GM_TOKEN });
    expect(limited.status).toBe(429);
    expect(limited.json).toMatchObject({ code: 'rate-limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(h.bridge.named('open-in-foundry')).toHaveLength(OPEN_RATE_LIMIT.max);

    // The first open was at +100 ms: the window frees it at +10,100 ms.
    h.clock.t = 1_000_000 + 100 + OPEN_RATE_LIMIT.windowMs - 1;
    expect((await postOpen(h, { uuid: ACTOR }, { token: GM_TOKEN })).status).toBe(429);
    h.clock.t = 1_000_000 + 100 + OPEN_RATE_LIMIT.windowMs;
    expect((await postOpen(h, { uuid: ACTOR }, { token: GM_TOKEN })).status).toBe(200);
    expect(h.bridge.named('open-in-foundry')).toHaveLength(OPEN_RATE_LIMIT.max + 1);
  });

  it('answers a bridge failure with 502 bridge and no internals', async () => {
    const h = await start(SPLIT_ON);
    const failures: Array<[Error, string | null]> = [
      [
        new ToolError(
          'Error: ENOENT: no such file C:\\Users\\chris\\secret\\vault.json\n    at Object.<anonymous> (/srv/app/dist/x.js:1:1)',
          'open-in-foundry'
        ),
        null,
      ],
      [new Error('boom\n    at run (/srv/app/dist/backend.js:10:5)'), 'boom'],
      [new ChannelError('Control channel not connected'), 'not connected'],
      [new TimeoutError('Request "call_tool" timed out after 15000ms'), 'did not answer'],
      [
        new ToolError(
          'Error: Query foundry-mcp-bridge.openDocumentForGm failed: Failed to open document: No document found for uuid Actor.aaaaaaaaaaaaaaaa',
          'open-in-foundry'
        ),
        'No document found',
      ],
    ];
    for (const [error, expected] of failures) {
      h.bridge.handlers['open-in-foundry'] = (): Promise<never> => Promise.reject(error);
      const answer = await postOpen(h, { uuid: ACTOR }, { token: GM_TOKEN });
      expect(answer.status).toBe(502);
      expect(answer.json?.code).toBe('bridge');
      const text = String(answer.json?.error);
      for (const internal of ['C:\\', '/srv/', ' at ', 'ENOENT', 'Query foundry-mcp-bridge']) {
        expect(text).not.toContain(internal);
      }
      if (expected) expect(text).toContain(expected);
    }
  });
});

describe('POST /api/open with the split off (legacy)', () => {
  it('acts for any caller, but the cross-site and header guards still refuse', async () => {
    const h = await start(SPLIT_OFF);
    expect((await postOpen(h, { uuid: ACTOR })).status).toBe(200);
    expect((await postOpen(h, { uuid: ACTOR }, { headers: { origin: h.base } })).status).toBe(200);
    const cross = await postOpen(
      h,
      { uuid: ACTOR },
      { headers: { 'sec-fetch-site': 'cross-site' } }
    );
    expect(cross.status).toBe(403);
    const foreign = await postOpen(
      h,
      { uuid: ACTOR },
      { headers: { origin: 'http://evil.example' } }
    );
    expect(foreign.status).toBe(403);
    const noHeader = await postOpen(h, { uuid: ACTOR }, { omit: ['x-cogm-request'] });
    expect(noHeader.status).toBe(403);
    expect(h.bridge.named('open-in-foundry')).toHaveLength(2);
  });
});

describe('compatibility with the P1 plugin (section 6.4)', () => {
  const OBSIDIAN = 'app://obsidian.md';
  const preflight = {
    origin: OBSIDIAN,
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type,x-cogm-request,x-cogm-token',
  };

  it('an OPTIONS preflight is not refused and gets no CORS grant', async () => {
    for (const allowedOrigins of [[], [OBSIDIAN]]) {
      const h = await start(SPLIT_ON, { allowedOrigins });
      const answer = await request(h, 'OPTIONS', '/api/open', preflight);
      expect(answer.status).not.toBe(401);
      expect(answer.status).not.toBe(403);
      expect(answer.headers['access-control-allow-origin']).toBeUndefined();
      expect(h.bridge.calls).toEqual([]);
    }
  });

  it('a POST from app://obsidian.md is cross-site with the default allowlist', async () => {
    const h = await start(SPLIT_ON);
    const answer = await postOpen(
      h,
      { uuid: ACTOR },
      { token: GM_TOKEN, headers: { origin: OBSIDIAN, 'sec-fetch-site': 'cross-site' } }
    );
    expect(answer.status).toBe(403);
    expect(answer.json).toMatchObject({ code: 'cross-site' });
    expect(answer.headers['access-control-allow-origin']).toBeUndefined();
    expect(h.bridge.calls).toEqual([]);
  });

  it('an allowlisted origin passes the cross-site check and only that check', async () => {
    const h = await start(SPLIT_ON, { allowedOrigins: [OBSIDIAN] });
    const headers = { origin: OBSIDIAN, 'sec-fetch-site': 'cross-site' };
    const ok = await postOpen(h, { uuid: ACTOR }, { token: GM_TOKEN, headers });
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBeUndefined();
    const noHeader = await postOpen(
      h,
      { uuid: ACTOR },
      { token: GM_TOKEN, headers, omit: ['x-cogm-request'] }
    );
    expect(noHeader.status).toBe(403);
    expect((await postOpen(h, { uuid: ACTOR }, { headers })).status).toBe(401);
    expect((await postOpen(h, { uuid: 'nope' }, { token: GM_TOKEN, headers })).status).toBe(400);
    // Another app origin is still refused.
    const other = await postOpen(
      h,
      { uuid: ACTOR },
      { token: GM_TOKEN, headers: { origin: 'app://other.md' } }
    );
    expect(other.status).toBe(403);
    expect(h.bridge.named('open-in-foundry')).toHaveLength(1);
  });
});

describe('crossSiteRefusal', () => {
  const host = '127.0.0.1:3100';
  const check = (headers: Record<string, string>, allowed: string[] = []): string | null =>
    crossSiteRefusal({ host, ...headers }, allowed);

  it('passes a request without Origin or Sec-Fetch-Site (curl) and its own origin', () => {
    expect(check({})).toBeNull();
    expect(check({ origin: 'http://127.0.0.1:3100' })).toBeNull();
    expect(check({ origin: 'https://cogm.example', host: 'cogm.example' })).toBeNull();
    expect(check({ origin: 'https://cogm.example', host: 'cogm.example:443' })).toBeNull();
    expect(check({ origin: 'http://127.0.0.1:3100', 'sec-fetch-site': 'same-origin' })).toBeNull();
  });

  it('refuses other origins, odd spellings and a missing Host', () => {
    for (const origin of [
      'null',
      'http://127.0.0.1:3101',
      'http://localhost:3100',
      'HTTP://127.0.0.1:3100',
      'http://127.0.0.1:3100/',
      'http://user@127.0.0.1:3100',
      'app://obsidian.md',
      'not a url',
    ]) {
      expect([origin, check({ origin })]).not.toEqual([origin, null]);
    }
    expect(crossSiteRefusal({ origin: 'http://127.0.0.1:3100' }, [])).not.toBeNull();
    expect(
      crossSiteRefusal({ origin: 'http://127.0.0.1:3100', host: 'evil@127.0.0.1:3100' }, [])
    ).not.toBeNull();
  });

  it('refuses every Sec-Fetch-Site but same-origin and none, unless the origin is allowlisted', () => {
    expect(check({ 'sec-fetch-site': 'cross-site' })).not.toBeNull();
    expect(check({ 'sec-fetch-site': 'same-site' })).not.toBeNull();
    expect(check({ 'sec-fetch-site': 'same-origin, cross-site' })).not.toBeNull();
    expect(check({ 'sec-fetch-site': 'none' })).toBeNull();
    expect(
      check({ origin: 'app://obsidian.md', 'sec-fetch-site': 'cross-site' }, ['app://obsidian.md'])
    ).toBeNull();
  });
});

describe('bridgeMessage', () => {
  it('keeps a short tool message and drops paths and stacks', () => {
    expect(bridgeMessage(new Error('Error: Failed to open document: X is not logged in'))).toBe(
      'Foundry could not open it: X is not logged in'
    );
    expect(bridgeMessage(new Error('see file:///C:/x'))).toBe('Foundry could not open it.');
    expect(bridgeMessage(new Error('read /home/pi/.config/x failed'))).toBe(
      'Foundry could not open it.'
    );
    expect(bridgeMessage(new Error('x'.repeat(300)))).toBe('Foundry could not open it.');
    expect(bridgeMessage('not an error')).toBe('Foundry could not open it: not an error');
  });
});

describe('the confirm page script (public/open.js)', () => {
  const source = readFileSync(path.join(PUBLIC_DIR, 'open.js'), 'utf8');

  it('never writes HTML and never stores or reads a token from the URL', () => {
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
      expect(source).not.toContain(sink);
    }
    expect(source).not.toContain('setItem');
    expect(source).not.toMatch(/get\(\s*['"]token['"]\s*\)/);
    expect(source).toContain('localStorage.getItem(TOKEN_KEY)');
    expect(source).toContain("const TOKEN_KEY = 'cogm_token'");
  });

  it('pins the uuid pattern to the shared contract', () => {
    expect(openPage.UUID_SOURCE).toBe(FOUNDRY_UUID_SOURCE);
    expect(openPage.UUID_MAX_LENGTH).toBe(FOUNDRY_UUID_MAX_LENGTH);
  });

  it('reads only a valid uuid from the query and labels it', () => {
    expect(openPage.uuidFromSearch(`?uuid=${ACTOR}`)).toBe(ACTOR);
    expect(openPage.uuidFromSearch(`?uuid=${encodeURIComponent(PAGE)}`)).toBe(PAGE);
    expect(openPage.uuidFromSearch('?uuid=javascript:alert(1)')).toBeNull();
    expect(openPage.uuidFromSearch('?uuid=Compendium.dnd5e.monsters.aaaaaaaaaaaaaaaa')).toBeNull();
    expect(openPage.uuidFromSearch('')).toBeNull();
    expect(openPage.documentLabel(ACTOR)).toBe('Actor');
    expect(openPage.documentLabel(PAGE)).toBe('Journal page');
    expect(openPage.documentLabel('Compendium.dnd5e.monsters.Actor.aaaaaaaaaaaaaaaa')).toBe(
      'Actor (compendium)'
    );
    expect(openPage.documentLabel('Actor.aaaaaaaaaaaaaaaa.ActiveEffect.bbbbbbbbbbbbbbbb')).toBe(
      'Active Effect'
    );
  });

  it('sends the token in a header only, with the custom request header', () => {
    const withToken = openPage.openRequest(ACTOR, 'tok', undefined);
    expect(withToken.method).toBe('POST');
    expect(withToken.headers).toEqual({
      'Content-Type': 'application/json',
      'X-CoGM-Request': 'open',
      'X-CoGM-Token': 'tok',
    });
    expect(JSON.parse(withToken.body)).toEqual({ uuid: ACTOR });
    expect(withToken.redirect).toBe('error');
    const chosen = openPage.openRequest(ACTOR, '', GM_B);
    expect(chosen.headers).not.toHaveProperty('X-CoGM-Token');
    expect(JSON.parse(chosen.body)).toEqual({ uuid: ACTOR, userId: GM_B });
  });

  it('describes every answer in plain words', () => {
    const ctx = { label: 'Actor', gmName: undefined };
    const opened = openPage.describeAnswer(
      200,
      { opened: true, documentName: 'Actor', name: 'Wolf', userId: GM_A },
      ctx
    );
    expect(opened).toMatchObject({ tone: 'ok', canRetry: true });
    expect(opened.text).toBe(`Opened Actor "Wolf" on the GM's Foundry screen.`);
    expect(
      openPage.describeAnswer(
        200,
        { opened: true, name: 'Wolf', userId: GM_B },
        {
          label: 'Actor',
          gmName: 'Bo',
        }
      ).text
    ).toBe(`Opened Actor "Wolf" on Bo's Foundry screen.`);
    expect(openPage.describeAnswer(401, { code: 'gm-required' }, ctx).text).toMatch(
      /not signed in.*Obsidian/s
    );
    expect(openPage.describeAnswer(403, { code: 'gm-required' }, ctx)).toMatchObject({
      canRetry: false,
    });
    expect(
      openPage.describeAnswer(403, { code: 'cross-site', error: 'Cross-site.' }, ctx).text
    ).toContain('Cross-site.');
    const choose = openPage.describeAnswer(
      409,
      {
        code: 'choose-gm',
        gms: [
          { id: GM_A, name: 'Anna' },
          { id: '<img src=x>', name: 'Bad id' },
          { id: GM_B, name: '' },
        ],
      },
      ctx
    );
    expect(choose.gms).toEqual([{ id: GM_A, name: 'Anna' }]);
    expect(openPage.describeAnswer(409, { code: 'choose-gm' }, ctx).gms).toBeUndefined();
    expect(openPage.describeAnswer(429, { code: 'rate-limited' }, ctx).canRetry).toBe(true);
    expect(openPage.describeAnswer(400, { code: 'bad-uuid' }, ctx).canRetry).toBe(false);
    expect(
      openPage.describeAnswer(502, { code: 'bridge', error: 'Foundry could not open it.' }, ctx)
        .text
    ).toContain('Foundry could not open it.');
    expect(openPage.describeAnswer(0, null, ctx).text).toContain('did not answer');
    expect(openPage.describeAnswer(500, null, ctx).text).toContain('HTTP 500');
  });

  it('uses no em dashes in the page', () => {
    for (const file of ['open.html', 'open.js', 'open.css']) {
      expect([file, readFileSync(path.join(PUBLIC_DIR, file), 'utf8').includes('\u2014')]).toEqual([
        file,
        false,
      ]);
    }
  });
});
