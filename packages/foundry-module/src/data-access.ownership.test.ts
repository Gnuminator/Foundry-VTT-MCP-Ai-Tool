/**
 * Characterization tests for the actor-ownership read surface of `FoundryDataAccess`:
 *   - getActorOwnership
 * (The write moved to the guarded `plan-ownership-change`, F5 L3.)
 *
 * These pin current (upstream-derived) behavior so the Phase 9 from-scratch
 * reimplementation can be verified to parity.
 *
 * Harness notes:
 *  - `testUserPermission` is NOT built into makeActor; it is supplied inline via
 *    the builder's rest-spread so the ownership tier logic can be exercised.
 *  - `game.users.getName` is used by getActorOwnership when playerIdentifier is
 *    set; MockCollection supports this (checked in world.ts install path).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';
import { OWNERSHIP_FEATURE_ID as SHARED_OWNERSHIP_FEATURE_ID } from '@gnuminator/shared';
import { OWNERSHIP_FEATURE_ID } from './data-access/ownership-players.js';

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
// getActorOwnership
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getActorOwnership', () => {
  /** Minimal testUserPermission that checks actor.ownership[userId] against a level map. */
  function makeOwnershipActor(opts: {
    id: string;
    name: string;
    type?: string;
    ownership?: Record<string, number>;
  }): ReturnType<typeof world.addActor> {
    const ownership = opts.ownership ?? {};
    const levelMap: Record<string, number> = { OWNER: 3, OBSERVER: 2, LIMITED: 1 };
    return world.addActor({
      id: opts.id,
      name: opts.name,
      type: opts.type ?? 'character',
      ownership,
      testUserPermission: (user: any, level: string) =>
        (ownership[user.id] ?? 0) >= (levelMap[level] ?? 99),
    });
  }

  it('returns an entry per actor with the shape {id,name,type,ownership:[...]}', async () => {
    makeOwnershipActor({ id: 'a1', name: 'Silvera', type: 'character', ownership: { p1: 3 } });
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });

    const result = await da.getActorOwnership({});

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'a1', name: 'Silvera', type: 'character' });
    expect(result[0].ownership).toHaveLength(1);
  });

  it('excludes GM users from the ownership list', async () => {
    makeOwnershipActor({ id: 'a1', name: 'Silvera', type: 'character', ownership: {} });
    world.addUser({ id: 'gm', name: 'Gamemaster', isGM: true });
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });

    const result = await da.getActorOwnership({});

    const userIds = result[0].ownership.map((o: any) => o.userId);
    expect(userIds).not.toContain('gm');
    expect(userIds).toContain('p1');
  });

  it('maps permission tier 3 to OWNER / numericPermission 3', async () => {
    makeOwnershipActor({ id: 'a1', name: 'Silvera', type: 'character', ownership: { p1: 3 } });
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });

    const result = await da.getActorOwnership({});

    expect(result[0].ownership[0]).toEqual({
      userId: 'p1',
      userName: 'Alice',
      permission: 'OWNER',
      numericPermission: 3,
    });
  });

  it('maps permission tier 2 to OBSERVER / numericPermission 2', async () => {
    makeOwnershipActor({ id: 'a1', name: 'Goblin', type: 'npc', ownership: { p1: 2 } });
    world.addUser({ id: 'p1', name: 'Bob', isGM: false });

    const result = await da.getActorOwnership({});

    expect(result[0].ownership[0]).toMatchObject({ permission: 'OBSERVER', numericPermission: 2 });
  });

  it('maps permission tier 1 to LIMITED / numericPermission 1', async () => {
    makeOwnershipActor({ id: 'a1', name: 'Troll', type: 'npc', ownership: { p1: 1 } });
    world.addUser({ id: 'p1', name: 'Carol', isGM: false });

    const result = await da.getActorOwnership({});

    expect(result[0].ownership[0]).toMatchObject({ permission: 'LIMITED', numericPermission: 1 });
  });

  it('maps permission tier 0 (no access) to NONE / numericPermission 0', async () => {
    makeOwnershipActor({ id: 'a1', name: 'Dragon', type: 'npc', ownership: {} });
    world.addUser({ id: 'p1', name: 'Dave', isGM: false });

    const result = await da.getActorOwnership({});

    expect(result[0].ownership[0]).toMatchObject({ permission: 'NONE', numericPermission: 0 });
  });

  it('actorIdentifier "all" returns all actors', async () => {
    makeOwnershipActor({ id: 'a1', name: 'Silvera' });
    makeOwnershipActor({ id: 'a2', name: 'Goblin', type: 'npc' });
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });

    const result = await da.getActorOwnership({ actorIdentifier: 'all' });

    expect(result).toHaveLength(2);
  });

  it('absent actorIdentifier also returns all actors', async () => {
    makeOwnershipActor({ id: 'a1', name: 'Silvera' });
    makeOwnershipActor({ id: 'a2', name: 'Goblin', type: 'npc' });
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });

    const result = await da.getActorOwnership({});

    expect(result).toHaveLength(2);
  });

  it('actorIdentifier by id filters to a single actor', async () => {
    makeOwnershipActor({ id: 'a1', name: 'Silvera' });
    makeOwnershipActor({ id: 'a2', name: 'Goblin', type: 'npc' });
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });

    const result = await da.getActorOwnership({ actorIdentifier: 'a1' });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('playerIdentifier filters ownership to just that user', async () => {
    makeOwnershipActor({ id: 'a1', name: 'Silvera', ownership: { p1: 3, p2: 1 } });
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });
    world.addUser({ id: 'p2', name: 'Bob', isGM: false });

    const result = await da.getActorOwnership({ playerIdentifier: 'Alice' });

    expect(result[0].ownership).toHaveLength(1);
    expect(result[0].ownership[0].userId).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// Feature id mirror
// ---------------------------------------------------------------------------

describe('ownership feature id', () => {
  it('the module mirror equals the shared constant', () => {
    expect(OWNERSHIP_FEATURE_ID).toBe(SHARED_OWNERSHIP_FEATURE_ID);
    expect(OWNERSHIP_FEATURE_ID).toBe('ownership');
  });

  it('the data access no longer has a direct ownership write (F5 L3)', () => {
    expect((da as any).setActorOwnership).toBeUndefined();
  });
});
