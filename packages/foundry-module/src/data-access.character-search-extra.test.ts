/**
 * Extra characterization for `FoundryDataAccess.searchCharacterItems` — the
 * dnd5e spell/equipment category + field surface that the frozen
 * `data-access.character-search.test.ts` does not pin in detail.
 *
 * This is the dnd5e-only contract for the category filter. It exists to back the
 * Phase 9 B5 prune of the inert pf2e fallbacks (`rank`, `location.prepared`/
 * `location.expended`, the `traits`/`category` focus check, and the `invested`
 * branch) from `applySpellFields`/`applyEquipmentFields`. It pins:
 *   - `level` reads `system.level` (dnd5e), not the pf2e `rank` fallback.
 *   - `prepared` reads raw `preparation.prepared` (dnd5e), not `location.prepared`.
 *   - `category=cantrip`/`prepared` (dnd5e-valid) filter as before.
 *   - `category=focus`/`invested` (pf2e-only) are INERT in dnd5e: with no pf2e
 *     focus/invested data on a dnd5e actor they apply no filter and return every
 *     matching-type item. (Pre-prune they matched nothing — see the prune commit.)
 *
 * Do not fold these into the frozen net; that file is the parity contract for
 * the rewrite and stays untouched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestWorld,
  makeActor,
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
// Fixture: a dnd5e caster with prepared/unprepared/default spells + equipment.
// `makeItem`'s `_source.system` defaults to a clone of `system`, so raw
// `preparation.prepared` is whatever we put under `system.preparation`.
// ---------------------------------------------------------------------------

function makeCaster() {
  return makeActor({
    name: 'Caster',
    type: 'character',
    items: [
      makeItem({
        name: 'Prepared Bolt',
        type: 'spell',
        system: { level: 2, preparation: { prepared: true }, activation: { type: 'action' } },
      }),
      makeItem({
        name: 'Unprepared Ray',
        type: 'spell',
        system: { level: 2, preparation: { prepared: false }, activation: { type: 'action' } },
      }),
      makeItem({
        name: 'Default Spell',
        type: 'spell',
        system: { level: 4, activation: { type: 'action' } },
      }),
      makeItem({
        name: 'Spark',
        type: 'spell',
        system: { level: 0, activation: { type: 'action' } },
      }),
      makeItem({
        name: 'Ring of Protection',
        type: 'equipment',
        system: { quantity: 1, equipped: true },
      }),
      makeItem({
        name: 'Spare Cloak',
        type: 'equipment',
        system: { quantity: 1, equipped: false },
      }),
    ],
  });
}

const names = (r: { matches: Array<{ name: string }> }) => r.matches.map(m => m.name).sort();

// ---------------------------------------------------------------------------
// Spell fields — level + prepared (dnd5e sources)
// ---------------------------------------------------------------------------

describe('searchCharacterItems — dnd5e spell fields', () => {
  it('reports level from system.level (no pf2e rank fallback)', async () => {
    world.actors.add(makeCaster());
    const lvl4 = await da.searchCharacterItems({
      characterIdentifier: 'Caster',
      type: 'spell',
      query: 'Default Spell',
    });
    expect(lvl4.matches).toHaveLength(1);
    expect(lvl4.matches[0].level).toBe(4);

    const cantrip = await da.searchCharacterItems({
      characterIdentifier: 'Caster',
      type: 'spell',
      query: 'Spark',
    });
    expect(cantrip.matches[0].level).toBe(0);
  });

  it('reads prepared from raw preparation.prepared; undefined when absent', async () => {
    world.actors.add(makeCaster());

    const prepared = await da.searchCharacterItems({
      characterIdentifier: 'Caster',
      type: 'spell',
      query: 'Prepared Bolt',
    });
    expect(prepared.matches[0].prepared).toBe(true);

    const unprepared = await da.searchCharacterItems({
      characterIdentifier: 'Caster',
      type: 'spell',
      query: 'Unprepared Ray',
    });
    expect(unprepared.matches[0].prepared).toBe(false);

    const noPrep = await da.searchCharacterItems({
      characterIdentifier: 'Caster',
      type: 'spell',
      query: 'Default Spell',
    });
    expect(noPrep.matches[0].prepared).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Spell categories — cantrip/prepared honored; focus inert
// ---------------------------------------------------------------------------

describe('searchCharacterItems — dnd5e spell categories', () => {
  it('category="cantrip" keeps only level-0 spells', async () => {
    world.actors.add(makeCaster());
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Caster',
      type: 'spell',
      category: 'cantrip',
    });
    expect(names(result)).toEqual(['Spark']);
  });

  it('category="prepared" excludes only spells with preparation.prepared === false', async () => {
    world.actors.add(makeCaster());
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Caster',
      type: 'spell',
      category: 'prepared',
    });
    // Unprepared Ray (prepared === false) is dropped; the rest default to prepared.
    expect(names(result)).toEqual(['Default Spell', 'Prepared Bolt', 'Spark']);
  });

  it('category="focus" is inert in dnd5e — returns every spell (no pf2e focus filter)', async () => {
    world.actors.add(makeCaster());
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Caster',
      type: 'spell',
      category: 'focus',
    });
    expect(names(result)).toEqual(['Default Spell', 'Prepared Bolt', 'Spark', 'Unprepared Ray']);
  });
});

// ---------------------------------------------------------------------------
// Equipment categories — equipped honored; invested inert
// ---------------------------------------------------------------------------

describe('searchCharacterItems — dnd5e equipment categories', () => {
  it('category="equipped" keeps only equipped equipment', async () => {
    world.actors.add(makeCaster());
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Caster',
      type: 'equipment',
      category: 'equipped',
    });
    expect(names(result)).toEqual(['Ring of Protection']);
  });

  it('category="invested" is inert in dnd5e — returns every equipment item (no pf2e invested filter)', async () => {
    world.actors.add(makeCaster());
    const result = await da.searchCharacterItems({
      characterIdentifier: 'Caster',
      type: 'equipment',
      category: 'invested',
    });
    expect(names(result)).toEqual(['Ring of Protection', 'Spare Cloak']);
  });
});
