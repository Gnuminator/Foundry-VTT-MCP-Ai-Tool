/**
 * Spotlight balance is GM only (I-177): the GM stream carries the tally, the player stream and
 * the player state never do.
 */
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-for-the-spotlight-test';
const PLAYER_TOKEN = 'player-token-for-the-spotlight-test';
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

const running: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map(h => h.close()));
});

async function start(): Promise<{ port: number; dashboard: Dashboard }> {
  const testConfig: Config = {
    ...config,
    host: '127.0.0.1',
    allowedHosts: parseAllowedHosts(''),
    stateDir: '',
    auth: AUTH,
  };
  const dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'spotlight-test'),
    client: fakeBridge,
  });
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  dashboard.start();
  running.push({
    close: () =>
      new Promise<void>(resolve => {
        dashboard.close();
        server.close(() => resolve());
      }),
  });
  return { port: (server.address() as AddressInfo).port, dashboard };
}

async function readStream(port: number, path: string, token: string, ms: number): Promise<string> {
  const ctrl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { 'x-cogm-token': token },
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

describe('spotlight stream', () => {
  it('sends the tally to the GM stream and nothing to the player stream', async () => {
    const h = await start();
    h.dashboard.handlers.onEvents?.(
      [
        {
          id: 'e1',
          timestamp: '2026-11-18T19:00:00.000Z',
          timestampMs: 1,
          eventType: 'roll',
          actorName: 'Ebbe',
          actorId: 'a1',
          description: 'Ebbe rolled',
          details: {},
          visibility: { subject: 'pc', tokenVisible: true, playerName: 'Ebbe' },
        },
      ],
      { initial: false }
    );
    const gm = await readStream(h.port, '/api/stream', GM_TOKEN, 400);
    expect(gm).toContain('event: spotlight');
    expect(gm).toContain('"name":"Ebbe","actions":1');
    const player = await readStream(h.port, '/api/player/stream', PLAYER_TOKEN, 400);
    expect(player).not.toContain('spotlight');
    expect(player).not.toContain('speaking');
    const state = await fetch(`http://127.0.0.1:${h.port}/api/player/state`, {
      headers: { 'x-cogm-token': PLAYER_TOKEN },
    });
    expect(await state.text()).not.toContain('spotlight');
  });
});
