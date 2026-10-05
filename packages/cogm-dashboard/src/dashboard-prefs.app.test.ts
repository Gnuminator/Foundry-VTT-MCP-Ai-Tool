/**
 * The GM's screen choices in the real app (D-092, I-107): `set-prefs` on /api/control is GM
 * only, checks its value, needs a known world, and its `prefs` event goes to the GM stream
 * only, never to the players' stream.
 */
import * as http from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-for-the-prefs-test';
const PLAYER_TOKEN = 'player-token-for-the-prefs-test';
const AUTH: AuthConfig = {
  ...config.auth,
  splitEnabled: true,
  gmToken: GM_TOKEN,
  playerToken: PLAYER_TOKEN,
  gmEmails: [],
};

const fakeBridge = {
  isConnected: true,
  listTools: (): Promise<unknown[]> => Promise.resolve([]),
  callTool: <T>(name: string): Promise<T> =>
    Promise.resolve(
      (name === 'get-world-info' ? { id: 'prefs-world', title: 'Prefs world' } : {}) as T
    ),
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
const streams: http.ClientRequest[] = [];

afterEach(async () => {
  for (const s of streams.splice(0)) s.destroy();
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
    logger: new Logger('error', 'prefs-test'),
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

/** Foundry becomes reachable, so the app loads the world (get-world-info). */
async function loadWorld(h: Harness): Promise<void> {
  h.dashboard.handlers.onStatus({
    controlChannel: 'connected',
    foundry: 'reachable',
    lastError: null,
    lastPollAt: null,
    foundryDownSince: null,
  });
  await new Promise(resolve => setTimeout(resolve, 30));
}

async function setPrefs(
  h: Harness,
  token: string | null,
  value: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${h.port}/api/control`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-cogm-token': token } : {}),
    },
    body: JSON.stringify({ action: 'set-prefs', value }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Everything a stream sends, collected as text while the test runs. */
function listen(h: Harness, path: string, token: string): { text: () => string } {
  let text = '';
  const req = http.get(
    { host: '127.0.0.1', port: h.port, path, headers: { 'x-cogm-token': token }, agent: false },
    res => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        text += chunk;
      });
    }
  );
  req.on('error', () => undefined);
  streams.push(req);
  return { text: () => text };
}

describe('set-prefs on /api/control', () => {
  it('is for the GM only', async () => {
    const h = await start();
    await loadWorld(h);
    expect((await setPrefs(h, PLAYER_TOKEN, { duringLayout: 'auto' })).status).toBe(403);
    expect((await setPrefs(h, null, { duringLayout: 'auto' })).status).toBe(401);
  });

  it('refuses a value without a known screen choice', async () => {
    const h = await start();
    await loadWorld(h);
    expect((await setPrefs(h, GM_TOKEN, { duringLayout: 'grid' })).status).toBe(400);
    expect((await setPrefs(h, GM_TOKEN, 'auto')).status).toBe(400);
  });

  it('waits for the world', async () => {
    const h = await start();
    expect((await setPrefs(h, GM_TOKEN, { duringLayout: 'auto' })).status).toBe(409);
  });

  it('saves for the GM and tells the GM stream only', async () => {
    const h = await start();
    await loadWorld(h);
    const gm = listen(h, '/api/stream', GM_TOKEN);
    const player = listen(h, '/api/player/stream', PLAYER_TOKEN);
    await new Promise(resolve => setTimeout(resolve, 50));

    const answer = await setPrefs(h, GM_TOKEN, { duringLayout: 'toggle', combatButtons: true });
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ duringLayout: 'toggle', combatButtons: true });
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(gm.text()).toContain('event: prefs');
    expect(gm.text()).toContain('"duringLayout":"toggle"');
    expect(player.text()).not.toContain('event: prefs');
    expect(player.text()).not.toContain('duringLayout');
  });
});
