/**
 * "Post to chat" from the dashboard is always a whisper to the GMs, also when no GM is logged in
 * (the dashboard's GM names come from the logged-in users only) or the world info is missing. A
 * public post would show Co-GM notes to every player.
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-post-chat';

let dashboard: Dashboard | null = null;
let server: Server | null = null;

afterEach(async () => {
  dashboard?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  dashboard = null;
  server = null;
});

/** A dashboard whose world has these logged-in users (null: world info fails). */
async function start(
  activeUsers: Array<{ name: string; isGM: boolean }> | null
): Promise<{ base: string; sent: Array<Record<string, unknown>> }> {
  const sent: Array<Record<string, unknown>> = [];
  const client = {
    isConnected: true,
    listTools: (): Promise<unknown[]> => Promise.resolve([]),
    callTool: <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
      if (name === 'get-world-info') {
        return activeUsers === null
          ? Promise.reject(new Error('Foundry not connected'))
          : Promise.resolve({
              id: 'w1',
              title: 'World',
              system: { id: 'dnd5e', version: '6.0.5' },
              foundry: { version: '14.368' },
              activeUsers,
            } as T);
      }
      if (name === 'check-secret-terms') return Promise.resolve({ matches: [] } as T);
      if (name === 'send-chat-message') {
        sent.push(args);
        return Promise.resolve({ ok: true } as T);
      }
      return Promise.reject(new Error(`unknown tool ${name}`));
    },
  };
  const testConfig: Config = {
    ...config,
    auth: { ...config.auth, splitEnabled: true, gmToken: GM_TOKEN, playerToken: '' },
  };
  dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'post-chat'),
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
  await new Promise(resolve => setTimeout(resolve, 200)); // world info arrives asynchronously
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, sent };
}

async function post(base: string): Promise<Response> {
  return fetch(`${base}/api/post-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CoGM-Token': GM_TOKEN },
    body: JSON.stringify({ text: 'The innkeeper lies.' }),
  });
}

describe('post to chat', () => {
  it('whispers to the logged-in GMs by name', async () => {
    const { base, sent } = await start([
      { name: 'Gamemaster', isGM: true },
      { name: 'Player', isGM: false },
    ]);
    expect((await post(base)).status).toBe(200);
    expect(sent).toEqual([
      expect.objectContaining({ messageType: 'whisper', whisperTargets: ['Gamemaster'] }),
    ]);
  });

  it('still whispers when no GM is logged in (the module then picks every GM user)', async () => {
    const { base, sent } = await start([{ name: 'Player', isGM: false }]);
    expect((await post(base)).status).toBe(200);
    expect(sent).toEqual([expect.objectContaining({ messageType: 'whisper', whisperTargets: [] })]);
  });

  it('still whispers when the world info is missing', async () => {
    const { base, sent } = await start(null);
    expect((await post(base)).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.messageType).toBe('whisper');
  });
});
