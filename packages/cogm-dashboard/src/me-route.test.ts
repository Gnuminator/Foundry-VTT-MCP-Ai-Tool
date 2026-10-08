/**
 * My character (I-096): a player's private link opens only their own sheets; the GM makes,
 * replaces and removes links; a wrong, old or missing key gets nothing.
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-me';
const PLAYER_TOKEN = 'player-token-me';
const PLAYER = 'player0000000001';
const TAMSIN = 'tamsin0000000002';

let dashboard: Dashboard | null = null;
let server: Server | null = null;

afterEach(async () => {
  dashboard?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  dashboard = null;
  server = null;
});

async function start(): Promise<{ base: string; asked: string[] }> {
  const asked: string[] = [];
  const client = {
    isConnected: true,
    listTools: (): Promise<unknown[]> => Promise.resolve([]),
    callTool: <T>(name: string): Promise<T> =>
      name === 'get-world-info'
        ? Promise.resolve({
            id: 'world-me',
            title: 'Test',
            system: { id: 'dnd5e' },
            playerUsers: [
              { id: PLAYER, name: 'Player', isGM: false },
              { id: TAMSIN, name: 'Tamsin', isGM: false },
            ],
          } as T)
        : Promise.reject(new Error('no tool')),
    characterSheet: (userId: string): Promise<unknown> => {
      asked.push(userId);
      return Promise.resolve({ userId, userName: 'x', sheets: [{ name: `sheet of ${userId}` }] });
    },
  };
  const testConfig: Config = {
    ...config,
    stateDir: undefined,
    auth: { ...config.auth, splitEnabled: true, gmToken: GM_TOKEN, playerToken: PLAYER_TOKEN },
  };
  dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'me'),
    client,
    coGm: {
      enabled: false,
      isBusy: false,
      setWorld: (): void => undefined,
      abortActive: (): void => undefined,
      stream: () => Promise.reject(new Error('off')),
    } as never,
  });
  server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', () => resolve()));
  dashboard.handlers.onStatus({
    controlChannel: 'connected',
    foundry: 'reachable',
    lastError: null,
    lastPollAt: null,
    foundryDownSince: null,
  });
  await new Promise(resolve => setTimeout(resolve, 200));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked };
}

const gm = { 'X-CoGM-Token': GM_TOKEN };
const keyOf = (link: string): string => new URL(link, 'http://x').searchParams.get('k') ?? '';
const me = (base: string, key?: string): Promise<Response> =>
  fetch(`${base}/api/me`, { headers: key ? { 'X-CoGM-Me': key } : {} });

async function makeLink(base: string, userId: string): Promise<string> {
  const res = await fetch(`${base}/api/player-links/${userId}`, { method: 'POST', headers: gm });
  expect(res.status).toBe(200);
  return ((await res.json()) as { link: string }).link;
}

describe('/api/me and the player links', () => {
  it("a player link opens only that player's sheets", async () => {
    const { base, asked } = await start();
    const link = await makeLink(base, PLAYER);
    expect(link).toMatch(/^\/me\?k=[A-Za-z0-9_-]{24}$/);
    const res = await me(base, keyOf(link));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sheets: [{ name: `sheet of ${PLAYER}` }],
      theme: 'neutral',
    });
    expect(asked).toEqual([PLAYER]);
  });

  it('no key, a wrong key or an old key gets nothing', async () => {
    const { base, asked } = await start();
    const old = keyOf(await makeLink(base, PLAYER));
    const fresh = keyOf(await makeLink(base, PLAYER));
    expect((await me(base)).status).toBe(401);
    expect((await me(base, 'x'.repeat(24))).status).toBe(401);
    expect((await me(base, old)).status).toBe(401);
    expect((await me(base, fresh)).status).toBe(200);
    expect(asked).toEqual([PLAYER]);
  });

  it('the key is never taken from the address', async () => {
    const { base, asked } = await start();
    const key = keyOf(await makeLink(base, PLAYER));
    expect((await fetch(`${base}/api/me?k=${key}`)).status).toBe(401);
    expect(asked).toEqual([]);
  });

  it('the GM lists, makes and removes links; players cannot', async () => {
    const { base } = await start();
    await makeLink(base, TAMSIN);
    const list = (await (await fetch(`${base}/api/player-links`, { headers: gm })).json()) as {
      players: Array<{ userId: string; link: string | null }>;
    };
    expect(list.players.map(p => [p.userId, p.link !== null])).toEqual([
      [PLAYER, false],
      [TAMSIN, true],
    ]);
    const asPlayer = { 'X-CoGM-Token': PLAYER_TOKEN };
    expect((await fetch(`${base}/api/player-links`, { headers: asPlayer })).status).toBe(403);
    expect(
      (await fetch(`${base}/api/player-links/${PLAYER}`, { method: 'POST', headers: asPlayer }))
        .status
    ).toBe(403);
    // With a player token set, a caller with no token (or a wrong one) is nobody: 401.
    for (const headers of [{}, { 'X-CoGM-Token': 'not-a-token' }]) {
      const res = await fetch(`${base}/api/player-links`, { headers });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: 'gm-required' });
      for (const method of ['POST', 'DELETE']) {
        expect(
          (await fetch(`${base}/api/player-links/${TAMSIN}`, { method, headers })).status
        ).toBe(401);
      }
    }
    const key = keyOf(list.players[1].link!);
    const del = await fetch(`${base}/api/player-links/${TAMSIN}`, {
      method: 'DELETE',
      headers: gm,
    });
    expect(await del.json()).toEqual({ removed: true });
    expect((await me(base, key)).status).toBe(401);
  });

  it('refuses a link for someone who is not a player of the world', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/player-links/nobody0000000003`, {
      method: 'POST',
      headers: gm,
    });
    expect(res.status).toBe(400);
  });
});
