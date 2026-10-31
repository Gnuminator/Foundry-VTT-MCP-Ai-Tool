/**
 * The GM page route (item gm-page-wrapper): `/gm` serves the dashboard shell, `/gm/` redirects,
 * and `/api/gm-page` tells only the GM where Foundry is.
 */
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { gmPageInfo, gmRedirectTarget } from './gm-page.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';

describe('gmPageInfo', () => {
  it('gives the address and its origin', () => {
    expect(gmPageInfo('http://localhost:30091/')).toEqual({
      foundryUrl: 'http://localhost:30091',
      foundryOrigin: 'http://localhost:30091',
    });
    expect(gmPageInfo('https://play.example.com/game')?.foundryOrigin).toBe(
      'https://play.example.com'
    );
  });

  it('gives nulls for an empty, unusable or non-web address', () => {
    const none = { foundryUrl: null, foundryOrigin: null };
    expect(gmPageInfo(undefined)).toEqual(none);
    expect(gmPageInfo('')).toEqual(none);
    expect(gmPageInfo('javascript:alert(1)')).toEqual(none);
    expect(gmPageInfo('ftp://play.example.com')).toEqual(none);
  });
});

describe('gmRedirectTarget', () => {
  it('keeps a plain query and drops anything else, always staying on /gm', () => {
    expect(gmRedirectTarget('/gm/')).toBe('/gm');
    expect(gmRedirectTarget('/gm/?token=abc')).toBe('/gm?token=abc');
    expect(gmRedirectTarget('/gm/?x=//evil.example')).toBe('/gm');
  });
});

const fakeCoGm = {
  enabled: false,
  isBusy: false,
  setWorld: (): void => undefined,
  abortActive: (): void => undefined,
} as unknown as CoGm;

const bridge = {
  isConnected: true,
  listTools: (): Promise<unknown[]> => Promise.resolve([]),
  callTool: <T>(): Promise<T> => Promise.resolve({} as T),
};

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map(c => c()));
});

async function start(foundryUrl: string): Promise<number> {
  const auth: AuthConfig = {
    ...config.auth,
    splitEnabled: true,
    gmToken: 'gm-token-test',
    playerToken: 'player-token-test',
    gmEmails: [],
    access: null,
  };
  const testConfig: Config = {
    ...config,
    host: '127.0.0.1',
    allowedHosts: parseAllowedHosts(''),
    auth,
    foundryUrl,
  };
  const dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'gm-page-test'),
    client: bridge,
    coGm: fakeCoGm,
  });
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  closers.push(
    () =>
      new Promise<void>(resolve => {
        dashboard.close();
        server.close(() => resolve());
      })
  );
  return (server.address() as AddressInfo).port;
}

describe('GET /api/gm-page', () => {
  it('answers the GM with the Foundry address, and nobody else', async () => {
    const port = await start('http://localhost:30091');
    const url = `http://127.0.0.1:${port}/api/gm-page`;
    const gm = await fetch(url, { headers: { 'X-CoGM-Token': 'gm-token-test' } });
    expect(gm.status).toBe(200);
    expect(await gm.json()).toEqual({
      foundryUrl: 'http://localhost:30091',
      foundryOrigin: 'http://localhost:30091',
    });
    const player = await fetch(url, { headers: { 'X-CoGM-Token': 'player-token-test' } });
    expect(player.status).toBe(403);
    expect((await fetch(url)).status).toBe(401);
  });
});

describe('GET /gm', () => {
  it('lets nobody frame the page, not even with the strip query', async () => {
    const port = await start('http://localhost:30091');
    for (const search of ['', '?strip=1']) {
      const res = await fetch(`http://127.0.0.1:${port}/gm${search}`);
      expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    }
  });

  it('redirects /gm/ to /gm, keeping a plain query', async () => {
    const port = await start('');
    const res = await fetch(`http://127.0.0.1:${port}/gm/?token=abc`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/gm?token=abc');
  });
});
