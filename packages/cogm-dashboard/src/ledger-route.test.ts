/**
 * Who knows what (secret ledger) and the whisper desk: the routes are GM only (a player token is
 * turned away, so the ledger never reaches /player or the TV), pass the GM's choices to the
 * bridge's control methods and answer an older bridge with a plain 503.
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-ledger';
const PLAYER_TOKEN = 'player-token-ledger';
const JORR = 'jjjjjjjjjjjjjjjj';

let dashboard: Dashboard | null = null;
let server: Server | null = null;

afterEach(async () => {
  dashboard?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  dashboard = null;
  server = null;
});

async function start(withMethods = true): Promise<{
  base: string;
  ledgerCalls: Array<[string, Record<string, unknown>]>;
  whispers: Array<Record<string, unknown>>;
}> {
  const ledgerCalls: Array<[string, Record<string, unknown>]> = [];
  const whispers: Array<Record<string, unknown>> = [];
  const testConfig: Config = {
    ...config,
    auth: { ...config.auth, splitEnabled: true, gmToken: GM_TOKEN, playerToken: PLAYER_TOKEN },
  };
  dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'ledger'),
    client: {
      isConnected: true,
      listTools: (): Promise<unknown[]> => Promise.resolve([]),
      callTool: <T>(): Promise<T> => Promise.reject(new Error('no tool')),
      ...(withMethods
        ? {
            ledger: (action: string, params: Record<string, unknown> = {}): Promise<unknown> => {
              ledgerCalls.push([action, params]);
              return Promise.resolve({ entries: [], chips: {} });
            },
            whisper: (params: { userId: string; name: string; text: string }): Promise<unknown> => {
              whispers.push(params);
              if (params.text === 'fail') return Promise.reject(new Error('Not delivered'));
              return Promise.resolve({ foundry: true, discord: 'queued', entry: null });
            },
          }
        : {}),
    },
  });
  server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', () => resolve()));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    ledgerCalls,
    whispers,
  };
}

function call(
  base: string,
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CoGM-Token': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('secret ledger and whisper routes', () => {
  it('turns a player token away from every route', async () => {
    const { base, ledgerCalls, whispers } = await start();
    for (const [method, path] of [
      ['GET', '/api/ledger'],
      ['POST', '/api/ledger'],
      ['POST', '/api/ledger/known-by'],
      ['POST', '/api/ledger/remove'],
      ['POST', '/api/whisper'],
    ] as const) {
      const res = await call(base, method, path, PLAYER_TOKEN, method === 'POST' ? {} : undefined);
      expect([401, 403], `${method} ${path}`).toContain(res.status);
    }
    expect(ledgerCalls).toEqual([]);
    expect(whispers).toEqual([]);
  });

  it('passes the GM through to the bridge', async () => {
    const { base, ledgerCalls, whispers } = await start();
    expect((await call(base, 'GET', '/api/ledger', GM_TOKEN)).status).toBe(200);
    await call(base, 'POST', '/api/ledger', GM_TOKEN, {
      kind: 'secret',
      text: 'x',
      knownBy: [{ userId: JORR, name: 'Jorr' }],
      pageId: 'pppppppppppppppp',
    });
    await call(base, 'POST', '/api/ledger/remove', GM_TOKEN, { id: 'e1' });
    expect(ledgerCalls.map(c => c[0])).toEqual(['list', 'add', 'remove']);
    const res = await call(base, 'POST', '/api/whisper', GM_TOKEN, {
      userId: JORR,
      name: 'Jorr',
      text: 'Psst',
    });
    expect(await res.json()).toMatchObject({ foundry: true, discord: 'queued' });
    expect(whispers).toEqual([{ userId: JORR, name: 'Jorr', text: 'Psst' }]);
  });

  it('answers a failed whisper with the reason, and an old bridge with 503', async () => {
    const first = await start();
    const bad = await call(first.base, 'POST', '/api/whisper', GM_TOKEN, {
      userId: JORR,
      name: 'Jorr',
      text: 'fail',
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Not delivered' });
    dashboard?.close();
    await new Promise<void>(resolve => server!.close(() => resolve()));
    const old = await start(false);
    expect((await call(old.base, 'GET', '/api/ledger', GM_TOKEN)).status).toBe(503);
    expect((await call(old.base, 'POST', '/api/whisper', GM_TOKEN, {})).status).toBe(503);
  });
});
