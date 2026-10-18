/**
 * Which page answers where (D-126, from 2026-11-01): the React dashboard at /, the old page at
 * /legacy/ until after G1, /next/ as a redirect to /, and the player pages unchanged.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import * as path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { Logger } from './logger.js';
import { OPEN_PAGE_CSP } from './open-route.js';

const fakeCoGm = {
  enabled: false,
  isBusy: false,
  setWorld: (): void => undefined,
  abortActive: (): void => undefined,
} as unknown as CoGm;

const fakeClient = {
  isConnected: true,
  listTools: (): Promise<unknown[]> => Promise.resolve([]),
  callTool: <T>(): Promise<T> => Promise.reject(new Error('no bridge in this test')),
};

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function get(port: number, urlPath: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath }, res => {
        let body = '';
        res.on('data', chunk => (body += String(chunk)));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      })
      .on('error', reject);
  });
}

const REACT_PAGE = '<!doctype html><title>React dashboard</title><div id="root"></div>';

/** A dashboard with a built React page in `webDir`, or with none when it is null. */
async function start(
  webDir: string | null
): Promise<{ port: number; stop: () => Promise<void>; dashboard: Dashboard }> {
  const testConfig: Config = {
    ...config,
    webDir: webDir ?? path.join(tmpdir(), 'cogm-no-such-web-dir'),
  };
  const dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'default-page-test'),
    client: fakeClient,
    coGm: fakeCoGm,
  });
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    dashboard,
    stop: async () => {
      dashboard.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

describe('the default page', () => {
  let webDir: string;
  let app: Awaited<ReturnType<typeof start>>;

  beforeAll(async () => {
    webDir = mkdtempSync(path.join(tmpdir(), 'cogm-web-'));
    writeFileSync(path.join(webDir, 'index.html'), REACT_PAGE);
    mkdirSync(path.join(webDir, 'assets'));
    writeFileSync(path.join(webDir, 'assets', 'x-abc123.js'), 'export {}');
    app = await start(webDir);
  });
  afterAll(async () => {
    await app.stop();
    rmSync(webDir, { recursive: true, force: true });
  });

  it('serves the React dashboard at /, checked on every load, with or without a query', async () => {
    for (const p of ['/', '/?token=abc', '/?plan=plan-1']) {
      const answer = await get(app.port, p);
      expect([p, answer.status]).toEqual([p, 200]);
      expect([p, answer.body]).toEqual([p, REACT_PAGE]);
      expect(answer.headers['cache-control']).toBe('no-cache');
    }
  });

  it('keeps the old page at /legacy/ with its relative files', async () => {
    const page = await get(app.port, '/legacy/');
    expect(page.status).toBe(200);
    expect(page.body).toContain('id="moment-after"');
    expect(page.body).not.toContain('React dashboard');
    for (const p of ['/legacy/app.js', '/legacy/styles.css', '/legacy/moments.css']) {
      expect([p, (await get(app.port, p)).status]).toEqual([p, 200]);
    }
  });

  it('sends /legacy to /legacy/ with the query', async () => {
    const answer = await get(app.port, '/legacy?token=abc');
    expect(answer.status).toBe(301);
    expect(answer.headers['location']).toBe('/legacy/?token=abc');
  });

  it('sends the old name /next/ to /, keeping the query', async () => {
    for (const [from, to] of [
      ['/next/', '/'],
      ['/next', '/'],
      ['/next/?token=a%20b', '/?token=a%20b'],
    ] as const) {
      const answer = await get(app.port, from);
      expect([from, answer.status, answer.headers['location']]).toEqual([from, 302, to]);
    }
  });

  it('still serves the React files under /next/ (the base of the build)', async () => {
    const asset = await get(app.port, '/next/assets/x-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
  });

  it('gives the player and open pages under /legacy/ the same headers as at the root', async () => {
    for (const name of ['player.html', 'open.html']) {
      const root = await get(app.port, `/${name}`);
      const legacy = await get(app.port, `/legacy/${name}`);
      expect([name, legacy.status]).toEqual([name, 200]);
      expect(legacy.headers['content-security-policy']).toBeTruthy();
      if (name === 'open.html') {
        expect(legacy.headers['content-security-policy']).toBe(OPEN_PAGE_CSP);
      }
      expect(legacy.headers['content-security-policy']).toBe(
        root.headers['content-security-policy']
      );
      expect(legacy.headers['cache-control']).toBe(root.headers['cache-control']);
    }
  });

  it('does not redirect /next// or a query to another host', async () => {
    for (const from of ['/next//evil.example', '/next/?//evil.example']) {
      const answer = await get(app.port, from);
      expect(String(answer.headers['location'] ?? '/')).toMatch(/^\/(?!\/)/);
    }
  });

  it('leaves the player and open pages where they were', async () => {
    for (const p of ['/player', '/player.html', '/open', '/open.html']) {
      const answer = await get(app.port, p);
      expect([p, answer.status]).toEqual([p, 200]);
      expect(answer.body).not.toContain('React dashboard');
    }
  });
});

describe('without a React build', () => {
  it('shows the old page at / instead of nothing', async () => {
    const app = await start(null);
    try {
      const answer = await get(app.port, '/');
      expect(answer.status).toBe(200);
      expect(answer.body).toContain('id="moment-after"');
    } finally {
      await app.stop();
    }
  });
});
