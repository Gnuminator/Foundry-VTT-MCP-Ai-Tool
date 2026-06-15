/**
 * Characterization tests for the actor-ownership surface of `FoundryDataAccess`:
 *   - setActorOwnership
 *   - getActorOwnership
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
// setActorOwnership
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — setActorOwnership', () => {
  it('returns success:false with error when actor id is missing', async () => {
    world.addUser({ id: 'u1', name: 'Alice', isGM: false });

    const result = await da.setActorOwnership({
      actorId: 'missing-actor',
      userId: 'u1',
      permission: 3,
    });

    expect(result).toEqual({
      success: false,
      error: 'Actor not found: missing-actor',
      message: '',
    });
  });

  it('returns success:false with error when user id is missing', async () => {
    world.addActor({ id: 'a1', name: 'Silvera', type: 'character' });

    const result = await da.setActorOwnership({
      actorId: 'a1',
      userId: 'missing-user',
      permission: 3,
    });

    expect(result).toEqual({ success: false, error: 'User not found: missing-user', message: '' });
  });

  it('returns success:true with OWNER name for permission 3', async () => {
    world.addActor({ id: 'a1', name: 'Silvera', type: 'character' });
    world.addUser({ id: 'u1', name: 'Alice', isGM: false });

    const result = await da.setActorOwnership({ actorId: 'a1', userId: 'u1', permission: 3 });

    expect(result).toEqual({ success: true, message: 'Set Silvera ownership to OWNER for Alice' });
  });

  it('returns success:true with OBSERVER name for permission 2', async () => {
    world.addActor({ id: 'a1', name: 'Goblin', type: 'npc' });
    world.addUser({ id: 'u1', name: 'Bob', isGM: false });

    const result = await da.setActorOwnership({ actorId: 'a1', userId: 'u1', permission: 2 });

    expect(result).toEqual({ success: true, message: 'Set Goblin ownership to OBSERVER for Bob' });
  });

  it('returns success:true with LIMITED name for permission 1', async () => {
    world.addActor({ id: 'a1', name: 'Troll', type: 'npc' });
    world.addUser({ id: 'u1', name: 'Carol', isGM: false });

    const result = await da.setActorOwnership({ actorId: 'a1', userId: 'u1', permission: 1 });

    expect(result).toEqual({ success: true, message: 'Set Troll ownership to LIMITED for Carol' });
  });

  it('returns success:true with NONE name for permission 0', async () => {
    world.addActor({ id: 'a1', name: 'Dragon', type: 'npc' });
    world.addUser({ id: 'u1', name: 'Dave', isGM: false });

    const result = await da.setActorOwnership({ actorId: 'a1', userId: 'u1', permission: 0 });

    expect(result).toEqual({ success: true, message: 'Set Dragon ownership to NONE for Dave' });
  });

  it('falls back to numeric string for unknown permission values', async () => {
    world.addActor({ id: 'a1', name: 'Sprite', type: 'npc' });
    world.addUser({ id: 'u1', name: 'Eve', isGM: false });

    const result = await da.setActorOwnership({ actorId: 'a1', userId: 'u1', permission: 99 });

    expect(result).toEqual({ success: true, message: 'Set Sprite ownership to 99 for Eve' });
  });

  it('mutates actor.ownership in-memory after a successful call', async () => {
    const actor = world.addActor({
      id: 'a1',
      name: 'Silvera',
      type: 'character',
      ownership: { default: 0 },
    });
    world.addUser({ id: 'u1', name: 'Alice', isGM: false });

    await da.setActorOwnership({ actorId: 'a1', userId: 'u1', permission: 3 });

    expect((actor as any).ownership).toMatchObject({ default: 0, u1: 3 });
  });

  it('merges new entry into existing ownership without clobbering other entries', async () => {
    const actor = world.addActor({
      id: 'a1',
      name: 'Silvera',
      type: 'character',
      ownership: { default: 0, u2: 2 },
    });
    world.addUser({ id: 'u1', name: 'Alice', isGM: false });

    await da.setActorOwnership({ actorId: 'a1', userId: 'u1', permission: 3 });

    expect((actor as any).ownership).toEqual({ default: 0, u2: 2, u1: 3 });
  });

  it('does NOT check caller permissions — succeeds regardless of who the active user is', async () => {
    // The active GM user (id 'gm') is the current user in createTestWorld();
    // setActorOwnership has no permission gate — any user can call it in the current impl.
    world.addActor({ id: 'a1', name: 'Silvera', type: 'character' });
    world.addUser({ id: 'p1', name: 'Player', isGM: false });

    const result = await da.setActorOwnership({ actorId: 'a1', userId: 'p1', permission: 1 });

    expect(result.success).toBe(true);
  });
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
  }) {
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
