/**
 * Character diaries (I-183, route A): a player's entries are theirs alone. The key is the only
 * identity, another player's key sees an empty list, and the text appears in no other route.
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { DiaryStore } from './diary-store.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-diary';
const PLAYER_TOKEN = 'player-token-diary';
const ANNA = 'anna000000000001';
const BEN = 'ben0000000000002';

let dashboard: Dashboard | null = null;
let server: Server | null = null;

afterEach(async () => {
  dashboard?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  dashboard = null;
  server = null;
});

async function start(): Promise<string> {
  const client = {
    isConnected: true,
    listTools: (): Promise<unknown[]> => Promise.resolve([]),
    callTool: <T>(name: string): Promise<T> =>
      name === 'get-world-info'
        ? Promise.resolve({
            id: 'world-diary',
            title: 'Test',
            system: { id: 'dnd5e' },
            playerUsers: [
              { id: ANNA, name: 'Anna', isGM: false },
              { id: BEN, name: 'Ben', isGM: false },
            ],
          } as T)
        : Promise.reject(new Error('no tool')),
  };
  const testConfig: Config = {
    ...config,
    stateDir: undefined,
    auth: { ...config.auth, splitEnabled: true, gmToken: GM_TOKEN, playerToken: PLAYER_TOKEN },
  };
  dashboard = createDashboard({ config: testConfig, logger: new Logger('error', 'diary'), client });
  server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', () => resolve()));
  dashboard.handlers.onStatus({
    controlChannel: 'connected',
    foundry: 'reachable',
    lastError: null,
    lastPollAt: null,
    foundryDownSince: null,
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await vi.waitFor(
    async () => {
      const res = await fetch(`${base}/api/state`, { headers: { 'X-CoGM-Token': GM_TOKEN } });
      const state = (await res.json()) as { world: { id: string } | null };
      expect(state.world?.id).toBe('world-diary');
    },
    { timeout: 5000 }
  );
  return base;
}

async function keyFor(base: string, userId: string): Promise<string> {
  const res = await fetch(`${base}/api/player-links/${userId}`, {
    method: 'POST',
    headers: { 'X-CoGM-Token': GM_TOKEN },
  });
  const { link } = (await res.json()) as { link: string };
  return new URL(link, 'http://x').searchParams.get('k') ?? '';
}

const call = (
  base: string,
  key: string,
  method: string,
  p: string,
  body?: unknown
): Promise<Response> =>
  fetch(`${base}/api/me/diary${p}`, {
    method,
    headers: { 'X-CoGM-Me': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

describe('/api/me/diary', () => {
  it('saves, edits and deletes the own entry; another player sees none of it', async () => {
    const base = await start();
    const anna = await keyFor(base, ANNA);
    const ben = await keyFor(base, BEN);

    const saved = await call(base, anna, 'POST', '', { character: 'Ebbe', text: 'Dear diary.' });
    expect(saved.status).toBe(200);
    const { entry } = (await saved.json()) as { entry: { id: string } };

    const edited = await call(base, anna, 'POST', '', {
      id: entry.id,
      text: 'Dear diary, edited.',
    });
    expect(edited.status).toBe(200);
    const mine = (await (await call(base, anna, 'GET', '')).json()) as {
      entries: Array<{ text: string; character: string }>;
    };
    expect(mine.entries).toHaveLength(1);
    expect(mine.entries[0]).toMatchObject({ text: 'Dear diary, edited.', character: 'Ebbe' });

    // Ben sees nothing, and cannot change or delete Anna's entry by guessing its id.
    const his = (await (await call(base, ben, 'GET', '')).json()) as { entries: unknown[] };
    expect(his.entries).toEqual([]);
    expect((await call(base, ben, 'POST', '', { id: entry.id, text: 'mine now' })).status).toBe(
      404
    );
    expect((await call(base, ben, 'DELETE', `/${entry.id}`)).status).toBe(404);

    // The text is in no other route: not the GM state, not the player page's state.
    const gmState = await (
      await fetch(`${base}/api/state`, { headers: { 'X-CoGM-Token': GM_TOKEN } })
    ).text();
    expect(gmState).not.toContain('Dear diary');
    const me = await (await fetch(`${base}/api/me`, { headers: { 'X-CoGM-Me': ben } })).text();
    expect(me).not.toContain('Dear diary');

    expect((await call(base, anna, 'DELETE', `/${entry.id}`)).status).toBe(200);
    const gone = (await (await call(base, anna, 'GET', '')).json()) as { entries: unknown[] };
    expect(gone.entries).toEqual([]);
  });

  it('refuses a missing or wrong key, an empty entry and an oversized one', async () => {
    const base = await start();
    expect((await call(base, '', 'GET', '')).status).toBe(401);
    expect((await call(base, 'x'.repeat(24), 'POST', '', { text: 'hi' })).status).toBe(401);
    const key = await keyFor(base, ANNA);
    expect((await call(base, key, 'POST', '', { text: '   ' })).status).toBe(400);
    expect((await call(base, key, 'POST', '', { text: 'a'.repeat(4001) })).status).toBe(400);
  });
});

describe('DiaryStore', () => {
  it('keeps entries across a restart and drops malformed ones', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diary-'));
    const file = path.join(dir, 'd.json');
    const a = new DiaryStore(file);
    const saved = a.save('w', ANNA, { character: 'Ebbe', text: 'Kept.' });
    expect(saved.ok).toBe(true);
    await a.flush();
    const b = new DiaryStore(file);
    expect(b.list('w', ANNA).map(e => e.text)).toEqual(['Kept.']);
    expect(b.list('w', BEN)).toEqual([]);
    expect(b.list('other', ANNA)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
