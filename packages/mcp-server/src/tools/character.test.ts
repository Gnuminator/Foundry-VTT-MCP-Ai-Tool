import { describe, expect, it, vi } from 'vitest';

import { CharacterTools } from './character.js';

/**
 * Characterization test suite for CharacterTools.
 *
 * Goal: parity net that pins current behavior so the file can later be safely
 * refactored. We mock FoundryClient so the layer is tested in isolation.
 *
 * Validation: all handlers use schema.parse(args) (Zod), so invalid args THROW
 * (ZodError) — no "return string" pattern here. Query errors are caught and
 * re-thrown as new Error('Failed to …: <message>').
 *
 * Private formatting helpers (formatCharacterResponse, formatItems,
 * formatEffects, formatActions, formatSpellcasting, extractBasicInfo,
 * extractStats) are exercised via the public handlers.
 */

function makeTools(queryImpl?: (method: string, data: unknown) => unknown) {
  const query = vi.fn(queryImpl ?? (() => ({ success: true })));
  const foundryClient = { query } as any;
  // Minimal Logger stub: `.child()` returns itself; level methods are no-ops.
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = () => logger;
  // No systemRegistry — tests run in legacy-extraction mode.
  return { tools: new CharacterTools({ foundryClient, logger }), query, logger };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('CharacterTools.getToolDefinitions', () => {
  it('exposes the expected tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'get-character',
      'get-character-entity',
      'list-characters',
      'use-item',
      'manage-world-items',
      'search-character-items',
    ]);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('get-character requires identifier', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-character')!;
    expect((def.inputSchema as any).required).toEqual(['identifier']);
  });

  it('get-character-entity requires characterIdentifier and entityIdentifier', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-character-entity')!;
    expect((def.inputSchema as any).required).toEqual(['characterIdentifier', 'entityIdentifier']);
  });

  it('list-characters has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'list-characters')!;
    expect((def.inputSchema as any).required).toBeUndefined();
  });

  it('use-item requires actorIdentifier and itemIdentifier', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'use-item')!;
    expect((def.inputSchema as any).required).toEqual(['actorIdentifier', 'itemIdentifier']);
  });

  it('manage-world-items requires action', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'manage-world-items')!;
    expect((def.inputSchema as any).required).toEqual(['action']);
  });

  it('search-character-items requires characterIdentifier', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'search-character-items')!;
    expect((def.inputSchema as any).required).toEqual(['characterIdentifier']);
  });
});

// ---------------------------------------------------------------------------
// handleGetCharacter
// ---------------------------------------------------------------------------

describe('CharacterTools.handleGetCharacter', () => {
  it('dispatches getCharacterInfo with characterName and returns formatted response', async () => {
    const rawChar = {
      id: 'char1',
      name: 'Elara',
      type: 'character',
      img: 'tokens/elara.png',
      items: [],
      effects: [],
      system: {},
    };
    const { tools, query } = makeTools(() => rawChar);
    const result = await tools.handleGetCharacter({ identifier: 'Elara' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getCharacterInfo', {
      characterName: 'Elara',
    });
    // formatCharacterResponse shapes the result
    expect(result.id).toBe('char1');
    expect(result.name).toBe('Elara');
    expect(result.type).toBe('character');
    expect(result.hasImage).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.effects).toEqual([]);
    expect(result).toHaveProperty('basicInfo');
    expect(result).toHaveProperty('stats');
  });

  it('throws ZodError (not a string) when identifier is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleGetCharacter({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when identifier is an empty string', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleGetCharacter({ identifier: '' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when Foundry query fails', async () => {
    const { tools } = makeTools(() => {
      throw new Error('actor not found');
    });
    await expect(tools.handleGetCharacter({ identifier: 'Ghost' })).rejects.toThrow(
      'Failed to retrieve character "Ghost": actor not found'
    );
  });

  it('shapes items through formatItems (minimal fields)', async () => {
    const rawChar = {
      id: 'char1',
      name: 'Thorn',
      type: 'character',
      img: null,
      items: [
        {
          id: 'item1',
          name: 'Longsword',
          type: 'weapon',
          system: {
            quantity: 1,
            equipped: true,
            attunement: 0,
          },
        },
        {
          id: 'item2',
          name: 'Healing Potion',
          type: 'consumable',
          system: {
            quantity: 3,
          },
        },
      ],
      effects: [],
      system: {},
    };
    const { tools } = makeTools(() => rawChar);
    const result = await tools.handleGetCharacter({ identifier: 'Thorn' });
    // quantity === 1 is NOT included; quantity === 3 IS included
    const sword = result.items.find((i: any) => i.name === 'Longsword');
    expect(sword).toMatchObject({ id: 'item1', name: 'Longsword', type: 'weapon', equipped: true });
    expect(sword.quantity).toBeUndefined(); // quantity === 1 is omitted
    const potion = result.items.find((i: any) => i.name === 'Healing Potion');
    expect(potion.quantity).toBe(3);
  });

  it('shapes effects through formatEffects', async () => {
    const rawChar = {
      id: 'char1',
      name: 'Caster',
      type: 'character',
      img: null,
      items: [],
      effects: [
        {
          id: 'eff1',
          name: 'Blessed',
          disabled: false,
          icon: 'icons/bless.png',
          duration: { type: 'rounds', remaining: 3 },
        },
        {
          id: 'eff2',
          name: 'Poisoned',
          disabled: true,
          icon: null,
          duration: null,
        },
      ],
      system: {},
    };
    const { tools } = makeTools(() => rawChar);
    const result = await tools.handleGetCharacter({ identifier: 'Caster' });
    expect(result.effects).toEqual([
      {
        id: 'eff1',
        name: 'Blessed',
        disabled: false,
        duration: { type: 'rounds', remaining: 3 },
        hasIcon: true,
      },
      { id: 'eff2', name: 'Poisoned', disabled: true, duration: null, hasIcon: false },
    ]);
  });

  it('includes actions when characterData.actions is non-empty', async () => {
    const rawChar = {
      id: 'char1',
      name: 'Fighter',
      type: 'character',
      img: null,
      items: [],
      effects: [],
      actions: [
        { name: 'Attack', type: 'action', traits: ['attack'], actions: 1, itemId: 'item1' },
        { name: 'Dodge', type: 'free', traits: [], actions: undefined, itemId: null },
      ],
      system: {},
    };
    const { tools } = makeTools(() => rawChar);
    const result = await tools.handleGetCharacter({ identifier: 'Fighter' });
    expect(result.actions).toHaveLength(2);
    const attack = result.actions.find((a: any) => a.name === 'Attack');
    expect(attack).toMatchObject({
      name: 'Attack',
      type: 'action',
      traits: ['attack'],
      actionCost: 1,
      itemId: 'item1',
    });
    // Empty traits array → traits NOT included (only included if length > 0)
    const dodge = result.actions.find((a: any) => a.name === 'Dodge');
    expect(dodge.traits).toBeUndefined();
  });

  it('includes spellcasting when characterData.spellcasting is non-empty', async () => {
    const rawChar = {
      id: 'char1',
      name: 'Wizard',
      type: 'character',
      img: null,
      items: [],
      effects: [],
      spellcasting: [
        {
          name: 'Arcane Spellcasting',
          type: 'prepared',
          tradition: 'arcane',
          ability: 'int',
          dc: 18,
          attack: 10,
          slots: { slot1: { value: 3, max: 3 } },
          spells: [
            { id: 'sp1', name: 'Magic Missile', level: 1, traits: ['force'], actionCost: '1' },
          ],
        },
      ],
      system: {},
    };
    const { tools } = makeTools(() => rawChar);
    const result = await tools.handleGetCharacter({ identifier: 'Wizard' });
    expect(result.spellcasting).toHaveLength(1);
    const sc = result.spellcasting[0];
    expect(sc.name).toBe('Arcane Spellcasting');
    expect(sc.tradition).toBe('arcane');
    expect(sc.spellCount).toBe(1);
    expect(sc.spells[0]).toMatchObject({
      id: 'sp1',
      name: 'Magic Missile',
      level: 1,
      traits: ['force'],
    });
  });

  it('extracts basicInfo hitPoints and armorClass from system.attributes', async () => {
    const rawChar = {
      id: 'char1',
      name: 'Paladin',
      type: 'character',
      img: null,
      items: [],
      effects: [],
      system: {
        attributes: {
          hp: { value: 45, max: 52, temp: 5 },
          ac: { value: 18 },
        },
      },
    };
    const { tools } = makeTools(() => rawChar);
    const result = await tools.handleGetCharacter({ identifier: 'Paladin' });
    expect(result.basicInfo.hitPoints).toEqual({ current: 45, max: 52, temp: 5 });
    expect(result.basicInfo.armorClass).toBe(18);
  });

  it('extracts stats abilities and skills from system fields', async () => {
    const rawChar = {
      id: 'char1',
      name: 'Rogue',
      type: 'character',
      img: null,
      items: [],
      effects: [],
      system: {
        abilities: {
          str: { value: 10, mod: 0 },
          dex: { value: 18, mod: 4 },
        },
        skills: {
          acr: { value: 6, proficient: true, ability: 'dex' },
        },
        saves: {
          dex: { value: 5, proficient: true },
        },
      },
    };
    const { tools } = makeTools(() => rawChar);
    const result = await tools.handleGetCharacter({ identifier: 'Rogue' });
    expect(result.stats.abilities.dex).toEqual({ score: 18, modifier: 4 });
    expect(result.stats.skills.acr).toMatchObject({ value: 6, proficient: true });
    expect(result.stats.saves.dex).toMatchObject({ value: 5, proficient: true });
  });
});

// ---------------------------------------------------------------------------
// handleGetCharacterEntity
// ---------------------------------------------------------------------------

describe('CharacterTools.handleGetCharacterEntity', () => {
  const baseChar = {
    id: 'char1',
    name: 'Ember',
    type: 'character',
    img: null,
    items: [
      {
        id: 'item1',
        name: 'Fireball',
        type: 'spell',
        img: 'icons/fire.png',
        system: {
          description: { value: 'A ball of fire erupts.' },
          traits: { value: ['fire', 'evocation'], rarity: 'common' },
          level: { value: 3 },
          quantity: 1,
        },
      },
    ],
    actions: [{ name: 'Strike', type: 'action', traits: ['attack'], itemId: 'item1' }],
    effects: [
      {
        id: 'eff1',
        name: 'Blessed',
        description: 'You are blessed.',
        traits: ['divine'],
        duration: null,
      },
    ],
  };

  it('dispatches getCharacterInfo and returns item entity shape', async () => {
    const { tools, query } = makeTools(() => ({ ...baseChar }));
    const result = await tools.handleGetCharacterEntity({
      characterIdentifier: 'Ember',
      entityIdentifier: 'Fireball',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getCharacterInfo', {
      characterName: 'Ember',
    });
    expect(result.entityType).toBe('item');
    expect(result.id).toBe('item1');
    expect(result.name).toBe('Fireball');
    expect(result.description).toBe('A ball of fire erupts.');
    expect(result.traits).toEqual(['fire', 'evocation']);
    expect(result.rarity).toBe('common');
    expect(result.level).toBe(3);
  });

  it('finds item by id (not just name)', async () => {
    const { tools } = makeTools(() => ({ ...baseChar }));
    const result = await tools.handleGetCharacterEntity({
      characterIdentifier: 'Ember',
      entityIdentifier: 'item1',
    });
    expect(result.entityType).toBe('item');
    expect(result.name).toBe('Fireball');
  });

  it('finds action entity by name when not in items', async () => {
    const charNoItemMatch = {
      ...baseChar,
      items: [], // No items → falls through to actions
    };
    const { tools } = makeTools(() => charNoItemMatch);
    const result = await tools.handleGetCharacterEntity({
      characterIdentifier: 'Ember',
      entityIdentifier: 'Strike',
    });
    expect(result.entityType).toBe('action');
    expect(result.name).toBe('Strike');
    expect(result.traits).toEqual(['attack']);
  });

  it('finds effect entity by name when not in items or actions', async () => {
    const charNoItemOrAction = {
      ...baseChar,
      items: [],
      actions: [],
    };
    const { tools } = makeTools(() => charNoItemOrAction);
    const result = await tools.handleGetCharacterEntity({
      characterIdentifier: 'Ember',
      entityIdentifier: 'Blessed',
    });
    expect(result.entityType).toBe('effect');
    expect(result.name).toBe('Blessed');
  });

  it('throws when entity is not found in any collection', async () => {
    const { tools } = makeTools(() => ({ ...baseChar, items: [], actions: [], effects: [] }));
    await expect(
      tools.handleGetCharacterEntity({
        characterIdentifier: 'Ember',
        entityIdentifier: 'NonExistent',
      })
    ).rejects.toThrow('Entity "NonExistent" not found on character "Ember"');
  });

  it('throws ZodError when characterIdentifier is missing', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleGetCharacterEntity({ entityIdentifier: 'Fireball' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when entityIdentifier is missing', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleGetCharacterEntity({ characterIdentifier: 'Ember' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('wraps query errors as "Failed to retrieve entity …"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('bridge down');
    });
    await expect(
      tools.handleGetCharacterEntity({
        characterIdentifier: 'Ember',
        entityIdentifier: 'Fireball',
      })
    ).rejects.toThrow('Failed to retrieve entity "Fireball" from character "Ember": bridge down');
  });
});

// ---------------------------------------------------------------------------
// handleListCharacters
// ---------------------------------------------------------------------------

describe('CharacterTools.handleListCharacters', () => {
  it('dispatches listActors with type and returns formatted list', async () => {
    const actors = [
      { id: 'a1', name: 'Elara', type: 'character', img: 'e.png' },
      { id: 'a2', name: 'Goblin', type: 'npc', img: null },
    ];
    const { tools, query } = makeTools(() => actors);
    const result = await tools.handleListCharacters({ type: 'character' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.listActors', { type: 'character' });
    expect(result).toEqual({
      characters: [
        { id: 'a1', name: 'Elara', type: 'character', hasImage: true },
        { id: 'a2', name: 'Goblin', type: 'npc', hasImage: false },
      ],
      total: 2,
      filtered: 'Filtered by type: character',
    });
  });

  it('dispatches with undefined type when called with empty object', async () => {
    const { tools, query } = makeTools(() => []);
    const result = await tools.handleListCharacters({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.listActors', { type: undefined });
    expect(result.filtered).toBe('All characters');
  });

  it('throws ZodError when called with undefined args (schema.parse requires an object)', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleListCharacters(undefined)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('wraps query errors as "Failed to list characters: …"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('socket error');
    });
    await expect(tools.handleListCharacters({})).rejects.toThrow(
      'Failed to list characters: socket error'
    );
  });
});

// ---------------------------------------------------------------------------
// handleUseItem
// ---------------------------------------------------------------------------

describe('CharacterTools.handleUseItem', () => {
  it('dispatches useItem with consume defaulting to true and skipDialog defaulting to true', async () => {
    const payload = { success: true, actorName: 'Elara', itemName: 'Fireball', targets: [] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleUseItem({
      actorIdentifier: 'Elara',
      itemIdentifier: 'Fireball',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.useItem', {
      actorIdentifier: 'Elara',
      itemIdentifier: 'Fireball',
      targets: undefined,
      options: { consume: true, spellLevel: undefined, skipDialog: true },
    });
    expect(result).toBe(payload);
  });

  it('dispatches with explicit targets, consume=false, spellLevel, skipDialog=false', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleUseItem({
      actorIdentifier: 'Elara',
      itemIdentifier: 'Fireball',
      targets: ['Goblin', 'Orc'],
      consume: false,
      spellLevel: 4,
      skipDialog: false,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.useItem', {
      actorIdentifier: 'Elara',
      itemIdentifier: 'Fireball',
      targets: ['Goblin', 'Orc'],
      options: { consume: false, spellLevel: 4, skipDialog: false },
    });
  });

  it('throws ZodError when actorIdentifier is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleUseItem({ itemIdentifier: 'Fireball' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when itemIdentifier is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleUseItem({ actorIdentifier: 'Elara' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('wraps query errors as "Failed to use item …"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('item not found on actor');
    });
    await expect(
      tools.handleUseItem({ actorIdentifier: 'Elara', itemIdentifier: 'Fireball' })
    ).rejects.toThrow('Failed to use item "Fireball": item not found on actor');
  });
});

// ---------------------------------------------------------------------------
// handleManageWorldItems — dispatcher
// ---------------------------------------------------------------------------

describe('CharacterTools.handleManageWorldItems (dispatcher)', () => {
  it('throws ZodError on invalid action enum value', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleManageWorldItems({ action: 'delete' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when action is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleManageWorldItems({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleManageWorldItems — action: "create"  (handleCreateWorldItems)
// ---------------------------------------------------------------------------

describe('CharacterTools.handleManageWorldItems action=create', () => {
  it('dispatches createWorldItems with items and optional folder', async () => {
    const payload = { folderId: 'fold1', created: ['id1', 'id2'] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleManageWorldItems({
      action: 'create',
      items: [
        { name: 'Dagger', type: 'weapon' },
        { name: 'Shield', type: 'armor', img: 'icons/shield.png' },
      ],
      folder: 'Loot',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.createWorldItems', {
      items: [
        { name: 'Dagger', type: 'weapon' },
        { name: 'Shield', type: 'armor', img: 'icons/shield.png' },
      ],
      folder: 'Loot',
    });
    expect(result).toBe(payload);
  });

  it('throws ZodError when items array is empty', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleManageWorldItems({ action: 'create', items: [] })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when items is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleManageWorldItems({ action: 'create' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('wraps query errors as "Failed to create world items: …"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('insufficient permissions');
    });
    await expect(
      tools.handleManageWorldItems({
        action: 'create',
        items: [{ name: 'Dagger', type: 'weapon' }],
      })
    ).rejects.toThrow('Failed to create world items: insufficient permissions');
  });
});

// ---------------------------------------------------------------------------
// handleManageWorldItems — action: "list"  (handleListWorldItems)
// ---------------------------------------------------------------------------

describe('CharacterTools.handleManageWorldItems action=list', () => {
  it('dispatches listWorldItems with optional filters and wraps result', async () => {
    const rawItems = [{ id: 'i1', name: 'Dagger', type: 'weapon' }];
    const { tools, query } = makeTools(() => rawItems);
    const result = await tools.handleManageWorldItems({
      action: 'list',
      type: 'weapon',
      folder: 'Loot',
      nameFilter: 'dag',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.listWorldItems', {
      type: 'weapon',
      folder: 'Loot',
      nameFilter: 'dag',
    });
    expect(result).toEqual({ items: rawItems, total: 1 });
  });

  it('omits undefined optional filters from the query params', async () => {
    const { tools, query } = makeTools(() => []);
    await tools.handleManageWorldItems({ action: 'list' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.listWorldItems', {});
  });

  it('returns {items:[], total:0} when query returns null', async () => {
    const { tools } = makeTools(() => null);
    const result = await tools.handleManageWorldItems({ action: 'list' });
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('wraps query errors as "Failed to list world items: …"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('world not loaded');
    });
    await expect(tools.handleManageWorldItems({ action: 'list' })).rejects.toThrow(
      'Failed to list world items: world not loaded'
    );
  });
});

// ---------------------------------------------------------------------------
// handleManageWorldItems — action: "update"  (handleUpdateWorldItems)
// ---------------------------------------------------------------------------

describe('CharacterTools.handleManageWorldItems action=update', () => {
  it('dispatches updateWorldItems with updates array', async () => {
    const payload = { updated: ['i1'] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleManageWorldItems({
      action: 'update',
      updates: [{ id: 'i1', name: 'Shortsword' }],
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateWorldItems', {
      updates: [{ id: 'i1', name: 'Shortsword' }],
    });
    expect(result).toBe(payload);
  });

  it('throws ZodError when updates array is empty', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleManageWorldItems({ action: 'update', updates: [] })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when updates entry is missing id', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleManageWorldItems({ action: 'update', updates: [{ name: 'Shortsword' }] })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('wraps query errors as "Failed to update world items: …"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('item not found');
    });
    await expect(
      tools.handleManageWorldItems({ action: 'update', updates: [{ id: 'i1' }] })
    ).rejects.toThrow('Failed to update world items: item not found');
  });
});

// ---------------------------------------------------------------------------
// handleManageWorldItems — action: "add-to-actor"  (handleAddActorItems)
// ---------------------------------------------------------------------------

describe('CharacterTools.handleManageWorldItems action=add-to-actor', () => {
  it('dispatches addActorItems with actorIdentifier and items', async () => {
    const payload = { actorName: 'Elara', created: ['i2'] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleManageWorldItems({
      action: 'add-to-actor',
      actorIdentifier: 'Elara',
      items: [{ name: 'Dagger', type: 'weapon' }],
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.addActorItems', {
      actorIdentifier: 'Elara',
      items: [{ name: 'Dagger', type: 'weapon' }],
    });
    expect(result).toBe(payload);
  });

  it('throws ZodError when actorIdentifier is missing', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleManageWorldItems({
        action: 'add-to-actor',
        items: [{ name: 'Dagger', type: 'weapon' }],
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when items array is empty', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleManageWorldItems({ action: 'add-to-actor', actorIdentifier: 'Elara', items: [] })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('wraps query errors as "Failed to add items to …"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('actor not found');
    });
    await expect(
      tools.handleManageWorldItems({
        action: 'add-to-actor',
        actorIdentifier: 'Elara',
        items: [{ name: 'Dagger', type: 'weapon' }],
      })
    ).rejects.toThrow('Failed to add items to "Elara": actor not found');
  });
});

// ---------------------------------------------------------------------------
// handleSearchCharacterItems
// ---------------------------------------------------------------------------

describe('CharacterTools.handleSearchCharacterItems', () => {
  it('dispatches searchCharacterItems with all params and returns result', async () => {
    const payload = { characterName: 'Elara', matches: [{ id: 'sp1', name: 'Fireball' }] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleSearchCharacterItems({
      characterIdentifier: 'Elara',
      query: 'fire',
      type: 'spell',
      category: 'prepared',
      limit: 5,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.searchCharacterItems', {
      characterIdentifier: 'Elara',
      query: 'fire',
      type: 'spell',
      category: 'prepared',
      limit: 5,
    });
    expect(result).toBe(payload);
  });

  it('defaults limit to 20 when not provided', async () => {
    const { tools, query } = makeTools(() => ({ matches: [] }));
    await tools.handleSearchCharacterItems({ characterIdentifier: 'Elara' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.searchCharacterItems', {
      characterIdentifier: 'Elara',
      query: undefined,
      type: undefined,
      category: undefined,
      limit: 20,
    });
  });

  it('throws ZodError when characterIdentifier is missing', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleSearchCharacterItems({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when characterIdentifier is empty string', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleSearchCharacterItems({ characterIdentifier: '' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('wraps query errors as "Failed to search items for …"', async () => {
    const { tools } = makeTools(() => {
      throw new Error('actor missing');
    });
    await expect(
      tools.handleSearchCharacterItems({ characterIdentifier: 'Elara' })
    ).rejects.toThrow('Failed to search items for "Elara": actor missing');
  });
});
