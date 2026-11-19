/**
 * I-180 downtime inbox: /api/me/downtime maps the private key to one user, forwards that user id
 * to the bridge, and refuses a bad key, a bad id and an old backend.
 */
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import { mountDowntimeRoute, type DowntimeClient } from './downtime-route.js';
import type { PlayerLinkStore } from './player-links.js';
import type { PlayerDirectory } from './usage-route.js';

let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise<void>(r => server!.close(() => r()));
  server = null;
});

async function start(client: DowntimeClient): Promise<string> {
  const app = express();
  app.use(express.json());
  mountDowntimeRoute(app, {
    client,
    links: {
      userFor: (_w: string, k?: string) => (k === 'good' ? 'anna' : null),
    } as unknown as PlayerLinkStore,
    directory: {
      refreshIfStale: () => Promise.resolve(),
      get: (id: string) => (id === 'anna' ? { userId: 'anna', name: 'Anna' } : undefined),
    } as unknown as PlayerDirectory,
    worldId: () => 'w',
  });
  await new Promise<void>(r => (server = app.listen(0, '127.0.0.1', r)));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('downtime route', () => {
  it('forwards only the mapped user and the player name', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const base = await start({
      downtime: p => {
        calls.push(p);
        return Promise.resolve({ entries: [{ id: 'x' }] });
      },
    });
    const h = { 'X-CoGM-Me': 'good', 'Content-Type': 'application/json' };
    const post = await fetch(`${base}/api/me/downtime`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ text: 'hi', userId: 'bo' }),
    });
    expect(post.status).toBe(200);
    expect(calls[0]).toEqual({ action: 'save', userId: 'anna', name: 'Anna', text: 'hi' });
    await fetch(`${base}/api/me/downtime/aaaaaaaaaaaaaaaa`, { method: 'DELETE', headers: h });
    expect(calls[1]).toEqual({ action: 'delete', userId: 'anna', id: 'aaaaaaaaaaaaaaaa' });
  });

  it('keeps working on the last world when no GM client is joined, and says offline when none is known', async () => {
    let world: string | null = null;
    const app = express();
    app.use(express.json());
    mountDowntimeRoute(app, {
      client: { downtime: () => Promise.resolve({ entries: [] }) },
      links: {
        userFor: (_w: string, k?: string) => (k === 'good' ? 'anna' : null),
      } as unknown as PlayerLinkStore,
      directory: {
        refreshIfStale: () => Promise.resolve(),
        get: () => undefined,
      } as unknown as PlayerDirectory,
      worldId: () => world,
    });
    await new Promise<void>(r => (server = app.listen(0, '127.0.0.1', r)));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const h = { 'X-CoGM-Me': 'good' };
    expect((await fetch(`${base}/api/me/downtime`, { headers: h })).status).toBe(503);
    world = 'w';
    expect((await fetch(`${base}/api/me/downtime`, { headers: h })).status).toBe(200);
    world = null; // the GM client left: the last world stands in, the link stays valid
    expect((await fetch(`${base}/api/me/downtime`, { headers: h })).status).toBe(200);
  });

  it('answers 501 for an old backend and 400 for a malformed edit id', async () => {
    const base = await start({
      downtime: () => Promise.reject(new Error('Unknown method')),
    });
    const h = { 'X-CoGM-Me': 'good', 'Content-Type': 'application/json' };
    expect((await fetch(`${base}/api/me/downtime`, { headers: h })).status).toBe(501);
    const bad = await fetch(`${base}/api/me/downtime`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ text: 'x', id: 'nope' }),
    });
    expect(bad.status).toBe(400);
  });

  it('refuses a bad key, a bad id and a missing backend method', async () => {
    const base = await start({ downtime: () => Promise.resolve({ entries: [] }) });
    expect(
      (await fetch(`${base}/api/me/downtime`, { headers: { 'X-CoGM-Me': 'bad' } })).status
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/api/me/downtime/nope`, {
          method: 'DELETE',
          headers: { 'X-CoGM-Me': 'good' },
        })
      ).status
    ).toBe(400);
    if (server) await new Promise<void>(r => server!.close(() => r()));
    const old = await start({});
    expect(
      (await fetch(`${old}/api/me/downtime`, { headers: { 'X-CoGM-Me': 'good' } })).status
    ).toBe(501);
  });
});
