/**
 * Characterization tests for `getCombatPlayByPlay` in `FoundryDataAccess`.
 *
 * `data-access.combat.test.ts` pins `getCombatState` exhaustively but does NOT
 * touch `getCombatPlayByPlay`; only the pure `EventTracker.buildPlayByPlay`
 * helper it delegates to is pinned (in `session-events.test.ts`). This file pins
 * `getCombatPlayByPlay`'s OWN logic — which combat document it resolves and the
 * lightweight descriptor it forwards — so the Phase 9 rewrite of the combat
 * reads can be verified to parity across both read methods.
 *
 * `eventTracker.buildPlayByPlay` is spied so the assertions isolate the
 * data-access method's resolution/passthrough behaviour from the (separately
 * pinned) synthesis inside the EventTracker.
 *
 * Harness: Phase 9 Foundry-mock (`src/test-support/foundry-mock/index.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, makeCombat, type TestWorld } from './test-support/foundry-mock/index.js';
import { eventTracker } from './session-events.js';
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

describe('FoundryDataAccess — getCombatPlayByPlay', () => {
  it('passes null to buildPlayByPlay when there is no combat, and returns its result verbatim', async () => {
    const marker = { playByPlay: 'no-combat-marker' };
    const spy = vi.spyOn(eventTracker, 'buildPlayByPlay').mockReturnValue(marker as any);

    const result = await da.getCombatPlayByPlay();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(null);
    expect(result).toBe(marker);
  });

  it('forwards the active combat (game.combat) round/started descriptor', async () => {
    const spy = vi.spyOn(eventTracker, 'buildPlayByPlay').mockReturnValue({} as any);
    world.setCombat({ id: 'cb-active', round: 2, started: true });

    await da.getCombatPlayByPlay();

    expect(spy).toHaveBeenCalledWith({ round: 2, started: true });
  });

  it('falls back to the most recent game.combats entry when there is no active combat', async () => {
    const spy = vi.spyOn(eventTracker, 'buildPlayByPlay').mockReturnValue({} as any);
    // Register a combat WITHOUT making it active, so game.combat stays null and
    // the resolver falls through to `Array.from(game.combats).slice(-1)`.
    world.combats.add(makeCombat({ id: 'cb-recent', round: 5, started: false }));

    await da.getCombatPlayByPlay();

    expect(spy).toHaveBeenCalledWith({ round: 5, started: false });
  });

  it('uses the LAST game.combats entry when several are registered (and none active)', async () => {
    const spy = vi.spyOn(eventTracker, 'buildPlayByPlay').mockReturnValue({} as any);
    world.combats.add(makeCombat({ id: 'cb-1', round: 1, started: true }));
    world.combats.add(makeCombat({ id: 'cb-2', round: 9, started: true }));

    await da.getCombatPlayByPlay();

    expect(spy).toHaveBeenCalledWith({ round: 9, started: true });
  });
});
