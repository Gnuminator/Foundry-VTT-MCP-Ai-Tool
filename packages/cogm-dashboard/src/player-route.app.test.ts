/**
 * The player connector's login (D-136, player-connector-auth): /mcp/player maps a verified
 * Cloudflare Access service token to one Foundry user, refuses everything else, and /me shows a
 * player only their own Client ID and Secret.
 */
import crypto from 'crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import path from 'path';
import { inflateRawSync } from 'zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';
import { ConnectorStore, parseConnectorFile } from './player-connector.js';

const TEAM = 'team.cloudflareaccess.com';
const GM_AUD = 'gm-app-aud';
const PLAYER_AUD = 'player-app-aud';
const ALICE = 'alice00000000001';
const BOB = 'bob0000000000002';
const GM_USER = 'gamemaster000003';
const WORLD = 'world-player-route';
const GM_TOKEN = 'gm-token-player-route';

const ID_A = 'aaaa1111.access';
const ID_B = 'bbbb2222.access';
const SECRET_A = 'secret-of-alice-aaaaaaaaaaaaaaaaaaaaaaaa';
const SECRET_B = 'secret-of-bob-bbbbbbbbbbbbbbbbbbbbbbbbbbb';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', kty: 'RSA' }];

function jwt(claims: Record<string, unknown>, aud = PLAYER_AUD): string {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ iss: `https://${TEAM}`, aud: [aud], iat: now, exp: now + 600, ...claims })
  ).toString('base64url');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey);
  return `${head}.${body}.${sig.toString('base64url')}`;
}
const service = (clientId: string, aud = PLAYER_AUD): string =>
  jwt({ common_name: clientId, sub: '' }, aud);

const dir = mkdtempSync(path.join(tmpdir(), 'player-route-'));
function configFile(extra: Record<string, unknown> = {}): string {
  const file = path.join(dir, `pc-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      endpoint: 'https://player-ai.example.com/mcp/player',
      audience: PLAYER_AUD,
      players: [
        { clientId: ID_A, clientSecret: SECRET_A, userId: ALICE },
        { clientId: ID_B, clientSecret: SECRET_B, userId: BOB },
        { clientId: 'gmtyp.access', clientSecret: 'x-secret-x', userId: GM_USER },
        { clientId: 'orphan.access', clientSecret: 'y-secret-y', userId: 'ghost00000000009' },
      ],
      ...extra,
    })
  );
  return file;
}

interface Call {
  userId: string;
  tool: string;
  args: unknown;
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map(c => c()));
});

async function start(
  options: {
    enabled?: boolean;
    file?: string | null;
    devUser?: string;
    teamDomain?: string;
    keyFetchFails?: boolean;
    host?: string;
    /** The bridge lists no users (the table is off or Foundry has not answered yet). */
    noUsers?: boolean;
    /** Replaces parts of the fake bridge client (a method set to undefined is removed). */
    client?: Record<string, unknown>;
    /** CF_ACCESS_TEAM_DOMAIN as set, parsed or not. */
    teamDomainRaw?: string;
  } = {}
): Promise<{ base: string; calls: Call[]; warns: string[] }> {
  const calls: Call[] = [];
  const warns: string[] = [];
  const auth: AuthConfig = {
    ...config.auth,
    splitEnabled: true,
    gmToken: GM_TOKEN,
    playerToken: '',
    gmEmails: ['gm@example.com'],
    access: { teamDomain: TEAM, audiences: [GM_AUD] },
  };
  const testConfig: Config = {
    ...config,
    host: options.host ?? '127.0.0.1',
    stateDir: undefined,
    allowedHosts: parseAllowedHosts(''),
    auth,
  };
  const baseClient = {
    isConnected: true,
    listTools: (): Promise<unknown[]> => Promise.resolve([]),
    callTool: <T>(name: string): Promise<T> =>
      name === 'get-world-info'
        ? Promise.resolve({
            id: WORLD,
            title: 'Test',
            system: { id: 'dnd5e' },
            playerUsers: options.noUsers
              ? []
              : [
                  { id: ALICE, name: 'Alice', isGM: false },
                  { id: BOB, name: 'Bob', isGM: false },
                  { id: GM_USER, name: 'Gamemaster', isGM: true },
                ],
          } as T)
        : Promise.reject(new Error('no tool')),
    characterSheet: (userId: string): Promise<unknown> => Promise.resolve({ userId, sheets: [] }),
    listPlayerTools: (): Promise<unknown> =>
      Promise.resolve({
        tools: [
          { name: 'get-my-character', description: 'x', inputSchema: { type: 'object' } },
          { name: 'apply-planned-change', description: 'nope', inputSchema: { type: 'object' } },
        ],
      }),
    playerTool: (userId: string, tool: string, args: unknown): Promise<unknown> => {
      calls.push({ userId, tool, args });
      return Promise.resolve({ content: [{ type: 'text', text: `{"for":"${userId}"}` }] });
    },
  };
  const client = { ...baseClient, ...options.client };
  const file = options.file === undefined ? configFile() : options.file;
  const dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'player-route'),
    client,
    accessFetch: () =>
      options.keyFetchFails
        ? Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ keys }) }),
    playerConnector: {
      enabled: options.enabled ?? true,
      store: new ConnectorStore(file, m => warns.push(m)),
      teamDomain: options.teamDomain ?? TEAM,
      devUser: options.devUser ?? '',
      teamDomainRaw: options.teamDomainRaw ?? options.teamDomain ?? TEAM,
    },
  });
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  closers.push(
    () =>
      new Promise<void>(resolve => {
        dashboard.close();
        server.close(() => resolve());
      })
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dashboard.handlers.onStatus({
    controlChannel: 'connected',
    foundry: 'reachable',
    lastError: null,
    lastPollAt: null,
    foundryDownSince: null,
  });
  await vi.waitFor(
    async () => {
      const res = await fetch(`${base}/api/state`, { headers: { 'X-CoGM-Token': GM_TOKEN } });
      expect(((await res.json()) as { world: { id: string } | null }).world?.id).toBe(WORLD);
    },
    { timeout: 5000 }
  );
  return { base, calls, warns };
}

function rpc(base: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/mcp/player`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const call = (name: string, args: unknown = {}, id = 1): object => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});
const asA = { 'cf-access-jwt-assertion': service(ID_A) };

describe('parseConnectorFile', () => {
  it('drops incomplete entries and an ambiguous duplicate Client ID', () => {
    const parsed = parseConnectorFile({
      endpoint: 'http://example.com/x',
      audience: [PLAYER_AUD, ' '],
      players: [
        { clientId: 'a', clientSecret: 's', userId: ALICE },
        { clientId: 'dup', clientSecret: 's', userId: ALICE },
        { clientId: 'dup', clientSecret: 's', userId: BOB },
        { clientId: 'b', clientSecret: '', userId: BOB },
        { clientId: 'c', clientSecret: 's', userId: 'short' },
        null,
      ],
    });
    expect(parsed.endpoint).toBeNull(); // plain http to a real host is not an endpoint
    expect(parsed.audiences).toEqual([PLAYER_AUD]);
    expect(parsed.players.map(p => p.clientId)).toEqual(['a']);
  });

  it('reports what it drops and a user id two entries share', () => {
    const problems: string[] = [];
    parseConnectorFile(
      {
        audience: PLAYER_AUD,
        players: [
          { clientId: 'a', clientSecret: 's', userId: ALICE },
          { clientId: 'b', clientSecret: 's', userId: ALICE },
          { clientId: 'c', clientSecret: '', userId: BOB },
          { clientId: 'dup', clientSecret: 's', userId: BOB },
          { clientId: 'dup', clientSecret: 's', userId: BOB },
        ],
      },
      m => problems.push(m)
    );
    expect(problems.some(m => m.includes('players[2]'))).toBe(true);
    expect(problems.some(m => m.includes('twice'))).toBe(true);
    expect(problems.some(m => m.includes('share one Foundry user id'))).toBe(true);
  });
});

describe('ConnectorStore logging', () => {
  it('logs dropped entries once per change and warns again after the file comes back', () => {
    const file = configFile({
      players: [
        { clientId: 'a', clientSecret: 's', userId: ALICE },
        { clientId: 'b', clientSecret: 's', userId: 'short' },
      ],
    });
    const warns: string[] = [];
    const store = new ConnectorStore(file, m => warns.push(m));
    store.read();
    store.read();
    expect(warns.filter(m => m.includes('dropped'))).toHaveLength(1);
    // Unreadable, then fine again, then unreadable again: each breakage is one line.
    writeFileSync(file, '{ not json');
    store.read();
    store.read();
    expect(warns.filter(m => m.includes('cannot be read'))).toHaveLength(1);
    writeFileSync(file, JSON.stringify({ audience: PLAYER_AUD, players: [] }));
    store.read();
    writeFileSync(file, '{ not json');
    store.read();
    expect(warns.filter(m => m.includes('cannot be read'))).toHaveLength(2);
  });

  it('repeats the drop warnings when the same bad file comes back after an unreadable spell', () => {
    const bad = {
      players: [{ clientId: 'b', clientSecret: 's', userId: 'short' }],
    };
    const file = configFile(bad);
    const warns: string[] = [];
    const store = new ConnectorStore(file, m => warns.push(m));
    store.read();
    expect(warns.filter(m => m.includes('dropped'))).toHaveLength(1);
    writeFileSync(file, '{ not json');
    store.read();
    writeFileSync(file, JSON.stringify(bad));
    store.read();
    expect(warns.filter(m => m.includes('dropped'))).toHaveLength(2);
  });
});

describe('/mcp/player: who gets in', () => {
  it('maps each player service token to their own Foundry user', async () => {
    const { base, calls } = await start();
    const a = await rpc(base, call('get-my-character', { name: 'Brenna' }), asA);
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({
      result: { content: [{ text: `{"for":"${ALICE}"}` }] },
    });
    await rpc(base, call('get-my-character'), { 'cf-access-jwt-assertion': service(ID_B) });
    expect(calls.map(c => c.userId)).toEqual([ALICE, BOB]);
  });

  it('ignores a userId or includeWorld the client puts in the arguments', async () => {
    const { base, calls } = await start();
    await rpc(base, { ...call('search-books', { query: 'x', userId: BOB }), userId: BOB }, asA);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.userId).toBe(ALICE);
  });

  it('is not there at all when the connector is off', async () => {
    const { base, calls } = await start({ enabled: false });
    const res = await rpc(base, call('get-my-character'), asA);
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('refuses no token, a bad token, a cookie and another app (401)', async () => {
    const { base, calls } = await start();
    expect((await rpc(base, call('get-my-character'))).status).toBe(401);
    expect(
      (await rpc(base, call('get-my-character'), { 'cf-access-jwt-assertion': 'a.b.c' })).status
    ).toBe(401);
    expect(
      (await rpc(base, call('get-my-character'), { cookie: `CF_Authorization=${service(ID_A)}` }))
        .status
    ).toBe(401);
    // The GM application's AUD tag is not the players' one.
    expect(
      (
        await rpc(base, call('get-my-character'), {
          'cf-access-jwt-assertion': service(ID_A, GM_AUD),
        })
      ).status
    ).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('gives a refusal no body to learn from', async () => {
    const { base } = await start();
    const res = await rpc(base, call('get-my-character'));
    expect(await res.text()).toBe('');
  });

  it('refuses a GM email login, even with the right application (403)', async () => {
    const { base, calls } = await start();
    const gmLogin = jwt({ email: 'gm@example.com', common_name: ID_A });
    const res = await rpc(base, call('get-my-character'), { 'cf-access-jwt-assertion': gmLogin });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('refuses a Client ID that is not in the table (403)', async () => {
    const { base, calls } = await start();
    const res = await rpc(base, call('get-my-character'), {
      'cf-access-jwt-assertion': service('stranger.access'),
    });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('refuses an entry that points at a GM or at a user Foundry does not list (403)', async () => {
    const { base, calls } = await start();
    for (const id of ['gmtyp.access', 'orphan.access']) {
      const res = await rpc(base, call('get-my-character'), {
        'cf-access-jwt-assertion': service(id),
      });
      expect(res.status).toBe(403);
    }
    expect(calls).toHaveLength(0);
  });

  it('logs the claim names, never values, when a valid token has no common_name', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    try {
      const { base, calls } = await start();
      const res = await rpc(base, call('get-my-character'), {
        'cf-access-jwt-assertion': jwt({ type: 'app', sub: 'secret-looking-value' }),
      });
      expect(res.status).toBe(403);
      expect(calls).toHaveLength(0);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain('no common_name');
      expect(logged).toContain('"type"');
      expect(logged).not.toContain('secret-looking-value');
    } finally {
      warn.mockRestore();
    }
  });

  it('says try again (503), not wrong login, when the table lists no users', async () => {
    const { base, calls } = await start({ noUsers: true });
    expect((await rpc(base, call('get-my-character'), asA)).status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it('refuses everything when the config file is missing or has no audience', async () => {
    // A table-side fault is 503 (try again), never "check your login".
    const { base, warns } = await start({ file: path.join(dir, 'nope.json') });
    expect((await rpc(base, call('get-my-character'), asA)).status).toBe(503);
    expect(warns.join(' ')).toContain('config file cannot be read');
    const noAud = await start({ file: configFile({ audience: '' }) });
    expect((await rpc(noAud.base, call('get-my-character'), asA)).status).toBe(503);
  });

  it('answers 503 without a team domain and when the signing keys cannot be fetched', async () => {
    const { base } = await start({ teamDomain: '' });
    expect((await rpc(base, call('get-my-character'), asA)).status).toBe(503);
    const noKeys = await start({ keyFetchFails: true });
    expect((await rpc(noKeys.base, call('get-my-character'), asA)).status).toBe(503);
  });

  it('refuses a Client ID that appears twice in the file (403), both entries dropped', async () => {
    const file = configFile({
      players: [
        { clientId: ID_A, clientSecret: SECRET_A, userId: ALICE },
        { clientId: ID_A, clientSecret: SECRET_B, userId: BOB },
      ],
    });
    const { base, calls } = await start({ file });
    expect((await rpc(base, call('get-my-character'), asA)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('says try again (503) when the bridge is not connected', async () => {
    const { base, calls } = await start({
      client: { isConnected: false },
      noUsers: true,
    });
    expect((await rpc(base, call('get-my-character'), asA)).status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it('only answers POST', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/mcp/player`, { headers: asA });
    expect(res.status).toBe(405);
  });
});

describe('/mcp/player: what it runs', () => {
  it('speaks initialize, ping and notifications; lists only the player tools', async () => {
    const { base } = await start();
    const init = await rpc(
      base,
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      asA
    );
    expect(await init.json()).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } },
    });
    expect((await rpc(base, { jsonrpc: '2.0', id: 2, method: 'ping' }, asA)).status).toBe(200);
    expect(
      (await rpc(base, { jsonrpc: '2.0', method: 'notifications/initialized' }, asA)).status
    ).toBe(202);
    const list = (await (
      await rpc(base, { jsonrpc: '2.0', id: 3, method: 'tools/list' }, asA)
    ).json()) as { result: { tools: Array<{ name: string }> } };
    expect(list.result.tools.map(t => t.name)).toEqual(['get-my-character']);
  });

  it('answers a bridge failure with a plain error, never the bridge text', async () => {
    const boom = (): Promise<never> => Promise.reject(new Error('secret bridge detail'));
    const { base } = await start({ client: { listPlayerTools: boom, playerTool: boom } });
    const list = await rpc(base, { jsonrpc: '2.0', id: 3, method: 'tools/list' }, asA);
    const listBody = (await list.json()) as { error?: { code: number; message: string } };
    expect(listBody.error?.code).toBe(-32000);
    expect(JSON.stringify(listBody)).not.toContain('secret bridge detail');
    const run = (await (await rpc(base, call('get-my-character'), asA)).json()) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    expect(run.result.isError).toBe(true);
    expect(JSON.stringify(run)).not.toContain('secret bridge detail');
  });

  it('answers 503 when the bridge client has no player methods', async () => {
    const { base } = await start({
      client: { listPlayerTools: undefined, playerTool: undefined },
    });
    expect((await rpc(base, { jsonrpc: '2.0', id: 3, method: 'tools/list' }, asA)).status).toBe(
      503
    );
    expect((await rpc(base, call('get-my-character'), asA)).status).toBe(503);
  });

  it('offers the newest protocol, reports the dashboard version and rejects a request with no method', async () => {
    const { base } = await start();
    const init = (await (
      await rpc(
        base,
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
        asA
      )
    ).json()) as { result: { protocolVersion: string; serverInfo: { version: string } } };
    expect(init.result.protocolVersion).toBe('2025-11-25');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(init.result.serverInfo.version).toBe(pkg.version);
    const noMethod = (await (await rpc(base, { jsonrpc: '2.0', id: 4 }, asA)).json()) as {
      id: number;
      error: { code: number };
    };
    expect(noMethod.id).toBe(4);
    expect(noMethod.error.code).toBe(-32600);
  });

  it('refuses every method and tool that is not a player tool', async () => {
    const { base, calls } = await start();
    for (const name of [
      'apply-planned-change',
      'session_switches',
      'getCharacterInfo',
      'search-rules',
      'constructor',
    ]) {
      const body = (await (await rpc(base, call(name), asA)).json()) as { error?: object };
      expect(body.error).toBeDefined();
    }
    for (const method of ['call_tool', 'player_tool', 'resources/list', 'prompts/list']) {
      const body = (await (
        await rpc(base, { jsonrpc: '2.0', id: 9, method, params: {} }, asA)
      ).json()) as { error?: object };
      expect(body.error).toBeDefined();
    }
    expect((await rpc(base, [call('get-my-character')], asA)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('dev mode', () => {
  it('serves the dev user on loopback with no login', async () => {
    // A dev setup has no Access application in its file.
    const { base, calls } = await start({
      devUser: ALICE,
      teamDomain: '',
      file: configFile({ audience: '' }),
    });
    expect((await rpc(base, call('get-my-character'))).status).toBe(200);
    expect(calls[0]?.userId).toBe(ALICE);
  });

  it('is ignored when the dashboard is not on loopback', async () => {
    const { base, calls } = await start({
      devUser: ALICE,
      host: '10.0.0.5',
      file: configFile({ audience: '' }),
    });
    expect((await rpc(base, call('get-my-character'))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('is ignored when a team domain is set: real players still log in, no login gets 401', async () => {
    const { base, calls } = await start({ devUser: ALICE });
    expect((await rpc(base, call('get-my-character'))).status).toBe(401);
    expect((await rpc(base, call('get-my-character'), asA)).status).toBe(200);
    expect(calls.map(c => c.userId)).toEqual([ALICE]);
  });

  it('is never used for a request that came through the tunnel or Access', async () => {
    const { base, calls } = await start({
      devUser: ALICE,
      teamDomain: '',
      file: configFile({ audience: '' }),
    });
    expect(
      (await rpc(base, call('get-my-character'), { 'cf-connecting-ip': '1.2.3.4' })).status
    ).toBe(403);
    expect((await rpc(base, call('get-my-character'), { 'cf-ray': 'abc' })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('serves the wrapper, which always sends its service-token pair, but not through the tunnel', async () => {
    const { base, calls } = await start({
      devUser: ALICE,
      teamDomain: '',
      file: configFile({ audience: '' }),
    });
    const pair = { 'cf-access-client-id': 'x.access', 'cf-access-client-secret': 'secret' };
    expect((await rpc(base, call('get-my-character'), pair)).status).toBe(200);
    expect(calls[0]?.userId).toBe(ALICE);
    expect(
      (await rpc(base, call('get-my-character'), { ...pair, 'cf-connecting-ip': '1.2.3.4' })).status
    ).toBe(403);
    expect((await rpc(base, call('get-my-character'), { ...pair, 'cf-ray': 'abc' })).status).toBe(
      403
    );
    expect(calls).toHaveLength(1);
  });

  it('is ignored when CF_ACCESS_TEAM_DOMAIN is set but malformed', async () => {
    const { base, calls } = await start({
      devUser: ALICE,
      teamDomain: '',
      teamDomainRaw: 'not a domain!',
      file: configFile({ audience: '' }),
    });
    expect((await rpc(base, call('get-my-character'))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('is not used once the config file names an Access application', async () => {
    const { base, calls } = await start({ devUser: ALICE, teamDomain: '' });
    // The default test file names an audience: production-shaped setups never serve the dev user.
    expect((await rpc(base, call('get-my-character'))).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

describe('a service token never becomes a GM', () => {
  it('stays a player on the GM routes, even with the GM application tag', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/tools`, {
      headers: { 'cf-access-jwt-assertion': service(ID_A, GM_AUD) },
    });
    expect(res.status).toBe(403);
  });
});

describe('Table at a glance is GM only', () => {
  // The glance screen reads get-party and get-current-scene through POST /api/tool (GM routes with
  // exact HP and hidden tokens). A signed-in player (Alice, with her own Client ID on the player
  // application) is refused there, so the screen can show a player nothing.
  it('refuses a player the tools the screen reads', async () => {
    const { base, calls } = await start();
    for (const name of ['get-party', 'get-current-scene', 'get-combat-state']) {
      const res = await fetch(`${base}/api/tool`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-access-jwt-assertion': service(ID_A),
        },
        body: JSON.stringify({ name, args: {} }),
      });
      expect(res.status).toBe(403);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('/me: Your Claude connector', () => {
  async function linkFor(base: string, userId: string): Promise<string> {
    const res = await fetch(`${base}/api/player-links/${userId}`, {
      method: 'POST',
      headers: { 'X-CoGM-Token': GM_TOKEN },
    });
    return new URL(((await res.json()) as { link: string }).link, 'http://x').searchParams.get(
      'k'
    ) as string;
  }
  const connector = (base: string, key?: string): Promise<Response> =>
    fetch(`${base}/api/me/connector`, { headers: key ? { 'X-CoGM-Me': key } : {} });

  it("shows a player only their own pair and never another player's", async () => {
    const { base } = await start();
    const keyA = await linkFor(base, ALICE);
    const keyB = await linkFor(base, BOB);
    const resA = await connector(base, keyA);
    expect(resA.headers.get('cache-control')).toBe('no-store');
    const textA = await resA.text();
    expect(JSON.parse(textA)).toMatchObject({
      enabled: true,
      clientId: ID_A,
      clientSecret: SECRET_A,
    });
    for (const other of [ID_B, SECRET_B, 'gmtyp.access', 'x-secret-x']) {
      expect(textA).not.toContain(other);
    }
    const textB = await (await connector(base, keyB)).text();
    expect(textB).toContain(SECRET_B);
    for (const other of [ID_A, SECRET_A]) expect(textB).not.toContain(other);
  });

  it('gives no pair to a missing, wrong or GM key', async () => {
    const { base } = await start();
    expect((await connector(base)).status).toBe(401);
    expect((await connector(base, 'x'.repeat(24))).status).toBe(401);
    const asGm = await fetch(`${base}/api/me/connector`, { headers: { 'X-CoGM-Token': GM_TOKEN } });
    expect(asGm.status).toBe(401);
  });

  const helper = (base: string, key?: string): Promise<Response> =>
    fetch(`${base}/api/me/helper.mcpb`, { headers: key ? { 'X-CoGM-Me': key } : {} });
  const manifestOf = (zip: Buffer): Record<string, unknown> => {
    let at = 0;
    while (zip.readUInt32LE(at) === 0x04034b50) {
      const packed = zip.readUInt32LE(at + 18);
      const nameLen = zip.readUInt16LE(at + 26);
      const start = at + 30 + nameLen + zip.readUInt16LE(at + 28);
      if (zip.toString('utf8', at + 30, at + 30 + nameLen) === 'manifest.json') {
        return JSON.parse(inflateRawSync(zip.subarray(start, start + packed)).toString('utf8'));
      }
      at = start + packed;
    }
    throw new Error('no manifest');
  };

  it('hands a player a file with only their own pair, never stored or cached', async () => {
    const { base } = await start();
    const keyA = await linkFor(base, ALICE);
    const keyB = await linkFor(base, BOB);
    const res = await helper(base, keyA);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toContain('foundry-player.mcpb');
    const zip = Buffer.from(await res.arrayBuffer());
    const m = manifestOf(zip) as {
      name: string;
      display_name: string;
      user_config?: unknown;
      server: { mcp_config: { env: Record<string, string> } };
    };
    expect(m.user_config).toBeUndefined();
    expect(m.display_name).toBe('Foundry (Alice)');
    expect(m.name).toBe('foundry-player-alice');
    expect(m.server.mcp_config.env).toEqual({
      FOUNDRY_PLAYER_ENDPOINT: 'https://player-ai.example.com/mcp/player',
      FOUNDRY_PLAYER_CLIENT_ID: ID_A,
      FOUNDRY_PLAYER_CLIENT_SECRET: SECRET_A,
    });
    const textB = JSON.stringify(
      manifestOf(Buffer.from(await (await helper(base, keyB)).arrayBuffer()))
    );
    expect(textB).toContain(SECRET_B);
    for (const other of [ID_A, SECRET_A]) expect(textB).not.toContain(other);
  });

  it('gives no file to a missing, wrong or GM key and 404 to a player with no pair', async () => {
    const { base } = await start();
    expect((await helper(base)).status).toBe(401);
    expect((await helper(base, 'x'.repeat(24))).status).toBe(401);
    const asGm = await fetch(`${base}/api/me/helper.mcpb`, {
      headers: { 'X-CoGM-Token': GM_TOKEN },
    });
    expect(asGm.status).toBe(401);
    const none = await start({ file: null });
    const key = await linkFor(none.base, ALICE);
    const res = await helper(none.base, key);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(SECRET_A);
    const off = await start({ enabled: false });
    expect((await helper(off.base, await linkFor(off.base, ALICE))).status).toBe(404);
  });

  it('says not enabled for a player with no entry or when the connector is off', async () => {
    const off = await start({ enabled: false });
    const key = await linkFor(off.base, ALICE);
    expect(await (await connector(off.base, key)).json()).toEqual({ enabled: false });
    const none = await start({ file: null });
    const key2 = await linkFor(none.base, ALICE);
    expect(await (await connector(none.base, key2)).json()).toEqual({ enabled: false });
  });
});
