/**
 * Characterization tests for the `actor-creation` domain of `FoundryDataAccess`:
 *   - createActorFromCompendium       (creature-type search → clone → create)
 *   - createActorFromCompendiumEntry  (explicit pack/item id → toObject → create)
 *   - addActorItems                   (author embedded Items onto an existing actor)
 *   - addActorsToScene                (place actor prototype tokens onto the scene)
 *
 * These pin the *current* behaviour so the Phase 9 from-scratch rewrite of
 * `actor-creation.ts` can be verified to parity. The test assertions are the spec.
 *
 * Driven through the Phase 9 Foundry-mock harness (in-memory, no browser). The
 * domain is reached through the real facade (`new FoundryDataAccess()`), which
 * wires the live compendium domain into `ActorCreationDataAccess`.
 *
 * Harness gaps worked around locally (never editing shared harness files):
 *   - Writes are gated by `permissionManager.checkWritePermission`, which reads
 *     `allowWriteOperations` + `maxActorsPerRequest`. `world.enableWrites(max)`
 *     sets both; tests that pin ACCESS_DENIED simply omit it.
 *   - `addActorsToScene` reads `actor.prototypeToken.toObject()`. `makeActor`
 *     doesn't attach a prototypeToken, so world actors used for token placement
 *     get one assembled locally with a `toObject()` that returns a plain token
 *     template (mirrors the `withUpdate` stub pattern in other write nets).
 *   - The cloned-actor path in `createActorFromCompendium` goes through
 *     `Actor.createDocuments`; to pin the rollback branch it is overridden locally
 *     to throw, then restored.
 *   - `transactionManager` is a module-level singleton shared across tests; each
 *     transaction id is unique per install (foundry.utils.randomID resets), so the
 *     ledger does not leak observable state into these assertions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from './constants.js';
import { createTestWorld, makeActor, type TestWorld } from './test-support/foundry-mock/index.js';
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

/**
 * Register an Actor compendium pack whose documents the creature-type search and
 * `getCompendiumDocumentFull` can both resolve. Each source doc is a full actor
 * (so `toObject()` yields system/items/effects), optionally with a prototypeToken.
 *
 * Real Foundry Actor documents carry `documentName: 'Actor'`; the harness
 * `makeActor` does not, and `createActorFromCompendiumEntry` gates on it, so it
 * is stamped on here by default (a test can override it to pin the wrong-type
 * branch).
 */
function addActorPack(packId: string, label: string, actors: Array<Record<string, any>>): any {
  return world.addPack({
    id: packId,
    label,
    type: 'Actor',
    documents: actors.map(a => makeActor({ documentName: 'Actor', ...a })),
  });
}

/** A world actor carrying a prototypeToken with a `toObject()` (for scene placement). */
function addActorWithProtoToken(
  opts: Record<string, any>,
  proto: Record<string, any> = { name: 'Token', texture: { src: 'tok.webp' } }
): any {
  const actor = world.addActor(opts);
  actor.prototypeToken = { ...proto, toObject: () => ({ ...proto }) };
  return actor;
}

// ===========================================================================
// createActorFromCompendium — permission + lookup guards
// ===========================================================================

describe('FoundryDataAccess — createActorFromCompendium: guards', () => {
  it('throws ACCESS_DENIED when write operations are disabled', async () => {
    // no enableWrites() → allowWriteOperations is undefined → permission denied
    await expect(da.createActorFromCompendium({ creatureType: 'Goblin' })).rejects.toThrow(
      `${ERROR_MESSAGES.ACCESS_DENIED}: Create Actor is disabled in module settings`
    );
  });

  it('throws ACCESS_DENIED when quantity exceeds maxActorsPerRequest', async () => {
    // The permission gate rejects quantity > max BEFORE the request-level clamp.
    world.enableWrites(2);
    await expect(
      da.createActorFromCompendium({ creatureType: 'Goblin', quantity: 5 })
    ).rejects.toThrow(`${ERROR_MESSAGES.ACCESS_DENIED}: Quantity 5 exceeds maximum allowed 2`);
  });

  it('throws "No compendium entry found" when the creature type matches nothing', async () => {
    world.enableWrites();
    addActorPack('world.monsters', 'Monsters', [{ id: 'o1', name: 'Orc', type: 'npc' }]);

    await expect(da.createActorFromCompendium({ creatureType: 'Dragon' })).rejects.toThrow(
      'No compendium entry found for "Dragon"'
    );
  });
});

// ===========================================================================
// createActorFromCompendium — success paths
// ===========================================================================

describe('FoundryDataAccess — createActorFromCompendium: success', () => {
  it('creates a single actor and returns the full result shape', async () => {
    world.enableWrites();
    addActorPack('world.monsters', 'SRD Monsters', [
      {
        id: 'gob1',
        name: 'Goblin',
        type: 'npc',
        img: 'goblin.webp',
        system: { details: { cr: 0.25 } },
      },
    ]);

    const before = world.actors.size;
    const result = await da.createActorFromCompendium({ creatureType: 'Goblin' });

    expect(result.success).toBe(true);
    expect(result.totalRequested).toBe(1);
    expect(result.totalCreated).toBe(1);
    expect(result.tokensPlaced).toBe(0);
    expect(result.errors).toBeUndefined();
    expect(result.actors).toHaveLength(1);
    expect(result.actors[0]).toMatchObject({
      name: 'Goblin',
      originalName: 'Goblin',
      type: 'npc',
      sourcePackId: 'world.monsters',
      sourcePackLabel: 'SRD Monsters',
    });
    // The actor was actually created into the world.
    expect(world.actors.size).toBe(before + 1);
    expect(world.actors.get(result.actors[0].id)).toBeTruthy();
  });

  it('creates the "Foundry MCP Creatures" Actor folder and assigns it', async () => {
    world.enableWrites();
    addActorPack('world.monsters', 'Monsters', [{ id: 'gob1', name: 'Goblin', type: 'npc' }]);

    await da.createActorFromCompendium({ creatureType: 'Goblin' });

    const folder = world.folders.find(
      (f: any) => f.name === 'Foundry MCP Creatures' && f.type === 'Actor'
    );
    expect(folder).toBeTruthy();
    const created = world.actors.find((a: any) => a.name === 'Goblin');
    expect(created!.folder).toBe(folder!.id);
  });

  it('reuses an existing "Foundry MCP Creatures" folder rather than creating a second', async () => {
    world.enableWrites();
    world.addFolder({ id: 'existing', name: 'Foundry MCP Creatures', type: 'Actor' });
    addActorPack('world.monsters', 'Monsters', [{ id: 'gob1', name: 'Goblin', type: 'npc' }]);

    await da.createActorFromCompendium({ creatureType: 'Goblin' });

    const matching = world.folders.filter(
      (f: any) => f.name === 'Foundry MCP Creatures' && f.type === 'Actor'
    );
    expect(matching).toHaveLength(1);
    const created = world.actors.find((a: any) => a.name === 'Goblin');
    expect(created!.folder).toBe('existing');
  });

  it('auto-numbers names when quantity > 1 (and clamps to maxActorsPerRequest)', async () => {
    world.enableWrites(3);
    addActorPack('world.monsters', 'Monsters', [{ id: 'gob1', name: 'Goblin', type: 'npc' }]);

    // request 3 (== max) so the permission gate passes; names auto-number 1..3
    const result = await da.createActorFromCompendium({ creatureType: 'Goblin', quantity: 3 });

    expect(result.totalRequested).toBe(3);
    expect(result.totalCreated).toBe(3);
    expect(result.actors.map(a => a.name)).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3']);
    expect(result.actors.every(a => a.originalName === 'Goblin')).toBe(true);
  });

  it('honours customNames, falling back to auto-numbering past the array end', async () => {
    world.enableWrites(3);
    addActorPack('world.monsters', 'Monsters', [{ id: 'gob1', name: 'Goblin', type: 'npc' }]);

    const result = await da.createActorFromCompendium({
      creatureType: 'Goblin',
      quantity: 3,
      customNames: ['Snik', 'Grub'],
    });

    // index 0,1 use custom names; index 2 has no custom name → `${name} 3`
    expect(result.actors.map(a => a.name)).toEqual(['Snik', 'Grub', 'Goblin 3']);
  });

  it('prefers an exact (case-insensitive) name match over a partial one', async () => {
    world.enableWrites();
    addActorPack('world.monsters', 'Monsters', [
      { id: 'gob-scout', name: 'Goblin Scout', type: 'npc' },
      { id: 'gob', name: 'Goblin', type: 'npc' },
    ]);

    const result = await da.createActorFromCompendium({ creatureType: 'goblin' });

    expect(result.actors[0].originalName).toBe('Goblin');
  });

  it('uses packPreference to disambiguate when there is no exact match', async () => {
    world.enableWrites();
    addActorPack('world.a', 'Pack A', [{ id: 'd1', name: 'Dragon Wyrmling', type: 'npc' }]);
    addActorPack('world.b', 'Pack B', [{ id: 'd2', name: 'Dragon Whelp', type: 'npc' }]);

    const result = await da.createActorFromCompendium({
      creatureType: 'dragon',
      packPreference: 'world.b',
    });

    expect(result.actors[0].sourcePackId).toBe('world.b');
  });

  it('clears a remote (http) prototype-token texture on the cloned actor', async () => {
    world.enableWrites();
    addActorPack('world.monsters', 'Monsters', [
      {
        id: 'gob1',
        name: 'Goblin',
        type: 'npc',
        prototypeToken: { texture: { src: 'https://example.com/remote.png' } },
      },
    ]);

    await da.createActorFromCompendium({ creatureType: 'Goblin' });

    const created = world.actors.find((a: any) => a.name === 'Goblin');
    expect(created!.prototypeToken.texture.src).toBeNull();
  });
});

// ===========================================================================
// createActorFromCompendium — addToScene branch
// ===========================================================================

describe('FoundryDataAccess — createActorFromCompendium: addToScene', () => {
  it('runs the scene placement when addToScene=true and reports tokensPlaced', async () => {
    // `createActor` and `modifyScene` share the `allowWriteOperations` toggle, so
    // enableWrites() satisfies both gates and the scene path actually executes.
    world.enableWrites();
    addActorPack('world.monsters', 'Monsters', [
      { id: 'gob1', name: 'Goblin', type: 'npc', prototypeToken: { texture: { src: '' } } },
    ]);
    const scene = world.addScene({ id: 'scene1', name: 'Field', active: true });
    world.setActiveScene(scene.id);

    const result = await da.createActorFromCompendium({
      creatureType: 'Goblin',
      addToScene: true,
    });

    // The actor is created; the placement runs but the cloned actor's
    // prototypeToken (a plain cloned object) has no `toObject()`, so per-actor
    // token prep is swallowed inside addActorsToScene and 0 tokens are placed.
    // That inner failure is NOT propagated to the outer result's errors.
    expect(result.success).toBe(true);
    expect(result.totalCreated).toBe(1);
    expect(result.tokensPlaced).toBe(0);
    expect(result.errors).toBeUndefined();
  });

  it('records a non-fatal error when scene placement throws (no active scene)', async () => {
    // addToScene=true with no active scene: addActorsToScene throws "No active
    // scene found"; the outer try/catch records it as an error but the created
    // actor still counts as a success (totalCreated stays 1).
    world.enableWrites();
    addActorPack('world.monsters', 'Monsters', [{ id: 'gob1', name: 'Goblin', type: 'npc' }]);
    // deliberately no active scene

    const result = await da.createActorFromCompendium({
      creatureType: 'Goblin',
      addToScene: true,
    });

    expect(result.success).toBe(true);
    expect(result.totalCreated).toBe(1);
    expect(result.tokensPlaced).toBe(0);
    expect(result.errors).toEqual(['Failed to add actors to scene: No active scene found']);
  });
});

// ===========================================================================
// createActorFromCompendium — rollback on significant failure
// ===========================================================================

describe('FoundryDataAccess — createActorFromCompendium: rollback', () => {
  it('rolls back and throws when fewer than half the requested actors are created', async () => {
    world.enableWrites(3);
    addActorPack('world.monsters', 'Monsters', [{ id: 'gob1', name: 'Goblin', type: 'npc' }]);

    // Force every per-actor creation to fail so createdActors.length (0) < quantity/2.
    const realCreateDocuments = (globalThis as any).Actor.createDocuments;
    (globalThis as any).Actor.createDocuments = vi.fn(() => {
      throw new Error('boom');
    });

    try {
      await expect(
        da.createActorFromCompendium({ creatureType: 'Goblin', quantity: 3 })
      ).rejects.toThrow(/Actor creation failed:/);
    } finally {
      (globalThis as any).Actor.createDocuments = realCreateDocuments;
    }
  });
});

// ===========================================================================
// createActorFromCompendiumEntry — input + lookup validation
// ===========================================================================

describe('FoundryDataAccess — createActorFromCompendiumEntry: validation', () => {
  it('throws when packId or itemId is missing', async () => {
    await expect(
      da.createActorFromCompendiumEntry({ packId: '', itemId: 'x', customNames: [] })
    ).rejects.toThrow('Both packId and itemId are required');
  });

  it('throws when the pack is not found', async () => {
    await expect(
      da.createActorFromCompendiumEntry({ packId: 'no.pack', itemId: 'x', customNames: [] })
    ).rejects.toThrow('Compendium pack "no.pack" not found');
  });

  it('throws when the document is not found in the pack', async () => {
    addActorPack('world.monsters', 'Monsters', []);
    await expect(
      da.createActorFromCompendiumEntry({
        packId: 'world.monsters',
        itemId: 'missing',
        customNames: [],
      })
    ).rejects.toThrow('Document "missing" not found in pack "world.monsters"');
  });

  it('throws when the resolved document is not an Actor', async () => {
    world.addPack({
      id: 'world.items',
      label: 'Items',
      type: 'Item',
      documents: [makeActor({ id: 'sword', name: 'Sword', type: 'weapon', documentName: 'Item' })],
    });

    await expect(
      da.createActorFromCompendiumEntry({
        packId: 'world.items',
        itemId: 'sword',
        customNames: [],
      })
    ).rejects.toThrow(/is not an Actor \(documentName: Item/);
  });

  it('throws when the actor type is unsupported (not character/npc)', async () => {
    addActorPack('world.monsters', 'Monsters', [{ id: 'veh1', name: 'Cart', type: 'vehicle' }]);

    await expect(
      da.createActorFromCompendiumEntry({
        packId: 'world.monsters',
        itemId: 'veh1',
        customNames: [],
      })
    ).rejects.toThrow(/unsupported actor type: vehicle\. Supported types: character, npc/);
  });
});

// ===========================================================================
// createActorFromCompendiumEntry — success paths
// ===========================================================================

describe('FoundryDataAccess — createActorFromCompendiumEntry: success', () => {
  it('creates from an explicit pack/item id with the supplied custom name', async () => {
    addActorPack('world.monsters', 'Monsters', [
      { id: 'gob1', name: 'Goblin', type: 'npc', img: 'g.webp', system: { hp: 7 } },
    ]);

    const result = await da.createActorFromCompendiumEntry({
      packId: 'world.monsters',
      itemId: 'gob1',
      customNames: ['Sneaky Pete'],
    });

    expect(result.success).toBe(true);
    expect(result.totalCreated).toBe(1);
    expect(result.totalRequested).toBe(1);
    expect(result.tokensPlaced).toBe(0);
    expect(result.errors).toBeUndefined();
    expect(result.actors[0]).toMatchObject({
      name: 'Sneaky Pete',
      originalName: 'Goblin',
      sourcePackLabel: 'Monsters',
    });
    expect(world.actors.find((a: any) => a.name === 'Sneaky Pete')).toBeTruthy();
  });

  it('defaults the name to "<name> Copy" when customNames is empty', async () => {
    addActorPack('world.monsters', 'Monsters', [{ id: 'gob1', name: 'Goblin', type: 'npc' }]);

    const result = await da.createActorFromCompendiumEntry({
      packId: 'world.monsters',
      itemId: 'gob1',
      customNames: [],
    });

    expect(result.actors[0].name).toBe('Goblin Copy');
  });

  it('caps the quantity at the number of supplied names', async () => {
    addActorPack('world.monsters', 'Monsters', [{ id: 'gob1', name: 'Goblin', type: 'npc' }]);

    const result = await da.createActorFromCompendiumEntry({
      packId: 'world.monsters',
      itemId: 'gob1',
      customNames: ['A', 'B'],
      quantity: 10,
    });

    expect(result.totalRequested).toBe(2);
    expect(result.actors.map(a => a.name)).toEqual(['A', 'B']);
  });

  it('clears a remote (http) prototype-token texture on the created actor', async () => {
    addActorPack('world.monsters', 'Monsters', [
      {
        id: 'gob1',
        name: 'Goblin',
        type: 'npc',
        prototypeToken: { texture: { src: 'http://x/y.png' } },
      },
    ]);

    await da.createActorFromCompendiumEntry({
      packId: 'world.monsters',
      itemId: 'gob1',
      customNames: ['Goblin Copy'],
    });

    const created = world.actors.find((a: any) => a.name === 'Goblin Copy');
    expect(created!.prototypeToken.texture.src).toBeNull();
  });

  it('files the created actor under the "Foundry MCP Creatures" Actor folder', async () => {
    addActorPack('world.monsters', 'Monsters', [{ id: 'gob1', name: 'Goblin', type: 'npc' }]);

    await da.createActorFromCompendiumEntry({
      packId: 'world.monsters',
      itemId: 'gob1',
      customNames: ['Goblin Copy'],
    });

    const folder = world.folders.find(
      (f: any) => f.name === 'Foundry MCP Creatures' && f.type === 'Actor'
    );
    expect(folder).toBeTruthy();
    const created = world.actors.find((a: any) => a.name === 'Goblin Copy');
    expect(created!.folder).toBe(folder!.id);
  });
});

// ===========================================================================
// addActorItems
// ===========================================================================

describe('FoundryDataAccess — addActorItems', () => {
  it('throws when actorIdentifier is missing', async () => {
    await expect(da.addActorItems({ actorIdentifier: '', items: [] })).rejects.toThrow(
      'actorIdentifier is required'
    );
  });

  it('throws when items is empty', async () => {
    await expect(da.addActorItems({ actorIdentifier: 'Hero', items: [] })).rejects.toThrow(
      'items array is required and must contain at least one entry'
    );
  });

  it('throws when the actor cannot be resolved', async () => {
    await expect(
      da.addActorItems({
        actorIdentifier: 'ghost',
        items: [{ name: 'Dagger', type: 'weapon' }],
      })
    ).rejects.toThrow('Actor not found: ghost');
  });

  it('throws when an item has a blank name', async () => {
    world.addActor({ id: 'h1', name: 'Hero', type: 'character' });
    await expect(
      da.addActorItems({ actorIdentifier: 'Hero', items: [{ name: '   ', type: 'weapon' }] })
    ).rejects.toThrow('items[0]: "name" is required and must be a non-empty string');
  });

  it('throws when an item has a blank type', async () => {
    world.addActor({ id: 'h1', name: 'Hero', type: 'character' });
    await expect(
      da.addActorItems({ actorIdentifier: 'Hero', items: [{ name: 'Dagger', type: '' }] })
    ).rejects.toThrow('items[0] ("Dagger"): "type" is required');
  });

  it('throws when the item type is not a declared system Item type', async () => {
    // game.system.documentTypes.Item declares the valid set; an unknown type is rejected.
    (globalThis as any).game.system.documentTypes = { Item: { weapon: {}, spell: {} } };
    world.addActor({ id: 'h1', name: 'Hero', type: 'character' });

    await expect(
      da.addActorItems({ actorIdentifier: 'Hero', items: [{ name: 'X', type: 'gadget' }] })
    ).rejects.toThrow(/unknown type "gadget".*Valid Item types: weapon, spell/);
  });

  it('creates embedded items and returns their ids/names/types', async () => {
    const actor = world.addActor({ id: 'h1', name: 'Hero', type: 'character' });

    const result = await da.addActorItems({
      actorIdentifier: 'Hero',
      items: [
        { name: 'Longsword', type: 'weapon', img: 'ls.webp', system: { damage: '1d8' } },
        { name: 'Fireball', type: 'spell' },
      ],
    });

    expect(result.actorId).toBe('h1');
    expect(result.actorName).toBe('Hero');
    expect(result.created.map(c => c.name)).toEqual(['Longsword', 'Fireball']);
    expect(result.created.map(c => c.type)).toEqual(['weapon', 'spell']);
    expect(result.created.every(c => typeof c.id === 'string' && c.id.length > 0)).toBe(true);
    // the items actually landed on the actor's embedded collection
    expect(actor.items.size).toBe(2);
  });

  it('accepts any type when the system declares no Item document types', async () => {
    // default harness game.system has no documentTypes → validTypes is null → no guard
    const actor = world.addActor({ id: 'h1', name: 'Hero', type: 'character' });

    const result = await da.addActorItems({
      actorIdentifier: 'Hero',
      items: [{ name: 'Mystery', type: 'anything-goes' }],
    });

    expect(result.created).toHaveLength(1);
    expect(result.created[0].type).toBe('anything-goes');
    expect(actor.items.size).toBe(1);
  });
});

// ===========================================================================
// addActorsToScene — permission + scene guards
// ===========================================================================

describe('FoundryDataAccess — addActorsToScene: guards', () => {
  it('throws ACCESS_DENIED when modifyScene is disabled', async () => {
    await expect(
      da.addActorsToScene({ actorIds: ['a1'], placement: 'grid', hidden: false })
    ).rejects.toThrow(
      `${ERROR_MESSAGES.ACCESS_DENIED}: Modify Scene is disabled in module settings`
    );
  });

  it('throws "No active scene found" when there is no current scene', async () => {
    world.enableWrites();
    await expect(
      da.addActorsToScene({ actorIds: ['a1'], placement: 'grid', hidden: false })
    ).rejects.toThrow('No active scene found');
  });
});

// ===========================================================================
// addActorsToScene — placement + result shape
// ===========================================================================

describe('FoundryDataAccess — addActorsToScene: placement', () => {
  function activeScene(): any {
    const scene = world.addScene({
      id: 'scene1',
      name: 'Field',
      active: true,
      width: 1000,
      height: 800,
      grid: { size: 100 },
    });
    world.setActiveScene(scene.id);
    return scene;
  }

  it('places a token for a known actor and returns the result shape', async () => {
    world.enableWrites();
    const scene = activeScene();
    addActorWithProtoToken({ id: 'a1', name: 'Goblin', type: 'npc' });

    const result = await da.addActorsToScene({
      actorIds: ['a1'],
      placement: 'grid',
      hidden: false,
    });

    expect(result.success).toBe(true);
    expect(result.tokensCreated).toBe(1);
    expect(result.tokenIds).toHaveLength(1);
    expect(result.errors).toBeUndefined();
    expect(scene.tokens.size).toBe(1);
    const token = scene.tokens.contents[0];
    expect(token.actorId).toBe('a1');
    expect(token.hidden).toBe(false);
  });

  it('places "grid" tokens at the documented offsets', async () => {
    world.enableWrites();
    const scene = activeScene();
    addActorWithProtoToken({ id: 'a1', name: 'A', type: 'npc' });
    addActorWithProtoToken({ id: 'a2', name: 'B', type: 'npc' });

    await da.addActorsToScene({ actorIds: ['a1', 'a2'], placement: 'grid', hidden: false });

    const tokens = scene.tokens.contents;
    // index 0: cols=ceil(sqrt(1))=1, row=0, col=0 → (100,100)
    expect({ x: tokens[0].x, y: tokens[0].y }).toEqual({ x: 100, y: 100 });
    // index 1: cols=ceil(sqrt(2))=2, row=0, col=1 → (100 + 1*200, 100) = (300,100)
    expect({ x: tokens[1].x, y: tokens[1].y }).toEqual({ x: 300, y: 100 });
  });

  it('places a "center" token relative to the scene dimensions', async () => {
    world.enableWrites();
    const scene = activeScene();
    addActorWithProtoToken({ id: 'a1', name: 'A', type: 'npc' });

    await da.addActorsToScene({ actorIds: ['a1'], placement: 'center', hidden: false });

    const token = scene.tokens.contents[0];
    // index 0: x = width/2 + 0 = 500, y = height/2 = 400
    expect({ x: token.x, y: token.y }).toEqual({ x: 500, y: 400 });
  });

  it('uses explicit coordinates when placement is "coordinates"', async () => {
    world.enableWrites();
    const scene = activeScene();
    addActorWithProtoToken({ id: 'a1', name: 'A', type: 'npc' });

    await da.addActorsToScene({
      actorIds: ['a1'],
      placement: 'coordinates',
      hidden: false,
      coordinates: [{ x: 777, y: 888 }],
    });

    const token = scene.tokens.contents[0];
    expect({ x: token.x, y: token.y }).toEqual({ x: 777, y: 888 });
  });

  it('marks the token hidden when hidden=true', async () => {
    world.enableWrites();
    const scene = activeScene();
    addActorWithProtoToken({ id: 'a1', name: 'A', type: 'npc' });

    await da.addActorsToScene({ actorIds: ['a1'], placement: 'grid', hidden: true });

    expect(scene.tokens.contents[0].hidden).toBe(true);
  });

  it('records an error (and skips) for an unknown actor id, succeeding for the rest', async () => {
    world.enableWrites();
    const scene = activeScene();
    addActorWithProtoToken({ id: 'a1', name: 'A', type: 'npc' });

    const result = await da.addActorsToScene({
      actorIds: ['ghost', 'a1'],
      placement: 'grid',
      hidden: false,
    });

    expect(result.success).toBe(true);
    expect(result.tokensCreated).toBe(1);
    expect(result.errors).toEqual(['Actor ghost not found']);
    expect(scene.tokens.size).toBe(1);
  });

  it('clears a remote (http) token texture before placement', async () => {
    world.enableWrites();
    const scene = activeScene();
    addActorWithProtoToken(
      { id: 'a1', name: 'A', type: 'npc' },
      { name: 'Tok', texture: { src: 'https://cdn/remote.png' } }
    );

    await da.addActorsToScene({ actorIds: ['a1'], placement: 'grid', hidden: false });

    expect(scene.tokens.contents[0].texture.src).toBeNull();
  });

  it('returns success=false and no tokens when given an empty actorIds list', async () => {
    world.enableWrites();
    activeScene();

    const result = await da.addActorsToScene({ actorIds: [], placement: 'grid', hidden: false });

    expect(result.success).toBe(false);
    expect(result.tokensCreated).toBe(0);
    expect(result.tokenIds).toEqual([]);
    expect(result.errors).toBeUndefined();
  });
});
