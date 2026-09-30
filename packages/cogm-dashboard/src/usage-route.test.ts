/**
 * The usage log's HTTP side (I-084, usage-route.ts): the real `createDashboard` against a fake
 * bridge that records every `record_usage` batch. Covers the auth of each route, the server
 * deciding surface and who, the limits, the name list, the old-backend path and that no route
 * returns usage data.
 */
import type { AddressInfo } from 'net';

import { USAGE_LIMITS, type UsageEvent } from '@gnuminator/shared';
import { afterEach, describe, expect, it } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig } from './config.js';
import { ChannelError } from './feed/mcp-control-client.js';
import { Logger } from './logger.js';
import { PlayerDirectory, playerWho } from './usage-route.js';

const GM_TOKEN = 'gm-token-for-usage';
const PLAYER_TOKEN = 'player-token-for-usage';

const SPLIT_ON: Partial<AuthConfig> = {
  splitEnabled: true,
  gmToken: GM_TOKEN,
  playerToken: PLAYER_TOKEN,
  gmEmails: [],
};

const ANNA = { id: 'PlayerAnnaaaaaaaaa', name: 'Anna', isGM: false };
const BO = { id: 'PlayerBoooooooooo', name: 'Bo', isGM: false };
const GM = { id: 'GmCyyyyyyyyyyyyy', name: 'Cy', isGM: true };

const fakeCoGm = {
  enabled: false,
  isBusy: false,
  setWorld: (): void => undefined,
  abortActive: (): void => undefined,
} as unknown as CoGm;

class FakeBridge {
  readonly batches: UsageEvent[][] = [];
  readonly worldCalls: number[] = [];
  readonly isConnected = true;
  users: unknown[] = [ANNA, BO, GM];
  recordError: Error | null = null;
  withRecordUsage = true;

  listTools = (): Promise<unknown[]> => Promise.resolve([]);

  callTool = <T>(name: string): Promise<T> => {
    if (name === 'get-world-info') {
      this.worldCalls.push(1);
      return Promise.resolve({
        id: 'w',
        title: 'W',
        system: { id: 'dnd5e', version: '6' },
        foundry: { version: '14' },
        activeUsers: this.users,
      } as T);
    }
    return Promise.reject(new Error(`unknown tool ${name}`));
  };

  recordUsage = (events: UsageEvent[]): Promise<{ accepted: number; dropped: number }> => {
    if (this.recordError) return Promise.reject(this.recordError);
    this.batches.push(events);
    return Promise.resolve({ accepted: events.length, dropped: 0 });
  };
}

interface Harness {
  base: string;
  bridge: FakeBridge;
  close(): Promise<void>;
}

const running: Harness[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map(h => h.close()));
});

async function start(
  auth: Partial<AuthConfig> = SPLIT_ON,
  setup: (bridge: FakeBridge) => void = (): void => undefined
): Promise<Harness> {
  const bridge = new FakeBridge();
  setup(bridge);
  const client = bridge.withRecordUsage
    ? bridge
    : { callTool: bridge.callTool, listTools: bridge.listTools, isConnected: true };
  const dashboard: Dashboard = createDashboard({
    config: { ...config, auth: { ...config.auth, ...auth } },
    logger: new Logger('error', 'usage-test'),
    client,
    coGm: fakeCoGm,
  });
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const h: Harness = {
    base: `http://127.0.0.1:${port}`,
    bridge,
    close: () =>
      new Promise<void>(resolve => {
        dashboard.close();
        server.close(() => resolve());
      }),
  };
  running.push(h);
  return h;
}

function ev(
  seq: number,
  name: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    v: 1,
    key: `abc:${seq}`,
    t: Date.now(),
    seq,
    clientId: 'abc',
    surface: 'module',
    kind: 'action',
    name,
    who: { role: 'gm', userId: 'Spoofed', name: 'Spoofed' },
    ...extra,
  };
}

async function post(
  h: Harness,
  path: string,
  body: unknown,
  token?: string,
  query = ''
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${h.base}${path}${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CoGM-Token': token } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as never };
}

describe('POST /api/usage (the GM page)', () => {
  it('is 401 without a token and 403 for a player token, and never reaches the bridge', async () => {
    const h = await start();
    const events = [ev(1, 'dash.tools.open')];
    expect((await post(h, '/api/usage', { events })).status).toBe(401);
    expect((await post(h, '/api/usage', { events }, PLAYER_TOKEN)).status).toBe(403);
    expect((await post(h, '/api/usage', { events }, 'wrong')).status).toBe(401);
    expect(h.bridge.batches).toHaveLength(0);
  });

  it('forces surface dashboard and who gm, whatever the body says', async () => {
    const h = await start();
    const answer = await post(
      h,
      '/api/usage',
      {
        events: [
          ev(1, 'dash.tools.open'),
          ev(2, 'tool.get-world-info', { kind: 'tool', outcome: 'ok' }),
        ],
      },
      GM_TOKEN
    );
    expect(answer).toMatchObject({ status: 200, json: { accepted: 2, dropped: 0 } });
    const [batch] = h.bridge.batches;
    expect(batch?.map(e => e.surface)).toEqual(['dashboard', 'dashboard']);
    expect(batch?.every(e => e.who.role === 'gm' && e.who.userId === null)).toBe(true);
    expect(batch?.[1]).toMatchObject({ kind: 'tool', outcome: 'ok' });
  });

  it('accepts the token as a query parameter (sendBeacon) and a text/plain body', async () => {
    const h = await start();
    const res = await fetch(`${h.base}/api/usage?token=${GM_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ events: [ev(1, 'dash.tools.open')] }),
    });
    expect(res.status).toBe(200);
    expect(h.bridge.batches).toHaveLength(1);
  });

  it('drops names with the wrong prefix and counts them', async () => {
    const h = await start();
    const answer = await post(
      h,
      '/api/usage',
      { events: [ev(1, 'dash.tools.open'), ev(2, 'player.who.pick'), ev(3, 'Not A Name')] },
      GM_TOKEN
    );
    expect(answer.json).toEqual({ accepted: 1, dropped: 2 });
  });

  it('works without the split (single-user mode)', async () => {
    const h = await start({ splitEnabled: false, gmToken: '', playerToken: '', gmEmails: [] });
    expect((await post(h, '/api/usage', { events: [ev(1, 'dash.tools.open')] })).status).toBe(200);
  });

  it('rejects a body that is not a list of events with 400', async () => {
    const h = await start();
    const answer = await post(h, '/api/usage', { events: 'nope' }, GM_TOKEN);
    expect(answer.status).toBe(400);
    expect(answer.json.code).toBe('bad-usage-batch');
  });

  it('refuses a body over the batch byte limit with 413 and caps the event count', async () => {
    const h = await start();
    const big = {
      events: [ev(1, 'dash.tools.open', { pad: 'x'.repeat(USAGE_LIMITS.maxBatchBytes) })],
    };
    expect((await post(h, '/api/usage', big, GM_TOKEN)).status).toBe(413);

    const many = Array.from({ length: USAGE_LIMITS.maxBatch + 20 }, (_, i) => ({
      v: 1,
      key: `c:${i}`,
      seq: i,
      clientId: 'c',
      kind: 'action',
      name: 'dash.a.b',
    }));
    const answer = await post(h, '/api/usage', { events: many }, GM_TOKEN);
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ accepted: USAGE_LIMITS.maxBatch, dropped: 20 });
  });
});

describe('POST /api/player/usage (the player page)', () => {
  it('is 401 without a credential and works for a player token', async () => {
    const h = await start();
    const events = [ev(1, 'player.handouts.open')];
    expect((await post(h, '/api/player/usage', { events })).status).toBe(401);
    expect((await post(h, '/api/player/usage', { events }, PLAYER_TOKEN)).status).toBe(200);
  });

  it('forces surface player: dashboard names and the tool kind are dropped', async () => {
    const h = await start();
    const answer = await post(
      h,
      '/api/player/usage',
      {
        events: [
          ev(1, 'player.handouts.open'),
          ev(2, 'dash.tools.open'),
          ev(3, 'tool.get-world-info', { kind: 'tool' }),
        ],
      },
      PLAYER_TOKEN
    );
    expect(answer.json).toEqual({ accepted: 1, dropped: 2 });
    expect(h.bridge.batches[0]?.[0]).toMatchObject({
      surface: 'player',
      name: 'player.handouts.open',
    });
  });

  it('treats a GM token as a player here: surface player, role player', async () => {
    const h = await start();
    await post(h, '/api/player/usage', { events: [ev(1, 'dash.tools.open')] }, GM_TOKEN);
    expect(h.bridge.batches).toHaveLength(0);
    await post(h, '/api/player/usage', { events: [ev(2, 'player.who.change')] }, GM_TOKEN);
    expect(h.bridge.batches[0]?.[0]).toMatchObject({
      surface: 'player',
      who: { role: 'player', userId: null, name: null },
    });
  });

  it('sets who from the server list: a known non-GM user by id, never from the event or name', async () => {
    const h = await start();
    await fetch(`${h.base}/api/player/names`, { headers: { 'X-CoGM-Token': PLAYER_TOKEN } });
    const events = [ev(1, 'player.handouts.open')];
    await post(
      h,
      '/api/player/usage',
      { events, who: { userId: ANNA.id, name: 'Mallory' } },
      PLAYER_TOKEN
    );
    expect(h.bridge.batches[0]?.[0]?.who).toEqual({
      role: 'player',
      userId: ANNA.id,
      name: 'Anna',
    });
  });

  it('an unknown or GM user id gives an unknown who', async () => {
    const h = await start();
    await fetch(`${h.base}/api/player/names`, { headers: { 'X-CoGM-Token': PLAYER_TOKEN } });
    for (const [i, userId] of ['NobodyKnowsMe1', GM.id, 42, '../x'].entries()) {
      await post(
        h,
        '/api/player/usage',
        { events: [ev(i + 1, 'player.handouts.open')], who: { userId } },
        PLAYER_TOKEN
      );
    }
    expect(h.bridge.batches).toHaveLength(4);
    for (const batch of h.bridge.batches) {
      expect(batch[0]?.who).toEqual({ role: 'player', userId: null, name: null });
    }
  });
});

describe('GET /api/player/names', () => {
  it('needs a credential and lists only non-GM users', async () => {
    const h = await start();
    expect((await fetch(`${h.base}/api/player/names`)).status).toBe(401);
    const res = await fetch(`${h.base}/api/player/names`, {
      headers: { 'X-CoGM-Token': PLAYER_TOKEN },
    });
    expect(res.status).toBe(200);
    const names = (await res.json()) as Array<{ userId: string; name: string }>;
    expect(names).toEqual([
      { userId: ANNA.id, name: 'Anna' },
      { userId: BO.id, name: 'Bo' },
    ]);
    expect(JSON.stringify(names)).not.toContain('Cy');
  });

  it('asks the bridge at most once per refresh window', async () => {
    const h = await start();
    const get = (): Promise<Response> =>
      fetch(`${h.base}/api/player/names`, { headers: { 'X-CoGM-Token': PLAYER_TOKEN } });
    await get();
    await get();
    await get();
    expect(h.bridge.worldCalls).toHaveLength(1);
  });

  it('is an empty list while the bridge has seen nobody', async () => {
    const h = await start(SPLIT_ON, bridge => {
      bridge.users = [GM];
    });
    const res = await fetch(`${h.base}/api/player/names`, {
      headers: { 'X-CoGM-Token': PLAYER_TOKEN },
    });
    expect(await res.json()).toEqual([]);
  });
});

describe('the bridge side', () => {
  it('answers an old backend ("Unknown method") with accepted 0 and keeps working', async () => {
    const h = await start(SPLIT_ON, bridge => {
      bridge.recordError = new ChannelError('Unknown method: record_usage');
    });
    const a = await post(h, '/api/usage', { events: [ev(1, 'dash.tools.open')] }, GM_TOKEN);
    const b = await post(h, '/api/usage', { events: [ev(2, 'dash.tools.open')] }, GM_TOKEN);
    expect(a).toMatchObject({ status: 200, json: { accepted: 0, dropped: 1 } });
    expect(b.status).toBe(200);
  });

  it('answers 200 with everything dropped when the bridge is down or has no recordUsage', async () => {
    const down = await start(SPLIT_ON, bridge => {
      bridge.recordError = new ChannelError('Control channel not connected');
    });
    expect(
      (await post(down, '/api/usage', { events: [ev(1, 'dash.tools.open')] }, GM_TOKEN)).json
    ).toEqual({
      accepted: 0,
      dropped: 1,
    });
    const bare = await start(SPLIT_ON, bridge => {
      bridge.withRecordUsage = false;
    });
    expect(
      (await post(bare, '/api/usage', { events: [ev(1, 'dash.tools.open')] }, GM_TOKEN)).json
    ).toEqual({
      accepted: 0,
      dropped: 1,
    });
  });
});

describe('no route returns usage data', () => {
  it('has no GET on the usage paths, for any role', async () => {
    const h = await start();
    await post(h, '/api/usage', { events: [ev(1, 'dash.tools.open')] }, GM_TOKEN);
    for (const path of [
      '/api/usage',
      '/api/player/usage',
      '/api/usage/summary',
      '/api/player/usage/all',
    ]) {
      for (const token of [GM_TOKEN, PLAYER_TOKEN, undefined]) {
        const res = await fetch(`${h.base}${path}`, {
          headers: token ? { 'X-CoGM-Token': token } : {},
        });
        expect(res.status, `${path} ${token ?? 'anon'}`).toBeGreaterThanOrEqual(400);
        expect(await res.text()).not.toContain('dash.tools.open');
      }
    }
  });
});

describe('PlayerDirectory and playerWho (pure helpers)', () => {
  const silent = new Logger('error', 'dir-test');
  const client = { callTool: (): Promise<never> => Promise.reject(new Error('no')) };

  it('harvests non-GM users only, drops a user later seen as GM, and ignores bad entries', () => {
    const dir = new PlayerDirectory(client, silent);
    dir.harvest({
      activeUsers: [ANNA, GM, { id: 'bad id!', name: 'X' }, { id: 'NoName12345' }, 7],
    });
    expect(dir.list()).toEqual([{ userId: ANNA.id, name: 'Anna' }]);
    dir.harvest({ activeUsers: [{ ...ANNA, isGM: true }] });
    expect(dir.list()).toEqual([]);
    dir.harvest('not an object');
    dir.harvest({ activeUsers: 'nope' });
    expect(dir.list()).toEqual([]);
  });

  it('cleans and bounds names', () => {
    const dir = new PlayerDirectory(client, silent);
    dir.harvest({ activeUsers: [{ id: 'U1', name: `  Zed\u0001${'y'.repeat(200)} ` }] });
    const [u] = dir.list();
    expect(u?.name.startsWith('Zed')).toBe(true);
    expect(u?.name.length).toBeLessThanOrEqual(64);
  });

  it('playerWho uses only the claimed user id', () => {
    const dir = new PlayerDirectory(client, silent);
    dir.harvest({ activeUsers: [ANNA] });
    expect(playerWho({ userId: ANNA.id, name: 'Other' }, dir)).toEqual({
      role: 'player',
      userId: ANNA.id,
      name: 'Anna',
    });
    expect(playerWho({ userId: 'nope' }, dir)).toEqual({
      role: 'player',
      userId: null,
      name: null,
    });
    expect(playerWho(undefined, dir)).toEqual({ role: 'player', userId: null, name: null });
  });

  it('refreshIfStale reads world info once per window (injected clock)', async () => {
    let t = 1_000_000;
    let calls = 0;
    const dir = new PlayerDirectory(
      {
        callTool: (): Promise<never> => {
          calls += 1;
          return Promise.resolve({ activeUsers: [ANNA] } as never);
        },
      },
      silent,
      () => t
    );
    await dir.refreshIfStale();
    await dir.refreshIfStale();
    expect(calls).toBe(1);
    t += 31_000;
    await dir.refreshIfStale();
    expect(calls).toBe(2);
    expect(dir.get(ANNA.id)).toEqual({ userId: ANNA.id, name: 'Anna' });
  });
});
