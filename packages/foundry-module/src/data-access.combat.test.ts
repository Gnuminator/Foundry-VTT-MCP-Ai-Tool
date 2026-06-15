/**
 * Characterization tests for `getCombatState` (and the private helper
 * `actorConditionNames` exercised indirectly through it) in `FoundryDataAccess`.
 *
 * These pin the *current* upstream-derived behavior so a from-scratch
 * reimplementation in Phase 9 can be verified to parity.
 *
 * Harness: Phase 9 Foundry-mock (`src/test-support/foundry-mock/index.ts`).
 * Mirror of: `src/data-access.reads.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestWorld,
  makeActor,
  makeEffect,
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

/** A minimal HP block for makeActor system override. */
function hp(value: number, max = 20, temp = 0) {
  return { attributes: { hp: { value, max, temp } } };
}

/** An HP block that also carries death-save counters. */
function hpDowned(success = 0, failure = 0) {
  return { attributes: { hp: { value: 0, max: 20, temp: 0 }, death: { success, failure } } };
}

// ---------------------------------------------------------------------------
// No-combat cases
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getCombatState: no combat', () => {
  it('returns active:false with a descriptive message when no combat exists', async () => {
    // Neither game.combat nor game.combats holds anything.
    const result = await da.getCombatState();

    expect(result).toEqual({
      success: true,
      active: false,
      message: 'No active or recent combat encounter.',
    });
  });
});

// ---------------------------------------------------------------------------
// Basic shape with a started combat
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getCombatState: top-level shape', () => {
  it('returns success:true with round/turn/current/combatants/downed when combat exists', async () => {
    const actor = makeActor({ type: 'character', system: hp(10), hasPlayerOwner: true });
    world.setCombat({
      turns: [
        makeCombatant({ id: 'c1', name: 'Hero', initiative: 20, actor, token: { disposition: 1 } }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();

    expect(result.success).toBe(true);
    expect(result.active).toBe(true);
    expect(result.round).toBe(1);
    expect(result.turn).toBe(0);
    expect(result.combatants).toHaveLength(1);
    expect(result.downed).toEqual([]);
    // current mirrors combatants[turn]
    expect(result.current).toEqual(result.combatants[0]);
  });

  it('returns active:false when combat.started is false', async () => {
    const actor = makeActor({ type: 'npc', system: hp(8) });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Goblin',
          initiative: 12,
          actor,
          token: { disposition: -1 },
        }),
      ],
      turn: 0,
      round: 0,
      started: false,
    });

    const result = await da.getCombatState();

    expect(result.active).toBe(false);
    expect(result.round).toBe(0);
  });

  it('sets current to null when turn index exceeds combatants length', async () => {
    // turn=1 but only one combatant (index 0) — combatants[1] is undefined → null
    const actor = makeActor({ type: 'npc', system: hp(5) });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Goblin',
          initiative: 10,
          actor,
          token: { disposition: -1 },
        }),
      ],
      turn: 1,
      round: 2,
      started: true,
    });

    const result = await da.getCombatState();

    expect(result.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-combatant isCurrentTurn / actedThisRound
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getCombatState: turn tracking', () => {
  it('marks only the combatant at turn index as isCurrentTurn', async () => {
    const actorA = makeActor({ type: 'character', system: hp(10), hasPlayerOwner: true });
    const actorB = makeActor({ type: 'npc', system: hp(8) });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Alice',
          initiative: 20,
          actor: actorA,
          token: { disposition: 1 },
        }),
        makeCombatant({
          id: 'c2',
          name: 'Goblin',
          initiative: 15,
          actor: actorB,
          token: { disposition: -1 },
        }),
      ],
      turn: 1,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();

    expect(result.combatants[0].isCurrentTurn).toBe(false);
    expect(result.combatants[1].isCurrentTurn).toBe(true);
  });

  it('actedThisRound is true for combatants whose index < current turn (started)', async () => {
    const actorA = makeActor({ type: 'character', system: hp(10), hasPlayerOwner: true });
    const actorB = makeActor({ type: 'npc', system: hp(8) });
    const actorC = makeActor({ type: 'npc', system: hp(6) });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Alice',
          initiative: 20,
          actor: actorA,
          token: { disposition: 1 },
        }),
        makeCombatant({
          id: 'c2',
          name: 'Goblin',
          initiative: 15,
          actor: actorB,
          token: { disposition: -1 },
        }),
        makeCombatant({
          id: 'c3',
          name: 'Orc',
          initiative: 10,
          actor: actorC,
          token: { disposition: -1 },
        }),
      ],
      turn: 2,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();

    expect(result.combatants[0].actedThisRound).toBe(true); // idx 0 < 2
    expect(result.combatants[1].actedThisRound).toBe(true); // idx 1 < 2
    expect(result.combatants[2].actedThisRound).toBe(false); // idx 2 === 2 (current)
  });

  it('actedThisRound is always false when combat has not started', async () => {
    const actorA = makeActor({ type: 'character', system: hp(10), hasPlayerOwner: true });
    const actorB = makeActor({ type: 'npc', system: hp(8) });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Alice',
          initiative: 20,
          actor: actorA,
          token: { disposition: 1 },
        }),
        makeCombatant({
          id: 'c2',
          name: 'Goblin',
          initiative: 15,
          actor: actorB,
          token: { disposition: -1 },
        }),
      ],
      turn: 1,
      round: 0,
      started: false,
    });

    const result = await da.getCombatState();

    expect(result.combatants[0].actedThisRound).toBe(false);
    expect(result.combatants[1].actedThisRound).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Category: pc / enemy / npc
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getCombatState: category', () => {
  it('assigns category "pc" for hasPlayerOwner + type character', async () => {
    const actor = makeActor({ type: 'character', system: hp(10), hasPlayerOwner: true });
    world.setCombat({
      turns: [
        makeCombatant({ id: 'c1', name: 'Hero', initiative: 18, actor, token: { disposition: 1 } }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].category).toBe('pc');
    expect(result.combatants[0].isPC).toBe(true);
  });

  it('assigns category "enemy" for disposition -1 and no player ownership', async () => {
    const actor = makeActor({ type: 'npc', system: hp(12), hasPlayerOwner: false });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Goblin',
          initiative: 14,
          actor,
          token: { disposition: -1 },
        }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].category).toBe('enemy');
    expect(result.combatants[0].isPC).toBe(false);
  });

  it('assigns category "npc" for non-hostile disposition and no player ownership', async () => {
    const actor = makeActor({ type: 'npc', system: hp(8), hasPlayerOwner: false });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Merchant',
          initiative: 9,
          actor,
          token: { disposition: 0 },
        }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].category).toBe('npc');
    expect(result.combatants[0].isPC).toBe(false);
  });

  it('does not classify as "pc" when actor type is not character even with player ownership', async () => {
    // hasPlayerOwner=true but type='npc' → isPC false → falls through to disposition check
    const actor = makeActor({ type: 'npc', system: hp(10), hasPlayerOwner: true });
    world.setCombat({
      turns: [
        makeCombatant({ id: 'c1', name: 'Pet', initiative: 11, actor, token: { disposition: 1 } }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].isPC).toBe(false);
    expect(result.combatants[0].category).toBe('npc'); // disposition 1, not -1
  });
});

// ---------------------------------------------------------------------------
// HP
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getCombatState: HP field', () => {
  it('maps hp value/max/temp from the actor system', async () => {
    const actor = makeActor({
      type: 'character',
      system: { attributes: { hp: { value: 7, max: 20, temp: 3 } } },
      hasPlayerOwner: true,
    });
    world.setCombat({
      turns: [
        makeCombatant({ id: 'c1', name: 'Hero', initiative: 20, actor, token: { disposition: 1 } }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].hp).toEqual({ value: 7, max: 20, temp: 3 });
  });

  it('returns hp:null when the actor has no hp block', async () => {
    const actor = makeActor({ type: 'npc', system: {} });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Spirit',
          initiative: 15,
          actor,
          token: { disposition: -1 },
        }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].hp).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Defeated / downed list
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getCombatState: defeated + downed', () => {
  it('marks a combatant defeated when isDefeated is true (overrides hp)', async () => {
    const actor = makeActor({ type: 'npc', system: hp(5), hasPlayerOwner: false });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Goblin',
          initiative: 12,
          actor,
          token: { disposition: -1 },
          isDefeated: true,
        }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].defeated).toBe(true);
    expect(result.downed).toHaveLength(1);
  });

  it('marks a combatant defeated when hp.value <= 0 (no explicit isDefeated)', async () => {
    const actor = makeActor({ type: 'character', system: hpDowned(), hasPlayerOwner: true });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Downed Hero',
          initiative: 18,
          actor,
          token: { disposition: 1 },
        }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].defeated).toBe(true);
    expect(result.downed).toHaveLength(1);
    expect(result.downed[0].name).toBe('Downed Hero');
  });

  it('includes death saves successes and failures when hp.value <= 0', async () => {
    const actor = makeActor({
      type: 'character',
      system: {
        attributes: { hp: { value: 0, max: 20, temp: 0 }, death: { success: 2, failure: 1 } },
      },
      hasPlayerOwner: true,
    });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Dying Hero',
          initiative: 17,
          actor,
          token: { disposition: 1 },
        }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].deathSaves).toEqual({ successes: 2, failures: 1 });
  });

  it('returns deathSaves:null when hp.value > 0', async () => {
    const actor = makeActor({ type: 'character', system: hp(10), hasPlayerOwner: true });
    world.setCombat({
      turns: [
        makeCombatant({ id: 'c1', name: 'Hero', initiative: 20, actor, token: { disposition: 1 } }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].deathSaves).toBeNull();
  });

  it('defaults death save counters to 0 when the death block is absent', async () => {
    // hp.value=0 but no death key on the system block
    const actor = makeActor({
      type: 'character',
      system: { attributes: { hp: { value: 0, max: 20, temp: 0 } } },
      hasPlayerOwner: true,
    });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Ghost Hero',
          initiative: 16,
          actor,
          token: { disposition: 1 },
        }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].deathSaves).toEqual({ successes: 0, failures: 0 });
  });
});

// ---------------------------------------------------------------------------
// Hidden
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getCombatState: hidden', () => {
  it('picks combatant.hidden when set (truthy)', async () => {
    const actor = makeActor({ type: 'npc', system: hp(8) });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Shadow',
          initiative: 16,
          actor,
          token: { disposition: -1, hidden: false },
          hidden: true,
        }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].hidden).toBe(true);
  });

  it('falls back to token.hidden when combatant.hidden is absent', async () => {
    const actor = makeActor({ type: 'npc', system: hp(8) });
    // Intentionally omit combatant-level hidden so token.hidden is the source
    const combatant = makeCombatant({
      id: 'c1',
      name: 'Lurker',
      initiative: 14,
      actor,
      token: { disposition: -1, hidden: true },
    });
    // delete the hidden property entirely so the ?? chain falls to token.hidden
    delete combatant.hidden;
    world.setCombat({ turns: [combatant], turn: 0, round: 1, started: true });

    const result = await da.getCombatState();
    expect(result.combatants[0].hidden).toBe(true);
  });

  it('defaults hidden to false when neither combatant.hidden nor token.hidden is set', async () => {
    const actor = makeActor({ type: 'npc', system: hp(6) });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Visible',
          initiative: 11,
          actor,
          token: { disposition: 0 },
        }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].hidden).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Conditions (actorConditionNames indirectly tested)
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getCombatState: conditions', () => {
  it('returns empty conditions array when the actor has no effects', async () => {
    const actor = makeActor({
      type: 'character',
      system: hp(10),
      hasPlayerOwner: true,
      effects: [],
    });
    world.setCombat({
      turns: [
        makeCombatant({ id: 'c1', name: 'Hero', initiative: 20, actor, token: { disposition: 1 } }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].conditions).toEqual([]);
  });

  it('includes condition names from active effects that have statuses', async () => {
    const poisoned = makeEffect({ name: 'Poisoned', statuses: ['poisoned'], disabled: false });
    const blinded = makeEffect({ name: 'Blinded', statuses: ['blinded'], disabled: false });
    const actor = makeActor({
      type: 'character',
      system: hp(10),
      hasPlayerOwner: true,
      effects: [poisoned, blinded],
    });
    world.setCombat({
      turns: [
        makeCombatant({ id: 'c1', name: 'Hero', initiative: 20, actor, token: { disposition: 1 } }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].conditions).toEqual(['Poisoned', 'Blinded']);
  });

  it('excludes disabled effects from conditions', async () => {
    const poisoned = makeEffect({ name: 'Poisoned', statuses: ['poisoned'], disabled: false });
    const exhausted = makeEffect({ name: 'Exhaustion', statuses: ['exhaustion'], disabled: true });
    const actor = makeActor({
      type: 'character',
      system: hp(10),
      hasPlayerOwner: true,
      effects: [poisoned, exhausted],
    });
    world.setCombat({
      turns: [
        makeCombatant({ id: 'c1', name: 'Hero', initiative: 20, actor, token: { disposition: 1 } }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].conditions).toEqual(['Poisoned']);
  });

  it('excludes effects that have an empty statuses set (non-condition effects)', async () => {
    // An effect with no statuses is a buff/debuff, not a tracked condition
    const bless = makeEffect({ name: 'Bless', disabled: false }); // no statuses → statuses set absent
    const actor = makeActor({
      type: 'character',
      system: hp(10),
      hasPlayerOwner: true,
      effects: [bless],
    });
    world.setCombat({
      turns: [
        makeCombatant({ id: 'c1', name: 'Hero', initiative: 20, actor, token: { disposition: 1 } }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    expect(result.combatants[0].conditions).toEqual([]);
  });

  it('returns empty conditions when actor is absent on a combatant', async () => {
    // Combatant with no actor at all (e.g. token-only entry)
    const combatant = makeCombatant({
      id: 'c1',
      name: 'Mystery',
      initiative: 8,
      token: { disposition: -1 },
    });
    // actor is intentionally omitted
    world.setCombat({ turns: [combatant], turn: 0, round: 1, started: true });

    const result = await da.getCombatState();
    expect(result.combatants[0].conditions).toEqual([]);
  });
});
