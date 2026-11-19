import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VaultStore } from '../vault/store.js';
import { DOWNTIME_MAX_PER_PLAYER, handleDowntime, listDowntime } from './store.js';

let dataDir: string;
let store: VaultStore;
const W = 'curse-of-strahd';

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'downtime-'));
  store = new VaultStore({ dataDir });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('downtime inbox (I-180)', () => {
  it("saves, lists, edits and deletes only the caller's own entries, marked from the player", async () => {
    const a = await handleDowntime(store, W, {
      action: 'save',
      userId: 'anna',
      name: 'Anna',
      text: ' Visit the chapel ',
    });
    expect(a.entries).toHaveLength(1);
    expect(a.entries[0]).toMatchObject({
      text: 'Visit the chapel',
      source: 'player',
      name: 'Anna',
    });
    await handleDowntime(store, W, { action: 'save', userId: 'bo', name: 'Bo', text: 'Fish' });

    expect(
      (await handleDowntime(store, W, { action: 'list', userId: 'anna' })).entries
    ).toHaveLength(1);
    // The digest side sees everyone's.
    expect(await listDowntime(store, W)).toHaveLength(2);

    const id = a.entries[0].id;
    // Another player cannot edit or delete it.
    await expect(
      handleDowntime(store, W, { action: 'save', userId: 'bo', id, text: 'hijack' })
    ).rejects.toThrow('gone');
    await handleDowntime(store, W, { action: 'delete', userId: 'bo', id });
    expect(await listDowntime(store, W)).toHaveLength(2);

    const edited = await handleDowntime(store, W, {
      action: 'save',
      userId: 'anna',
      id,
      text: 'Visit the crypt',
    });
    expect(edited.entries[0].text).toBe('Visit the crypt');
    const gone = await handleDowntime(store, W, { action: 'delete', userId: 'anna', id });
    expect(gone.entries).toEqual([]);
  });

  it('refuses empty, long and too many entries', async () => {
    await expect(
      handleDowntime(store, W, { action: 'save', userId: 'a', text: '  ' })
    ).rejects.toThrow('Write something');
    await expect(
      handleDowntime(store, W, { action: 'save', userId: 'a', text: 'x'.repeat(1001) })
    ).rejects.toThrow('Keep it under');
    for (let i = 0; i < DOWNTIME_MAX_PER_PLAYER; i++) {
      await handleDowntime(store, W, { action: 'save', userId: 'a', text: `n${i}` });
    }
    await expect(
      handleDowntime(store, W, { action: 'save', userId: 'a', text: 'one more' })
    ).rejects.toThrow('You can keep');
  });
});
