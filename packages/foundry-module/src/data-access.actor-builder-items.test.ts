/**
 * Characterization tests for the ITEMS / SPELLS / USE half of the
 * `actor-builder` domain of `FoundryDataAccess` (the largest deferred domain):
 *   - useItem                 (use a spell / ability / item on a character)
 *   - setActorSpellcasting    (ability + slot-count tables)
 *   - addSpellsToActor        (import spells from compendium packs)
 *   - addFeaturesFromCompendium (import features from compendium packs)
 *
 * These pin the *current* behaviour so the Phase 9 from-scratch rewrite of
 * `actor-builder.ts` can be verified to parity for the item/spell/use surface.
 * The SIBLING net (`data-access.actor-builder-npc.test.ts`) owns `createNpcActor`
 * and the NPC stat-block construction (addAttackToActor / addAttackWithSaveToActor /
 * addAuraToActor / addSaveFeatureToActor / addPassiveFeatureToActor + useNpcActivity).
 *
 * Driven through the Phase 9 Foundry-mock harness (in-memory, no browser).
 *
 * Harness gaps worked around locally (never editing shared harness files):
 *   - `makeActor` items carry no dnd5e `use()` method; for `useItem` the item's
 *     `use`/`toMessage`/`toChat`/`roll` surfaces are attached per-test as
 *     `vi.fn()` stubs (these are fire-and-forget, so the stubs return resolved
 *     promises). The generic fallback uses the harness `ChatMessage.create`.
 *   - `useItem` targeting reads `game.scenes.active`, `scene.tokens`, and
 *     `game.user.updateTokenTargets`; a scene is added and `updateTokenTargets`
 *     is stubbed on the GM user after install.
 *   - Compendium packs are added with `world.addPack` (type `'Item'` so they pass
 *     the `pack.metadata.type === 'Item'` guard); their index carries `_id`/`name`
 *     and `pack.getDocument` returns a doc with `toObject()`.
 *   - The system-id guard (`requireDnd5e`-style) is exercised by overriding
 *     `game.system.id` after `world.install()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestWorld,
  makeActor,
  makeItem,
  makeToken,
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

/** A short tick so a fire-and-forget `.use()/.toMessage()` promise resolves. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// ===========================================================================
// useItem
// ===========================================================================

describe('FoundryDataAccess — useItem', () => {
  it('throws when the actor cannot be resolved', async () => {
    await expect(
      da.useItem({ actorIdentifier: 'ghost', itemIdentifier: 'Fireball' })
    ).rejects.toThrow('Actor not found: ghost');
  });

  it('throws when the item is not on the actor', async () => {
    world.addActor({ id: 'a1', name: 'Mage', items: [] });

    await expect(
      da.useItem({ actorIdentifier: 'Mage', itemIdentifier: 'Fireball' })
    ).rejects.toThrow('Item "Fireball" not found on actor "Mage"');
  });

  it('invokes item.use() (dnd5e path) and returns the initiated result shape', async () => {
    const use = vi.fn(() => Promise.resolve());
    const item = makeItem({ id: 'spell1', name: 'Fireball', type: 'spell' });
    (item as any).use = use;
    world.addActor({ id: 'a1', name: 'Mage', items: [item] });

    const result = await da.useItem({ actorIdentifier: 'Mage', itemIdentifier: 'Fireball' });
    await flush();

    expect(use).toHaveBeenCalledTimes(1);
    // dnd5e branch (game.system.id === 'dnd5e') wires consume + configureDialog.
    expect(use.mock.calls[0][0]).toMatchObject({
      createMessage: true,
      consumeResource: true,
      consumeSpellSlot: true,
      consumeUsage: true,
      configureDialog: true,
    });

    expect(result).toEqual({
      success: true,
      status: 'initiated',
      message: `Item use initiated for Mage using Fireball. If a dialog appeared in Foundry VTT, the GM should select options and confirm. The result will appear in chat.`,
      itemName: 'Fireball',
      actorName: 'Mage',
      requiresGMInteraction: true,
    });
  });

  it('resolves the item by id as well as by name', async () => {
    const use = vi.fn(() => Promise.resolve());
    const item = makeItem({ id: 'item-id-xyz', name: 'Healing Word', type: 'spell' });
    (item as any).use = use;
    world.addActor({ id: 'a1', name: 'Cleric', items: [item] });

    const result = await da.useItem({
      actorIdentifier: 'Cleric',
      itemIdentifier: 'item-id-xyz',
    });

    expect(result.success).toBe(true);
    expect(result.itemName).toBe('Healing Word');
  });

  it('passes spellLevel through as slotLevel + level when upcasting', async () => {
    const use = vi.fn(() => Promise.resolve());
    const item = makeItem({ id: 'spell1', name: 'Magic Missile', type: 'spell' });
    (item as any).use = use;
    world.addActor({ id: 'a1', name: 'Sorcerer', items: [item] });

    await da.useItem({
      actorIdentifier: 'Sorcerer',
      itemIdentifier: 'Magic Missile',
      options: { spellLevel: 3 },
    });

    expect(use.mock.calls[0][0]).toMatchObject({ slotLevel: 3, level: 3 });
  });

  it('honors consume:false to disable resource/slot/usage consumption', async () => {
    const use = vi.fn(() => Promise.resolve());
    const item = makeItem({ id: 'spell1', name: 'Shield', type: 'spell' });
    (item as any).use = use;
    world.addActor({ id: 'a1', name: 'Wizard', items: [item] });

    await da.useItem({
      actorIdentifier: 'Wizard',
      itemIdentifier: 'Shield',
      options: { consume: false },
    });

    expect(use.mock.calls[0][0]).toMatchObject({
      consumeResource: false,
      consumeSpellSlot: false,
      consumeUsage: false,
    });
  });

  it('falls back to toMessage() when the item has no use() method', async () => {
    const toMessage = vi.fn(() => Promise.resolve());
    const item = makeItem({ id: 'item1', name: 'Potion', type: 'consumable' });
    (item as any).toChat = vi.fn();
    (item as any).toMessage = toMessage;
    world.addActor({ id: 'a1', name: 'Rogue', items: [item] });

    const result = await da.useItem({ actorIdentifier: 'Rogue', itemIdentifier: 'Potion' });
    await flush();

    expect(toMessage).toHaveBeenCalledTimes(1);
    expect(toMessage.mock.calls[0]).toEqual([undefined, { create: true }]);
    expect(result.success).toBe(true);
  });

  it('falls back to the generic ChatMessage when no use/toChat/roll method exists', async () => {
    const item = makeItem({ id: 'item1', name: 'Trinket', type: 'loot' });
    world.addActor({ id: 'a1', name: 'Bard', items: [item] });
    const before = world.messages.size;

    const result = await da.useItem({ actorIdentifier: 'Bard', itemIdentifier: 'Trinket' });

    expect(world.messages.size).toBe(before + 1);
    expect(result.success).toBe(true);
    expect(result.itemName).toBe('Trinket');
  });

  it('resolves named targets, sets them via updateTokenTargets, and reports them', async () => {
    const use = vi.fn(() => Promise.resolve());
    const item = makeItem({ id: 'spell1', name: 'Hold Person', type: 'spell' });
    (item as any).use = use;
    world.addActor({ id: 'a1', name: 'Mage', items: [item] });

    const scene = world.addScene({
      id: 'scene1',
      name: 'Field',
      active: true,
      tokens: [makeToken({ id: 'tok-goblin', name: 'Goblin', x: 100, y: 100 })],
    });
    world.setActiveScene(scene.id);

    const updateTokenTargets = vi.fn(() => Promise.resolve());
    (world.options.currentUser as any).updateTokenTargets = updateTokenTargets;

    const result = await da.useItem({
      actorIdentifier: 'Mage',
      itemIdentifier: 'Hold Person',
      targets: ['Goblin'],
    });

    expect(updateTokenTargets).toHaveBeenCalledTimes(1);
    expect(updateTokenTargets.mock.calls[0][0]).toEqual(['tok-goblin']);
    expect(result.targets).toEqual(['Goblin']);
    expect(result.message).toContain('targeting Goblin');
  });

  it('resolves "self" to the caster\'s own token', async () => {
    const use = vi.fn(() => Promise.resolve());
    const item = makeItem({ id: 'spell1', name: 'Bless', type: 'spell' });
    (item as any).use = use;
    const actor = world.addActor({ id: 'a1', name: 'Paladin', items: [item] });

    const scene = world.addScene({
      id: 'scene1',
      name: 'Field',
      active: true,
      tokens: [makeToken({ id: 'tok-self', name: 'Paladin Token', actorId: actor.id })],
    });
    world.setActiveScene(scene.id);
    (world.options.currentUser as any).updateTokenTargets = vi.fn(() => Promise.resolve());

    const result = await da.useItem({
      actorIdentifier: 'Paladin',
      itemIdentifier: 'Bless',
      targets: ['self'],
    });

    // "self" resolves the token to the caster actor; the reported name is the actor's.
    expect(result.targets).toEqual(['Paladin']);
  });

  it('throws when targets are given but there is no active scene', async () => {
    const use = vi.fn(() => Promise.resolve());
    const item = makeItem({ id: 'spell1', name: 'Sleep', type: 'spell' });
    (item as any).use = use;
    world.addActor({ id: 'a1', name: 'Enchanter', items: [item] });

    await expect(
      da.useItem({
        actorIdentifier: 'Enchanter',
        itemIdentifier: 'Sleep',
        targets: ['Goblin'],
      })
    ).rejects.toThrow('No active scene to find targets on');
  });

  it('omits the dnd5e-specific consume options under a non-dnd5e system', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    const use = vi.fn(() => Promise.resolve());
    const item = makeItem({ id: 'spell1', name: 'Heal', type: 'spell' });
    (item as any).use = use;
    world.addActor({ id: 'a1', name: 'Healer', items: [item] });

    await da.useItem({ actorIdentifier: 'Healer', itemIdentifier: 'Heal' });

    const opts = use.mock.calls[0][0];
    expect(opts).toEqual({ createMessage: true });
    expect(opts.consumeResource).toBeUndefined();
    expect(opts.configureDialog).toBeUndefined();
  });
});

// ===========================================================================
// setActorSpellcasting
// ===========================================================================

describe('FoundryDataAccess — setActorSpellcasting', () => {
  it('throws under a non-dnd5e system', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    await expect(
      da.setActorSpellcasting({
        actorIdentifier: 'Mage',
        spellcastingClass: 'wizard',
        spellcastingLevel: 5,
        effectiveAbility: 'int',
      })
    ).rejects.toThrow('setActorSpellcasting requires the dnd5e game system');
  });

  it('throws when the actor cannot be resolved', async () => {
    await expect(
      da.setActorSpellcasting({
        actorIdentifier: 'ghost',
        spellcastingClass: 'wizard',
        spellcastingLevel: 5,
        effectiveAbility: 'int',
      })
    ).rejects.toThrow('Actor not found: "ghost"');
  });

  it('full caster: writes ability + level-5 wizard slot row, echoes slots in response', async () => {
    const actor = world.addActor({ id: 'a1', name: 'Gandalf', type: 'character', system: {} });

    const result = await da.setActorSpellcasting({
      actorIdentifier: 'Gandalf',
      spellcastingClass: 'wizard',
      spellcastingLevel: 5,
      effectiveAbility: 'int',
    });

    // Wizard L5 (FULL_CASTER_SLOTS index 4): [4,3,2,0,0,0,0,0,0]
    expect(actor.system.attributes.spellcasting).toBe('int');
    expect(actor.system.spells.spell1).toEqual({ max: 4, value: 4 });
    expect(actor.system.spells.spell2).toEqual({ max: 3, value: 3 });
    expect(actor.system.spells.spell3).toEqual({ max: 2, value: 2 });
    expect(actor.system.spells.spell4).toEqual({ max: 0, value: 0 });

    expect(result.actor).toEqual({ id: 'a1', name: 'Gandalf' });
    expect(result.spellcasting.ability).toBe('int');
    expect(result.spellcasting.slots.spell1).toBe(4);
    expect(result.spellcasting.slots.spell3).toBe(2);
    expect(result.spellcasting.slots.spell9).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('warlock: zeroes the regular slots and sets pact slots from the table', async () => {
    const actor = world.addActor({ id: 'a1', name: 'Fiendling', type: 'character', system: {} });

    const result = await da.setActorSpellcasting({
      actorIdentifier: 'Fiendling',
      spellcastingClass: 'warlock',
      spellcastingLevel: 5,
      effectiveAbility: 'cha',
    });

    // Warlock L5 pact table index 4: { max: 2, level: 3 }
    for (let i = 1; i <= 9; i++) {
      expect(actor.system.spells[`spell${i}`]).toEqual({ max: 0, value: 0 });
    }
    expect(actor.system.spells.pact).toEqual({ max: 2, value: 2, level: 3 });
    expect(result.spellcasting.slots).toEqual({ pact: { max: 2, level: 3 } });
  });

  it('half caster (paladin) at level 1 warns about no slots', async () => {
    const actor = world.addActor({ id: 'a1', name: 'Squire', type: 'character', system: {} });

    const result = await da.setActorSpellcasting({
      actorIdentifier: 'Squire',
      spellcastingClass: 'paladin',
      spellcastingLevel: 1,
      effectiveAbility: 'cha',
    });

    // HALF_CASTER_SLOTS index 0 = all zeros
    expect(actor.system.spells.spell1).toEqual({ max: 0, value: 0 });
    expect(result.warnings).toContain(
      'paladin level 1 has no spell slots — use level 2+ to unlock spellcasting'
    );
  });

  it('artificer uses the artificer slot table (rounds up — slots at level 1)', async () => {
    const actor = world.addActor({ id: 'a1', name: 'Tinker', type: 'character', system: {} });

    const result = await da.setActorSpellcasting({
      actorIdentifier: 'Tinker',
      spellcastingClass: 'artificer',
      spellcastingLevel: 1,
      effectiveAbility: 'int',
    });

    // ARTIFICER_SLOTS index 0: [2,0,...]
    expect(actor.system.spells.spell1).toEqual({ max: 2, value: 2 });
    expect(result.spellcasting.slots.spell1).toBe(2);
    expect(result.warnings).toEqual([]);
  });
});

// ===========================================================================
// addSpellsToActor (compendium import)
// ===========================================================================

/** Build an Item-typed pack of spells the importer can index + fetch. */
function addSpellPack(id: string, label: string, spells: Array<{ id: string; name: string }>) {
  return world.addPack({
    id,
    label,
    type: 'Item',
    documents: spells.map(s =>
      makeItem({ id: s.id, name: s.name, type: 'spell', system: { level: 1 } })
    ),
  });
}

describe('FoundryDataAccess — addSpellsToActor', () => {
  it('throws under a non-dnd5e system', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    await expect(
      da.addSpellsToActor({ actorIdentifier: 'Mage', spellNames: ['Fireball'] })
    ).rejects.toThrow('addSpellsToActor requires the dnd5e game system');
  });

  it('throws when the actor cannot be resolved', async () => {
    await expect(
      da.addSpellsToActor({ actorIdentifier: 'ghost', spellNames: ['Fireball'] })
    ).rejects.toThrow('Actor not found: "ghost"');
  });

  it('imports a spell from a named pack and embeds it (id stripped) on the actor', async () => {
    const actor = world.addActor({ id: 'a1', name: 'Mage', type: 'character', items: [] });
    addSpellPack('world.spells', 'My Spells', [{ id: 'fb1', name: 'Fireball' }]);

    const result = await da.addSpellsToActor({
      actorIdentifier: 'Mage',
      spellNames: ['Fireball'],
      compendiumPacks: ['world.spells'],
    });

    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({
      name: 'Fireball',
      packId: 'world.spells',
      packLabel: 'My Spells',
    });
    expect(result.notFound).toEqual([]);
    expect(result.failed).toEqual([]);

    // Embedded onto the actor. The importer deletes only `_id` from the cloned
    // spell data before embedding (so Foundry assigns a fresh id live). The
    // reported itemId matches the created document's id.
    expect(actor.items.size).toBe(1);
    const embedded = actor.items.contents[0];
    expect(embedded.name).toBe('Fireball');
    expect(embedded.type).toBe('spell');
    expect(result.added[0]!.itemId).toBe(embedded.id);
  });

  it('reports a spell missing from all packs in notFound', async () => {
    world.addActor({ id: 'a1', name: 'Mage', type: 'character', items: [] });
    addSpellPack('world.spells', 'My Spells', [{ id: 'fb1', name: 'Fireball' }]);

    const result = await da.addSpellsToActor({
      actorIdentifier: 'Mage',
      spellNames: ['Meteor Swarm'],
      compendiumPacks: ['world.spells'],
    });

    expect(result.notFound).toEqual(['Meteor Swarm']);
    expect(result.added).toEqual([]);
  });

  it('deduplicates case-insensitive input (skip reason "duplicate in input")', async () => {
    world.addActor({ id: 'a1', name: 'Mage', type: 'character', items: [] });
    addSpellPack('world.spells', 'My Spells', [{ id: 'fb1', name: 'Fireball' }]);

    const result = await da.addSpellsToActor({
      actorIdentifier: 'Mage',
      spellNames: ['Fireball', 'fireball'],
      compendiumPacks: ['world.spells'],
    });

    expect(result.added).toHaveLength(1);
    expect(result.skipped).toContainEqual({ name: 'fireball', reason: 'duplicate in input' });
  });

  it('skips a spell already on the actor (only type "spell" counts as a dup)', async () => {
    const existing = makeItem({ id: 'have1', name: 'Fireball', type: 'spell' });
    world.addActor({ id: 'a1', name: 'Mage', type: 'character', items: [existing] });
    addSpellPack('world.spells', 'My Spells', [{ id: 'fb1', name: 'Fireball' }]);

    const result = await da.addSpellsToActor({
      actorIdentifier: 'Mage',
      spellNames: ['Fireball'],
      compendiumPacks: ['world.spells'],
    });

    expect(result.added).toEqual([]);
    expect(result.skipped).toContainEqual({ name: 'Fireball', reason: 'already on actor' });
  });

  it('warns and skips a pack that is not found, then throws when no packs remain', async () => {
    world.addActor({ id: 'a1', name: 'Mage', type: 'character', items: [] });

    await expect(
      da.addSpellsToActor({
        actorIdentifier: 'Mage',
        spellNames: ['Fireball'],
        compendiumPacks: ['world.missing'],
      })
    ).rejects.toThrow('No valid compendium packs available');
  });

  it('warns and skips a pack of the wrong metadata type', async () => {
    world.addActor({ id: 'a1', name: 'Mage', type: 'character', items: [] });
    // Actor-typed pack — rejected by the Item type guard.
    world.addPack({
      id: 'world.actors',
      label: 'Actors',
      type: 'Actor',
      documents: [makeActor({ id: 'g1', name: 'Goblin', type: 'npc' })],
    });

    await expect(
      da.addSpellsToActor({
        actorIdentifier: 'Mage',
        spellNames: ['Goblin'],
        compendiumPacks: ['world.actors'],
      })
    ).rejects.toThrow('No valid compendium packs available');
  });

  it('first-pack-wins when a spell exists in two packs', async () => {
    const actor = world.addActor({ id: 'a1', name: 'Mage', type: 'character', items: [] });
    addSpellPack('world.spellsA', 'Pack A', [{ id: 'fb-a', name: 'Fireball' }]);
    addSpellPack('world.spellsB', 'Pack B', [{ id: 'fb-b', name: 'Fireball' }]);

    const result = await da.addSpellsToActor({
      actorIdentifier: 'Mage',
      spellNames: ['Fireball'],
      compendiumPacks: ['world.spellsA', 'world.spellsB'],
    });

    expect(result.added[0]!.packId).toBe('world.spellsA');
    expect(actor.items.size).toBe(1);
  });
});

// ===========================================================================
// addFeaturesFromCompendium (compendium import)
// ===========================================================================

/** Build an Item-typed pack of features the importer can index + fetch. */
function addFeaturePack(id: string, label: string, feats: Array<{ id: string; name: string }>) {
  return world.addPack({
    id,
    label,
    type: 'Item',
    documents: feats.map(f => makeItem({ id: f.id, name: f.name, type: 'feat', system: {} })),
  });
}

describe('FoundryDataAccess — addFeaturesFromCompendium', () => {
  it('throws under a non-dnd5e system', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    await expect(
      da.addFeaturesFromCompendium({ actorIdentifier: 'Hero', featureNames: ['Pack Tactics'] })
    ).rejects.toThrow('addFeaturesFromCompendium requires the dnd5e game system');
  });

  it('throws when the actor cannot be resolved', async () => {
    await expect(
      da.addFeaturesFromCompendium({ actorIdentifier: 'ghost', featureNames: ['Pack Tactics'] })
    ).rejects.toThrow('Actor not found: "ghost"');
  });

  it('imports a feature from a named pack and embeds it on the actor', async () => {
    const actor = world.addActor({ id: 'a1', name: 'Wolf', type: 'npc', items: [] });
    addFeaturePack('world.feats', 'Monster Features', [{ id: 'pt1', name: 'Pack Tactics' }]);

    const result = await da.addFeaturesFromCompendium({
      actorIdentifier: 'Wolf',
      featureNames: ['Pack Tactics'],
      compendiumPacks: ['world.feats'],
    });

    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({
      name: 'Pack Tactics',
      packId: 'world.feats',
      packLabel: 'Monster Features',
    });
    expect(actor.items.size).toBe(1);
    expect(actor.items.contents[0].name).toBe('Pack Tactics');
    expect(actor.items.contents[0].type).toBe('feat');
    expect(result.added[0]!.itemId).toBe(actor.items.contents[0].id);
  });

  it('reports a feature missing from all packs in notFound', async () => {
    world.addActor({ id: 'a1', name: 'Wolf', type: 'npc', items: [] });
    addFeaturePack('world.feats', 'Monster Features', [{ id: 'pt1', name: 'Pack Tactics' }]);

    const result = await da.addFeaturesFromCompendium({
      actorIdentifier: 'Wolf',
      featureNames: ['Legendary Resistance'],
      compendiumPacks: ['world.feats'],
    });

    expect(result.notFound).toEqual(['Legendary Resistance']);
    expect(result.added).toEqual([]);
  });

  it('skips a feature already on the actor (name-only dup check, any item type)', async () => {
    // The on-actor item is a weapon, not a feat — yet the name-only check skips it.
    const existing = makeItem({ id: 'have1', name: 'Multiattack', type: 'weapon' });
    world.addActor({ id: 'a1', name: 'Ogre', type: 'npc', items: [existing] });
    addFeaturePack('world.feats', 'Monster Features', [{ id: 'ma1', name: 'Multiattack' }]);

    const result = await da.addFeaturesFromCompendium({
      actorIdentifier: 'Ogre',
      featureNames: ['Multiattack'],
      compendiumPacks: ['world.feats'],
    });

    expect(result.added).toEqual([]);
    expect(result.skipped).toContainEqual({ name: 'Multiattack', reason: 'already on actor' });
  });

  it('deduplicates case-insensitive input', async () => {
    world.addActor({ id: 'a1', name: 'Wolf', type: 'npc', items: [] });
    addFeaturePack('world.feats', 'Monster Features', [{ id: 'pt1', name: 'Pack Tactics' }]);

    const result = await da.addFeaturesFromCompendium({
      actorIdentifier: 'Wolf',
      featureNames: ['Pack Tactics', 'pack tactics'],
      compendiumPacks: ['world.feats'],
    });

    expect(result.added).toHaveLength(1);
    expect(result.skipped).toContainEqual({ name: 'pack tactics', reason: 'duplicate in input' });
  });

  it('throws when no requested pack is valid', async () => {
    world.addActor({ id: 'a1', name: 'Wolf', type: 'npc', items: [] });

    await expect(
      da.addFeaturesFromCompendium({
        actorIdentifier: 'Wolf',
        featureNames: ['Pack Tactics'],
        compendiumPacks: ['world.missing'],
      })
    ).rejects.toThrow('No valid compendium packs available');
  });
});
