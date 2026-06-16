/**
 * Characterization tests for the player/NPC roster surface of `FoundryDataAccess`,
 * driven through the Phase 9 Foundry-mock harness.
 *
 * Methods covered:
 *   - getFriendlyNPCs
 *   - getPartyCharacters
 *   - getConnectedPlayers
 *   - findPlayers
 *   - findActor
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, makeToken, type TestWorld } from './test-support/foundry-mock/index.js';
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

// ---------------------------------------------------------------------------
// getFriendlyNPCs
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getFriendlyNPCs', () => {
  it('returns [] when there is no active scene', async () => {
    // No scene installed — game.scenes.find(s => s.active) returns undefined.
    const result = await da.getFriendlyNPCs();
    expect(result).toEqual([]);
  });

  it('returns only tokens with disposition === 1 (FRIENDLY)', async () => {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Village',
      active: true,
      tokens: [
        makeToken({ id: 't1', name: 'Guard', disposition: 1, actor: { id: 'a1', name: 'Guard' } }),
        makeToken({
          id: 't2',
          name: 'Goblin',
          disposition: -1,
          actor: { id: 'a2', name: 'Goblin' },
        }),
        makeToken({
          id: 't3',
          name: 'Peasant',
          disposition: 0,
          actor: { id: 'a3', name: 'Peasant' },
        }),
      ],
    });
    world.setActiveScene(scene.id);

    const result = await da.getFriendlyNPCs();

    expect(result).toEqual([{ id: 'a1', name: 'Guard' }]);
  });

  it('prefers token.actor.id over token.id for the returned id', async () => {
    const scene = world.addScene({
      id: 'scene2',
      active: true,
      tokens: [
        makeToken({
          id: 'tok1',
          name: 'Ally',
          disposition: 1,
          actor: { id: 'actor-a', name: 'Ally' },
        }),
      ],
    });
    world.setActiveScene(scene.id);

    const [item] = await da.getFriendlyNPCs();
    expect(item?.id).toBe('actor-a');
  });

  it('falls back to token.id when actor is absent', async () => {
    const scene = world.addScene({
      id: 'scene3',
      active: true,
      tokens: [
        makeToken({ id: 'tok2', name: 'Spirit', disposition: 1 }),
        // no actor property → token.actor is undefined
      ],
    });
    world.setActiveScene(scene.id);

    const result = await da.getFriendlyNPCs();
    expect(result).toEqual([{ id: 'tok2', name: 'Spirit' }]);
  });

  it('filters out entries where the resolved id is blank', async () => {
    // Token with neither actor.id nor its own id → blank id after map → filtered out.
    const scene = world.addScene({
      id: 'scene4',
      active: true,
      tokens: [
        // manually-crafted token with no id and no actor
        { id: '', name: 'Ghost', disposition: 1 },
      ],
    });
    world.setActiveScene(scene.id);

    const result = await da.getFriendlyNPCs();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getPartyCharacters
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getPartyCharacters', () => {
  it('returns actors where hasPlayerOwner === true AND type === "character"', async () => {
    world.addActor({ id: 'pc1', name: 'Silvera', type: 'character', hasPlayerOwner: true });
    world.addActor({ id: 'pc2', name: 'Thorn', type: 'character', hasPlayerOwner: true });
    // NPC with player owner — must not appear
    world.addActor({ id: 'npc1', name: 'Sidekick', type: 'npc', hasPlayerOwner: true });
    // Character without player owner — must not appear
    world.addActor({ id: 'pc3', name: 'Unmanned', type: 'character', hasPlayerOwner: false });

    const result = await da.getPartyCharacters();

    expect(result).toEqual([
      { id: 'pc1', name: 'Silvera' },
      { id: 'pc2', name: 'Thorn' },
    ]);
  });

  it('returns [] when no actors qualify', async () => {
    world.addActor({ id: 'npc1', name: 'Goblin', type: 'npc', hasPlayerOwner: false });
    expect(await da.getPartyCharacters()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getConnectedPlayers
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getConnectedPlayers', () => {
  it('returns non-GM users that are active', async () => {
    world.addUser({ id: 'p1', name: 'Alice', active: true, isGM: false });
    world.addUser({ id: 'p2', name: 'Bob', active: false, isGM: false });
    // The default GM user installed by createTestWorld is isGM:true — must not appear.

    const result = await da.getConnectedPlayers();

    expect(result).toEqual([{ id: 'p1', name: 'Alice' }]);
  });

  it('excludes GM users even when they are active', async () => {
    // createTestWorld already adds an active GM; confirm it is excluded.
    const result = await da.getConnectedPlayers();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findPlayers
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — findPlayers', () => {
  it('finds a player by exact user name', async () => {
    world.addUser({ id: 'p1', name: 'Alice', active: true, isGM: false });

    const result = await da.findPlayers({ identifier: 'Alice' });

    expect(result).toEqual([{ id: 'p1', name: 'Alice' }]);
  });

  it('finds a player by partial name match (default allowPartialMatch = true)', async () => {
    world.addUser({ id: 'p1', name: 'Alexandra', active: true, isGM: false });

    const result = await da.findPlayers({ identifier: 'alex' });

    expect(result).toEqual([{ id: 'p1', name: 'Alexandra' }]);
  });

  it('skips partial match when allowPartialMatch = false', async () => {
    world.addUser({ id: 'p1', name: 'Alexandra', active: true, isGM: false });

    const result = await da.findPlayers({ identifier: 'alex', allowPartialMatch: false });

    expect(result).toEqual([]);
  });

  it('never returns GM users by name', async () => {
    // createTestWorld creates a GM named Gamemaster — ensure it is excluded.
    const result = await da.findPlayers({ identifier: 'Gamemaster' });
    expect(result).toEqual([]);
  });

  it('falls back to character-owner lookup when no direct user match (includeCharacterOwners default true)', async () => {
    world.addUser({ id: 'p1', name: 'Alice', active: true, isGM: false });
    world.addActor({
      id: 'actor1',
      name: 'Silvera',
      type: 'character',
      // testUserPermission must return OWNER for 'p1' and non-OWNER for gm
      testUserPermission: (user: any, perm: string) => perm === 'OWNER' && user.id === 'p1',
    });

    const result = await da.findPlayers({ identifier: 'Silvera' });

    expect(result).toEqual([{ id: 'p1', name: 'Alice' }]);
  });

  it('skips character-owner lookup when includeCharacterOwners = false', async () => {
    world.addUser({ id: 'p1', name: 'Alice', active: true, isGM: false });
    world.addActor({
      id: 'actor1',
      name: 'Silvera',
      type: 'character',
      testUserPermission: (_u: any, _p: string) => true,
    });

    const result = await da.findPlayers({ identifier: 'Silvera', includeCharacterOwners: false });

    // No direct user named Silvera and includeCharacterOwners=false — should return [].
    expect(result).toEqual([]);
  });

  it('does not duplicate a player who appears through both user-name and character-owner paths', async () => {
    // A user whose name happens to match the search term AND owns a character
    // that also matches — the user-name path fills `players` so the character
    // lookup is skipped (it only runs when players.length === 0).
    world.addUser({ id: 'p1', name: 'Alice', active: true, isGM: false });
    world.addActor({
      id: 'actor1',
      name: 'Alice',
      type: 'character',
      testUserPermission: (user: any, perm: string) => perm === 'OWNER' && user.id === 'p1',
    });

    const result = await da.findPlayers({ identifier: 'Alice' });

    // Should appear exactly once from the direct user-name branch.
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// findActor
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — findActor', () => {
  it('resolves by exact id (16-char id triggers get() branch)', async () => {
    world.addActor({ id: 'aaaaaaaaaaaaaaaa', name: 'Silvera', type: 'character' });

    const result = await da.findActor({ identifier: 'aaaaaaaaaaaaaaaa' });

    expect(result).toEqual({ id: 'aaaaaaaaaaaaaaaa', name: 'Silvera' });
  });

  it('resolves by exact name via getName()', async () => {
    world.addActor({ id: 'actor-x', name: 'Thorn', type: 'character' });

    const result = await da.findActor({ identifier: 'Thorn' });

    expect(result).toEqual({ id: 'actor-x', name: 'Thorn' });
  });

  it('resolves by partial name substring (case-insensitive)', async () => {
    world.addActor({ id: 'actor-y', name: 'Thornamere', type: 'npc' });

    const result = await da.findActor({ identifier: 'thorn' });

    expect(result).toEqual({ id: 'actor-y', name: 'Thornamere' });
  });

  it('returns null when no actor matches', async () => {
    const result = await da.findActor({ identifier: 'Nobody' });
    expect(result).toBeNull();
  });
});
