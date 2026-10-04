/**
 * Per-player links (I-096): random keys per world and user, found in constant time, kept
 * across restarts, replaced and removed by the GM.
 */
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { PlayerLinkStore, newPlayerKey } from './player-links.js';

const ALICE = 'aaaaaaaaaaaaaaa1';
const BOB = 'bbbbbbbbbbbbbbb2';
let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('PlayerLinkStore', () => {
  it('makes a 144-bit base64url key per player and finds the player by it', async () => {
    const store = new PlayerLinkStore(null);
    const a = await store.create('w', ALICE);
    const b = await store.create('w', BOB);
    expect(a.key).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(a.key).not.toBe(b.key);
    expect(store.userFor('w', a.key)).toBe(ALICE);
    expect(store.userFor('w', b.key)).toBe(BOB);
  });

  it('knows no key in another world, a wrong key or junk', async () => {
    const store = new PlayerLinkStore(null);
    const a = await store.create('w', ALICE);
    expect(store.userFor('other', a.key)).toBeNull();
    expect(store.userFor('w', newPlayerKey())).toBeNull();
    expect(store.userFor('w', undefined)).toBeNull();
    expect(store.userFor('w', `${a.key}x`)).toBeNull();
  });

  it('a new link replaces the old one; removing it ends it', async () => {
    const store = new PlayerLinkStore(null);
    const old = await store.create('w', ALICE);
    const fresh = await store.create('w', ALICE);
    expect(store.userFor('w', old.key)).toBeNull();
    expect(store.userFor('w', fresh.key)).toBe(ALICE);
    expect(await store.remove('w', ALICE)).toBe(true);
    expect(store.userFor('w', fresh.key)).toBeNull();
    expect(await store.remove('w', ALICE)).toBe(false);
  });

  it('refuses a user id that is not a Foundry id', async () => {
    await expect(new PlayerLinkStore(null).create('w', '../etc')).rejects.toThrow();
  });

  it('keeps the links across a restart', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cogm-links-'));
    const file = path.join(dir, 'player-links.json');
    const first = new PlayerLinkStore(file);
    const a = await first.create('w', ALICE);
    expect(JSON.parse(readFileSync(file, 'utf8')).worlds.w[ALICE].key).toBe(a.key);
    const second = new PlayerLinkStore(file);
    expect(second.userFor('w', a.key)).toBe(ALICE);
    expect(second.list('w').map(l => l.userId)).toEqual([ALICE]);
  });
});
