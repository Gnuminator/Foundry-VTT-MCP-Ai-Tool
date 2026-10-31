/**
 * The read cache in the real app (I-098): a second get-play-stats inside the window comes from the
 * cache, and a play-session mark or a new game event empties it.
 */
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import type { SessionEvent } from './feed/types.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-for-the-read-cache-test';
const AUTH: AuthConfig = {
  ...config.auth,
  splitEnabled: true,
  gmToken: GM_TOKEN,
  playerToken: 'player-token-for-the-read-cache-test',
  gmEmails: [],
};

const fakeCoGm = {
  enabled: false,
  isBusy: false,
  setWorld: (): void => undefined,
  abortActive: (): void => undefined,
} as unknown as CoGm;

interface Harness {
  port: number;
  dashboard: Dashboard;
  calls: string[];
  close(): Promise<void>;
}
const running: Harness[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map(h => h.close()));
});

async function start(): Promise<Harness> {
  const calls: string[] = [];
  const testConfig: Config = {
    ...config,
    host: '127.0.0.1',
    allowedHosts: parseAllowedHosts(''),
    stateDir: '',
    auth: AUTH,
  };
  const dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'read-cache-test'),
    client: {
      isConnected: true,
      listTools: (): Promise<unknown[]> => Promise.resolve([]),
      callTool: <T>(name: string): Promise<T> => {
        calls.push(name);
        return Promise.resolve({} as T);
      },
    },
    coGm: fakeCoGm,
  });
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const harness: Harness = {
    port: (server.address() as AddressInfo).port,
    dashboard,
    calls,
    close: () =>
      new Promise<void>(resolve => {
        dashboard.close();
        server.close(() => resolve());
      }),
  };
  running.push(harness);
  return harness;
}

async function tool(h: Harness, name: string, args: Record<string, unknown> = {}): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${h.port}/api/tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cogm-token': GM_TOKEN },
    body: JSON.stringify({ name, args }),
  });
  expect(res.status).toBe(200);
}

const stats = (h: Harness): Promise<void> => tool(h, 'get-play-stats', { session: 'latest' });
const countOf = (h: Harness, name: string): number => h.calls.filter(c => c === name).length;

const event: SessionEvent = {
  id: 'e1',
  timestamp: '2026-10-30T20:00:00.000Z',
  timestampMs: Date.parse('2026-10-30T20:00:00.000Z'),
  eventType: 'damage',
  actorName: null,
  actorId: null,
  description: 'Ilvara took 4 damage',
  details: { amount: 4 },
};

describe('read cache in /api/tool', () => {
  it('serves a second get-play-stats from the cache', async () => {
    const h = await start();
    await stats(h);
    await stats(h);
    expect(countOf(h, 'get-play-stats')).toBe(1);
  });

  it('never caches the lists that show write results', async () => {
    const h = await start();
    await tool(h, 'list-recent-changes', { limit: 20 });
    await tool(h, 'list-recent-changes', { limit: 20 });
    expect(countOf(h, 'list-recent-changes')).toBe(2);
  });

  it('asks again after a play-session mark', async () => {
    const h = await start();
    await stats(h);
    await tool(h, 'mark-play-session', { action: 'start' });
    await stats(h);
    expect(countOf(h, 'get-play-stats')).toBe(2);
  });

  it('asks again after a new game event', async () => {
    const h = await start();
    await stats(h);
    h.dashboard.handlers.onEvents?.([event], { initial: false });
    await stats(h);
    expect(countOf(h, 'get-play-stats')).toBe(2);
  });
});
