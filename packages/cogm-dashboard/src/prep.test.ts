/**
 * The Prep drawer (I-045) reads the bridge tool `get-prep-digest` through the generic, GM-only
 * `/api/tool` proxy. No route of its own: these tests pin that the tool counts as a read, that
 * the GM's call reaches the bridge unchanged, and that a player (or no token) never gets it.
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import type { PrepDigest } from '@gnuminator/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { Logger } from './logger.js';
import { classifyTool } from './tool-policy.js';

const GM_TOKEN = 'gm-token-prep';
const PLAYER_TOKEN = 'player-token-prep';

const DIGEST: PrepDigest = {
  schema: 1,
  action: 'summary',
  worldId: 'w',
  computedAt: 1,
  lastSession: null,
  openQuests: null,
  openCampaignParts: null,
  handoutQueue: [],
  bosses: null,
  preflight: null,
  recentChanges: { count: 0, latest: [] },
  tarokka: { hasReading: false },
  warnings: ['Foundry is not connected.'],
};

describe('get-prep-digest policy', () => {
  it('is a read: no GM Actions switch and no confirm', () => {
    expect(classifyTool('get-prep-digest')).toBe('read');
  });
});

describe('POST /api/tool with get-prep-digest', () => {
  let dashboard: Dashboard | null = null;
  let server: Server | null = null;
  const calls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];

  afterEach(async () => {
    dashboard?.close();
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    dashboard = null;
    server = null;
    calls.length = 0;
  });

  async function start(): Promise<string> {
    const testConfig: Config = {
      ...config,
      auth: { ...config.auth, splitEnabled: true, gmToken: GM_TOKEN, playerToken: PLAYER_TOKEN },
    };
    dashboard = createDashboard({
      config: testConfig,
      logger: new Logger('error', 'prep'),
      client: {
        isConnected: true,
        listTools: (): Promise<unknown[]> => Promise.resolve([]),
        callTool: <T>(name: string, args?: Record<string, unknown>): Promise<T> => {
          if (name === 'get-world-info') return Promise.reject(new Error('no world'));
          calls.push({ name, args });
          return Promise.resolve(DIGEST as T);
        },
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
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  function post(
    base: string,
    token: string | null,
    args: Record<string, unknown>
  ): Promise<Response> {
    return fetch(`${base}/api/tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-CoGM-Token': token } : {}),
      },
      body: JSON.stringify({ name: 'get-prep-digest', args }),
    });
  }

  it('passes the GM call through and returns the digest as is', async () => {
    const base = await start();
    const res = await post(base, GM_TOKEN, { action: 'last-session' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; mutates: string; result: PrepDigest };
    expect(body.ok).toBe(true);
    expect(body.mutates).toBe('read');
    expect(body.result).toEqual(DIGEST);
    expect(calls).toEqual([{ name: 'get-prep-digest', args: { action: 'last-session' } }]);
  });

  it('refuses a player and a caller without a token; the bridge is never called', async () => {
    const base = await start();
    for (const token of [PLAYER_TOKEN, null]) {
      const res = await post(base, token, { action: 'summary' });
      expect(res.status).toBeGreaterThanOrEqual(401);
      expect(res.status).toBeLessThan(404);
    }
    expect(calls).toEqual([]);
  });
});
