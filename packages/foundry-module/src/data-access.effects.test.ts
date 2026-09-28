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

  it('preserves an explicit v13 (rounds) duration, remaining read straight off duration.remaining', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [
          makeEffect({
            id: 'eff1',
            name: 'Haste',
            duration: { rounds: 3, remaining: 2 },
          }),
        ],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });
    const dur = result.effects[0].duration;

    expect(dur.rounds).toBe(3);
    expect(dur.turns).toBeNull();
    expect(dur.seconds).toBeNull();
    expect(dur.remaining).toBe(2);
  });

  it('preserves a v13 (turns) duration', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [makeEffect({ id: 'eff1', name: 'Guarded', duration: { turns: 1 } })],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });
    expect(result.effects[0].duration).toEqual({
      rounds: null,
      turns: 1,
      seconds: null,
      remaining: null,
    });
  });

  it('reads a v14-shaped duration ({value, units}) into the same rounds/turns/seconds fields', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [
          // v14 core: `effect.duration` (a live getter in real Foundry) exposes
          // `{value, units, ...}` plus a `remaining` field computed the same way
          // on both versions (verified `client/documents/active-effect.mjs:405`).
          makeEffect({
            id: 'eff1',
            name: 'Haste',
            duration: { value: 3, units: 'rounds', remaining: 3 },
          }),
        ],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });
    expect(result.effects[0].duration).toEqual({
      rounds: 3,
      turns: null,
      seconds: null,
      remaining: 3,
    });
  });

  it('maps a v13 numeric-mode changes array to {key, mode, type, value} (mode now the normalized string)', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [
          makeEffect({
            id: 'eff1',
            name: 'Bless',
            // CONST.ACTIVE_EFFECT_MODES.MULTIPLY = 1 in most versions, but this
            // suite's fixture predates that constant; 2 is ADD per
            // `core.ts` `LEGACY_CHANGE_MODES` and matches the pre-existing test data.
            changes: [{ key: 'system.attributes.ac.bonus', mode: 2, value: '2' }],
          }),
        ],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });
    expect(result.effects[0].changes).toEqual([
      { key: 'system.attributes.ac.bonus', mode: 'add', type: 'add', value: '2' },
    ]);
  });

  it('maps a v14 system.changes array (string type) the same way', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [
          makeEffect({
            id: 'eff1',
            name: 'Bless',
            system: { changes: [{ key: 'system.attributes.ac.bonus', type: 'add', value: '2' }] },
          }),
        ],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });
    expect(result.effects[0].changes).toEqual([
      { key: 'system.attributes.ac.bonus', mode: 'add', type: 'add', value: '2' },
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

  it('classifies a condition when CONFIG.statusEffects is a dnd5e 6.0 id-keyed object', async () => {
    // dnd5e 6.0 replaces the array with an object keyed by id
    // (verified `dnd5e.mjs:96351-96370` `_configureStatusEffects`).
    (globalThis as any).CONFIG.statusEffects = {
      prone: { id: 'prone', name: 'Prone', img: 'icons/prone.svg' },
    };

    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [makeEffect({ id: 'eff-prone', name: 'Prone', statuses: ['prone'] })],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });
    expect(result.effects[0].isCondition).toBe(true);
    expect(result.effects[0].type).toBe('condition');
  });

  it('icon prefers img over the removed v14 icon field', async () => {
    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Fighter',
        effects: [
          // v14 has no `icon` field at all; a legacy v13 doc may still carry both.
          makeEffect({ id: 'eff1', name: 'Both', icon: 'legacy.svg', img: 'current.webp' }),
        ],
      })
    );

    const result = await da.getActiveEffects({ identifier: 'Fighter' });
    expect(result.effects[0].icon).toBe('current.webp');
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

  it('reads a dnd5e 6.0 id-keyed object the same as the v13/core array', async () => {
    // Verified `dnd5e.mjs:96351-96370`: `_configureStatusEffects` builds a plain
    // `{[id]: data}` object and assigns it to `CONFIG.statusEffects`.
    (globalThis as any).CONFIG.statusEffects = {
      prone: { id: 'prone', name: 'Prone', img: 'icons/prone.svg' },
      grappled: { id: 'grappled', name: 'Grappled', img: 'icons/grappled.svg' },
    };

    const result = await da.getAvailableConditions();

    expect(result.conditions).toEqual([
      { id: 'prone', name: 'Prone', icon: 'icons/prone.svg', description: '' },
      { id: 'grappled', name: 'Grappled', icon: 'icons/grappled.svg', description: '' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// getCharacterResources — concentration spell name (pre-existing bug fix)
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getCharacterResources concentration spell name', () => {
  it('resolves the spell name via fromUuidSync on flags.dnd5e.item.uuid (dnd5e never sets .item.name)', async () => {
    // Verified `dnd5e.mjs:8259-8290` `Actor5e.createConcentrationEffectData`:
    // the concentration effect carries `flags.dnd5e.item = {type, id, uuid}` and
    // `origin` (both the concentrated item's UUID) — never `.item.name`.
    const spell = makeActor({ id: 'spell0000000000', name: 'Fireball', type: 'npc' });
    spell.uuid = 'Actor.actor1actor1xxxx.Item.spell0000000000';
    (globalThis as any).fromUuidSync = (uuid: string): unknown =>
      uuid === spell.uuid ? spell : null;

    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Wizard',
        effects: [
          makeEffect({
            id: 'conc1',
            name: 'Concentrating: Fireball',
            statuses: ['concentrating'],
            flags: { dnd5e: { item: { type: 'spell', id: 'spell0000000000', uuid: spell.uuid } } },
            origin: spell.uuid,
          }),
        ],
      })
    );

    const result = await da.getCharacterResources({ identifier: 'Wizard' });
    expect(result.concentration).toEqual({ active: true, spell: 'Fireball', remaining: null });
  });

  it('falls back to stripping the "Concentrating: " prefix when the item cannot be resolved', async () => {
    (globalThis as any).fromUuidSync = (): null => null;

    world.actors.add(
      makeActor({
        id: 'actor1actor1xxxx',
        name: 'Wizard',
        effects: [
          makeEffect({
            id: 'conc1',
            name: 'Concentrating: Fireball',
            statuses: ['concentrating'],
            flags: { dnd5e: { item: { type: 'spell', id: 'gone', uuid: 'Item.gone000000000' } } },
            origin: 'Item.gone000000000',
          }),
        ],
      })
    );

    const result = await da.getCharacterResources({ identifier: 'Wizard' });
    expect(result.concentration).toEqual({ active: true, spell: 'Fireball', remaining: null });
  });
});
