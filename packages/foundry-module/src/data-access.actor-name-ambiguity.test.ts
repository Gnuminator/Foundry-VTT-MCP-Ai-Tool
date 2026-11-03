/**
 * `findActorByIdentifier` (22 callers: use-item, add-feature, the roll tools, ...) follows the
 * same rules as get-character: id, exact name (first wins), a unique partial name; several
 * partials throw with candidates and ids instead of taking the first one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, makeActor, type TestWorld } from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';
import { findActorByIdentifier } from './data-access/shared.js';

let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  world.actors.add(makeActor({ id: 'aria-storm', name: 'Aria Stormwind', type: 'character' }));
  world.actors.add(makeActor({ id: 'aria-bright', name: 'Aria Brightwood', type: 'character' }));
  world.actors.add(makeActor({ id: 'silv1', name: 'Silvera Frostmantle', type: 'character' }));
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

describe('findActorByIdentifier', () => {
  it('finds by id', () => {
    expect(findActorByIdentifier('silv1')?.name).toBe('Silvera Frostmantle');
  });

  it('finds by exact name, ignoring case, and an exact name beats partial siblings', () => {
    world.actors.add(makeActor({ id: 'aria-plain', name: 'Aria', type: 'character' }));
    expect(findActorByIdentifier('aria')?.id).toBe('aria-plain');
  });

  it('takes the first of duplicate exact names', () => {
    world.actors.add(makeActor({ id: 'twin-1', name: 'Twin', type: 'npc' }));
    world.actors.add(makeActor({ id: 'twin-2', name: 'Twin', type: 'npc' }));
    expect(findActorByIdentifier('Twin')?.id).toBe('twin-1');
  });

  it('finds a unique partial name', () => {
    expect(findActorByIdentifier('frost')?.id).toBe('silv1');
  });

  it('throws with candidates and ids when several partials match', () => {
    expect(() => findActorByIdentifier('Aria')).toThrow(/Multiple characters match "Aria"/);
    expect(() => findActorByIdentifier('Aria')).toThrow(/Aria Stormwind \(aria-storm\)/);
    expect(() => findActorByIdentifier('Aria')).toThrow(/Aria Brightwood \(aria-bright\)/);
    expect(() => findActorByIdentifier('Aria')).toThrow(/exact name or the 16-character id/);
  });

  it('returns undefined when nothing matches', () => {
    expect(findActorByIdentifier('Nobody')).toBeUndefined();
  });

  it('caps the candidate list at ten', () => {
    for (let i = 0; i < 12; i++) {
      world.actors.add(makeActor({ id: `gob${i}`, name: `Goblin ${i}`, type: 'npc' }));
    }
    expect(() => findActorByIdentifier('Goblin')).toThrow(/\(\+2 more\)/);
  });
});

describe('a batch with an ambiguous target', () => {
  it('reports the ambiguity for that target and still runs the others', async () => {
    const da = new FoundryDataAccess();
    const silv = world.actors.get('silv1') as any;
    silv.rollSavingThrow = vi.fn(() => Promise.resolve({ total: 12, isSuccess: true }));

    const result = (await da.rollSavingThrows({
      targets: ['Aria', 'silv1'],
      rollType: 'save',
      ability: 'dex',
      dc: 10,
    })) as { results: Array<{ target: string; error?: string; total?: number }> };

    expect(result.results[0]?.error).toMatch(/Multiple characters match "Aria"/);
    expect(result.results[1]?.total).toBe(12);
  });
});
