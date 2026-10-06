/**
 * The storage space check on the dashboard (2026-10-06): `GET /api/space` is GM only, answers
 * "not available" when the Pi's status file is missing, and passes the level, the stale flag and
 * the disks when it is there. The players' pages never call it.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';
import { spaceView } from './space-route.js';

const GM_TOKEN = 'gm-token-for-the-space-test';
const PLAYER_TOKEN = 'player-token-for-the-space-test';
const AUTH: AuthConfig = {
  ...config.auth,
  splitEnabled: true,
  gmToken: GM_TOKEN,
  playerToken: PLAYER_TOKEN,
  gmEmails: [],
};
const NOW = Date.parse('2026-10-06T12:00:00Z');

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
} as unknown as CoGm;

function statusFile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    checkedAt: '2026-10-06T11:30:00Z',
    host: 'foundry-pi',
    thresholdPercent: 20,
    criticalPercent: 5,
    level: 'low',
    disks: [
      {
        mount: '/',
        paths: ['/var/lib/foundry'],
        jobs: ['restic backup (source)'],
        totalBytes: 100e9,
        freeBytes: 14.25e9,
        freePercent: 14.3,
        level: 'low',
      },
    ],
    ...overrides,
  });
}

let dir: string;
let dashboard: Dashboard | undefined;
let server: http.Server | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'space-route-'));
});

afterEach(async () => {
  dashboard?.close();
  await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
  dashboard = undefined;
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function start(spaceStatusFile: string): Promise<number> {
  const testConfig: Config = {
    ...config,
    host: '127.0.0.1',
    allowedHosts: parseAllowedHosts(''),
    stateDir: '',
    auth: AUTH,
  };
  dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'space-test'),
    client: fakeBridge,
    coGm: fakeCoGm,
    spaceStatusFile,
    spaceNow: () => NOW,
  });
  server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', () => resolve()));
  return (server.address() as AddressInfo).port;
}

async function getSpace(
  port: number,
  token: string | null
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/space`, {
    headers: token ? { 'x-cogm-token': token } : {},
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('GET /api/space', () => {
  it('is for the GM only', async () => {
    const file = join(dir, 'status.json');
    writeFileSync(file, statusFile());
    const port = await start(file);
    expect((await getSpace(port, PLAYER_TOKEN)).status).toBe(403);
    expect((await getSpace(port, null)).status).toBe(401);
    expect((await getSpace(port, GM_TOKEN)).status).toBe(200);
  });

  it('says "not available" when the status file is missing', async () => {
    const port = await start(join(dir, 'none.json'));
    const r = await getSpace(port, GM_TOKEN);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ available: false, reason: 'missing' });
  });

  it('says "not available" when the file is not a status file', async () => {
    const file = join(dir, 'status.json');
    writeFileSync(file, '{"version": 9}');
    const port = await start(file);
    expect((await getSpace(port, GM_TOKEN)).json).toMatchObject({
      available: false,
      reason: 'invalid',
    });
  });

  it('passes the level, the disks and a fresh check', async () => {
    const file = join(dir, 'status.json');
    writeFileSync(file, statusFile());
    const port = await start(file);
    const r = await getSpace(port, GM_TOKEN);
    expect(r.json).toMatchObject({
      available: true,
      level: 'low',
      stale: false,
      host: 'foundry-pi',
      disks: [{ mount: '/', freePercent: 14.3, freeGb: 14.3, level: 'low' }],
    });
  });

  it('flags a check older than 3 hours as stale', async () => {
    const file = join(dir, 'status.json');
    writeFileSync(file, statusFile({ checkedAt: '2026-10-06T07:00:00Z' }));
    const port = await start(file);
    expect((await getSpace(port, GM_TOKEN)).json).toMatchObject({ available: true, stale: true });
  });
});

describe('spaceView', () => {
  it('drops everything but what the banner needs', () => {
    const view = spaceView({
      state: 'available',
      stale: false,
      ageMs: 0,
      status: {
        version: 1,
        checkedAt: 'x',
        host: 'h',
        thresholdPercent: 20,
        criticalPercent: 5,
        level: 'ok',
        disks: [],
        lastJob: { name: 'n', at: 'a', level: 'ok', ran: true },
      },
    });
    expect(JSON.stringify(view)).not.toContain('lastJob');
  });
});

describe('the pages players open', () => {
  it('never ask for the space check', () => {
    for (const page of ['player.js', 'me.js', 'me-paper.js', 'player.html', 'me.html']) {
      const text = readFileSync(join(config.publicDir, page), 'utf8');
      expect(text, page).not.toContain('/api/space');
    }
  });
});
