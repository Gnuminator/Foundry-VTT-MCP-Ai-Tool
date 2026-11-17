/**
 * "Who uses what" (D-146) in the real app: the report route is GM only, answers 501 from an old
 * bridge and 502 when the bridge fails; the Obsidian plugin's version header is forwarded to the
 * bridge for a GM request only, with the install id kept only when it is 12 hex characters.
 */
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-for-the-who-test';
const PLAYER_TOKEN = 'player-token-for-the-who-test';
const AUTH: AuthConfig = {
  ...config.auth,
  splitEnabled: true,
  gmToken: GM_TOKEN,
  playerToken: PLAYER_TOKEN,
  gmEmails: [],
};

const REPORT = { schema: 1, people: [{ key: 'u1', role: 'player', calls: 3 }] };

interface Bridge {
  isConnected: boolean;
  listTools: () => Promise<unknown[]>;
  callTool: <T>(name: string) => Promise<T>;
  whoUsesWhat?: (days: number) => Promise<unknown>;
  recordClient?: (entry: Record<string, unknown>) => Promise<unknown>;
}
const baseBridge = (): Bridge => ({
  isConnected: true,
  listTools: () => Promise.resolve([]),
  callTool: <T>() => Promise.resolve({} as T),
});

interface Harness {
  port: number;
  dashboard: Dashboard;
  close(): Promise<void>;
}
const running: Harness[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map(h => h.close()));
});

async function start(bridge: Bridge): Promise<Harness> {
  const testConfig: Config = {
    ...config,
    host: '127.0.0.1',
    allowedHosts: parseAllowedHosts(''),
    stateDir: '',
    auth: AUTH,
  };
  const dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'who-test'),
    client: bridge,
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

const get = (
  h: Harness,
  path: string,
  token?: string,
  headers: Record<string, string> = {}
): Promise<Response> =>
  fetch(`http://127.0.0.1:${h.port}${path}`, {
    headers: { ...(token ? { 'x-cogm-token': token } : {}), ...headers },
  });

describe('GET /api/who-uses-what', () => {
  it('serves the GM the bridge report and refuses a player and an anonymous caller', async () => {
    const whoUsesWhat = vi.fn(() => Promise.resolve(REPORT));
    const h = await start({ ...baseBridge(), whoUsesWhat });

    const gm = await get(h, '/api/who-uses-what?days=3', GM_TOKEN);
    expect(gm.status).toBe(200);
    expect(await gm.json()).toEqual(REPORT);
    expect(whoUsesWhat).toHaveBeenCalledWith(3);

    expect((await get(h, '/api/who-uses-what', PLAYER_TOKEN)).status).toBe(403);
    expect([401, 403]).toContain((await get(h, '/api/who-uses-what')).status);
    expect(whoUsesWhat).toHaveBeenCalledTimes(1);
  });

  it('asks for a week without a usable days value', async () => {
    const whoUsesWhat = vi.fn(() => Promise.resolve(REPORT));
    const h = await start({ ...baseBridge(), whoUsesWhat });
    await get(h, '/api/who-uses-what?days=abc', GM_TOKEN);
    expect(whoUsesWhat).toHaveBeenLastCalledWith(7);
  });

  it('answers 501 from a bridge that cannot build it and 502 when the bridge fails', async () => {
    const old = await start(baseBridge());
    expect((await get(old, '/api/who-uses-what', GM_TOKEN)).status).toBe(501);

    const failing = await start({
      ...baseBridge(),
      whoUsesWhat: () => Promise.reject(new Error('socket closed: secret detail')),
    });
    const res = await get(failing, '/api/who-uses-what', GM_TOKEN);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('secret detail');
  });
});

describe('the Obsidian version header', () => {
  const header = { 'x-foundry-client': 'obsidian/0.29.1' };

  it('is forwarded for a GM request, the install id only when it is 12 hex characters', async () => {
    const recordClient = vi.fn(() => Promise.resolve({ ok: true }));
    const h = await start({ ...baseBridge(), recordClient });
    await get(h, '/api/state', GM_TOKEN, { ...header, 'x-foundry-install': 'abc123abc123' });
    await get(h, '/api/state', GM_TOKEN, { ...header, 'x-foundry-install': 'not hex at all' });
    expect(recordClient).toHaveBeenNthCalledWith(1, {
      piece: 'obsidian',
      who: 'gm',
      install: 'abc123abc123',
      version: '0.29.1',
    });
    expect(recordClient).toHaveBeenNthCalledWith(2, {
      piece: 'obsidian',
      who: 'gm',
      install: '',
      version: '0.29.1',
    });
  });

  it('is not forwarded for a player request', async () => {
    const recordClient = vi.fn(() => Promise.resolve({ ok: true }));
    const h = await start({ ...baseBridge(), recordClient });
    await get(h, '/api/state', PLAYER_TOKEN, header);
    expect(recordClient).not.toHaveBeenCalled();
  });
});
