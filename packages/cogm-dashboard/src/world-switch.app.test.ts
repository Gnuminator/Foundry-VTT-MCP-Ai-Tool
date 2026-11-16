// A world switch (Foundry drops and comes back on another world): the events and module errors of
// the old world must not stay on the GM screen or the /player page, and the feed reads the new
// world again from the start.
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import type { BridgeStatus, ModuleError, SessionEvent } from './feed/types.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-for-the-world-switch-test';
const PLAYER_TOKEN = 'player-token-for-the-world-switch-test';
const AUTH: AuthConfig = {
  ...config.auth,
  splitEnabled: true,
  gmToken: GM_TOKEN,
  playerToken: PLAYER_TOKEN,
  gmEmails: [],
};

const REACHABLE: BridgeStatus = {
  controlChannel: 'connected',
  foundry: 'reachable',
  lastError: null,
  lastPollAt: null,
  foundryDownSince: null,
};
const DOWN: BridgeStatus = { ...REACHABLE, foundry: 'unreachable' };

const event = (id: string): SessionEvent =>
  ({ id, timestampMs: 1, timestamp: '2026-01-01T00:00:00Z', type: 'damage' }) as SessionEvent;
const moduleError = (id: string): ModuleError =>
  ({
    id,
    timestampMs: 1,
    timestamp: '2026-01-01T00:00:00Z',
    level: 'error',
    message: 'x',
  }) as ModuleError;

const running: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map(close => close()));
});

async function start(
  worlds: string[]
): Promise<{ dashboard: Dashboard; port: number; worldReads: () => number }> {
  let call = 0;
  const bridge = {
    isConnected: true,
    listTools: (): Promise<unknown[]> => Promise.resolve([]),
    callTool: <T>(name: string): Promise<T> =>
      Promise.resolve(
        (name === 'get-world-info'
          ? { id: worlds[Math.min(call++, worlds.length - 1)], title: 'W', system: { id: 'dnd5e' } }
          : {}) as T
      ),
  };
  const testConfig: Config = {
    ...config,
    host: '127.0.0.1',
    allowedHosts: parseAllowedHosts(''),
    stateDir: '',
    auth: AUTH,
  };
  const dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'world-switch-test'),
    client: bridge,
  });
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  running.push(
    () =>
      new Promise<void>(resolve => {
        dashboard.close();
        server.close(() => resolve());
      })
  );
  return { dashboard, port: (server.address() as AddressInfo).port, worldReads: () => call };
}

interface Page {
  events: unknown[];
  errors: unknown[];
  world: unknown;
}

async function read(port: number, path: string, token: string): Promise<Page> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { 'x-cogm-token': token },
  });
  return (await res.json()) as Page;
}

async function switchTo(d: Dashboard): Promise<void> {
  d.handlers.onStatus(DOWN);
  d.handlers.onStatus(REACHABLE);
}

describe('a world switch', () => {
  it('empties the events and errors on the GM and player pages and asks the feed to read again', async () => {
    const { dashboard, port } = await start(['world-a', 'world-b']);
    const resync = vi.fn();
    dashboard.onFeed({ pollNow: () => undefined, resync });

    dashboard.handlers.onStatus(REACHABLE);
    await vi.waitFor(async () => {
      dashboard.handlers.onEvents([event('e1')], { initial: true });
      const player = await read(port, '/api/player/state', PLAYER_TOKEN);
      expect(player.world).toBeTruthy();
      expect((await read(port, '/api/state', GM_TOKEN)).events).toHaveLength(1);
    });
    dashboard.handlers.onErrors([moduleError('d1')], { initial: true });
    expect((await read(port, '/api/state', GM_TOKEN)).errors).toHaveLength(1);

    await switchTo(dashboard);

    await vi.waitFor(async () => {
      expect((await read(port, '/api/player/state', PLAYER_TOKEN)).events).toHaveLength(0);
    });
    const gm = await read(port, '/api/state', GM_TOKEN);
    expect(gm.events).toHaveLength(0);
    expect(gm.errors).toHaveLength(0);
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it('keeps everything when the same world comes back after a drop', async () => {
    const { dashboard, port, worldReads } = await start(['world-a']);
    const resync = vi.fn();
    dashboard.onFeed({ pollNow: () => undefined, resync });

    dashboard.handlers.onStatus(REACHABLE);
    await vi.waitFor(async () => {
      dashboard.handlers.onEvents([event('e1')], { initial: true });
      const player = await read(port, '/api/player/state', PLAYER_TOKEN);
      expect(player.world).toBeTruthy();
      expect((await read(port, '/api/state', GM_TOKEN)).events).toHaveLength(1);
    });

    // The negative check needs the world read after the drop to have been answered: wait for
    // the read, then one turn of the event loop for its answer to be handled.
    const readsBefore = worldReads();
    await switchTo(dashboard);
    await vi.waitFor(() => expect(worldReads()).toBeGreaterThan(readsBefore));
    await new Promise(resolve => setImmediate(resolve));

    expect((await read(port, '/api/state', GM_TOKEN)).events).toHaveLength(1);
    expect(resync).not.toHaveBeenCalled();
  });
});
