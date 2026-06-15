/**
 * Characterization tests for the token write methods of `FoundryDataAccess`:
 *   - moveToken
 *   - updateToken
 *   - deleteTokens
 *   - toggleTokenCondition
 *
 * Driven through the Phase 9 Foundry-mock harness (in-memory, no browser).
 * These pin current behaviour so the Phase 9 from-scratch reimplementation can
 * be verified to parity.
 *
 * Harness gaps worked around locally (no edits to shared harness files):
 *   - `makeToken` does not call `withDocumentMethods`, so raw token objects
 *     lack `.update()`. Tokens are patched inline with a simple `update` stub
 *     that mutates the token's own fields (mirrors what the real harness helper
 *     would do via `applyFlatChanges`).
 *   - `CONFIG.statusEffects` is set via `(globalThis as any).CONFIG.statusEffects`
 *     after `world.install()` because the harness initialises it to `[]`.
 *   - `makeToken` does not include `actor`; actors are supplied via rest-spread.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from './constants.js';
import {
  createTestWorld,
  makeActor,
  makeEffect,
  makeToken,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Patch a token with an `update` method that applies flat changes in-place.
 * Needed because `makeToken` does not call `withDocumentMethods`.
 * This is a local workaround — do NOT copy into the shared harness.
 */
function withUpdate(token: any): any {
  token.update = (changes: Record<string, any>, _opts?: any) => {
    for (const [k, v] of Object.entries(changes)) {
      token[k] = v;
    }
    return Promise.resolve(token);
  };
  return token;
}

// ---------------------------------------------------------------------------
// moveToken — permission-denied path
// ---------------------------------------------------------------------------

describe('FoundryDataAccess.moveToken — permission denied', () => {
  it('throws ACCESS_DENIED when writes are not enabled', async () => {
    // No world.enableWrites() → permissionManager.checkWritePermission returns denied
    await expect(da.moveToken({ tokenId: 't1', x: 100, y: 200 })).rejects.toThrow(
      ERROR_MESSAGES.ACCESS_DENIED
    );
  });
});

// ---------------------------------------------------------------------------
// moveToken — allowed paths
// ---------------------------------------------------------------------------

describe('FoundryDataAccess.moveToken — allowed', () => {
  beforeEach(() => {
    world.enableWrites();
  });

  it('throws wrapped error when there is no active scene', async () => {
    // No scene installed → game.scenes.current is undefined
    await expect(da.moveToken({ tokenId: 't1', x: 100, y: 200 })).rejects.toThrow(
      'Failed to move token: No active scene found'
    );
  });

  it('throws wrapped error when the token is not in the current scene', async () => {
    const scene = world.addScene({ id: 'scene1', name: 'Arena', active: true });
    world.setActiveScene(scene.id);

    await expect(da.moveToken({ tokenId: 'missing', x: 50, y: 50 })).rejects.toThrow(
      'Failed to move token: Token missing not found in current scene'
    );
  });

  it('moves a token and returns the expected result shape', async () => {
    const token = withUpdate(makeToken({ id: 't1', name: 'Warrior', x: 0, y: 0 }));
    const scene = world.addScene({
      id: 'scene1',
      name: 'Arena',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    const result = await da.moveToken({ tokenId: 't1', x: 300, y: 400 });

    expect(result).toEqual({
      success: true,
      tokenId: 't1',
      tokenName: 'Warrior',
      newPosition: { x: 300, y: 400 },
      animated: true, // animate defaults to true when not supplied (animate !== false)
    });
    // Token position should have been mutated
    expect(token.x).toBe(300);
    expect(token.y).toBe(400);
  });

  it('sets animated:false when animate is explicitly false', async () => {
    const token = withUpdate(makeToken({ id: 't2', name: 'Goblin', x: 0, y: 0 }));
    const scene = world.addScene({
      id: 'scene2',
      name: 'Pit',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    const result = await da.moveToken({ tokenId: 't2', x: 50, y: 50, animate: false });

    expect(result.animated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateToken — permission-denied path
// ---------------------------------------------------------------------------

describe('FoundryDataAccess.updateToken — permission denied', () => {
  it('throws ACCESS_DENIED when writes are not enabled', async () => {
    await expect(da.updateToken({ tokenId: 't1', updates: { hidden: true } })).rejects.toThrow(
      ERROR_MESSAGES.ACCESS_DENIED
    );
  });
});

// ---------------------------------------------------------------------------
// updateToken — allowed paths
// ---------------------------------------------------------------------------

describe('FoundryDataAccess.updateToken — allowed', () => {
  beforeEach(() => {
    world.enableWrites();
  });

  it('throws wrapped error when there is no active scene', async () => {
    await expect(da.updateToken({ tokenId: 't1', updates: { hidden: true } })).rejects.toThrow(
      'Failed to update token: No active scene found'
    );
  });

  it('throws wrapped error when the token is not in the current scene', async () => {
    const scene = world.addScene({ id: 'scene1', name: 'Arena', active: true });
    world.setActiveScene(scene.id);

    await expect(da.updateToken({ tokenId: 'missing', updates: { hidden: true } })).rejects.toThrow(
      'Failed to update token: Token missing not found in current scene'
    );
  });

  it('applies updates and returns updatedProperties listing the keys', async () => {
    const token = withUpdate(makeToken({ id: 't1', name: 'Scout', hidden: false, disposition: 0 }));
    const scene = world.addScene({
      id: 'scene1',
      name: 'Forest',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    const result = await da.updateToken({
      tokenId: 't1',
      updates: { hidden: true, disposition: -1 },
    });

    expect(result).toEqual({
      success: true,
      tokenId: 't1',
      tokenName: 'Scout',
      updatedProperties: ['hidden', 'disposition'],
    });
    expect(token.hidden).toBe(true);
    expect(token.disposition).toBe(-1);
  });

  it('filters out undefined values from updates before applying', async () => {
    const token = withUpdate(makeToken({ id: 't1', name: 'Guard', hidden: false }));
    const scene = world.addScene({
      id: 'scene1',
      name: 'Gate',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    const result = await da.updateToken({
      tokenId: 't1',
      updates: { hidden: true, disposition: undefined },
    });

    // Only the defined key should be listed
    expect(result.updatedProperties).toEqual(['hidden']);
    // The undefined key should not have been applied — disposition stays at its original value (0)
    expect(token.disposition).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deleteTokens — permission-denied path
// ---------------------------------------------------------------------------

describe('FoundryDataAccess.deleteTokens — permission denied', () => {
  it('throws ACCESS_DENIED when writes are not enabled', async () => {
    await expect(da.deleteTokens({ tokenIds: ['t1'] })).rejects.toThrow(
      ERROR_MESSAGES.ACCESS_DENIED
    );
  });
});

// ---------------------------------------------------------------------------
// deleteTokens — allowed paths
// ---------------------------------------------------------------------------

describe('FoundryDataAccess.deleteTokens — allowed', () => {
  beforeEach(() => {
    world.enableWrites();
  });

  it('throws wrapped error when there is no active scene', async () => {
    await expect(da.deleteTokens({ tokenIds: ['t1'] })).rejects.toThrow(
      'Failed to delete tokens: No active scene found'
    );
  });

  it('deletes a token that exists and returns success', async () => {
    const token = makeToken({ id: 't1', name: 'Bandit' });
    const scene = world.addScene({
      id: 'scene1',
      name: 'Road',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    const before = scene.tokens.size;
    const result = await da.deleteTokens({ tokenIds: ['t1'] });

    expect(result).toEqual({
      success: true,
      deletedCount: 1,
      deletedTokens: ['t1'],
      failedTokens: undefined, // no failures → undefined
    });
    expect(scene.tokens.size).toBe(before - 1);
  });

  it('puts missing token ids into failedTokens and still succeeds', async () => {
    const token = makeToken({ id: 't1', name: 'Soldier' });
    const scene = world.addScene({
      id: 'scene1',
      name: 'Fort',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    const result = await da.deleteTokens({ tokenIds: ['t1', 'missing'] });

    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedTokens).toEqual(['t1']);
    expect(result.failedTokens).toEqual(['missing']);
  });

  it('deletes multiple tokens in a single call', async () => {
    const t1 = makeToken({ id: 't1', name: 'Orc' });
    const t2 = makeToken({ id: 't2', name: 'Troll' });
    const scene = world.addScene({
      id: 'scene1',
      name: 'Dungeon',
      active: true,
      tokens: [t1, t2],
    });
    world.setActiveScene(scene.id);

    const result = await da.deleteTokens({ tokenIds: ['t1', 't2'] });

    expect(result.deletedCount).toBe(2);
    expect(result.deletedTokens).toEqual(['t1', 't2']);
    expect(result.failedTokens).toBeUndefined();
    expect(scene.tokens.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toggleTokenCondition — permission-denied path
// ---------------------------------------------------------------------------

describe('FoundryDataAccess.toggleTokenCondition — permission denied', () => {
  it('throws ACCESS_DENIED when writes are not enabled', async () => {
    await expect(
      da.toggleTokenCondition({ tokenId: 't1', conditionId: 'prone', active: true })
    ).rejects.toThrow(ERROR_MESSAGES.ACCESS_DENIED);
  });
});

// ---------------------------------------------------------------------------
// toggleTokenCondition — allowed paths
// ---------------------------------------------------------------------------

describe('FoundryDataAccess.toggleTokenCondition — allowed', () => {
  beforeEach(() => {
    world.enableWrites();
    // CONFIG.statusEffects is initialised to [] by the harness; populate it for
    // the condition-lookup tests. This must run after world.install() (which
    // happened in the outer beforeEach).
    (globalThis as any).CONFIG.statusEffects = [
      { id: 'prone', name: 'Prone', icon: 'icons/prone.svg' },
      { id: 'stunned', name: 'Stunned', icon: 'icons/stunned.svg' },
    ];
  });

  it('throws wrapped error when there is no active scene', async () => {
    await expect(
      da.toggleTokenCondition({ tokenId: 't1', conditionId: 'prone', active: true })
    ).rejects.toThrow('Failed to toggle token condition: No active scene found');
  });

  it('throws wrapped error when the token is not in the scene', async () => {
    const scene = world.addScene({ id: 'scene1', name: 'Arena', active: true });
    world.setActiveScene(scene.id);

    await expect(
      da.toggleTokenCondition({ tokenId: 'missing', conditionId: 'prone', active: true })
    ).rejects.toThrow('Failed to toggle token condition: Token missing not found in current scene');
  });

  it('throws wrapped error when the token has no actor', async () => {
    // Token without an actor property
    const token = makeToken({ id: 't1', name: 'Puppet' });
    const scene = world.addScene({
      id: 'scene1',
      name: 'Stage',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    await expect(
      da.toggleTokenCondition({ tokenId: 't1', conditionId: 'prone', active: true })
    ).rejects.toThrow('Failed to toggle token condition: Token t1 has no associated actor');
  });

  it('throws wrapped error when the conditionId is not in CONFIG.statusEffects', async () => {
    const actor = makeActor({ id: 'a1', name: 'Knight', effects: [] });
    const token = makeToken({ id: 't1', name: 'Knight', actor });
    const scene = world.addScene({
      id: 'scene1',
      name: 'Arena',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    await expect(
      da.toggleTokenCondition({ tokenId: 't1', conditionId: 'nonexistent', active: true })
    ).rejects.toThrow('Failed to toggle token condition: Condition not found: nonexistent');
  });

  it('active:true adds an ActiveEffect to the actor and returns the correct shape', async () => {
    const actor = makeActor({ id: 'a1', name: 'Barbarian', effects: [] });
    const token = makeToken({ id: 't1', name: 'Barbarian', actor });
    const scene = world.addScene({
      id: 'scene1',
      name: 'Battlefield',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    const before = actor.effects.size;
    const result = await da.toggleTokenCondition({
      tokenId: 't1',
      conditionId: 'prone',
      active: true,
    });

    expect(result).toEqual({
      success: true,
      tokenId: 't1',
      tokenName: 'Barbarian',
      conditionId: 'prone',
      conditionName: 'Prone',
      isActive: true,
      active: true,
      message: 'Applied prone to Barbarian',
    });
    // An effect was created on the actor
    expect(actor.effects.size).toBe(before + 1);
    // The effect should carry the statuses set
    const added = actor.effects.contents[0] as any;
    expect(added.statuses).toContain('prone');
  });

  it('active:false removes matching effects from the actor by statuses set', async () => {
    // Pre-create an effect that has statuses: new Set(['prone'])
    const existingEffect = makeEffect({
      id: 'eff1',
      name: 'Prone',
      statuses: ['prone'],
    });
    const actor = makeActor({ id: 'a1', name: 'Rogue', effects: [existingEffect] });
    const token = makeToken({ id: 't1', name: 'Rogue', actor });
    const scene = world.addScene({
      id: 'scene1',
      name: 'Alley',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    const result = await da.toggleTokenCondition({
      tokenId: 't1',
      conditionId: 'prone',
      active: false,
    });

    expect(result).toEqual({
      success: true,
      tokenId: 't1',
      tokenName: 'Rogue',
      conditionId: 'prone',
      conditionName: 'Prone',
      isActive: false,
      active: false,
      message: 'Removed prone from Rogue',
    });
    // Effect was removed
    expect(actor.effects.size).toBe(0);
  });

  it('active:false is a no-op (no error) when no matching effect exists', async () => {
    const actor = makeActor({ id: 'a1', name: 'Paladin', effects: [] });
    const token = makeToken({ id: 't1', name: 'Paladin', actor });
    const scene = world.addScene({
      id: 'scene1',
      name: 'Chapel',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    const result = await da.toggleTokenCondition({
      tokenId: 't1',
      conditionId: 'prone',
      active: false,
    });

    expect(result.success).toBe(true);
    expect(result.active).toBe(false);
    expect(actor.effects.size).toBe(0);
  });

  it('matches condition by name (case-insensitive) as well as by id', async () => {
    const actor = makeActor({ id: 'a1', name: 'Wizard', effects: [] });
    const token = makeToken({ id: 't1', name: 'Wizard', actor });
    const scene = world.addScene({
      id: 'scene1',
      name: 'Tower',
      active: true,
      tokens: [token],
    });
    world.setActiveScene(scene.id);

    // 'STUNNED' matches the condition whose name is 'Stunned' via case-insensitive compare
    const result = await da.toggleTokenCondition({
      tokenId: 't1',
      conditionId: 'STUNNED',
      active: true,
    });

    expect(result.conditionId).toBe('STUNNED');
    expect(result.conditionName).toBe('Stunned');
    expect(actor.effects.size).toBe(1);
  });
});
