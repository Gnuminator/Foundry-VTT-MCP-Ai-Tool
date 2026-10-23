/**
 * Unit tests for the combat plans: `planCombatChange` turns one `plan-combat-change` request
 * into guarded ops. Nothing is written. Driven through the Foundry-mock harness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMBAT_PLAN_QUERY, planCombatChange, startedOnCreate } from './combat-plan.js';
import { COMBAT_PLAN_QUERY as SHARED_QUERY } from '../../../shared/src/combat-change.js';
import { createTestWorld, makeToken, type TestWorld } from './test-support/foundry-mock/index.js';

let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

it('pins the query name to the shared contract', () => {
  expect(COMBAT_PLAN_QUERY).toBe(SHARED_QUERY);
});

function arena(tokens: any[], extra: Record<string, any> = {}): any {
  const scene = world.addScene({
    id: 'scene1',
    name: 'Field',
    uuid: 'Scene.scene1',
    tokens,
    ...extra,
  });
  world.setActiveScene(scene.id);
  return scene;
}

/** A token with an actor: `pc` is a player-owned character. */
function fighter(id: string, name: string, disposition: number, pc = false): any {
  return makeToken({
    id,
    name,
    disposition,
    actorId: `actor-${id}`,
    actor: { id: `actor-${id}`, type: pc ? 'character' : 'npc', hasPlayerOwner: pc },
  });
}

describe('start', () => {
  it('takes the player characters and the Hostile tokens, not Neutral or Friendly', async () => {
    arena([
      fighter('t1', 'Brannoc', 1, true),
      fighter('t2', 'Wolf', -1),
      fighter('t3', 'Shopkeeper', 0),
      fighter('t4', 'Guard', 1),
    ]);
    const plan = await planCombatChange({ action: 'start' });
    expect(plan.combatants).toEqual(['Brannoc', 'Wolf']);
    expect(plan.summary).toBe('Start combat on "Field" with 2 tokens');
    expect(plan.ops).toEqual([
      {
        kind: 'create',
        documentName: 'Combat',
        data: {
          scene: 'scene1',
          active: true,
          round: 1,
          turn: 0,
          combatants: [
            { tokenId: 't1', sceneId: 'scene1', actorId: 'actor-t1', hidden: false },
            { tokenId: 't2', sceneId: 'scene1', actorId: 'actor-t2', hidden: false },
          ],
        },
      },
    ]);
  });

  it('takes exactly the chosen tokens, once each, and lists what it left out', async () => {
    arena([fighter('t1', 'Brannoc', 1, true), fighter('t3', 'Shopkeeper', 0)]);
    const plan = await planCombatChange({ action: 'start', tokenIds: ['t3', 't3', 'gone'] });
    expect(plan.combatants).toEqual(['Shopkeeper']);
    expect(plan.skipped).toEqual(['gone (not on this scene)']);
  });

  it('marks a hidden token hidden and leaves out a token with no actor', async () => {
    arena([
      makeToken({
        id: 't1',
        name: 'Ambusher',
        disposition: -1,
        hidden: true,
        actorId: 'a1',
        actor: { id: 'a1', type: 'npc' },
      }),
      makeToken({ id: 't2', name: 'Marker', disposition: -1 }),
    ]);
    const plan = await planCombatChange({ action: 'start' });
    expect(plan.combatants).toEqual(['Ambusher']);
    expect((plan.ops[0] as any).data.combatants[0].hidden).toBe(true);
    expect(plan.skipped).toEqual(['Marker (no actor)']);
  });

  it('refuses when a combat already runs on the scene, or nobody can fight', async () => {
    arena([fighter('t1', 'Wolf', -1)]);
    await expect(planCombatChange({ action: 'start', tokenIds: ['nope'] })).rejects.toThrow(
      'None of the chosen tokens can fight.'
    );
    world.setCombat({ id: 'c1', scene: { id: 'scene1' } });
    await expect(planCombatChange({ action: 'start' })).rejects.toThrow(
      'A combat already runs on "Field"'
    );
  });

  it('refuses a scene with nobody on the default side', async () => {
    arena([fighter('t3', 'Shopkeeper', 0)]);
    await expect(planCombatChange({ action: 'start' })).rejects.toThrow(
      'No player character or Hostile token'
    );
  });
});

describe('startedOnCreate', () => {
  it('is true for a combat created already begun', () => {
    expect(startedOnCreate({ round: 1 }, { 'foundry-mcp-bridge': { changeMode: 'apply' } })).toBe(
      true
    );
    expect(startedOnCreate({ round: 1 }, {})).toBe(true);
  });

  it('is false for round 0, and for a combat an undo or rollback re-creates', () => {
    expect(startedOnCreate({ round: 0 }, {})).toBe(false);
    expect(startedOnCreate({}, undefined)).toBe(false);
    expect(startedOnCreate({ round: 3 }, { 'foundry-mcp-bridge': { changeMode: 'undo' } })).toBe(
      false
    );
    expect(
      startedOnCreate({ round: 3 }, { 'foundry-mcp-bridge': { changeMode: 'rollback' } })
    ).toBe(false);
  });
});

describe('end', () => {
  it('plans one delete of the active combat', async () => {
    world.setCombat({
      id: 'c1',
      uuid: 'Combat.c1',
      round: 3,
      scene: { name: 'Field' },
      combatants: [{ id: 'a' }, { id: 'b' }],
    });
    const plan = await planCombatChange({ action: 'end' });
    expect(plan.ops).toEqual([{ kind: 'delete', uuid: 'Combat.c1' }]);
    expect(plan.combatId).toBe('c1');
    expect(plan.warning).toContain('Undo');
    expect(plan.summary).toBe('End combat on "Field" (round 3, 2 combatants)');
  });

  it('falls back to Combat.<id> when the document has no uuid', async () => {
    world.setCombat({ id: 'c9', round: 1, combatants: [{ id: 'a' }] });
    const plan = await planCombatChange({ action: 'end' });
    expect(plan.ops).toEqual([{ kind: 'delete', uuid: 'Combat.c9' }]);
    expect(plan.summary).toBe('End combat (round 1, 1 combatant)');
  });

  it('picks a named combat over the active one', async () => {
    world.setCombat({ id: 'other', uuid: 'Combat.other' });
    world.setCombat({ id: 'active', uuid: 'Combat.active' });
    const plan = await planCombatChange({ action: 'end', combatId: 'other' });
    expect(plan.ops).toEqual([{ kind: 'delete', uuid: 'Combat.other' }]);
  });

  it('refuses with no active combat or an unknown id', async () => {
    await expect(planCombatChange({ action: 'end' })).rejects.toThrow('No active combat');
    world.setCombat({ id: 'c1' });
    await expect(planCombatChange({ action: 'end', combatId: 'nope' })).rejects.toThrow(
      'Combat not found: nope'
    );
  });

  it('refuses an unknown action', async () => {
    await expect(planCombatChange({ action: 'pause' })).rejects.toThrow('Unknown action "pause"');
  });
});
