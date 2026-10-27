/**
 * The stream status in the real app: `lastPollAt` follows each poll (onPoll) in /api/state,
 * without a `status` broadcast per poll.
 */
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-for-the-status-poll-test';
const AUTH: AuthConfig = {
  ...config.auth,
  splitEnabled: true,
  gmToken: GM_TOKEN,
  playerToken: 'player-token-for-the-status-poll-test',
  gmEmails: [],
};

const fakeBridge = {
  isConnected: true,
  listTools: (): Promise<unknown[]> => Promise.resolve([]),
  callTool: <T>(): Promise<T> => Promise.resolve({} as T),
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
  close(): Promise<void>;
}
const running: Harness[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map(h => h.close()));
});

async function start(): Promise<Harness> {
  const testConfig: Config = {
    ...config,
    host: '127.0.0.1',
    allowedHosts: parseAllowedHosts(''),
    stateDir: '',
    auth: AUTH,
  };
  const dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'status-poll-test'),
    client: fakeBridge,
    coGm: fakeCoGm,
  });
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const harness: Harness = {
    port: (server.address() as AddressInfo).port,
    dashboard,
    close: () =>
      new Promise<void>(resolve => {
        dashboard.close();
        server.close(() => resolve());
      }),
  };
  running.push(harness);
  return harness;
}

async function lastPollAt(h: Harness): Promise<string | null> {
  const res = await fetch(`http://127.0.0.1:${h.port}/api/state`, {
    headers: { 'x-cogm-token': GM_TOKEN },
  });
  return ((await res.json()) as { status: { lastPollAt: string | null } }).status.lastPollAt;
}

describe('status lastPollAt in /api/state', () => {
  it('moves with each poll while the published status stays the same', async () => {
    const h = await start();
    expect(await lastPollAt(h)).toBeNull();
    h.dashboard.handlers.onPoll?.('2026-10-27T10:00:00.000Z');
    expect(await lastPollAt(h)).toBe('2026-10-27T10:00:00.000Z');
    h.dashboard.handlers.onPoll?.('2026-10-27T10:00:05.000Z');
    expect(await lastPollAt(h)).toBe('2026-10-27T10:00:05.000Z');
  });
});
