/**
 * I-039 seen log: POST /api/player/handout-seen forwards a known player's first open to the
 * bridge, refuses unknown players and bad ids, and tells the GM's drawer to refresh.
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { Logger } from './logger.js';

const PLAYER_TOKEN = 'player-token-seen';
const ANNA = 'aaaaaaaaaaaaaaaa';
const PAGE = 'pppppppppppppppp';

let dashboard: Dashboard | null = null;
let server: Server | null = null;

afterEach(async () => {
  dashboard?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  dashboard = null;
  server = null;
});

async function start(opts: { withMethod?: boolean } = {}): Promise<{
  base: string;
  calls: Array<[string, string, string]>;
}> {
  const calls: Array<[string, string, string]> = [];
  const testConfig: Config = {
    ...config,
    auth: {
      ...config.auth,
      splitEnabled: true,
      gmToken: 'gm-token-seen',
      playerToken: PLAYER_TOKEN,
    },
  };
  dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'handout-seen'),
    client: {
      isConnected: true,
      listTools: (): Promise<unknown[]> => Promise.resolve([]),
      callTool: <T>(name: string): Promise<T> =>
        name === 'get-world-info'
          ? Promise.resolve({
              id: 'w1',
              title: 'World',
              playerUsers: [
                { id: ANNA, name: 'Anna', isGM: false },
                { id: 'gggggggggggggggg', name: 'GM', isGM: true },
              ],
            } as T)
          : Promise.reject(new Error(`unknown tool ${name}`)),
      ...(opts.withMethod === false
        ? {}
        : {
            recordHandoutSeen: (
              pageId: string,
              userId: string,
              name: string
            ): Promise<{ recorded: boolean }> => {
              calls.push([pageId, userId, name]);
              return Promise.resolve({ recorded: true });
            },
          }),
    },
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
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls };
}

function post(base: string, body: unknown, token = PLAYER_TOKEN): Promise<Response> {
  return fetch(`${base}/api/player/handout-seen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CoGM-Token': token },
    body: JSON.stringify(body),
  });
}

describe('POST /api/player/handout-seen', () => {
  it('forwards a known player with the name the dashboard knows, not a claimed one', async () => {
    const { base, calls } = await start();
    const res = await post(base, { handoutId: PAGE, userId: ANNA, name: 'Someone else' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: true });
    expect(calls).toEqual([[PAGE, ANNA, 'Anna']]);
  });

  it('refuses an unknown user, a GM and a bad handout id', async () => {
    const { base, calls } = await start();
    expect((await post(base, { handoutId: PAGE, userId: 'zzzzzzzzzzzzzzzz' })).status).toBe(400);
    expect((await post(base, { handoutId: PAGE, userId: 'gggggggggggggggg' })).status).toBe(400);
    expect((await post(base, { handoutId: '../x', userId: ANNA })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('needs a token', async () => {
    const { base } = await start();
    expect((await post(base, { handoutId: PAGE, userId: ANNA }, 'wrong')).status).toBe(401);
  });

  it('answers recorded: false with an older bridge client', async () => {
    const { base } = await start({ withMethod: false });
    const res = await post(base, { handoutId: PAGE, userId: ANNA });
    expect(await res.json()).toEqual({ recorded: false });
  });
});
