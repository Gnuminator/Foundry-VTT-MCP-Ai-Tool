// Roll requests on the streams (item roll-status-player-push): the player stream carries the open
// requests with the player each is for (no totals), the GM stream carries every request with its
// status and total, and a request disappears from the player stream once the character rolled.
import * as http from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import type { BridgeStatus, SessionEvent } from './feed/types.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-for-the-stream-rolls-test';
const PLAYER_TOKEN = 'player-token-for-the-stream-rolls-test';
const AUTH: AuthConfig = {
  ...config.auth,
  splitEnabled: true,
  gmToken: GM_TOKEN,
  playerToken: PLAYER_TOKEN,
  gmEmails: [],
};

const PLAYER_ID = 'aaaaaaaaaaaaaaaa';
const GM_ID = 'gggggggggggggggg';

const WORLD_INFO = {
  id: 'test-world',
  title: 'Test',
  system: 'dnd5e',
  playerUsers: [
    { id: PLAYER_ID, name: 'Tom', isGM: false },
    { id: GM_ID, name: 'Danni', isGM: true },
  ],
};

const fakeBridge = {
  isConnected: true,
  listTools: (): Promise<unknown[]> => Promise.resolve([]),
  callTool: <T>(name: string): Promise<T> =>
    Promise.resolve((name === 'get-world-info' ? WORLD_INFO : {}) as T),
};

const fakeCoGm = {
  enabled: false,
  isBusy: false,
  setWorld: (): void => undefined,
  abortActive: (): void => undefined,
  notifyCombatChange: (): void => undefined,
} as unknown as CoGm;

const REACHABLE: BridgeStatus = {
  controlChannel: 'connected',
  foundry: 'reachable',
  lastError: null,
  lastPollAt: null,
  foundryDownSince: null,
};

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
    logger: new Logger('error', 'stream-rolls-test'),
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
  // The world load teaches the dashboard who the players are.
  dashboard.handlers.onStatus(REACHABLE);
  await new Promise(resolve => setTimeout(resolve, 50));
  return harness;
}

const SNAPSHOT_END: Record<string, string> = {
  '/api/stream': 'event: errors',
  '/api/player/stream': 'event: theme',
};

function listen(
  h: Harness,
  path: string,
  token: string
): { text: () => string; ready: Promise<void> } {
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
  return {
    text: () => text,
    ready: vi.waitFor(() => expect(text).toContain(SNAPSHOT_END[path]), { timeout: 5000 }),
  };
}

let n = 0;
function event(eventType: string, actorId: string, details: Record<string, unknown>): SessionEvent {
  n += 1;
  const now = Date.now();
  return {
    id: `ev${n}`,
    timestamp: new Date(now).toISOString(),
    timestampMs: now + n,
    eventType,
    actorName: 'Brenna',
    actorId,
    description: `${eventType} ${n}`,
    details,
  };
}

const REQUEST = (): SessionEvent =>
  event('roll-request', 'actor1', {
    label: 'Perception Skill Check',
    isPublic: true,
    targetName: 'Tom',
    targetUserId: PLAYER_ID,
    whisperTo: [],
  });

/** The last `rolls` payload in a stream's text. */
function lastRolls(
  text: string
): { open?: unknown[]; rows?: Array<Record<string, unknown>> } | null {
  const hits = [...text.matchAll(/event: rolls\ndata: (.*)\n/g)];
  const last = hits[hits.length - 1];
  return last ? (JSON.parse(last[1] ?? 'null') as never) : null;
}

describe('roll requests on the streams', () => {
  it('push a request to a player stream that is already open, with the player it is for', async () => {
    const h = await start();
    const player = listen(h, '/api/player/stream', PLAYER_TOKEN);
    await player.ready;
    expect(lastRolls(player.text())?.open).toEqual([]);

    h.dashboard.handlers.onEvents([REQUEST()], { initial: false });
    await vi.waitFor(() => expect(lastRolls(player.text())?.open).toHaveLength(1), {
      timeout: 2000,
    });
    expect(lastRolls(player.text())?.open?.[0]).toMatchObject({
      label: 'Perception Skill Check',
      userId: PLAYER_ID,
    });
  });

  it('tell the GM who has rolled, and take the request off the player stream', async () => {
    const h = await start();
    const gm = listen(h, '/api/stream', GM_TOKEN);
    const player = listen(h, '/api/player/stream', PLAYER_TOKEN);
    await Promise.all([gm.ready, player.ready]);

    h.dashboard.handlers.onEvents([REQUEST()], { initial: false });
    await vi.waitFor(() => expect(lastRolls(gm.text())?.rows?.[0]?.['status']).toBe('sent'), {
      timeout: 2000,
    });

    h.dashboard.handlers.onEvents([event('roll', 'actor1', { rollType: 'skill', total: 17 })], {
      initial: false,
    });
    await vi.waitFor(
      () => expect(lastRolls(gm.text())?.rows?.[0]).toMatchObject({ status: 'rolled', total: 17 }),
      {
        timeout: 2000,
      }
    );
    await vi.waitFor(() => expect(lastRolls(player.text())?.open).toEqual([]), { timeout: 2000 });
    // The total is the GM's: the player stream never carries it.
    expect(player.text()).not.toContain('"total":17');
  });

  it('never put rolls on the GM stream for a player, nor rows on the player stream', async () => {
    const h = await start();
    const player = listen(h, '/api/player/stream', PLAYER_TOKEN);
    await player.ready;
    h.dashboard.handlers.onEvents([REQUEST()], { initial: false });
    await vi.waitFor(() => expect(lastRolls(player.text())?.open).toHaveLength(1), {
      timeout: 2000,
    });
    expect(player.text()).not.toContain('"rows"');
  });
});
