/**
 * The health line's server side (item gm-health-line): /api/health carries the Foundry state, and
 * the GM stream repeats the status on a timer so the page's watchdog can tell quiet from dead.
 */
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-for-the-health-heartbeat-test';
const AUTH: AuthConfig = {
  ...config.auth,
  splitEnabled: true,
  gmToken: GM_TOKEN,
  playerToken: 'player-token-for-the-health-heartbeat-test',
  gmEmails: [],
};

const fakeBridge = {
  isConnected: true,
  listTools: (): Promise<unknown[]> => Promise.resolve([]),
  callTool: <T>(): Promise<T> => Promise.resolve({} as T),
};

interface Harness {
  port: number;
  dashboard: Dashboard;
  close(): Promise<void>;
}
const running: Harness[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map(h => h.close()));
});

async function start(statusHeartbeatMs: number): Promise<Harness> {
  const testConfig: Config = {
    ...config,
    host: '127.0.0.1',
    allowedHosts: parseAllowedHosts(''),
    stateDir: '',
    auth: AUTH,
  };
  const dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'health-heartbeat-test'),
    client: fakeBridge,
    statusHeartbeatMs,
  });
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  dashboard.start();
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

describe('/api/health', () => {
  it('carries the Foundry state, the last poll and the down-since time', async () => {
    const h = await start(60_000);
    h.dashboard.handlers.onStatus?.({
      controlChannel: 'connected',
      foundry: 'unreachable',
      lastError: null,
      lastPollAt: null,
      foundryDownSince: '2026-11-05T20:14:00.000Z',
    });
    h.dashboard.handlers.onPoll?.('2026-11-05T20:15:00.000Z');
    const res = await fetch(`http://127.0.0.1:${h.port}/api/health`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      controlChannel: 'connected',
      foundry: 'unreachable',
      lastPollAt: '2026-11-05T20:15:00.000Z',
      foundryDownSince: '2026-11-05T20:14:00.000Z',
    });
  });
});

describe('status heartbeat', () => {
  it('repeats the status on the GM stream without any change', async () => {
    const h = await start(40);
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${h.port}/api/stream`, {
      headers: { 'x-cogm-token': GM_TOKEN },
      signal: ctrl.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (text.match(/event: status/g) ?? []).length < 3) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    ctrl.abort();
    // One on connect, then at least two from the timer.
    expect((text.match(/event: status/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
