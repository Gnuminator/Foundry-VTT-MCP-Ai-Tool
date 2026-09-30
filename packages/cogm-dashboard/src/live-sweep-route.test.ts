/**
 * The live write sweep's helper route (I-016): GM only, refused while GM Actions are off,
 * and it hands the run start to the bridge's `live_sweep` control method.
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-sweep';

let dashboard: Dashboard | null = null;
let server: Server | null = null;

afterEach(async () => {
  dashboard?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  dashboard = null;
  server = null;
});

async function start(
  withCleanup: boolean
): Promise<{ base: string; calls: Array<Record<string, unknown>> }> {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    isConnected: true,
    listTools: (): Promise<unknown[]> => Promise.resolve([]),
    callTool: <T>(): Promise<T> => Promise.reject(new Error('no tools here')),
    ...(withCleanup
      ? {
          liveSweep: (request: Record<string, unknown>): Promise<unknown> => {
            calls.push(request);
            return Promise.resolve({ world: 'ai-tool-test', deleted: { actors: 2 }, names: [] });
          },
        }
      : {}),
  };
  const testConfig: Config = {
    ...config,
    auth: { ...config.auth, splitEnabled: true, gmToken: GM_TOKEN, playerToken: '' },
  };
  dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'live-sweep'),
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
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, calls };
}

function post(base: string, path: string, body: unknown, token = GM_TOKEN): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CoGM-Token': token },
    body: JSON.stringify(body),
  });
}

describe('POST /api/test/live-sweep (I-016)', () => {
  it('needs the GM token', async () => {
    const { base, calls } = await start(true);
    const res = await post(base, '/api/test/live-sweep', { since: 5 }, 'wrong');
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(calls).toEqual([]);
  });

  it('is refused while GM Actions are off', async () => {
    const { base, calls } = await start(true);
    const res = await post(base, '/api/test/live-sweep', { since: 5 });
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('passes the run start to the bridge and returns its result', async () => {
    const { base, calls } = await start(true);
    await post(base, '/api/control', { action: 'set-gm-actions', value: true });
    const res = await post(base, '/api/test/live-sweep', { since: 1234 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, result: { deleted: { actors: 2 } } });
    expect(calls).toEqual([{ mode: 'cleanup', since: 1234 }]);
  });

  it('answers 501 when the bridge cannot clean up', async () => {
    const { base } = await start(false);
    await post(base, '/api/control', { action: 'set-gm-actions', value: true });
    const res = await post(base, '/api/test/live-sweep', {});
    expect(res.status).toBe(501);
  });
});
