/**
 * /api/state and the old pages' stylesheets go out gzipped in the real app (I-098), and the page
 * headers of the /open page's stylesheet survive it. Raw http: fetch would decompress on its own.
 */
import * as http from 'http';
import type { AddressInfo } from 'net';
import { gunzipSync } from 'zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-for-the-gzip-test';
const AUTH: AuthConfig = {
  ...config.auth,
  splitEnabled: true,
  gmToken: GM_TOKEN,
  playerToken: 'player-token-for-the-gzip-test',
  gmEmails: [],
};
const BIG_TITLE = 'A long world title '.repeat(200);

const fakeBridge = {
  isConnected: true,
  listTools: (): Promise<unknown[]> => Promise.resolve([]),
  callTool: <T>(name: string): Promise<T> =>
    Promise.resolve((name === 'get-world-info' ? { id: 'gz-world', title: BIG_TITLE } : {}) as T),
};
const fakeCoGm = {
  enabled: false,
  isBusy: false,
  setWorld: (): void => undefined,
  abortActive: (): void => undefined,
} as unknown as CoGm;

let dashboard: Dashboard | null = null;
let server: http.Server | null = null;

afterEach(async () => {
  dashboard?.close();
  await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
  dashboard = null;
  server = null;
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
    logger: new Logger('error', 'gzip-test'),
    client: fakeBridge,
    coGm: fakeCoGm,
  });
  server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server?.once('listening', () => resolve()));
  return (server.address() as AddressInfo).port;
}

function rawGet(
  port: number,
  urlPath: string,
  headers: http.OutgoingHttpHeaders
): Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath, headers }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
      })
      .on('error', reject);
  });
}

describe('gzip in the real app', () => {
  it('sends /api/state gzipped to a browser that accepts it, plain otherwise', async () => {
    const port = await start();
    dashboard?.handlers.onStatus({
      controlChannel: 'connected',
      foundry: 'reachable',
      lastError: null,
      lastPollAt: null,
      foundryDownSince: null,
    });
    const auth = { 'x-cogm-token': GM_TOKEN };
    await vi.waitFor(
      async () => {
        const plain = await rawGet(port, '/api/state', { ...auth, 'Accept-Encoding': 'identity' });
        expect(plain.headers['content-encoding']).toBeUndefined();
        expect((JSON.parse(plain.body.toString()) as { world: unknown }).world).not.toBeNull();
      },
      { timeout: 5000 }
    );
    const plain = await rawGet(port, '/api/state', { ...auth, 'Accept-Encoding': 'identity' });
    const zipped = await rawGet(port, '/api/state', { ...auth, 'Accept-Encoding': 'gzip' });
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(zipped.headers['vary']).toContain('Accept-Encoding');
    expect(zipped.body.length).toBeLessThan(plain.body.length / 4);
    expect(JSON.parse(gunzipSync(zipped.body).toString())).toEqual(
      JSON.parse(plain.body.toString())
    );
  });

  it('gzips the old stylesheets and keeps the /open page headers on open.css', async () => {
    const port = await start();
    const identity = await rawGet(port, '/open.css', { 'Accept-Encoding': 'identity' });
    const zipped = await rawGet(port, '/open.css', { 'Accept-Encoding': 'gzip' });
    for (const name of ['content-security-policy', 'cache-control', 'referrer-policy']) {
      expect(identity.headers[name]).toBeTruthy();
      expect(zipped.headers[name]).toBe(identity.headers[name]);
    }
    const big = await rawGet(port, '/styles.css', { 'Accept-Encoding': 'gzip' });
    expect(big.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(big.body).length).toBeGreaterThan(big.body.length * 2);
  });
});
