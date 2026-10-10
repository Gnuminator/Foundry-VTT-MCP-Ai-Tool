// What a GM stream says about the fight when it connects (the combat strip's reconnect case): the
// current fight, or `{combat: null}` when none runs. Without the null, a page that was
// disconnected while a fight ended kept showing it as live after the stream came back.
import * as http from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import type { CombatState } from './feed/types.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-for-the-stream-combat-test';
const PLAYER_TOKEN = 'player-token-for-the-stream-combat-test';
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
  notifyCombatChange: (): void => undefined,
} as unknown as CoGm;

const FIGHT: CombatState = {
  active: true,
  round: 2,
  turn: 0,
  current: null,
  combatants: [],
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
    logger: new Logger('error', 'stream-combat-test'),
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

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 60));

describe('the fight on a GM stream that connects', () => {
  it('is null when no fight runs, so a page that missed the end clears its strip', async () => {
    const h = await start();
    const gm = listen(h, '/api/stream', GM_TOKEN);
    await settle();
    expect(gm.text()).toContain('event: combat\ndata: {"combat":null}');
  });

  it('is the fight when one runs', async () => {
    const h = await start();
    h.dashboard.handlers.onCombat(FIGHT);
    const gm = listen(h, '/api/stream', GM_TOKEN);
    await settle();
    expect(gm.text()).toContain('event: combat');
    expect(gm.text()).toContain('"combat":{"active":true,"round":2');
    expect(gm.text()).not.toContain('{"combat":null}');
  });

  it('is null again for a stream that connects after the fight ended', async () => {
    const h = await start();
    h.dashboard.handlers.onCombat(FIGHT);
    h.dashboard.handlers.onCombat(null);
    const gm = listen(h, '/api/stream', GM_TOKEN);
    await settle();
    expect(gm.text()).toContain('event: combat\ndata: {"combat":null}');
  });

  it('is never sent on the player stream', async () => {
    const h = await start();
    h.dashboard.handlers.onCombat(FIGHT);
    const player = listen(h, '/api/player/stream', PLAYER_TOKEN);
    await settle();
    expect(player.text()).not.toContain('event: combat');
  });
});
