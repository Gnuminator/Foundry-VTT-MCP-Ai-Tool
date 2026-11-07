/**
 * Which page answers where (D-126, from 2026-11-01): the React dashboard at /, /next/ and the
 * retired /legacy/ as redirects to /, and the player pages unchanged.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import * as path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { Logger } from './logger.js';

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
  });
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    dashboard,
    stop: async (): Promise<void> => {
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

  it('sends the retired /legacy/ address to /, keeping the query, and serves none of its files', async () => {
    for (const [from, to] of [
      ['/legacy/', '/'],
      ['/legacy', '/'],
      ['/legacy?token=abc', '/?token=abc'],
      ['/legacy/?token=abc', '/?token=abc'],
    ] as const) {
      const answer = await get(app.port, from);
      expect([from, answer.status, answer.headers['location']]).toEqual([from, 302, to]);
    }
    for (const p of ['/legacy/app.js', '/legacy/index.html', '/app.js', '/index.html']) {
      expect([p, (await get(app.port, p)).status]).toEqual([p, 404]);
    }
  });

  it('sends the old name /next/ to /, keeping the query', async () => {
    for (const [from, to] of [
      ['/next/', '/'],
      ['/next', '/'],
      ['/next/?token=a%20b', '/?token=a%20b'],
      ['/next/?token=abc_DEF-123&plan=plan-abc-1', '/?token=abc_DEF-123&plan=plan-abc-1'],
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

  it('drops a query that is not plain text, so /next never redirects to another host', async () => {
    for (const from of [
      '/next/?//evil.example',
      '/legacy/?//evil.example',
      '/legacy?/%5Cevil',
      '/next/?/%5Cevil',
      '/next/?/\\evil',
      '/next/?x=//evil.example',
      '/next//evil.example',
    ]) {
      const answer = await get(app.port, from);
      const to = answer.headers['location'];
      expect([from, to === undefined || /^\/(\?[^\\/]*)?$/.test(String(to))]).toEqual([from, true]);
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

describe('the page routes are rate limited', () => {
  it('answers 429 to a runaway loop of loads', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cogm-web-'));
    writeFileSync(path.join(dir, 'index.html'), REACT_PAGE);
    const app = await start(dir);
    try {
      const statuses: number[] = [];
      for (let batch = 0; batch < 11; batch++) {
        const answers = await Promise.all(Array.from({ length: 100 }, () => get(app.port, '/')));
        statuses.push(...answers.map(answer => answer.status));
      }
      expect(statuses.filter(status => status === 429).length).toBeGreaterThan(0);
      expect(statuses[0]).toBe(200);
    } finally {
      await app.stop();
    }
  }, 30_000);
});

describe('the asset files have their own rate limit bucket', () => {
  it('still answers 200 for assets after the page limit is used up', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cogm-web-'));
    writeFileSync(path.join(dir, 'index.html'), REACT_PAGE);
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets', 'x-abc123.js'), 'export {}');
    const app = await start(dir);
    try {
      const statuses: number[] = [];
      for (let batch = 0; batch < 11; batch++) {
        const answers = await Promise.all(Array.from({ length: 100 }, () => get(app.port, '/')));
        statuses.push(...answers.map(answer => answer.status));
      }
      expect(statuses.filter(status => status === 429).length).toBeGreaterThan(0);
      const asset = await get(app.port, '/next/assets/x-abc123.js');
      expect(asset.status).toBe(200);
    } finally {
      await app.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('without a React build', () => {
  it('says the dashboard is not built at / (and has nothing behind it)', async () => {
    const app = await start(null);
    try {
      const answer = await get(app.port, '/');
      expect(answer.status).toBe(503);
      expect(answer.body).toContain('npm run build');
    } finally {
      await app.stop();
    }
  });
});
