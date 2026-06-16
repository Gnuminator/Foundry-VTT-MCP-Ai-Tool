/**
 * Characterization tests for the world-item write/read surface of
 * `FoundryDataAccess`, driven through the Phase 9 Foundry-mock harness.
 *
 * Methods covered:
 *   - listWorldItems   (~line 3061)
 *   - updateWorldItems (~line 3126)
 *   - createWorldItems (~line 3221)
 *
 * These pin the *current* behavior so the from-scratch reimplementation
 * planned for Phase 9 can be verified to parity.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
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
// listWorldItems
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — listWorldItems', () => {
  it('returns an empty array when there are no world items', async () => {
    const result = await da.listWorldItems({});
    expect(result).toEqual([]);
  });

  it('maps items to id/name/type/folderId/folderName and omits img when falsy', async () => {
    world.addItem({ id: 'i1', name: 'Sword', type: 'weapon' });
    world.addItem({ id: 'i2', name: 'Coin', type: 'loot', img: 'coin.webp' });

    const result = await da.listWorldItems({});

    expect(result).toEqual([
      { id: 'i1', name: 'Sword', type: 'weapon', folderId: null, folderName: null },
      { id: 'i2', name: 'Coin', type: 'loot', img: 'coin.webp', folderId: null, folderName: null },
    ]);
  });

  it('includes img only when truthy', async () => {
    world.addItem({ id: 'i1', name: 'Shield', type: 'equipment', img: '' });
    const result = await da.listWorldItems({});
    expect(result[0]).not.toHaveProperty('img');
  });

  it('filters by type', async () => {
    world.addItem({ id: 'i1', name: 'Sword', type: 'weapon' });
    world.addItem({ id: 'i2', name: 'Pouch', type: 'loot' });

    const result = await da.listWorldItems({ type: 'weapon' });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('i1');
  });

  it('filters by folder name — items in that folder are returned', async () => {
    world.addFolder({ id: 'f1', name: 'Gear', type: 'Item' });
    world.addItem({
      id: 'i1',
      name: 'Helmet',
      type: 'equipment',
      folder: { id: 'f1', name: 'Gear' },
    });
    world.addItem({ id: 'i2', name: 'Pouch', type: 'loot' });

    const result = await da.listWorldItems({ folder: 'Gear' });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('i1');
    expect(result[0].folderId).toBe('f1');
    expect(result[0].folderName).toBe('Gear');
  });

  it('filters by folder id', async () => {
    world.addFolder({ id: 'f1', name: 'Gear', type: 'Item' });
    world.addItem({
      id: 'i1',
      name: 'Helmet',
      type: 'equipment',
      folder: { id: 'f1', name: 'Gear' },
    });
    world.addItem({ id: 'i2', name: 'Pouch', type: 'loot' });

    const result = await da.listWorldItems({ folder: 'f1' });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('i1');
  });

  it('returns [] when folder param is given but folder does not exist', async () => {
    world.addItem({ id: 'i1', name: 'Sword', type: 'weapon' });

    const result = await da.listWorldItems({ folder: 'Nonexistent' });

    expect(result).toEqual([]);
  });

  it('filters by nameFilter case-insensitively', async () => {
    world.addItem({ id: 'i1', name: 'Longsword', type: 'weapon' });
    world.addItem({ id: 'i2', name: 'Shield', type: 'equipment' });

    const result = await da.listWorldItems({ nameFilter: 'LONG' });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('i1');
  });

  it('combines type and nameFilter', async () => {
    world.addItem({ id: 'i1', name: 'Longsword', type: 'weapon' });
    world.addItem({ id: 'i2', name: 'Longbow', type: 'weapon' });
    world.addItem({ id: 'i3', name: 'Longsword Replica', type: 'loot' });

    const result = await da.listWorldItems({ type: 'weapon', nameFilter: 'long' });

    expect(result).toHaveLength(2);
    expect(result.map(r => r.id)).toEqual(['i1', 'i2']);
  });
});

// ---------------------------------------------------------------------------
// updateWorldItems
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — updateWorldItems', () => {
  it('throws when updates is an empty array', async () => {
    await expect(da.updateWorldItems({ updates: [] })).rejects.toThrow(
      'updates array is required and must contain at least one entry'
    );
  });

  it('throws when updates is not an array', async () => {
    await expect(da.updateWorldItems({ updates: null as any })).rejects.toThrow(
      'updates array is required and must contain at least one entry'
    );
  });

  it('throws when an entry has no id', async () => {
    await expect(da.updateWorldItems({ updates: [{ id: '' }] })).rejects.toThrow(
      'updates[0]: "id" is required and must be a non-empty string'
    );
  });

  it('throws when an entry id is not found in world items', async () => {
    await expect(da.updateWorldItems({ updates: [{ id: 'missing-id' }] })).rejects.toThrow(
      'updates[0]: Item "missing-id" not found in world'
    );
  });

  it('updates name and returns {updated:[{id,name,type}]}', async () => {
    world.addItem({ id: 'i1', name: 'Rusty Sword', type: 'weapon' });

    const result = await da.updateWorldItems({
      updates: [{ id: 'i1', name: 'Shining Sword' }],
    });

    expect(result).toEqual({
      updated: [{ id: 'i1', name: 'Shining Sword', type: 'weapon' }],
    });
    // Verify the mutation was applied to the live document
    const doc = (globalThis as any).game.items.get('i1');
    expect(doc.name).toBe('Shining Sword');
  });

  it('updates img field', async () => {
    world.addItem({ id: 'i1', name: 'Sword', type: 'weapon' });

    await da.updateWorldItems({ updates: [{ id: 'i1', img: 'new-sword.webp' }] });

    const doc = (globalThis as any).game.items.get('i1');
    expect(doc.img).toBe('new-sword.webp');
  });

  it('resolves existing folder by name and stamps folder on the item', async () => {
    world.addFolder({ id: 'f1', name: 'Gear', type: 'Item' });
    world.addItem({ id: 'i1', name: 'Sword', type: 'weapon' });

    const result = await da.updateWorldItems({
      updates: [{ id: 'i1', folder: 'Gear' }],
    });

    expect(result.updated[0].id).toBe('i1');
    // The item's folder field should now be the resolved folder id
    const doc = (globalThis as any).game.items.get('i1');
    expect(doc.folder).toBe('f1');
  });

  it('creates a new folder via Folder.create when name does not exist', async () => {
    world.addItem({ id: 'i1', name: 'Sword', type: 'weapon' });

    await da.updateWorldItems({ updates: [{ id: 'i1', folder: 'New Folder' }] });

    // The folder should have been created and registered in game.folders
    const createdFolder = (globalThis as any).game.folders.find(
      (f: any) => f.name === 'New Folder' && f.type === 'Item'
    );
    expect(createdFolder).toBeDefined();
    const doc = (globalThis as any).game.items.get('i1');
    expect(doc.folder).toBe(createdFolder.id);
  });

  it('batches multiple updates in a single call', async () => {
    world.addItem({ id: 'i1', name: 'Sword', type: 'weapon' });
    world.addItem({ id: 'i2', name: 'Shield', type: 'equipment' });

    const result = await da.updateWorldItems({
      updates: [
        { id: 'i1', name: 'Magic Sword' },
        { id: 'i2', name: 'Magic Shield' },
      ],
    });

    expect(result.updated).toHaveLength(2);
    expect(result.updated.map(u => u.name)).toEqual(['Magic Sword', 'Magic Shield']);
  });
});

// ---------------------------------------------------------------------------
// createWorldItems
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — createWorldItems', () => {
  it('throws when items is an empty array', async () => {
    await expect(da.createWorldItems({ items: [] })).rejects.toThrow(
      'items array is required and must contain at least one entry'
    );
  });

  it('throws when items[idx] has no name', async () => {
    await expect(da.createWorldItems({ items: [{ name: '', type: 'weapon' }] })).rejects.toThrow(
      'items[0]: "name" is required and must be a non-empty string'
    );
  });

  it('throws when items[idx] has no type', async () => {
    await expect(da.createWorldItems({ items: [{ name: 'Sword', type: '' }] })).rejects.toThrow(
      'items[0] ("Sword"): "type" is required'
    );
  });

  it('throws unknown-type when game.system.documentTypes.Item is set and type is invalid', async () => {
    (globalThis as any).game.system.documentTypes = { Item: { weapon: {}, loot: {} } };

    await expect(
      da.createWorldItems({ items: [{ name: 'Magic Orb', type: 'trinket' }] })
    ).rejects.toThrow('unknown type "trinket"');

    // clean up
    delete (globalThis as any).game.system.documentTypes;
  });

  it('accepts valid type when game.system.documentTypes.Item is set', async () => {
    (globalThis as any).game.system.documentTypes = { Item: { weapon: {}, loot: {} } };

    const result = await da.createWorldItems({ items: [{ name: 'Dagger', type: 'weapon' }] });

    expect(result.created).toHaveLength(1);
    expect(result.created[0].name).toBe('Dagger');

    delete (globalThis as any).game.system.documentTypes;
  });

  it('creates items and returns {folderId:null, folderName:null, created:[...]}', async () => {
    const result = await da.createWorldItems({
      items: [{ name: 'Potion', type: 'consumable' }],
    });

    expect(result.folderId).toBeNull();
    expect(result.folderName).toBeNull();
    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({ name: 'Potion', type: 'consumable' });
    expect(typeof result.created[0].id).toBe('string');
  });

  it('registers created items in game.items so subsequent reads find them', async () => {
    const result = await da.createWorldItems({
      items: [{ name: 'Torch', type: 'consumable' }],
    });

    const id = result.created[0].id;
    const doc = (globalThis as any).game.items.get(id);
    expect(doc).toBeDefined();
    expect(doc.name).toBe('Torch');
  });

  it('creates items inside an existing folder by name', async () => {
    world.addFolder({ id: 'f1', name: 'Gear', type: 'Item' });

    const result = await da.createWorldItems({
      items: [{ name: 'Helmet', type: 'equipment' }],
      folder: 'Gear',
    });

    expect(result.folderId).toBe('f1');
    expect(result.folderName).toBe('Gear');
    const doc = (globalThis as any).game.items.get(result.created[0].id);
    expect(doc.folder).toBe('f1');
  });

  it('creates a new folder via Folder.create when folder name does not exist', async () => {
    const result = await da.createWorldItems({
      items: [{ name: 'Arrow', type: 'consumable' }],
      folder: 'Ammo',
    });

    expect(result.folderName).toBe('Ammo');
    expect(result.folderId).toBeDefined();
    expect(typeof result.folderId).toBe('string');

    const createdFolder = (globalThis as any).game.folders.find(
      (f: any) => f.name === 'Ammo' && f.type === 'Item'
    );
    expect(createdFolder).toBeDefined();
    expect(result.folderId).toBe(createdFolder.id);
  });

  it('creates multiple items in a single call', async () => {
    const result = await da.createWorldItems({
      items: [
        { name: 'Sword', type: 'weapon' },
        { name: 'Shield', type: 'equipment' },
        { name: 'Potion', type: 'consumable' },
      ],
    });

    expect(result.created).toHaveLength(3);
    expect(result.created.map(c => c.name)).toEqual(['Sword', 'Shield', 'Potion']);
  });

  it('stamps img and system onto created items when provided', async () => {
    const result = await da.createWorldItems({
      items: [
        {
          name: 'Magic Sword',
          type: 'weapon',
          img: 'magic-sword.webp',
          system: { damage: '1d8' },
        },
      ],
    });

    const id = result.created[0].id;
    const doc = (globalThis as any).game.items.get(id);
    expect(doc.img).toBe('magic-sword.webp');
    expect(doc.system).toMatchObject({ damage: '1d8' });
  });
});
