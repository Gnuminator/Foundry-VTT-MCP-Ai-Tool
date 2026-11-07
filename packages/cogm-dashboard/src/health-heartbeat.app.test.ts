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

async function start(statusHeartbeatMs: number, recordingHealthMs?: number): Promise<Harness> {
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
    ...(recordingHealthMs === undefined ? {} : { recordingHealthMs }),
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

async function readStream(port: number, ms: number): Promise<string> {
  const ctrl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/stream`, {
    headers: { 'x-cogm-token': GM_TOKEN },
    signal: ctrl.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const stop = setTimeout(() => ctrl.abort(), ms);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
  } catch {
    // aborted: the time is up
  }
  clearTimeout(stop);
  return text;
}

describe('status clock', () => {
  it("stamps every status event with the server's clock, for a page whose own clock is off", async () => {
    const h = await start(40);
    const text = await readStream(h.port, 300);
    const data = [...text.matchAll(/event: status\ndata: (.*)\n/g)].map(m => m[1] ?? '');
    expect(data.length).toBeGreaterThan(1);
    for (const line of data) {
      const now = (JSON.parse(line) as { now?: string }).now;
      expect(Date.parse(now ?? '')).not.toBeNaN();
    }
  });
});

describe('recording-health event', () => {
  it('replays on connect and is sent again only when it changes', async () => {
    const h = await start(60_000, 30);
    const text = await readStream(h.port, 500);
    const sent = (text.match(/event: recording-health/g) ?? []).length;
    // On connect, plus at most the first change; the ~15 timer ticks after that find the same
    // dots and stay quiet.
    expect(sent).toBeGreaterThanOrEqual(1);
    expect(sent).toBeLessThanOrEqual(3);
    expect(text).toContain('"playLog"');
  });

  it('starts its timers on start() and clears them on close()', async () => {
    const realSet = global.setInterval;
    const realClear = global.clearInterval;
    const created = new Map<unknown, unknown>();
    const cleared = new Set<unknown>();
    global.setInterval = ((...args: Parameters<typeof setInterval>) => {
      const t = realSet(...args);
      created.set(t, args[1]);
      return t;
    }) as typeof setInterval;
    global.clearInterval = (t): void => {
      cleared.add(t);
      realClear(t);
    };
    try {
      const h = await start(60_000, 30);
      await h.close();
      running.splice(running.indexOf(h), 1);
    } finally {
      global.setInterval = realSet;
      global.clearInterval = realClear;
    }
    const delays = [...created.values()];
    // The heartbeat (60 s) and the recording-health timer (30 ms) were started ...
    expect(delays).toContain(60_000);
    expect(delays).toContain(30);
    // ... and every one of those is cleared, none left running (other timers, such as the control
    // client's 10 s heartbeat, belong to parts this harness does not close).
    const left = [...created.entries()]
      .filter(([t, ms]) => (ms === 60_000 || ms === 30) && !cleared.has(t))
      .map(([, ms]) => ms);
    expect(left).toEqual([]);
  });
});
