/**
 * `GET /api/versions` (I-127): GM only, and off until the GM switches the version tracker on, so a
 * fresh dashboard makes no online lookups. The tracker itself is in versions.test.ts.
 */
import * as http from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';
import { parsePrefsChange } from './dashboard-prefs.js';

const GM_TOKEN = 'gm-token-for-the-versions-test';
const PLAYER_TOKEN = 'player-token-for-the-versions-test';
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
  callTool: <T>(): Promise<T> => Promise.resolve({} as T),
};
const fakeCoGm = {
  enabled: false,
  isBusy: false,
  setWorld: (): void => undefined,
  abortActive: (): void => undefined,
} as unknown as CoGm;

let dashboard: Dashboard | undefined;
let server: http.Server | undefined;

afterEach(async () => {
  dashboard?.close();
  await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
  dashboard = undefined;
  server = undefined;
});

async function start(): Promise<number> {
  const testConfig: Config = {
    ...config,
    host: '127.0.0.1',
    allowedHosts: parseAllowedHosts(''),
    stateDir: '',
    auth: AUTH,
  };
  dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'versions-test'),
    client: fakeBridge,
    coGm: fakeCoGm,
    kitLastRunFile: null,
  });
  server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', () => resolve()));
  return (server.address() as AddressInfo).port;
}

async function get(port: number, token: string | null): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/versions`, {
    headers: token ? { 'x-cogm-token': token } : {},
  });
  return { status: res.status, body: await res.json() };
}

describe('GET /api/versions', () => {
  it('is for the GM only', async () => {
    const port = await start();
    expect((await get(port, null)).status).toBe(401);
    expect((await get(port, PLAYER_TOKEN)).status).toBe(403);
    expect((await get(port, GM_TOKEN)).status).toBe(200);
  });

  it('answers "off" while the switch is off, which is the default', async () => {
    const port = await start();
    expect((await get(port, GM_TOKEN)).body).toEqual({ enabled: false });
  });
});

describe('the versionTracker pref', () => {
  it('is a boolean the prefs route accepts, and nothing else', () => {
    expect(parsePrefsChange({ versionTracker: true })).toEqual({ versionTracker: true });
    expect(parsePrefsChange({ versionTracker: 'yes' })).toBeNull();
  });
});
