/**
 * In-app help (I-064): GET /api/help/:page serves one page of the built help, GM only.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-help';
const PLAYER_TOKEN = 'player-token-help';

let dashboard: Dashboard | null = null;
let server: Server | null = null;
let dir: string | null = null;

afterEach(async () => {
  dashboard?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
  dashboard = null;
  server = null;
  dir = null;
});

async function start(help: unknown): Promise<string> {
  dir = mkdtempSync(path.join(tmpdir(), 'cogm-help-'));
  const file = path.join(dir, 'help.json');
  if (help !== null) writeFileSync(file, JSON.stringify(help), 'utf8');
  const testConfig: Config = {
    ...config,
    auth: { ...config.auth, splitEnabled: true, gmToken: GM_TOKEN, playerToken: PLAYER_TOKEN },
  };
  dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'help'),
    client: {
      isConnected: true,
      listTools: (): Promise<unknown[]> => Promise.resolve([]),
      callTool: <T>(): Promise<T> => Promise.reject(new Error('no tools')),
    },
    coGm: {
      enabled: false,
      isBusy: false,
      setWorld: (): void => undefined,
      abortActive: (): void => undefined,
      stream: () => Promise.reject(new Error('off')),
    } as never,
    helpFile: file,
  });
  server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const get = (base: string, page: string, token = GM_TOKEN): Promise<Response> =>
  fetch(`${base}/api/help/${page}`, { headers: { 'X-CoGM-Token': token } });

describe('GET /api/help/:page', () => {
  const help = {
    pages: { features: { title: 'Features', html: '<h1 id="features">Features</h1>' } },
  };

  it('serves a page to the GM', async () => {
    const base = await start(help);
    const res = await get(base, 'features');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      page: 'features',
      title: 'Features',
      html: '<h1 id="features">Features</h1>',
    });
  });

  it('is GM only', async () => {
    const base = await start(help);
    expect((await get(base, 'features', PLAYER_TOKEN)).status).toBe(403);
  });

  it('answers 404 for an unknown page, an odd name or an inherited key', async () => {
    const base = await start(help);
    expect((await get(base, 'nope')).status).toBe(404);
    expect((await get(base, '..%2Fpackage')).status).toBe(404);
    expect((await get(base, 'constructor')).status).toBe(404);
  });

  it('says the help is built with npm run build when the file is missing', async () => {
    const base = await start(null);
    const res = await get(base, 'features');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain('npm run build');
  });
});
