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
