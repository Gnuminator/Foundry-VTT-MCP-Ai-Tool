/**
 * Characterization tests for `getActiveEffects` and `getAvailableConditions` in
 * `FoundryDataAccess`, driven through the Phase 9 Foundry-mock harness.
 *
 * These pin the *current* (upstream-derived) behavior so the from-scratch
 * reimplementation planned for Phase 9 can be verified to parity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from './constants.js';
import {
  createTestWorld,
  makeActor,
  makeEffect,
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
// getActiveEffects
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getActiveEffects', () => {
  it('throws CHARACTER_NOT_FOUND when the actor does not exist', async () => {
    await expect(da.getActiveEffects({ identifier: 'Nobody' })).rejects.toThrow(
      `${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: Nobody`
    );
  });

  it('returns success shape with actorId, actorName, count and effects array', async () => {
    world.actors.add(makeActor({ id: 'actor1actor1xxxx', name: 'Hero' }));

    const result = await da.getActiveEffects({ identifier: 'Hero' });

    expect(result.success).toBe(true);
    expect(result.actorId).toBe('actor1actor1xxxx');
    expect(result.actorName).toBe('Hero');
    expect(result.count).toBe(0);
    expect(result.effects).toEqual([]);
  });

  it('classifies an effect as "condition" when its status is in CONFIG.statusEffects', async () => {
    // Register 'prone' as a known game condition
    (globalThis as any).CONFIG.statusEffects = [
      { id: 'prone', name: 'Prone', icon: 'icons/prone.svg' },
    ];

    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [
          makeEffect({
            id: 'eff-prone',
            name: 'Prone',
            statuses: ['prone'],
          }),
        ],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });

    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0];
    expect(eff.isCondition).toBe(true);
    expect(eff.type).toBe('condition');
  });

  it('classifies an effect as "buff/debuff" when its status is NOT in CONFIG.statusEffects', async () => {
    // CONFIG.statusEffects stays empty (harness default) — 'custom-status' is not registered
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [
          makeEffect({
            id: 'eff-buff',
            name: "Hunter's Mark",
            statuses: ['custom-status'],
          }),
        ],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });

    const eff = result.effects[0];
    expect(eff.isCondition).toBe(false);
    expect(eff.type).toBe('buff/debuff');
  });

  it('resolves effect name via label fallback and "Unknown Effect" when both absent', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [
          makeEffect({ id: 'eff1', name: 'Real Name' }),
          // label only — name omitted via spread override
          { id: 'eff2', label: 'Label Only', disabled: false },
          // neither name nor label
          { id: 'eff3', disabled: false },
        ],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });

    expect(result.effects[0].name).toBe('Real Name');
    expect(result.effects[1].name).toBe('Label Only');
    expect(result.effects[2].name).toBe('Unknown Effect');
  });

  it('resolves icon via img fallback and null when both absent', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [
          makeEffect({ id: 'eff1', name: 'WithIcon', icon: 'icons/icon.svg' }),
          makeEffect({ id: 'eff2', name: 'WithImg', img: 'icons/img.webp' }),
          makeEffect({ id: 'eff3', name: 'NoIcon' }),
        ],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });

    expect(result.effects[0].icon).toBe('icons/icon.svg');
    expect(result.effects[1].icon).toBe('icons/img.webp');
    expect(result.effects[2].icon).toBeNull();
  });

  it('defaults disabled to false via ?? operator', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        // inject raw object: disabled not set at all
        effects: [{ id: 'eff1', name: 'Buff' }],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });
    expect(result.effects[0].disabled).toBe(false);
  });

  it('duration fields default to null when absent', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [makeEffect({ id: 'eff1', name: 'Buff' })],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });
    const dur = result.effects[0].duration;

    expect(dur.rounds).toBeNull();
    expect(dur.turns).toBeNull();
    expect(dur.seconds).toBeNull();
    expect(dur.remaining).toBeNull();
  });

  it('preserves explicit duration values', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [
          makeEffect({
            id: 'eff1',
            name: 'Haste',
            duration: { rounds: 3, turns: 1, seconds: 18, remaining: 2 },
          }),
        ],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });
    const dur = result.effects[0].duration;

    expect(dur.rounds).toBe(3);
    expect(dur.turns).toBe(1);
    expect(dur.seconds).toBe(18);
    expect(dur.remaining).toBe(2);
  });

  it('maps effect changes array with key/mode/value', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [
          makeEffect({
            id: 'eff1',
            name: 'Bless',
            changes: [{ key: 'system.attributes.ac.bonus', mode: 2, value: '2' }],
          }),
        ],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });
    expect(result.effects[0].changes).toEqual([
      { key: 'system.attributes.ac.bonus', mode: 2, value: '2' },
    ]);
  });

  it('detects requiresConcentration via flags.dnd5e.concentration', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Wizard',
        effects: [
          makeEffect({
            id: 'eff1',
            name: 'Fly',
            flags: { dnd5e: { concentration: true } },
          }),
        ],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Wizard' });
    expect(result.effects[0].requiresConcentration).toBe(true);
  });

  it('detects requiresConcentration via /concentrat/i name match', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Wizard',
        effects: [makeEffect({ id: 'eff1', name: 'Concentrating on Bless' })],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Wizard' });
    expect(result.effects[0].requiresConcentration).toBe(true);
  });

  it('does NOT flag requiresConcentration when neither flag nor name match', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [makeEffect({ id: 'eff1', name: 'Rage' })],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });
    expect(result.effects[0].requiresConcentration).toBe(false);
  });

  it('statuses is an array of strings extracted from the Set', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [makeEffect({ id: 'eff1', name: 'Multi', statuses: ['prone', 'restrained'] })],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });
    const statuses = result.effects[0].statuses;
    expect(Array.isArray(statuses)).toBe(true);
    expect(statuses).toContain('prone');
    expect(statuses).toContain('restrained');
  });
});

// ---------------------------------------------------------------------------
// getAvailableConditions
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getAvailableConditions', () => {
  it('returns success shape with gameSystem matching game.system.id', async () => {
    const result = await da.getAvailableConditions();

    expect(result.success).toBe(true);
    expect(result.gameSystem).toBe('dnd5e');
  });

  it('returns an empty conditions array when CONFIG.statusEffects is empty', async () => {
    // Harness default: CONFIG.statusEffects = []
    const result = await da.getAvailableConditions();
    expect(result.conditions).toEqual([]);
  });

  it('maps id, name, icon, and description for each status effect', async () => {
    (globalThis as any).CONFIG.statusEffects = [
      {
        id: 'prone',
        name: 'Prone',
        icon: 'icons/prone.svg',
        description: 'You are on the ground.',
      },
    ];

    const result = await da.getAvailableConditions();

    expect(result.conditions).toEqual([
      {
        id: 'prone',
        name: 'Prone',
        icon: 'icons/prone.svg',
        description: 'You are on the ground.',
      },
    ]);
  });

  it('falls back name to label then id when name is absent', async () => {
    (globalThis as any).CONFIG.statusEffects = [
      { id: 'stunned', label: 'Stunned via Label', icon: 'icons/stunned.svg' },
      { id: 'blinded' },
    ];

    const result = await da.getAvailableConditions();

    expect(result.conditions[0].name).toBe('Stunned via Label');
    expect(result.conditions[1].name).toBe('blinded');
  });

  it('falls back icon to img when icon is absent', async () => {
    (globalThis as any).CONFIG.statusEffects = [
      { id: 'poisoned', name: 'Poisoned', img: 'icons/poison.webp' },
    ];

    const result = await da.getAvailableConditions();

    expect(result.conditions[0].icon).toBe('icons/poison.webp');
  });

  it('defaults description to empty string when absent', async () => {
    (globalThis as any).CONFIG.statusEffects = [
      { id: 'charmed', name: 'Charmed', icon: 'icons/charmed.svg' },
    ];

    const result = await da.getAvailableConditions();

    expect(result.conditions[0].description).toBe('');
  });
});
