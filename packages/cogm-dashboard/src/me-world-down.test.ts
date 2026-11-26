/**
 * My character with no live world: a key the links know answers 503 "The table is not open right
 * now" on every player route, never the bad-link 401; a key nobody knows still gets 401.
 */
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import { DiaryStore } from './diary-store.js';
import { mountMeRoute } from './me-route.js';
import type { PlayerLinkStore } from './player-links.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import { PlayerDirectory, mountUsageRoute } from './usage-route.js';

const KNOWN = 'k'.repeat(24);
const UNKNOWN = 'u'.repeat(24);

let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise<void>(r => server!.close(() => r()));
  server = null;
});

async function start(live: boolean): Promise<string> {
  const app = express();
  mountMeRoute(app, {
    client: {},
    links: {
      userFor: (_w: string, k?: string) => (k === KNOWN ? 'anna' : null),
      worldFor: (k?: string) => (k === KNOWN ? 'w' : null),
    } as unknown as PlayerLinkStore,
    diary: new DiaryStore(null, { warn: (): void => undefined }),
    directory: {
      refreshIfStale: () => Promise.resolve(),
      list: () => [],
    } as unknown as PlayerDirectory,
    requireGm: (_req, _res, next) => next(),
    worldId: () => (live ? 'w' : null),
    theme: () => 'neutral',
    publicDir: '.',
    pageHeaders: () => undefined,
  });
  await new Promise<void>(r => (server = app.listen(0, '127.0.0.1', () => r())));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const ROUTES: Array<[string, string, string]> = [
  ['sheet', 'GET', '/api/me'],
  ['stash', 'GET', '/api/me/stash'],
  ['connector', 'GET', '/api/me/connector'],
  ['diary', 'GET', '/api/me/diary'],
  ['roll', 'POST', '/api/me/roll'],
  ['portrait', 'POST', '/api/me/portrait'],
  ['helper', 'GET', '/api/me/helper.mcpb'],
  ['diary add', 'POST', '/api/me/diary'],
  ['diary delete', 'DELETE', '/api/me/diary/abc'],
];

describe('My character with the table closed', () => {
  for (const [name, method, url] of ROUTES) {
    it(`${name}: a known key gets 503, an unknown key still 401`, async () => {
      const base = await start(false);
      const call = (key: string): Promise<Response> =>
        fetch(`${base}${url}`, {
          method,
          headers: { 'X-CoGM-Me': key, 'Content-Type': 'application/json' },
          body: method === 'POST' ? '{}' : undefined,
        });
      const closed = await call(KNOWN);
      expect(closed.status).toBe(503);
      const body = (await closed.json()) as { code?: string; error: string };
      expect(body.error).toBe('The table is not open right now. Try again later.');
      expect(body.code).toBeUndefined();
      const bad = await call(UNKNOWN);
      expect(bad.status).toBe(401);
      expect(((await bad.json()) as { code: string }).code).toBe('no-link');
    });
  }

  it('usage: a known key gets 503 (the page keeps its events), an unknown key 401', async () => {
    const app = express();
    mountUsageRoute(app, {
      config: {} as unknown as Config,
      client: {},
      logger: { debug: (): void => undefined, warn: (): void => undefined } as unknown as Logger,
      directory: new PlayerDirectory({}, {} as unknown as Logger),
      requireGm: (_req, _res, next) => next(),
      meUserFor: () => null,
      meTableClosed: key => key === KNOWN,
    });
    await new Promise<void>(r => (server = app.listen(0, '127.0.0.1', () => r())));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const send = (key: string): Promise<Response> =>
      fetch(`${base}/api/me/usage`, {
        method: 'POST',
        headers: { 'X-CoGM-Me': key, 'Content-Type': 'application/json' },
        // Not valid JSON: only a key check that runs before the parser answers 503 or 401, not 400.
        body: '{',
      });
    expect((await send(KNOWN)).status).toBe(503);
    expect((await send(UNKNOWN)).status).toBe(401);
  });

  it('usage: a keyed user the directory has not seen is recorded by id with no name', async () => {
    const recorded: Array<{ who?: unknown }> = [];
    const client = {
      isConnected: false,
      callTool: (): Promise<never> => Promise.reject(new Error('no world')),
      recordUsage: (
        events: Array<{ who?: unknown }>
      ): Promise<{ accepted: number; dropped: number }> => {
        recorded.push(...events);
        return Promise.resolve({ accepted: events.length, dropped: 0 });
      },
    };
    const app = express();
    mountUsageRoute(app, {
      config: {} as unknown as Config,
      client: client as never,
      logger: { debug: (): void => undefined, warn: (): void => undefined } as unknown as Logger,
      directory: new PlayerDirectory(client as never, {} as unknown as Logger),
      requireGm: (_req, _res, next) => next(),
      meUserFor: () => 'ghost',
    });
    await new Promise<void>(r => (server = app.listen(0, '127.0.0.1', () => r())));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/api/me/usage`, {
      method: 'POST',
      headers: { 'X-CoGM-Me': KNOWN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [
          {
            v: 1,
            key: 'a:1',
            t: Date.now(),
            seq: 1,
            clientId: 'a',
            kind: 'action',
            name: 'me.print',
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(recorded[0]?.who).toEqual({ role: 'player', userId: 'ghost', name: null });
  });

  it('with the table open an unknown key is still 401', async () => {
    const base = await start(true);
    const res = await fetch(`${base}/api/me`, { headers: { 'X-CoGM-Me': UNKNOWN } });
    expect(res.status).toBe(401);
  });
});
