/**
 * I-070: legendary actions, legendary resistances and lair on combatants
 * (`get-combat-state` `boss`), read from dnd5e 6 `system.resources`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FoundryDataAccess } from './data-access.js';
import { bossResources } from './data-access/combat.js';
import {
  createTestWorld,
  makeActor,
  makeCombatant,
  type TestWorld,
} from './test-support/foundry-mock/index.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

/** The dnd5e 6.0.5 shape seen live on the 2024 Aboleth (`value` is derived). */
const ABOLETH = {
  attributes: { hp: { value: 150, max: 150, temp: 0 } },
  resources: {
    legact: { max: 3, spent: 1, value: 2, lr: true, label: 'Legendary Action Uses: 3' },
    legres: { max: 3, spent: 0, value: 3, lr: true },
    lair: { value: true, inside: true, initiative: null },
  },
};

describe('bossResources', () => {
  it('reads dnd5e 6 {max, spent} counters and the lair', () => {
    expect(bossResources({ system: ABOLETH })).toEqual({
      legendary: { max: 3, spent: 1, remaining: 2 },
      resistances: { max: 3, spent: 0, remaining: 3 },
      lair: { inside: true, initiative: null },
    });
  });

  it('falls back to value (uses left) when spent is missing, and clamps', () => {
    const r = bossResources({
      system: { resources: { legact: { max: 3, value: 1 }, legres: { max: 2, spent: 9 } } },
    });
    expect(r?.legendary).toEqual({ max: 3, spent: 2, remaining: 1 });
    expect(r?.resistances).toEqual({ max: 2, spent: 2, remaining: 0 });
    expect(r?.lair).toBeNull();
  });

  it('is null for a creature with none of them (empty containers are always present)', () => {
    expect(
      bossResources({
        system: {
          resources: {
            legact: { max: 0, spent: 0 },
            legres: { max: 0, spent: 0 },
            lair: { value: false, inside: false, initiative: null },
          },
        },
      })
    ).toBeNull();
    expect(bossResources({ system: {} })).toBeNull();
    expect(bossResources(null)).toBeNull();
  });

  it('keeps a lair initiative count', () => {
    expect(
      bossResources({ system: { resources: { lair: { value: true, initiative: 20 } } } })?.lair
    ).toEqual({ inside: false, initiative: 20 });
  });
});

describe('getCombatState — boss', () => {
  it('adds boss resources to NPC combatants and null to PCs', async () => {
    const boss = makeActor({ type: 'npc', name: 'Aboleth', system: ABOLETH });
    const wolf = makeActor({
      type: 'npc',
      name: 'Wolf',
      system: { attributes: { hp: { value: 11, max: 11 } } },
    });
    const hero = makeActor({
      type: 'character',
      name: 'Hero',
      hasPlayerOwner: true,
      system: { ...ABOLETH },
    });
    world.setCombat({
      turns: [
        makeCombatant({
          id: 'c1',
          name: 'Aboleth',
          initiative: 18,
          actor: boss,
          token: { disposition: -1 },
        }),
        makeCombatant({
          id: 'c2',
          name: 'Wolf',
          initiative: 12,
          actor: wolf,
          token: { disposition: -1 },
        }),
        makeCombatant({
          id: 'c3',
          name: 'Hero',
          initiative: 10,
          actor: hero,
          token: { disposition: 1 },
        }),
      ],
      turn: 0,
      round: 1,
      started: true,
    });

    const result = await da.getCombatState();
    const [a, w, h] = result.combatants;
    expect(a.boss.legendary).toEqual({ max: 3, spent: 1, remaining: 2 });
    expect(w.boss).toBeNull();
    expect(h.boss).toBeNull();
  });
});
