/**
 * Dashboard pre-flight (I-068): the bridge checklist plus GM Actions and the /player page, and
 * the GM-only route.
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import type { PreflightChecksResult } from '@gnuminator/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { Logger } from './logger.js';
import { playerTextChunks, runDashboardPreflight } from './preflight.js';

const BRIDGE: PreflightChecksResult = {
  ready: true,
  checks: [{ id: 'foundry-link', label: 'Foundry connected', status: 'ok', detail: 'Connected.' }],
  scan: null,
  bridgeVersion: '0.19.0',
  moduleVersion: '0.19.0',
};

function tools(opts: { bridge?: PreflightChecksResult | Error; secret?: string } = {}): {
  callTool: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
  texts: string[];
} {
  const texts: string[] = [];
  const callTool = <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (name === 'get-preflight') {
      return opts.bridge instanceof Error
        ? Promise.reject(opts.bridge)
        : Promise.resolve((opts.bridge ?? BRIDGE) as T);
    }
    if (name === 'check-secret-terms') {
      const text = String(args.text);
      texts.push(text);
      const hit = opts.secret && text.includes(opts.secret);
      return Promise.resolve({ matches: hit ? [{ category: 'c', term: opts.secret }] : [] } as T);
    }
    return Promise.reject(new Error(`unknown tool ${name}`));
  };
  return { callTool, texts };
}

describe('playerTextChunks', () => {
  it('collects every string and keeps each piece within the 5000-character limit', () => {
    const long = 'x'.repeat(12_000);
    const chunks = playerTextChunks({ a: 'Wolf 1', b: [{ c: long }], n: 3, e: '' });
    expect(chunks.every(c => c.length <= 5000)).toBe(true);
    expect(chunks.join('')).toContain('Wolf 1');
    expect(chunks.join('').replace(/\n/g, '').length).toBe('Wolf 1'.length + long.length);
  });

  it('returns nothing for an empty state', () => {
    expect(playerTextChunks({ combat: null, events: [] })).toEqual([]);
  });
});

describe('runDashboardPreflight', () => {
  it('adds Ready for session and the player page to the bridge checks', async () => {
    const { callTool, texts } = tools();
    const result = await runDashboardPreflight({
      callTool,
      gmActionsEnabled: false,
      sessionSwitches: null,
      playerState: { combat: { combatants: [{ name: 'Wolf 1' }] } },
    });
    expect(result.ready).toBe(true);
    expect(result.checks.map(c => [c.id, c.status])).toEqual([
      ['foundry-link', 'ok'],
      ['ready', 'warn'],
      ['player-page', 'ok'],
    ]);
    expect(texts).toEqual(['Wolf 1']);
    expect(result.moduleVersion).toBe('0.19.0');
  });

  it('fails on a secret term on /player', async () => {
    const { callTool } = tools({ secret: 'Sunsword' });
    const result = await runDashboardPreflight({
      callTool,
      gmActionsEnabled: true,
      sessionSwitches: null,
      playerState: { events: [{ text: 'They found the Sunsword' }] },
    });
    expect(result.ready).toBe(false);
    const byId = Object.fromEntries(result.checks.map(c => [c.id, c]));
    expect(byId['ready']?.status).toBe('ok');
    expect(byId['player-page']?.status).toBe('fail');
    expect(byId['player-page']?.detail).toContain('Sunsword');
  });

  it('never throws when the bridge does not answer; not ready', async () => {
    const { callTool } = tools({ bridge: new Error('Unknown tool: get-preflight') });
    const result = await runDashboardPreflight({
      callTool,
      gmActionsEnabled: false,
      sessionSwitches: null,
      playerState: {},
    });
    expect(result.ready).toBe(false);
    expect(result.checks[0]).toMatchObject({ id: 'bridge-checks', status: 'unknown' });
    expect(result.checks[0]?.detail).toContain('Unknown tool');
  });

  it('never throws when the bridge answers without a checks list; not ready', async () => {
    const { callTool } = tools({ bridge: { ready: true } as unknown as PreflightChecksResult });
    const result = await runDashboardPreflight({
      callTool,
      gmActionsEnabled: false,
      sessionSwitches: null,
      playerState: {},
    });
    expect(result.ready).toBe(false);
    expect(result.checks[0]).toMatchObject({ id: 'bridge-checks', status: 'unknown' });
    expect(result.checks[0]?.detail).toContain('without a list of checks');
    expect(result.scan).toBeNull();
  });
});

describe('GET /api/preflight', () => {
  const GM_TOKEN = 'gm-token-preflight';
  let dashboard: Dashboard | null = null;
  let server: Server | null = null;

  afterEach(async () => {
    dashboard?.close();
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    dashboard = null;
    server = null;
  });

  async function start(bridge?: PreflightChecksResult): Promise<string> {
    const { callTool } = tools(bridge ? { bridge } : {});
    const testConfig: Config = {
      ...config,
      auth: { ...config.auth, splitEnabled: true, gmToken: GM_TOKEN, playerToken: 'player-token' },
    };
    dashboard = createDashboard({
      config: testConfig,
      logger: new Logger('error', 'preflight'),
      client: {
        isConnected: true,
        listTools: (): Promise<unknown[]> => Promise.resolve([]),
        callTool: <T>(name: string, args?: Record<string, unknown>): Promise<T> =>
          name === 'get-world-info'
            ? Promise.reject(new Error('no world'))
            : callTool<T>(name, args),
      },
      coGm: {
        enabled: false,
        isBusy: false,
        setWorld: (): void => undefined,
        abortActive: (): void => undefined,
        stream: () => Promise.reject(new Error('off')),
      } as never,
    });
    server = dashboard.app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('answers the GM with the checklist', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/preflight`, { headers: { 'X-CoGM-Token': GM_TOKEN } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks: Array<{ id: string }> };
    expect(body.checks.map(c => c.id)).toEqual(['foundry-link', 'ready', 'player-page']);
  });

  it('survives a bridge answer without checks and keeps serving', async () => {
    const base = await start({ ready: true } as unknown as PreflightChecksResult);
    const headers = { 'X-CoGM-Token': GM_TOKEN };
    const res = await fetch(`${base}/api/preflight`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ready: boolean;
      checks: Array<{ id: string; status: string }>;
    };
    expect(body.ready).toBe(false);
    expect(body.checks[0]).toMatchObject({ id: 'bridge-checks', status: 'unknown' });
    // The process is still up: a second request is answered too.
    expect((await fetch(`${base}/api/preflight`, { headers })).status).toBe(200);
  });

  it('refuses a player', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/preflight`, {
      headers: { 'X-CoGM-Token': 'player-token' },
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(404);
  });
});
