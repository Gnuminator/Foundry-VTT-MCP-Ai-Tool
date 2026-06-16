/**
 * Characterization tests for the combat *mutation / compute* methods of
 * `FoundryDataAccess` (the ones `data-access.combat.test.ts` + the reads net do
 * NOT cover):
 *   - advanceCombatTurn
 *   - setInitiative
 *   - rollInitiativeForNpcs
 *   - applyDamageAndHealing
 *   - rollSavingThrows
 *   - manageRest
 *   - suggestBalancedEncounter
 *
 * These pin the *current* behaviour so the Phase 9 from-scratch rewrite of the
 * combat domain can be verified to parity across the whole surface (the wave-1
 * lesson: a parity net is required per method, not per domain). The combat-reads
 * rewrite deliberately left these 7 methods byte-identical pending this net.
 *
 * Driven through the Phase 9 Foundry-mock harness (in-memory, no browser).
 *
 * Harness gaps worked around locally (never editing shared harness files):
 *   - `makeCombat` returns a plain object with no methods; the domain calls
 *     `combat.update/nextTurn/setInitiative/rollNPC/rollAll/rollInitiative`, so
 *     those are attached inline as `vi.fn()` stubs (mirrors the `withUpdate`
 *     token pattern in the token-manipulation net).
 *   - `makeActor` has no dnd5e action methods; `applyDamage/applyTempHP/
 *     rollSavingThrow/rollSkill/rollAbilityCheck/rollAbilitySave/rollAbilityTest/
 *     shortRest/longRest` are attached per-test as `vi.fn()` stubs.
 *   - The dnd5e-version branch (`systemMajor()`) and the system-id guard
 *     (`requireDnd5e`) are exercised by overriding `game.system.version` /
 *     `game.system.id` after `world.install()`.
 *   - Targets resolve via `shared.resolveTargetActor`, which (with no current
 *     scene) falls back to `game.actors` by id/name — so target actors are added
 *     as world actors and addressed by name.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestWorld,
  makeActor,
  makeCombat,
  makeCombatant,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
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
// Helpers
// ---------------------------------------------------------------------------

/** Register an active combat with the mutation methods the domain calls. */
function installCombat(opts: Parameters<typeof makeCombat>[0] = {}): any {
  const combat = world.setCombat(opts);
  combat.update = vi.fn((changes: any) => {
    Object.assign(combat, changes);
    return Promise.resolve(combat);
  });
  combat.nextTurn = vi.fn(() => Promise.resolve());
  combat.setInitiative = vi.fn(() => Promise.resolve());
  combat.rollNPC = vi.fn(() => Promise.resolve());
  combat.rollAll = vi.fn(() => Promise.resolve());
  combat.rollInitiative = vi.fn(() => Promise.resolve());
  return combat;
}

/** Add a world actor (resolved by `resolveTargetActor`) with dnd5e hp. */
function addActorWithHp(name: string, hp: { value: number; max?: number; temp?: number }): any {
  return world.addActor({
    name,
    type: 'character',
    system: { attributes: { hp: { max: hp.value, temp: 0, ...hp } } },
  });
}

// ===========================================================================
// advanceCombatTurn
// ===========================================================================

describe('FoundryDataAccess — advanceCombatTurn', () => {
  it('throws when there is no active combat', async () => {
    await expect(da.advanceCombatTurn({})).rejects.toThrow('No active combat encounter.');
  });

  it('advances to the next turn (no skipTo) via combat.nextTurn()', async () => {
    const combat = installCombat({
      turns: [makeCombatant({ id: 'c1', name: 'Hero' })],
      turn: 1,
      round: 3,
    });
    combat.combatant = { name: 'Goblin' };

    const result = await da.advanceCombatTurn({});

    expect(combat.nextTurn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, round: 3, turn: 1, current: 'Goblin' });
  });

  it('skipTo by combatant name (case-insensitive) updates the turn index', async () => {
    const combat = installCombat({
      turns: [
        makeCombatant({ id: 'c1', name: 'Alice' }),
        makeCombatant({ id: 'c2', name: 'Goblin Boss' }),
      ],
      turn: 0,
      round: 2,
    });

    const result = await da.advanceCombatTurn({ skipTo: 'goblin boss' });

    expect(combat.update).toHaveBeenCalledWith({ turn: 1 });
    expect(result).toEqual({ success: true, round: 2, turn: 1, current: 'Goblin Boss' });
  });

  it('skipTo matches an actor id as well as a name', async () => {
    const combat = installCombat({
      turns: [
        makeCombatant({ id: 'c1', name: 'Alice', actor: makeActor({ id: 'actor-x' }) }),
        makeCombatant({ id: 'c2', name: 'Bob', actor: makeActor({ id: 'actor-y' }) }),
      ],
      turn: 0,
      round: 1,
    });

    const result = await da.advanceCombatTurn({ skipTo: 'actor-y' });

    expect(combat.update).toHaveBeenCalledWith({ turn: 1 });
    expect(result.turn).toBe(1);
    expect(result.current).toBe('Bob');
  });

  it('throws when skipTo matches no combatant', async () => {
    installCombat({ turns: [makeCombatant({ id: 'c1', name: 'Alice' })], turn: 0, round: 1 });

    await expect(da.advanceCombatTurn({ skipTo: 'nobody' })).rejects.toThrow(
      'Combatant not found: nobody'
    );
  });
});

// ===========================================================================
// setInitiative
// ===========================================================================

describe('FoundryDataAccess — setInitiative', () => {
  it('throws when there is no active combat', async () => {
    await expect(da.setInitiative({ combatantName: 'Hero', initiative: 18 })).rejects.toThrow(
      'No active combat encounter.'
    );
  });

  it('finds the combatant in combat.turns and calls combat.setInitiative(id, value)', async () => {
    const combat = installCombat({
      turns: [makeCombatant({ id: 'c1', name: 'Hero' })],
      turn: 0,
      round: 1,
    });

    const result = await da.setInitiative({ combatantName: 'hero', initiative: 17 });

    expect(combat.setInitiative).toHaveBeenCalledWith('c1', 17);
    expect(result).toEqual({ success: true, combatant: 'Hero', initiative: 17 });
  });

  it('prefers combat.combatants.contents and matches by actor name', async () => {
    const combat = installCombat({ turns: [], turn: 0, round: 1 });
    combat.combatants = {
      contents: [
        makeCombatant({ id: 'cb9', name: 'Token Name', actor: makeActor({ name: 'Varis' }) }),
      ],
    };

    const result = await da.setInitiative({ combatantName: 'varis', initiative: 9 });

    expect(combat.setInitiative).toHaveBeenCalledWith('cb9', 9);
    expect(result.combatant).toBe('Token Name');
  });

  it('throws when the combatant is not found', async () => {
    installCombat({ turns: [makeCombatant({ id: 'c1', name: 'Hero' })], turn: 0, round: 1 });

    await expect(da.setInitiative({ combatantName: 'ghost', initiative: 5 })).rejects.toThrow(
      'Combatant not found: ghost'
    );
  });
});

// ===========================================================================
// rollInitiativeForNpcs
// ===========================================================================

describe('FoundryDataAccess — rollInitiativeForNpcs', () => {
  it('throws when there is no active combat', async () => {
    await expect(da.rollInitiativeForNpcs({})).rejects.toThrow('No active combat encounter.');
  });

  it("default scope 'npcs' calls combat.rollNPC() and returns the order", async () => {
    const combat = installCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Hero',
          initiative: 20,
          actor: makeActor({ hasPlayerOwner: true }),
        }),
        makeCombatant({
          id: 'c2',
          name: 'Goblin',
          initiative: 12,
          actor: makeActor({ hasPlayerOwner: false }),
        }),
      ],
      round: 1,
    });

    const result = await da.rollInitiativeForNpcs({});

    expect(combat.rollNPC).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      scope: 'npcs',
      round: 1,
      order: [
        { name: 'Hero', initiative: 20, isPC: true },
        { name: 'Goblin', initiative: 12, isPC: false },
      ],
    });
  });

  it("scope 'all' calls combat.rollAll()", async () => {
    const combat = installCombat({ turns: [], round: 2 });

    const result = await da.rollInitiativeForNpcs({ scope: 'all' });

    expect(combat.rollAll).toHaveBeenCalledTimes(1);
    expect(combat.rollNPC).not.toHaveBeenCalled();
    expect(result.scope).toBe('all');
  });

  it("scope 'missing' rolls only combatants without an initiative value", async () => {
    const combat = installCombat({ turns: [], round: 1 });
    combat.combatants = {
      contents: [
        makeCombatant({ id: 'c1', name: 'Has', initiative: 15 }),
        makeCombatant({ id: 'c2', name: 'Missing1', initiative: null }),
        makeCombatant({ id: 'c3', name: 'Missing2', initiative: undefined }),
      ],
    };

    await da.rollInitiativeForNpcs({ scope: 'missing' });

    expect(combat.rollInitiative).toHaveBeenCalledWith(['c2', 'c3']);
  });

  it("scope 'missing' does not call rollInitiative when none are missing", async () => {
    const combat = installCombat({ turns: [], round: 1 });
    combat.combatants = { contents: [makeCombatant({ id: 'c1', name: 'Has', initiative: 15 })] };

    await da.rollInitiativeForNpcs({ scope: 'missing' });

    expect(combat.rollInitiative).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// applyDamageAndHealing
// ===========================================================================

describe('FoundryDataAccess — applyDamageAndHealing', () => {
  it('throws when the system is not dnd5e', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    await expect(da.applyDamageAndHealing({ targets: ['x'], amount: 5 })).rejects.toThrow(
      'apply-damage-and-healing requires the dnd5e game system'
    );
  });

  it('throws when targets is missing/empty', async () => {
    await expect(da.applyDamageAndHealing({ targets: [], amount: 5 })).rejects.toThrow(
      'targets array is required'
    );
  });

  it('throws when amount is negative or not finite', async () => {
    await expect(da.applyDamageAndHealing({ targets: ['Hero'], amount: -1 })).rejects.toThrow(
      'amount must be a non-negative number'
    );
  });

  it('applies typed damage via actor.applyDamage and reports hpBefore/hpAfter', async () => {
    const actor = addActorWithHp('Hero', { value: 20, max: 20, temp: 0 });
    actor.applyDamage = vi.fn((changes: any[]) => {
      actor.system.attributes.hp.value -= changes[0].value;
      return Promise.resolve();
    });

    const result = await da.applyDamageAndHealing({
      targets: ['Hero'],
      amount: 8,
      type: 'fire',
      multiplier: 2,
      ignoreResistance: true,
    });

    expect(actor.applyDamage).toHaveBeenCalledWith([{ value: 8, type: 'fire' }], {
      multiplier: 2,
      ignore: true,
    });
    expect(result.success).toBe(true);
    expect(result.kind).toBe('damage');
    expect(result.amount).toBe(8);
    expect(result.type).toBe('fire');
    expect(result.results).toEqual([
      {
        target: 'Hero',
        kind: 'damage',
        hpBefore: { value: 20, temp: 0 },
        hpAfter: { value: 12, temp: 0 },
      },
    ]);
  });

  it('healing calls applyDamage with a healing entry', async () => {
    const actor = addActorWithHp('Cleric', { value: 5, max: 20, temp: 0 });
    actor.applyDamage = vi.fn((changes: any[]) => {
      actor.system.attributes.hp.value += changes[0].value;
      return Promise.resolve();
    });

    const result = await da.applyDamageAndHealing({
      targets: ['Cleric'],
      amount: 6,
      kind: 'healing',
    });

    expect(actor.applyDamage).toHaveBeenCalledWith([{ value: 6, type: 'healing' }]);
    expect(result.results[0]).toEqual({
      target: 'Cleric',
      kind: 'healing',
      hpBefore: { value: 5, temp: 0 },
      hpAfter: { value: 11, temp: 0 },
    });
  });

  it('temp HP calls actor.applyTempHP', async () => {
    const actor = addActorWithHp('Wizard', { value: 10, max: 10, temp: 0 });
    actor.applyTempHP = vi.fn((amt: number) => {
      actor.system.attributes.hp.temp = amt;
      return Promise.resolve();
    });

    const result = await da.applyDamageAndHealing({ targets: ['Wizard'], amount: 5, kind: 'temp' });

    expect(actor.applyTempHP).toHaveBeenCalledWith(5);
    expect(result.results[0].hpAfter).toEqual({ value: 10, temp: 5 });
  });

  it('records an error entry for an unresolved target', async () => {
    const result = await da.applyDamageAndHealing({ targets: ['ghost'], amount: 4 });

    expect(result.results).toEqual([{ target: 'ghost', error: 'actor/token not found' }]);
  });
});

// ===========================================================================
// rollSavingThrows
// ===========================================================================

describe('FoundryDataAccess — rollSavingThrows', () => {
  it('throws when the system is not dnd5e', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    await expect(
      da.rollSavingThrows({ targets: ['x'], rollType: 'save', ability: 'dex' })
    ).rejects.toThrow('roll-saving-throws requires the dnd5e game system');
  });

  it('throws when targets is empty', async () => {
    await expect(
      da.rollSavingThrows({ targets: [], rollType: 'save', ability: 'dex' })
    ).rejects.toThrow('targets array is required');
  });

  it('throws when a skill roll has no skill', async () => {
    await expect(da.rollSavingThrows({ targets: ['Hero'], rollType: 'skill' })).rejects.toThrow(
      'skill is required for skill rolls'
    );
  });

  it('throws when a save/check roll has no ability', async () => {
    await expect(da.rollSavingThrows({ targets: ['Hero'], rollType: 'save' })).rejects.toThrow(
      'ability is required for save/check rolls'
    );
  });

  it('dnd5e v4+ save: dispatches rollSavingThrow(config, dialog, message) and reads isSuccess', async () => {
    // default harness systemVersion is 4.0.0 → major 4
    const actor = addActorWithHp('Hero', { value: 20 });
    actor.rollSavingThrow = vi.fn(() => Promise.resolve({ total: 18, isSuccess: true }));

    const result = await da.rollSavingThrows({
      targets: ['Hero'],
      rollType: 'save',
      ability: 'dex',
      dc: 15,
    });

    expect(actor.rollSavingThrow).toHaveBeenCalledWith(
      { ability: 'dex', target: 15 },
      { configure: false },
      { create: true, rollMode: 'gmroll' }
    );
    expect(result).toEqual({
      success: true,
      rollType: 'save',
      dc: 15,
      results: [{ target: 'Hero', total: 18, success: true }],
    });
  });

  it('v4+ skill: unwraps an array return and computes success from total vs dc when no isSuccess', async () => {
    const actor = addActorWithHp('Rogue', { value: 16 });
    actor.rollSkill = vi.fn(() => Promise.resolve([{ total: 22 }]));

    const result = await da.rollSavingThrows({
      targets: ['Rogue'],
      rollType: 'skill',
      skill: 'ste',
      dc: 15,
      isPublic: true,
    });

    expect(actor.rollSkill).toHaveBeenCalledWith(
      { skill: 'ste', target: 15 },
      { configure: false },
      { create: true, rollMode: 'publicroll' }
    );
    expect(result.results[0]).toEqual({ target: 'Rogue', total: 22, success: true });
  });

  it('success is null when no dc is supplied', async () => {
    const actor = addActorWithHp('Hero', { value: 20 });
    actor.rollAbilityCheck = vi.fn(() => Promise.resolve({ total: 11 }));

    const result = await da.rollSavingThrows({
      targets: ['Hero'],
      rollType: 'check',
      ability: 'str',
    });

    expect(result.results[0]).toEqual({ target: 'Hero', total: 11, success: null });
  });

  it('dnd5e v3 save: dispatches rollAbilitySave(ability, opts) with targetValue', async () => {
    (globalThis as any).game.system.version = '3.5.0';
    const actor = addActorWithHp('Knight', { value: 25 });
    actor.rollAbilitySave = vi.fn(() => Promise.resolve({ total: 9 }));

    const result = await da.rollSavingThrows({
      targets: ['Knight'],
      rollType: 'save',
      ability: 'con',
      dc: 12,
    });

    expect(actor.rollAbilitySave).toHaveBeenCalledWith('con', {
      fastForward: true,
      chatMessage: true,
      rollMode: 'gmroll',
      targetValue: 12,
    });
    expect(result.results[0]).toEqual({ target: 'Knight', total: 9, success: false });
  });
});

// ===========================================================================
// manageRest
// ===========================================================================

describe('FoundryDataAccess — manageRest', () => {
  it('throws when the system is not dnd5e', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    await expect(da.manageRest({ targets: ['x'], restType: 'long' })).rejects.toThrow(
      'manage-rest requires the dnd5e game system'
    );
  });

  it('throws when targets is empty', async () => {
    await expect(da.manageRest({ targets: [], restType: 'long' })).rejects.toThrow(
      'targets array is required'
    );
  });

  it('long rest: calls longRest with newDay defaulting to true and reads deltas.hitPoints', async () => {
    const actor = addActorWithHp('Hero', { value: 10, max: 20 });
    actor.longRest = vi.fn(() => Promise.resolve({ deltas: { hitPoints: 10, hitDice: 2 } }));

    const result = await da.manageRest({ targets: ['Hero'], restType: 'long' });

    expect(actor.longRest).toHaveBeenCalledWith({
      dialog: false,
      chat: false,
      autoHD: true,
      newDay: true,
    });
    expect(result).toEqual({
      success: true,
      restType: 'long',
      results: [
        { target: 'Hero', hpRecovered: 10, hitDiceRecovered: 2, hp: { value: 10, max: 20 } },
      ],
    });
  });

  it('short rest: newDay defaults to false and falls back to dhp/dhd deltas', async () => {
    const actor = addActorWithHp('Fighter', { value: 12, max: 18 });
    actor.shortRest = vi.fn(() => Promise.resolve({ dhp: 4, dhd: 1 }));

    const result = await da.manageRest({ targets: ['Fighter'], restType: 'short' });

    expect(actor.shortRest).toHaveBeenCalledWith({
      dialog: false,
      chat: false,
      autoHD: true,
      newDay: false,
    });
    expect(result.results[0]).toEqual({
      target: 'Fighter',
      hpRecovered: 4,
      hitDiceRecovered: 1,
      hp: { value: 12, max: 18 },
    });
  });
});

// ===========================================================================
// suggestBalancedEncounter
// ===========================================================================

describe('FoundryDataAccess — suggestBalancedEncounter', () => {
  it('uses explicit partyLevels with the built-in 2014 DMG table (no CONFIG.DND5E)', async () => {
    // harness CONFIG.DND5E = {} → no ENCOUNTER_DIFFICULTY → model '2014'; CR_EXP_LEVELS absent → []
    const result = await da.suggestBalancedEncounter({ partyLevels: [5, 5, 5, 5] });

    expect(result.success).toBe(true);
    expect(result.model).toBe('2014');
    expect(result.difficulty).toBe('moderate');
    expect(result.partyLevels).toEqual([5, 5, 5, 5]);
    // T[5] moderate (col 1) = 500 each × 4
    expect(result.xpBudget).toBe(2000);
    // CR_EXP_LEVELS is empty in the harness → no creature suggestions resolve above 0
    expect(result.suggestions.singleCreatureMaxCR).toBe(0);
    expect(result.suggestions.mixes).toEqual([
      { count: 1, crEach: 0, xpEach: 0, totalXp: 0 },
      { count: 2, crEach: 0, xpEach: 0, totalXp: 0 },
      { count: 4, crEach: 0, xpEach: 0, totalXp: 0 },
      { count: 6, crEach: 0, xpEach: 0, totalXp: 0 },
    ]);
  });

  it("maps difficulty 'high' to the 2014 'deadly' column", async () => {
    // T[5] deadly (col 3) = 1100
    const result = await da.suggestBalancedEncounter({ partyLevels: [5], difficulty: 'high' });

    expect(result.xpBudget).toBe(1100);
    expect(result.difficulty).toBe('high');
  });

  it('derives party levels from player-owned character actors when none are passed', async () => {
    world.addActor({
      name: 'PC1',
      type: 'character',
      hasPlayerOwner: true,
      system: { details: { level: 3 } },
    });
    world.addActor({
      name: 'PC2',
      type: 'character',
      hasPlayerOwner: true,
      system: { details: { level: 4 } },
    });
    world.addActor({
      name: 'NPC',
      type: 'npc',
      hasPlayerOwner: false,
      system: { details: { level: 9 } },
    });

    const result = await da.suggestBalancedEncounter({});

    // only the two player-owned characters contribute; NPC is excluded
    expect(result.partyLevels.sort()).toEqual([3, 4]);
    // T[3] + T[4] moderate (col 1) = 150 + 250 = 400
    expect(result.xpBudget).toBe(400);
  });

  it('throws when no party levels are available', async () => {
    // no partyLevels passed and no player-owned characters in the world
    await expect(da.suggestBalancedEncounter({})).rejects.toThrow(
      'No party levels available — pass partyLevels.'
    );
  });
});
