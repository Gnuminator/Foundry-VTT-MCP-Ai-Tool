/**
 * Characterization tests for `FoundryDataAccess.getCharacterResources`.
 *
 * These pin the current (upstream-derived) behavior of the resource-tracking
 * method so the Phase 9 from-scratch reimplementation can be verified to parity.
 *
 * Sub-branches covered:
 *   - Spell slots (level 1–9, pact magic)
 *   - Class resources (primary / secondary / tertiary)
 *   - Item charges (v3 `spent`, legacy `value`, recharge variants)
 *   - Concentration detection (status set, name match, flags.dnd5e.itemData)
 *   - Hit dice (from system.attributes.hd, then from class items)
 *   - Death saves (only when hp.value <= 0)
 *   - CHARACTER_NOT_FOUND error for unknown identifier
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from './constants.js';
import {
  createTestWorld,
  makeActor,
  makeEffect,
  makeItem,
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
// Helper: a fully-loaded character with all resource types populated
// ---------------------------------------------------------------------------
function richActor() {
  return makeActor({
    id: 'aaaaaaaaaaaaaaaa', // 16 chars → id-lookup branch
    name: 'Thoradin',
    type: 'character',
    system: {
      attributes: {
        hp: { value: 30, max: 45 },
        hd: { max: 5, value: 3, denomination: 'd8' },
        death: { success: 0, failure: 0 },
      },
      spells: {
        spell1: { value: 2, max: 4 },
        spell2: { value: 1, max: 3 },
        spell3: { value: 0, max: 2 },
        // spell4 absent → should not appear
        pact: { value: 1, max: 2, level: 3 },
      },
      resources: {
        primary: { label: 'Ki Points', max: 5, value: 3 },
        secondary: { label: '', max: 0, value: 0 }, // neither label nor non-zero max → excluded
        tertiary: { label: 'Channel Divinity', max: 1, value: 1 },
      },
    },
    items: [
      // Item charge — dnd5e v3 style (uses.spent)
      makeItem({
        name: 'Healing Word',
        type: 'feat',
        system: { uses: { max: 3, spent: 1, per: 'sr' } },
      }),
      // Item charge — legacy style (uses.value)
      makeItem({
        name: 'Action Surge',
        type: 'feat',
        system: { uses: { max: 1, value: 0, per: 'sr' } },
      }),
      // No uses.max → must be excluded
      makeItem({
        name: 'Passive Perception',
        type: 'feat',
        system: {},
      }),
    ],
    effects: [],
  });
}

// ---------------------------------------------------------------------------
// Error path
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getCharacterResources', () => {
  it('throws CHARACTER_NOT_FOUND for an unknown identifier', async () => {
    await expect(da.getCharacterResources({ identifier: 'Nobody' })).rejects.toThrow(
      ERROR_MESSAGES.CHARACTER_NOT_FOUND
    );
  });

  // -------------------------------------------------------------------------
  // Happy-path shape (top-level structure)
  // -------------------------------------------------------------------------

  it('returns the top-level envelope: success, actorId, actorName, system', async () => {
    world.actors.add(richActor());
    const res = await da.getCharacterResources({ identifier: 'aaaaaaaaaaaaaaaa' });

    expect(res.success).toBe(true);
    expect(res.actorId).toBe('aaaaaaaaaaaaaaaa');
    expect(res.actorName).toBe('Thoradin');
    expect(res.system).toBe('dnd5e');
  });

  // -------------------------------------------------------------------------
  // Spell slots
  // -------------------------------------------------------------------------

  it('maps spell1/spell2/spell3 into spellSlots.level{n} with max/current/expended', async () => {
    world.actors.add(richActor());
    const res = await da.getCharacterResources({ identifier: 'Thoradin' });

    expect(res.spellSlots).toEqual(
      expect.objectContaining({
        level1: { max: 4, current: 2, expended: 2 },
        level2: { max: 3, current: 1, expended: 2 },
        level3: { max: 2, current: 0, expended: 2 },
      })
    );
    // spell4 and above not present in system → must not appear
    expect(res.spellSlots.level4).toBeUndefined();
  });

  it('includes pact magic slot with level when pact.max > 0', async () => {
    world.actors.add(richActor());
    const res = await da.getCharacterResources({ identifier: 'Thoradin' });

    expect(res.spellSlots.pact).toEqual({ max: 2, current: 1, expended: 1, level: 3 });
  });

  it('omits a spell-level entry when both max and value are 0 / absent', async () => {
    world.actors.add(
      makeActor({
        name: 'Bare',
        system: {
          spells: {
            spell1: { value: 0, max: 0 }, // both zero → excluded
          },
        },
      })
    );
    const res = await da.getCharacterResources({ identifier: 'Bare' });
    expect(res.spellSlots.level1).toBeUndefined();
  });

  it('includes a slot entry when max is 0 but value > 0 (edge case)', async () => {
    // The condition is: max>0 OR value>0
    world.actors.add(
      makeActor({
        name: 'EdgeCase',
        system: {
          spells: {
            spell5: { value: 1, max: 0 },
          },
        },
      })
    );
    const res = await da.getCharacterResources({ identifier: 'EdgeCase' });
    expect(res.spellSlots.level5).toEqual({ max: 0, current: 1, expended: 0 });
  });

  it('omits pact slot when pact.max is 0', async () => {
    world.actors.add(
      makeActor({
        name: 'NoPact',
        system: {
          spells: { pact: { value: 0, max: 0, level: 1 } },
        },
      })
    );
    const res = await da.getCharacterResources({ identifier: 'NoPact' });
    expect(res.spellSlots.pact).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Class resources
  // -------------------------------------------------------------------------

  it('includes primary resource (label + non-zero max) and tertiary (label only)', async () => {
    world.actors.add(richActor());
    const res = await da.getCharacterResources({ identifier: 'Thoradin' });

    expect(res.classResources).toEqual(
      expect.arrayContaining([
        { key: 'primary', label: 'Ki Points', max: 5, current: 3 },
        { key: 'tertiary', label: 'Channel Divinity', max: 1, current: 1 },
      ])
    );
  });

  it('excludes secondary resource that has neither label nor non-zero max', async () => {
    world.actors.add(richActor());
    const res = await da.getCharacterResources({ identifier: 'Thoradin' });
    const keys = res.classResources.map((r: any) => r.key);
    expect(keys).not.toContain('secondary');
  });

  it('includes a resource with max non-zero but empty label; label falls back to key', async () => {
    world.actors.add(
      makeActor({
        name: 'Ranger',
        system: {
          resources: {
            primary: { label: '', max: 3, value: 2 },
          },
        },
      })
    );
    const res = await da.getCharacterResources({ identifier: 'Ranger' });
    expect(res.classResources).toEqual([{ key: 'primary', label: 'primary', max: 3, current: 2 }]);
  });

  // -------------------------------------------------------------------------
  // Item charges
  // -------------------------------------------------------------------------

  it('maps item charges (spent variant): current = max - spent', async () => {
    world.actors.add(richActor());
    const res = await da.getCharacterResources({ identifier: 'Thoradin' });
    const hw = res.itemCharges.find((c: any) => c.itemName === 'Healing Word');
    // uses.value is absent → current = max(0, 3 - 1) = 2
    expect(hw).toEqual({ itemName: 'Healing Word', charges: 2, max: 3, recharge: 'sr' });
  });

  it('maps item charges (value variant): current = uses.value', async () => {
    world.actors.add(richActor());
    const res = await da.getCharacterResources({ identifier: 'Thoradin' });
    const as_ = res.itemCharges.find((c: any) => c.itemName === 'Action Surge');
    // uses.value = 0 → current = 0
    expect(as_).toEqual({ itemName: 'Action Surge', charges: 0, max: 1, recharge: 'sr' });
  });

  it('excludes items with no uses.max (or max <= 0)', async () => {
    world.actors.add(richActor());
    const res = await da.getCharacterResources({ identifier: 'Thoradin' });
    const names = res.itemCharges.map((c: any) => c.itemName);
    expect(names).not.toContain('Passive Perception');
  });

  it('reads recharge from uses.recovery[0].period when uses.per is absent', async () => {
    world.actors.add(
      makeActor({
        name: 'RecoveryActor',
        system: {},
        items: [
          makeItem({
            name: 'Magic Shield',
            type: 'feat',
            system: {
              uses: { max: 2, value: 1, recovery: [{ period: 'dawn' }] },
            },
          }),
        ],
      })
    );
    const res = await da.getCharacterResources({ identifier: 'RecoveryActor' });
    expect(res.itemCharges[0].recharge).toBe('dawn');
  });

  it('reads recharge from system.recharge.value when per and recovery are absent', async () => {
    world.actors.add(
      makeActor({
        name: 'RechargeActor',
        system: {},
        items: [
          makeItem({
            name: 'Breath Weapon',
            type: 'feat',
            system: {
              uses: { max: 1, value: 0 },
              recharge: { value: 5 },
            },
          }),
        ],
      })
    );
    const res = await da.getCharacterResources({ identifier: 'RechargeActor' });
    expect(res.itemCharges[0].recharge).toBe(5);
  });

  // -------------------------------------------------------------------------
  // Concentration
  // -------------------------------------------------------------------------

  it('reports concentration inactive when no matching effect exists', async () => {
    world.actors.add(richActor());
    const res = await da.getCharacterResources({ identifier: 'Thoradin' });
    expect(res.concentration).toEqual({ active: false });
  });

  it('detects concentration via statuses Set containing "concentrating"', async () => {
    world.actors.add(
      makeActor({
        name: 'Spellbinder',
        system: {},
        effects: [
          makeEffect({
            name: 'Concentrating',
            statuses: ['concentrating'],
            duration: { remaining: 60 },
            flags: { dnd5e: { item: { name: 'Hold Person' } } },
          }),
        ],
      })
    );
    const res = await da.getCharacterResources({ identifier: 'Spellbinder' });
    expect(res.concentration).toEqual({ active: true, spell: 'Hold Person', remaining: 60 });
  });

  it('detects concentration via effect name matching /concentrat/i', async () => {
    world.actors.add(
      makeActor({
        name: 'Concentrator',
        system: {},
        effects: [
          makeEffect({
            name: 'Concentrating: Bless',
            duration: { seconds: 60 },
          }),
        ],
      })
    );
    const res = await da.getCharacterResources({ identifier: 'Concentrator' });
    // spell = name stripped of "Concentrating: " prefix
    expect(res.concentration.active).toBe(true);
    expect(res.concentration.spell).toBe('Bless');
    // remaining comes from duration.seconds when duration.remaining is absent
    expect(res.concentration.remaining).toBe(60);
  });

  it('detects concentration via flags.dnd5e.itemData presence', async () => {
    world.actors.add(
      makeActor({
        name: 'FlaggedSpell',
        system: {},
        effects: [
          makeEffect({
            name: 'Some Effect',
            flags: { dnd5e: { itemData: { name: 'Web' } } },
          }),
        ],
      })
    );
    const res = await da.getCharacterResources({ identifier: 'FlaggedSpell' });
    expect(res.concentration.active).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Hit dice
  // -------------------------------------------------------------------------

  it('reads hit dice directly from system.attributes.hd when present', async () => {
    world.actors.add(richActor());
    const res = await da.getCharacterResources({ identifier: 'Thoradin' });
    expect(res.hitDice).toEqual({ total: 5, available: 3, dieType: 'd8' });
  });

  it('sums hit dice from class items when system.attributes.hd is absent', async () => {
    world.actors.add(
      makeActor({
        name: 'MultiClass',
        system: {
          attributes: { hp: { value: 20, max: 40 } },
          // no hd key → falls through to class-item aggregation
        },
        items: [
          makeItem({
            name: 'Fighter',
            type: 'class',
            system: { levels: 5, hitDiceUsed: 2, hitDice: 'd10' },
          }),
          makeItem({
            name: 'Rogue',
            type: 'class',
            system: { levels: 3, hitDiceUsed: 1, hitDice: 'd8' },
          }),
        ],
      })
    );
    const res = await da.getCharacterResources({ identifier: 'MultiClass' });
    // total = 5+3=8, available = (5-2)+(3-1)=5, dieType = last class encountered = 'd8'
    expect(res.hitDice).toEqual({ total: 8, available: 5, dieType: 'd8' });
  });

  it('leaves hitDice null when no hd attribute and no class items', async () => {
    world.actors.add(
      makeActor({
        name: 'NoClass',
        system: { attributes: { hp: { value: 10, max: 10 } } },
      })
    );
    const res = await da.getCharacterResources({ identifier: 'NoClass' });
    expect(res.hitDice).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Death saves
  // -------------------------------------------------------------------------

  it('omits death saves (null) when HP is above 0', async () => {
    world.actors.add(richActor());
    const res = await da.getCharacterResources({ identifier: 'Thoradin' });
    expect(res.deathSaves).toBeNull();
  });

  it('returns death save counts when HP <= 0', async () => {
    world.actors.add(
      makeActor({
        name: 'Dying',
        system: {
          attributes: {
            hp: { value: 0, max: 30 },
            death: { success: 1, failure: 2 },
          },
        },
      })
    );
    const res = await da.getCharacterResources({ identifier: 'Dying' });
    expect(res.deathSaves).toEqual({ successes: 1, failures: 2 });
  });

  it('defaults death save counts to 0 when death attribute keys are absent', async () => {
    world.actors.add(
      makeActor({
        name: 'FreshlyDown',
        system: {
          attributes: {
            hp: { value: -1, max: 20 },
            // no death key
          },
        },
      })
    );
    const res = await da.getCharacterResources({ identifier: 'FreshlyDown' });
    expect(res.deathSaves).toEqual({ successes: 0, failures: 0 });
  });
});
