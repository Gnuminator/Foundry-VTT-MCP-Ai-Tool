/**
 * Keepsake route: the private key maps to one user; a player reads and changes only their own
 * keepsakes; a bad key, a bad id and a table without player vaults are refused.
 */
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import { mountKeepsakeRoute } from './keepsake-route.js';
import type { PlayerLinkStore } from './player-links.js';
import {
  buildKeepsakeLedgers,
  KeepsakeStore,
  type KeepsakeLedger,
} from './player-vault/keepsake.js';

let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise<void>(r => server!.close(() => r()));
  server = null;
});

const KEYS: Record<string, string> = { annakey: 'anna000000000001', benkey: 'ben0000000000002' };

async function start(withLedgers = true): Promise<{ base: string; store: KeepsakeStore }> {
  const app = express();
  app.use(express.json());
  const store = new KeepsakeStore(null);
  mountKeepsakeRoute(app, {
    links: {
      userFor: (_w: string, k?: string) => (k ? (KEYS[k] ?? null) : null),
      worldFor: (k?: string) => (k && KEYS[k] ? 'w' : null),
    } as unknown as PlayerLinkStore,
    worldId: () => 'w',
    store,
    ledgersFor: withLedgers
      ? (userId: string): Promise<KeepsakeLedger[]> =>
          Promise.resolve(buildKeepsakeLedgers(store.list('w', userId), [], null))
      : null,
  });
  await new Promise<void>(r => (server = app.listen(0, '127.0.0.1', () => r())));
  return { base: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, store };
}

const json = (key: string): Record<string, string> => ({
  'X-CoGM-Me': key,
  'Content-Type': 'application/json',
});

describe('keepsake route', () => {
  it('adds, lists and removes only the callers own keepsakes', async () => {
    const { base } = await start();
    const add = await fetch(`${base}/api/me/keepsakes`, {
      method: 'POST',
      headers: json('annakey'),
      body: JSON.stringify({ kind: 'names', title: 'Book', character: 'Ebbe' }),
    });
    expect(add.status).toBe(200);
    const mine = (await add.json()) as { ledgers: { id: string; title: string }[] };
    expect(mine.ledgers.map(l => l.title)).toEqual(['Book']);

    const ben = (await (
      await fetch(`${base}/api/me/keepsakes`, { headers: json('benkey') })
    ).json()) as { ledgers: unknown[] };
    expect(ben.ledgers).toEqual([]);

    const bens = await fetch(`${base}/api/me/keepsakes/${mine.ledgers[0].id}`, {
      method: 'DELETE',
      headers: json('benkey'),
    });
    expect(bens.status).toBe(404);
    const gone = await fetch(`${base}/api/me/keepsakes/${mine.ledgers[0].id}`, {
      method: 'DELETE',
      headers: json('annakey'),
    });
    expect(gone.status).toBe(200);
  });

  it('refuses a bad key, a bad body and a table without player vaults', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/me/keepsakes`, { headers: json('nope') })).status).toBe(401);
    const bad = await fetch(`${base}/api/me/keepsakes`, {
      method: 'POST',
      headers: json('annakey'),
      body: JSON.stringify({ kind: 'names', title: '' }),
    });
    expect(bad.status).toBe(400);
    await new Promise<void>(r => server!.close(() => r()));
    const off = await start(false);
    expect((await fetch(`${off.base}/api/me/keepsakes`, { headers: json('annakey') })).status).toBe(
      501
    );
  });
});
