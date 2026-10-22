import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LAST_WORLD_FILE, WorldIdResolver } from './world-id.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'world-id-'));
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

function foundry(worldId = 'curse-of-strahd'): {
  state: { connected: boolean; serial: number };
  source: never;
} {
  const state = { connected: true, serial: 1 };
  const source = {
    query: vi.fn(() => Promise.resolve({ id: worldId })),
    isConnected: (): boolean => state.connected,
    getConnectionSerial: (): number => state.serial,
  };
  return { state, source: source as never };
}

describe('WorldIdResolver.currentOrLastKnown', () => {
  it('is the current world while Foundry is connected, and remembers it on disk', async () => {
    const f = foundry();
    const resolver = new WorldIdResolver(f.source, { dataDir });
    expect(await resolver.currentOrLastKnown()).toBe('curse-of-strahd');
    const saved = JSON.parse(await fsp.readFile(path.join(dataDir, LAST_WORLD_FILE), 'utf8'));
    expect(saved.worldId).toBe('curse-of-strahd');
  });

  it('falls back to the last world after a restart, with Foundry closed', async () => {
    const first = foundry();
    await new WorldIdResolver(first.source, { dataDir }).current();

    const closed = foundry();
    closed.state.connected = false;
    const restarted = new WorldIdResolver(closed.source, { dataDir });
    expect(await restarted.currentOrLastKnown()).toBe('curse-of-strahd');
    // The strict lookup still never guesses.
    await expect(restarted.current()).rejects.toThrow(/not connected/);
  });

  it('follows a different world once Foundry opens it', async () => {
    await new WorldIdResolver(foundry('world-a').source, { dataDir }).current();
    await new WorldIdResolver(foundry('world-b').source, { dataDir }).current();
    const closed = foundry();
    closed.state.connected = false;
    expect(await new WorldIdResolver(closed.source, { dataDir }).currentOrLastKnown()).toBe(
      'world-b'
    );
  });

  it('says so when Foundry is closed and no world was ever seen', async () => {
    const closed = foundry();
    closed.state.connected = false;
    await expect(
      new WorldIdResolver(closed.source, { dataDir }).currentOrLastKnown()
    ).rejects.toThrow(/has not seen a world yet/);
    await expect(new WorldIdResolver(closed.source).currentOrLastKnown()).rejects.toThrow(
      /has not seen a world yet/
    );
  });

  it('ignores a damaged or unusable file', async () => {
    const closed = foundry();
    closed.state.connected = false;
    await fsp.writeFile(path.join(dataDir, LAST_WORLD_FILE), '{not json', 'utf8');
    await expect(
      new WorldIdResolver(closed.source, { dataDir }).currentOrLastKnown()
    ).rejects.toThrow(/has not seen a world yet/);
    await fsp.writeFile(path.join(dataDir, LAST_WORLD_FILE), JSON.stringify({ worldId: '../x' }));
    await expect(
      new WorldIdResolver(closed.source, { dataDir }).currentOrLastKnown()
    ).rejects.toThrow(/has not seen a world yet/);
  });

  it('still works when the file cannot be written', async () => {
    const f = foundry();
    const resolver = new WorldIdResolver(f.source, { dataDir: path.join(dataDir, 'file', 'x') });
    await fsp.writeFile(path.join(dataDir, 'file'), 'a file where a folder should be');
    expect(await resolver.current()).toBe('curse-of-strahd');
  });
});
