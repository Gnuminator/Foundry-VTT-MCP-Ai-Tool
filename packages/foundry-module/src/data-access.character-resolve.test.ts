/**
 * Characterization for the forgiving actor resolution in
 * `FoundryDataAccess.getCharacterInfo` (the `get-character` tool).
 *
 * Live use surfaced the papercut: a GM typed "Silvera" but the actor is
 * "Silvera Frostmantle", and the old resolver only did id / exact-name lookup so
 * it 404'd. The resolver now falls back to a unique case-insensitive partial
 * match, and reports "did you mean …" when a partial is ambiguous. This pins the
 * new tiers; the frozen `data-access.reads.test.ts` still pins id / exact /
 * not-found and is left untouched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestWorld,
  makeActor,
  makeToken,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';
import { ERROR_MESSAGES } from './constants.js';

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

describe('getCharacterInfo — forgiving resolution', () => {
  it('resolves a unique partial name ("Silvera" → "Silvera Frostmantle")', async () => {
    world.actors.add(makeActor({ id: 'silv1', name: 'Silvera Frostmantle', type: 'character' }));

    expect((await da.getCharacterInfo('silvera')).name).toBe('Silvera Frostmantle');
    expect((await da.getCharacterInfo('Frostmantle')).name).toBe('Silvera Frostmantle');
  });

  it('prefers an exact name over a partial sibling', async () => {
    world.actors.add(makeActor({ id: 'aria-exact', name: 'Aria', type: 'character' }));
    world.actors.add(makeActor({ id: 'aria-storm', name: 'Aria Stormwind', type: 'character' }));

    const info = await da.getCharacterInfo('Aria');
    expect(info.name).toBe('Aria'); // exact wins; not treated as ambiguous
    expect(info.id).toBe('aria-exact');
  });

  it('returns the first of duplicate exact names (no ambiguity error)', async () => {
    world.actors.add(makeActor({ id: 'dup-1', name: 'Twin', type: 'character' }));
    world.actors.add(makeActor({ id: 'dup-2', name: 'Twin', type: 'character' }));

    expect((await da.getCharacterInfo('Twin')).id).toBe('dup-1');
  });

  it('throws a "did you mean" error listing candidates when a partial is ambiguous', async () => {
    world.actors.add(makeActor({ id: 'aria-storm', name: 'Aria Stormwind', type: 'character' }));
    world.actors.add(makeActor({ id: 'aria-bright', name: 'Aria Brightwood', type: 'character' }));

    await expect(da.getCharacterInfo('Aria')).rejects.toThrow(/Multiple characters match "Aria"/);
    // The candidates (name + id) are listed so the caller can disambiguate.
    await expect(da.getCharacterInfo('Aria')).rejects.toThrow(/Aria Stormwind \(aria-storm\)/);
    await expect(da.getCharacterInfo('Aria')).rejects.toThrow(/Aria Brightwood \(aria-bright\)/);
  });

  it('still resolves a 16-character id directly', async () => {
    world.actors.add(makeActor({ id: 'aaaaaaaaaaaaaaaa', name: 'ById', type: 'character' }));
    expect((await da.getCharacterInfo('aaaaaaaaaaaaaaaa')).name).toBe('ById');
  });

  it('falls through to a name match for a 16-char string that is not an id', async () => {
    // 'Sixteencharname!' is 16 chars but not an actor id → name lookup.
    world.actors.add(
      makeActor({ id: 'realid0000000000', name: 'Sixteencharname!', type: 'character' })
    );
    expect((await da.getCharacterInfo('Sixteencharname!')).name).toBe('Sixteencharname!');
  });

  it('still throws CHARACTER_NOT_FOUND when nothing matches (exact or partial)', async () => {
    world.actors.add(makeActor({ name: 'Silvera Frostmantle', type: 'character' }));
    await expect(da.getCharacterInfo('Nobody')).rejects.toThrow(ERROR_MESSAGES.CHARACTER_NOT_FOUND);
  });
});

describe('getCharacterInfo — rules version (2014 vs 2024)', () => {
  it('reports the stored tag and the current detection', async () => {
    world.actors.add(
      makeActor({
        id: 'strahd1',
        name: 'Strahd',
        type: 'npc',
        system: { source: { rules: '2014' } },
        flags: {
          'foundry-mcp-bridge': {
            rules: { version: '2014', source: 'system.source.rules', at: '2026-09-27T00:00:00Z' },
          },
        },
      })
    );

    const info = await da.getCharacterInfo('Strahd');

    expect(info.rulesVersion).toEqual({
      tagged: { version: '2014', source: 'system.source.rules', at: '2026-09-27T00:00:00Z' },
      detected: { version: '2014', source: 'system.source.rules' },
    });
  });

  it('untagged and undetectable: both null', async () => {
    world.actors.add(makeActor({ id: 'x1', name: 'Nobody', type: 'npc', system: {} }));
    expect((await da.getCharacterInfo('Nobody')).rulesVersion).toEqual({
      tagged: null,
      detected: null,
    });
  });
});

describe('getCharacterInfo: a token on the current scene', () => {
  /** A world NPC plus `count` unlinked tokens from it, each with its own synthetic copy. */
  function bossOnScene(count: number, tokenName = 'Boss Token'): void {
    world.actors.add(makeActor({ id: 'strahd', name: 'Boss', type: 'npc' }));
    const tokens = Array.from({ length: count }, (_, i) =>
      makeToken({
        id: `tok${i}`,
        name: count === 1 ? tokenName : `${tokenName} ${i + 1}`,
        actorId: 'strahd',
        actorLink: false,
        actor: makeActor({ id: 'strahd', name: `Boss copy ${i}`, type: 'npc' }),
      })
    );
    world.addScene({ id: 's1', active: true, tokens });
  }

  it('reads the only token made from the world actor named', async () => {
    bossOnScene(1);
    expect((await da.getCharacterInfo('Boss')).name).toBe('Boss copy 0');
  });

  it('reads a token named that is not a world actor name', async () => {
    bossOnScene(1);
    expect((await da.getCharacterInfo('Boss Token')).name).toBe('Boss copy 0');
  });

  it('keeps the world actor when several tokens share it', async () => {
    bossOnScene(2);
    expect((await da.getCharacterInfo('Boss')).name).toBe('Boss');
  });
});
