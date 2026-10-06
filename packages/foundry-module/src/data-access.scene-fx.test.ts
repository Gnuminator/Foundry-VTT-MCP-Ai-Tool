/**
 * Tests for the one direct scene-dressing write left in the `scene-fx` domain of
 * `FoundryDataAccess`: `playPlaylist` (I-112). Templates, darkness and light, map
 * notes and loot are planned by `scene-plan.ts` (`scene-plan.test.ts`).
 *
 * Harness gap worked around locally: `game.playlists` is empty, so playlists with
 * `playAll`/`stopAll` stubs are pushed onto `world.playlists`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

function addPlaylist(name: string): {
  playAll: ReturnType<typeof vi.fn>;
  stopAll: ReturnType<typeof vi.fn>;
} {
  const playAll = vi.fn(() => Promise.resolve());
  const stopAll = vi.fn(() => Promise.resolve());
  world.playlists.add({ id: 'pl1', name, playAll, stopAll } as any);
  return { playAll, stopAll };
}

describe('FoundryDataAccess: playPlaylist', () => {
  it('plays a named playlist (case-insensitive) and reports the action', async () => {
    const { playAll, stopAll } = addPlaylist('Tavern');

    const result = await da.playPlaylist({ playlistName: 'tavern' });

    expect(playAll).toHaveBeenCalledTimes(1);
    expect(stopAll).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, playlist: 'play "Tavern"' });
  });

  it('stops a named playlist when the action is stop', async () => {
    const { playAll, stopAll } = addPlaylist('Battle');

    const result = await da.playPlaylist({ playlistName: 'Battle', action: 'stop' });

    expect(stopAll).toHaveBeenCalledTimes(1);
    expect(playAll).not.toHaveBeenCalled();
    expect(result.playlist).toBe('stop "Battle"');
  });

  it('reports a not-found playlist without throwing', async () => {
    const result = await da.playPlaylist({ playlistName: 'Nonexistent' });

    expect(result).toEqual({ success: true, playlist: 'Playlist not found: Nonexistent' });
  });

  it('throws when no playlist name is given', async () => {
    await expect(da.playPlaylist({})).rejects.toThrow('playlistName is required');
  });
});
