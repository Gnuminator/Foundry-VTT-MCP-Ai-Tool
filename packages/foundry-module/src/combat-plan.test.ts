/**
 * Unit tests for the combat plans: `planCombatChange` turns one `plan-combat-change` request
 * into guarded ops. Nothing is written. Driven through the Foundry-mock harness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMBAT_PLAN_QUERY, planCombatChange } from './combat-plan.js';
import { COMBAT_PLAN_QUERY as SHARED_QUERY } from '../../../shared/src/combat-change.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';

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
