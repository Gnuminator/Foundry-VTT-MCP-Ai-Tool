import { z } from 'zod';
import { AT_THE_TABLE, toolRef } from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';
import { SystemRegistry } from '../systems/system-registry.js';
import { detectGameSystem, getCachedSystemId, type GameSystem } from '../utils/system-detection.js';
import type { SystemAdapter } from '../systems/types.js';
import type { RulesCheckTools } from './rules-check.js';
import { arr, at, rec, type Rec } from './bridge-data.js';

export interface CharacterToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
  systemRegistry?: SystemRegistry;
  /** Advisory rules pre-check for use-item (never blocks). */
  rulesCheck?: Pick<RulesCheckTools, 'tryCheck'>;
}

export class CharacterTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private systemRegistry: SystemRegistry | null;
  private cachedGameSystem: GameSystem | null = null;
  private rulesCheck: Pick<RulesCheckTools, 'tryCheck'> | null;

  constructor({ foundryClient, logger, systemRegistry, rulesCheck }: CharacterToolsOptions) {
    this.rulesCheck = rulesCheck ?? null;
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'CharacterTools' });
    this.systemRegistry = systemRegistry ?? null;
  }

  /**
   * Get or detect the game system (cached)
   */
  private async getGameSystem(): Promise<GameSystem> {
    if (!this.cachedGameSystem) {
      this.cachedGameSystem = await detectGameSystem(this.foundryClient, this.logger);
    }
    return this.cachedGameSystem;
  }

  /**
   * Resolve the active SystemAdapter, if any. Looks up by the raw
   * Foundry system id first (so adapters whose id isn't part of the
   * narrow `GameSystem` enum — e.g. 'dsa5', 'cosmere-rpg' — still
   * resolve), then falls back to the normalised GameSystem.
   */
  private async getAdapter(): Promise<SystemAdapter | null> {
    if (!this.systemRegistry) return null;
    // Ensure detection has populated the cached id (it's set as a side
    // effect of detectGameSystem, which getGameSystem wraps).
    await this.getGameSystem();
    const rawId = getCachedSystemId();
    if (rawId) {
      const byRaw = this.systemRegistry.getAdapter(rawId);
      if (byRaw) return byRaw;
    }
    return this.systemRegistry.getAdapter(this.cachedGameSystem ?? 'other');
  }

  /**
   * Tool: get-character
   * Retrieve detailed information about a specific character
   */
  getToolDefinitions(): { name: string; description: string; inputSchema: object }[] {
    return [
      {
        name: 'get-character',
        description:
          'Retrieve character information optimized for minimal token usage. Returns: full stats (abilities, skills, saves, AC, HP), action names, active effects/conditions (name only), and ALL items with minimal metadata (name, type, equipped status, attunement status) without descriptions. Perfect for filtering (e.g., equipped weapons, prepared spells), checking equipment, or identifying what to investigate further. Use get-character-entity to fetch full details for specific items, actions, spells, or effects.',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description: 'Character name or ID to look up',
              ...toolRef('actor', 'id', { filter: AT_THE_TABLE }),
            },
          },
          required: ['identifier'],
        },
      },
      {
        name: 'get-character-entity',
        description:
          'Retrieve full details for one item or effect of a character. Items (spells, weapons, equipment, features) come with their dnd5e details (spell level, rarity, quantity, equipped, attunement, uses left) and their activities (attacks with to-hit, saves with DC, damage formulas, activation, range, target), plus the complete description and system data. Effects come with duration and changes. Use this after get-character when you need detailed information about a specific entity.',
        inputSchema: {
          type: 'object',
          properties: {
            characterIdentifier: {
              type: 'string',
              description: 'Character name or ID',
              ...toolRef('actor', 'id', { filter: AT_THE_TABLE }),
            },
            entityIdentifier: {
              type: 'string',
              description: 'Item or effect name or ID (a spell, weapon, feature or effect)',
              ...toolRef('actor-item', 'id', { parent: 'characterIdentifier' }),
            },
          },
          required: ['characterIdentifier', 'entityIdentifier'],
        },
      },
      {
        name: 'list-characters',
        description: 'List all available characters with basic information',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Optional filter by character type (e.g., "character", "npc")',
            },
          },
        },
      },
      {
        name: 'use-item',
        description:
          'Use an item on a character (cast spell, use ability, activate feature, consume item). Opens the item dialog in Foundry for the GM to confirm; on a GM browser without a canvas no dialog opens and the chat card Attack button reads the targets of whoever clicks it. Optionally specify targets by name. Returns "initiated" at once. Use get-character or search-character-items first to see available items/spells.',
        inputSchema: {
          type: 'object',
          properties: {
            actorIdentifier: {
              type: 'string',
              description: 'Character using the item (name or ID)',
              ...toolRef('actor', 'id', { filter: AT_THE_TABLE }),
            },
            itemIdentifier: {
              type: 'string',
              description: 'Item name or ID (spell, feat, equipment, consumable, etc.)',
              ...toolRef('actor-item', 'id', { parent: 'actorIdentifier' }),
            },
            targets: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Target character/token names or IDs. Use ["self"] to target the caster. If omitted, GM selects targets in Foundry.',
              ...toolRef('token', 'id', {
                extra: [{ value: 'self', label: 'Self (the user of the item)' }],
              }),
            },
            consume: {
              type: 'boolean',
              description: 'Whether to consume charges/uses (default: true)',
            },
            spellLevel: {
              type: 'number',
              description: 'For spells: cast at a higher level than base (D&D 5e upcasting)',
            },
          },
          required: ['actorIdentifier', 'itemIdentifier'],
        },
      },
      {
        name: 'manage-world-items',
        description:
          'Manage Item documents in Foundry VTT. Specify the operation with "action":\n' +
          '- "create": Create world-level Items in the sidebar (not actor-attached). Good for reusable libraries. GM-only.\n' +
          '- "list": List world-level Items with optional type/folder/name filters.\n' +
          '- "update": Update existing world-level Items by ID. GM-only.\n' +
          '- "add-to-actor": Create and attach Items directly to an existing actor. GM-only.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['create', 'list', 'update', 'add-to-actor'],
              description:
                'Operation to perform: "create" world items, "list" world items, "update" world items by id, or "add-to-actor" to attach items to an actor.',
            },
            items: {
              type: 'array',
              minItems: 1,
              description:
                'Required for "create" and "add-to-actor". One or more items to create. Each item requires a name and a type valid for D&D 5e (e.g. "weapon", "equipment", "spell", "feat").',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Display name of the item' },
                  type: {
                    type: 'string',
                    description:
                      'Item type valid for the active system (e.g. "action", "talent", "weapon")',
                  },
                  img: {
                    type: 'string',
                    description: 'Optional icon path (e.g. "icons/svg/explosion.svg")',
                  },
                  system: {
                    type: 'object',
                    description:
                      "System-specific data (free-form). Passed through to Foundry's DataModel layer.",
                    additionalProperties: true,
                  },
                },
                required: ['name', 'type'],
              },
            },
            updates: {
              type: 'array',
              minItems: 1,
              description:
                'Required for "update". One or more item patches. Each entry must include "id" plus at least one field to change (name, img, system, folder).',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'ID of the world Item to update' },
                  name: { type: 'string', description: 'New display name' },
                  img: { type: 'string', description: 'New icon path' },
                  system: {
                    type: 'object',
                    description:
                      'System-specific fields to update (merged into existing system data)',
                    additionalProperties: true,
                  },
                  folder: {
                    type: 'string',
                    description: 'Move item into this folder (name or ID). Created if absent.',
                  },
                },
                required: ['id'],
              },
            },
            folder: {
              type: 'string',
              description:
                'For "create": folder name/ID to place items in (created if absent). For "list": filter to items inside this folder.',
              ...toolRef('folder', 'id', { filter: { documentName: 'Item' } }),
            },
            type: {
              type: 'string',
              description:
                'For "list": filter by item type (e.g. "action", "talent"). Omit to return all types.',
            },
            nameFilter: {
              type: 'string',
              description: 'For "list": case-insensitive substring match on item name.',
            },
            actorIdentifier: {
              type: 'string',
              description: 'For "add-to-actor": actor name or ID to receive the items.',
              ...toolRef('actor', 'id', { filter: AT_THE_TABLE }),
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'search-character-items',
        description:
          "Search within a character's items, spells, actions, and effects. More token-efficient than get-character when you need specific items. Supports text search (name/description) and type filtering. Returns matching items with full details including targeting info for spells. Use this to find specific spells, equipment, feats, or abilities without loading the entire character.",
        inputSchema: {
          type: 'object',
          properties: {
            characterIdentifier: {
              type: 'string',
              description: 'Character name or ID to search within',
              ...toolRef('actor', 'id', { filter: AT_THE_TABLE }),
            },
            query: {
              type: 'string',
              description:
                'Text to search for in item names and descriptions (case-insensitive). Leave empty to return all items of specified type.',
            },
            type: {
              type: 'string',
              description:
                'Filter by dnd5e item type: "spell", "weapon", "equipment" (armor and shields too), "consumable", "tool", "loot", "container", "feat" (features), "class", "subclass", "background", "race" (species), or "effect" for active effects. Leave empty to search all types.',
            },
            category: {
              type: 'string',
              description:
                'Additional category filter. For spells: "cantrip" or "prepared". For weapons and equipment: "equipped".',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 20)',
            },
          },
          required: ['characterIdentifier'],
        },
      },
    ];
  }

  async handleGetCharacter(args: unknown): Promise<unknown> {
    const schema = z.object({
      identifier: z.string().min(1, 'Character identifier cannot be empty'),
    });

    const { identifier } = schema.parse(args);

    this.logger.info('Getting character information', { identifier });

    try {
      const characterData = (await this.foundryClient.query('foundry-mcp-bridge.getCharacterInfo', {
        characterName: identifier,
      })) as Rec;

      this.logger.debug('Successfully retrieved character data', {
        characterId: characterData.id,
        characterName: characterData.name,
      });

      // Format the response for Claude
      return await this.formatCharacterResponse(characterData);
    } catch (error) {
      this.logger.error('Failed to get character information', error);
      throw new Error(
        `Failed to retrieve character "${identifier}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  async handleGetCharacterEntity(args: unknown): Promise<unknown> {
    const schema = z.object({
      characterIdentifier: z.string().min(1, 'Character identifier cannot be empty'),
      entityIdentifier: z.string().min(1, 'Entity identifier cannot be empty'),
    });

    const { characterIdentifier, entityIdentifier } = schema.parse(args);

    this.logger.info('Getting character entity', { characterIdentifier, entityIdentifier });

    try {
      const result: unknown = await this.foundryClient.query(
        'foundry-mcp-bridge.getCharacterEntity',
        { characterIdentifier, entityIdentifier }
      );
      return flattenEntityResult(result);
    } catch (error) {
      this.logger.error('Failed to get character entity', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      const hint = /No handler found for query/.test(message)
        ? ' The Foundry AI Tool module in this world is older than the bridge; update the module.'
        : '';
      throw new Error(
        `Failed to retrieve entity "${entityIdentifier}" from character "${characterIdentifier}": ${message}${hint}`,
        { cause: error }
      );
    }
  }

  async handleListCharacters(args: unknown): Promise<unknown> {
    const schema = z.object({
      type: z.string().optional(),
    });

    const { type } = schema.parse(args);

    this.logger.info('Listing characters', { type });

    try {
      const actors = (await this.foundryClient.query('foundry-mcp-bridge.listActors', {
        type,
      })) as Rec[];

      this.logger.debug('Successfully retrieved character list', { count: actors.length });

      // Format the response for Claude
      return {
        characters: actors.map(actor => ({
          id: actor.id,
          name: actor.name,
          type: actor.type,
          hasImage: !!actor.img,
        })),
        total: actors.length,
        filtered: type ? `Filtered by type: ${type}` : 'All characters',
      };
    } catch (error) {
      this.logger.error('Failed to list characters', error);
      throw new Error(
        `Failed to list characters: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  async handleUseItem(args: unknown): Promise<unknown> {
    const schema = z.object({
      actorIdentifier: z.string().min(1, 'Actor identifier cannot be empty'),
      itemIdentifier: z.string().min(1, 'Item identifier cannot be empty'),
      targets: z.array(z.string()).optional(),
      consume: z.boolean().optional(),
      spellLevel: z.number().optional(),
      skipDialog: z.boolean().optional(),
    });

    const { actorIdentifier, itemIdentifier, targets, consume, spellLevel, skipDialog } =
      schema.parse(args);

    this.logger.info('Using item', {
      actorIdentifier,
      itemIdentifier,
      targets,
      consume,
      spellLevel,
      skipDialog,
    });

    try {
      const target = targets?.find(t => t.toLowerCase() !== 'self');
      const rulesCheck = await this.rulesCheck?.tryCheck(
        {
          actor: actorIdentifier,
          item: itemIdentifier,
          ...(target ? { target } : {}),
          ...(spellLevel !== undefined && spellLevel >= 1 && spellLevel <= 9
            ? { castLevel: Math.trunc(spellLevel) }
            : {}),
        },
        true
      );
      const result = (await this.foundryClient.query('foundry-mcp-bridge.useItem', {
        actorIdentifier,
        itemIdentifier,
        targets,
        options: {
          consume: consume ?? true,
          spellLevel,
          skipDialog: skipDialog ?? true, // Default to skipping dialogs for MCP automation
        },
      })) as Rec;

      this.logger.debug('Successfully used item', {
        actorName: result.actorName,
        itemName: result.itemName,
        targets: result.targets,
      });

      return rulesCheck && result && typeof result === 'object'
        ? { ...result, rulesCheck }
        : result;
    } catch (error) {
      this.logger.error('Failed to use item', error);
      throw new Error(
        `Failed to use item "${itemIdentifier}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  async handleAddActorItems(args: unknown): Promise<unknown> {
    const itemSchema = z.object({
      name: z.string().min(1, 'Item name cannot be empty'),
      type: z.string().min(1, 'Item type cannot be empty'),
      img: z.string().optional(),
      system: z.record(z.unknown()).optional(),
    });

    const schema = z.object({
      actorIdentifier: z.string().min(1, 'Actor identifier cannot be empty'),
      items: z.array(itemSchema).min(1, 'At least one item is required'),
    });

    const { actorIdentifier, items } = schema.parse(args);

    this.logger.info('Adding items to actor', {
      actorIdentifier,
      count: items.length,
      types: items.map(i => i.type),
    });

    try {
      const result = (await this.foundryClient.query('foundry-mcp-bridge.addActorItems', {
        actorIdentifier,
        items,
      })) as Rec;

      this.logger.debug('Successfully added actor items', {
        actorName: result.actorName,
        created: arr(result.created).length,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to add actor items', error);
      throw new Error(
        `Failed to add items to "${actorIdentifier}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  async handleUpdateWorldItems(args: unknown): Promise<unknown> {
    const updateEntrySchema = z.object({
      id: z.string().min(1, 'Item id cannot be empty'),
      name: z.string().optional(),
      img: z.string().optional(),
      system: z.record(z.unknown()).optional(),
      folder: z.string().optional(),
    });

    const schema = z.object({
      updates: z.array(updateEntrySchema).min(1, 'At least one update entry is required'),
    });

    const { updates } = schema.parse(args);

    this.logger.info('Updating world items', {
      count: updates.length,
      ids: updates.map(u => u.id),
    });

    try {
      const result = (await this.foundryClient.query('foundry-mcp-bridge.updateWorldItems', {
        updates,
      })) as Rec;

      this.logger.debug('Successfully updated world items', {
        count: arr(result.updated).length,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to update world items', error);
      throw new Error(
        `Failed to update world items: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  async handleListWorldItems(args: unknown): Promise<unknown> {
    const schema = z.object({
      type: z.string().optional(),
      folder: z.string().optional(),
      nameFilter: z.string().optional(),
    });

    const { type, folder, nameFilter } = schema.parse(args);

    this.logger.info('Listing world items', {
      type: type ?? null,
      folder: folder ?? null,
      nameFilter: nameFilter ?? null,
    });

    try {
      const items = (await this.foundryClient.query('foundry-mcp-bridge.listWorldItems', {
        ...(type !== undefined ? { type } : {}),
        ...(folder !== undefined ? { folder } : {}),
        ...(nameFilter !== undefined ? { nameFilter } : {}),
      })) as unknown[] | null | undefined;

      this.logger.debug('Successfully listed world items', { count: items?.length ?? 0 });

      return {
        items: items ?? [],
        total: items?.length ?? 0,
      };
    } catch (error) {
      this.logger.error('Failed to list world items', error);
      throw new Error(
        `Failed to list world items: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  async handleCreateWorldItems(args: unknown): Promise<unknown> {
    const itemSchema = z.object({
      name: z.string().min(1, 'Item name cannot be empty'),
      type: z.string().min(1, 'Item type cannot be empty'),
      img: z.string().optional(),
      system: z.record(z.unknown()).optional(),
    });

    const schema = z.object({
      items: z.array(itemSchema).min(1, 'At least one item is required'),
      folder: z.string().optional(),
    });

    const { items, folder } = schema.parse(args);

    this.logger.info('Creating world items', {
      count: items.length,
      folder: folder ?? null,
      types: items.map(i => i.type),
    });

    try {
      const result = (await this.foundryClient.query('foundry-mcp-bridge.createWorldItems', {
        items,
        folder,
      })) as Rec;

      this.logger.debug('Successfully created world items', {
        folderId: result.folderId,
        created: arr(result.created).length,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to create world items', error);
      throw new Error(
        `Failed to create world items: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  async handleManageWorldItems(args: unknown): Promise<unknown> {
    const { action } = z
      .object({ action: z.enum(['create', 'list', 'update', 'add-to-actor']) })
      .parse(args);

    switch (action) {
      case 'create':
        return this.handleCreateWorldItems(args);
      case 'list':
        return this.handleListWorldItems(args);
      case 'update':
        return this.handleUpdateWorldItems(args);
      case 'add-to-actor':
        return this.handleAddActorItems(args);
    }
  }

  async handleSearchCharacterItems(args: unknown): Promise<unknown> {
    const schema = z.object({
      characterIdentifier: z.string().min(1, 'Character identifier cannot be empty'),
      query: z.string().optional(),
      type: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().optional(),
    });

    const { characterIdentifier, query, type, category, limit } = schema.parse(args);

    this.logger.info('Searching character items', {
      characterIdentifier,
      query,
      type,
      category,
      limit,
    });

    try {
      const result = (await this.foundryClient.query('foundry-mcp-bridge.searchCharacterItems', {
        characterIdentifier,
        query,
        type,
        category,
        limit: limit ?? 20,
      })) as Rec;

      this.logger.debug('Successfully searched character items', {
        characterName: result.characterName,
        matchCount: arr(result.matches).length,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to search character items', error);
      throw new Error(
        `Failed to search items for "${characterIdentifier}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  private async formatCharacterResponse(characterData: Rec): Promise<Rec> {
    const response: Rec = {
      id: characterData.id,
      name: characterData.name,
      type: characterData.type,
      basicInfo: await this.extractBasicInfo(characterData),
      stats: await this.extractStats(characterData),
      items: this.formatItems(arr(characterData.items)),
      effects: this.formatEffects(arr(characterData.effects)),
      hasImage: !!characterData.img,
    };

    // Add actions with minimal data (name, traits, action cost only - no variants)
    const actions = arr(characterData.actions);
    if (actions.length > 0) {
      response.actions = this.formatActions(actions);
    }

    // Add spellcasting data with spell lists
    const spellcasting = arr(characterData.spellcasting);
    if (spellcasting.length > 0) {
      response.spellcasting = this.formatSpellcasting(spellcasting);
    }

    // Exclude itemVariants and itemToggles - these are verbose and can be fetched via get-character-entity if needed

    return response;
  }

  private formatSpellcasting(spellcastingEntries: unknown[]): Rec[] {
    return spellcastingEntries.map(rawEntry => {
      const entry = rec(rawEntry);
      const formatted: Rec = {
        name: entry.name,
        type: entry.type,
      };

      // Include tradition for PF2e (arcane, divine, primal, occult)
      if (entry.tradition) {
        formatted.tradition = entry.tradition;
      }

      // Include spellcasting ability
      if (entry.ability) {
        formatted.ability = entry.ability;
      }

      // Include DC and attack bonus
      if (entry.dc) {
        formatted.dc = entry.dc;
      }
      if (entry.attack) {
        formatted.attack = entry.attack;
      }

      // Include spell slots if available
      if (entry.slots && Object.keys(entry.slots).length > 0) {
        formatted.slots = entry.slots;
      }

      // Format spells - minimal data for browsing, use get-character-entity for full details
      const spells = arr(entry.spells);
      if (spells.length > 0) {
        formatted.spells = spells.map(rawSpell => {
          const spell = rec(rawSpell);
          const spellData: Rec = {
            id: spell.id,
            name: spell.name,
            level: spell.level,
          };

          // Only include prepared status if it's false (assumed prepared by default)
          if (spell.prepared === false) {
            spellData.prepared = false;
          }

          // Include expended status if spell slot has been used
          if (spell.expended) {
            spellData.expended = true;
          }

          // Include traits for PF2e spells (for filtering by damage type, etc.)
          if (arr(spell.traits).length > 0) {
            spellData.traits = spell.traits;
          }

          // Include action cost
          if (spell.actionCost) {
            spellData.actionCost = spell.actionCost;
          }

          // Include targeting info - helps Claude decide whether to specify targets
          if (spell.range) {
            spellData.range = spell.range;
          }
          if (spell.target) {
            spellData.target = spell.target;
          }
          if (spell.area) {
            spellData.area = spell.area;
          }

          return spellData;
        });

        formatted.spellCount = spells.length;
      }

      return formatted;
    });
  }

  private formatActions(actions: unknown[]): Rec[] {
    // Return minimal action data - just enough to identify and filter
    return actions.map(rawAction => {
      const action = rec(rawAction);
      const formatted: Rec = {
        name: action.name,
        type: action.type,
      };

      // Include traits if present (for filtering, e.g., "fire" attacks, "concentrate" actions)
      if (arr(action.traits).length > 0) {
        formatted.traits = action.traits;
      }

      // Include action cost (e.g., 1, 2, 3 actions, reaction, free)
      if (action.actions !== undefined) {
        formatted.actionCost = action.actions;
      }

      // Include itemId for cross-referencing with items
      if (action.itemId) {
        formatted.itemId = action.itemId;
      }

      return formatted;
    });
  }

  private async extractBasicInfo(characterData: Rec): Promise<Rec> {
    // Extract common fields that exist across different game systems
    const basicInfo: Rec = {};

    // Let the active SystemAdapter (if it exposes extractBasicInfo) seed
    // system-specific fields first. Anything it returns wins; the legacy
    // cross-system extractor below only fills gaps.
    try {
      const adapter = await this.getAdapter();
      if (adapter && typeof adapter.extractBasicInfo === 'function') {
        const fromAdapter: unknown = adapter.extractBasicInfo(characterData);
        if (fromAdapter && typeof fromAdapter === 'object') {
          Object.assign(basicInfo, fromAdapter);
        }
      }
    } catch (error) {
      this.logger.warn('System adapter extractBasicInfo failed; falling back to legacy', { error });
    }

    const system = rec(characterData.system);

    // D&D 5e / PF2e common fields (only fill if adapter didn't already)
    const attributes = rec(system.attributes);
    if (system.attributes) {
      if (attributes.hp && basicInfo.hitPoints === undefined) {
        basicInfo.hitPoints = {
          current: at(attributes, 'hp', 'value'),
          max: at(attributes, 'hp', 'max'),
          temp: at(attributes, 'hp', 'temp') || 0,
        };
      }
      if (attributes.ac && basicInfo.armorClass === undefined) {
        basicInfo.armorClass = at(attributes, 'ac', 'value');
      }
    }

    // Level information (only if adapter didn't set it)
    if (basicInfo.level === undefined) {
      if (at(system, 'details', 'level', 'value')) {
        basicInfo.level = at(system, 'details', 'level', 'value');
      } else if (typeof system.level === 'number') {
        basicInfo.level = system.level;
      }
    }

    // Class information
    if (at(system, 'details', 'class')) {
      basicInfo.class = at(system, 'details', 'class');
    }

    // Race/ancestry information
    // dnd5e 4.x+ stores race as an embedded item document; collapse to just the
    // identifying name to avoid dumping the full item (HTML description, advancement,
    // circular refs). Older data may store a plain string, which we pass through.
    const race = at(system, 'details', 'race');
    const ancestry = at(system, 'details', 'ancestry');
    if (race) {
      basicInfo.race =
        typeof race === 'string'
          ? race
          : at(race, 'name') || at(race, 'identifier') || at(race, '_id') || 'Unknown';
    } else if (ancestry) {
      basicInfo.ancestry =
        typeof ancestry === 'string'
          ? ancestry
          : at(ancestry, 'name') || at(ancestry, 'identifier') || at(ancestry, '_id') || 'Unknown';
    }

    return basicInfo;
  }

  private async extractStats(characterData: Rec): Promise<unknown> {
    // Try using system adapter if available. Lookup uses the raw Foundry
    // system id first so adapters whose id isn't part of the narrow
    // GameSystem enum (e.g. 'dsa5', 'cosmere-rpg') resolve correctly.
    try {
      const adapter = await this.getAdapter();
      if (adapter) {
        this.logger.debug('Using system adapter for character stats extraction', {
          system: adapter.getMetadata().id,
        });
        return adapter.extractCharacterStats(characterData);
      }
    } catch (error) {
      this.logger.warn('Failed to use system adapter, falling back to legacy extraction', {
        error,
      });
    }

    // Legacy extraction (backwards compatibility)
    const system = rec(characterData.system);
    const stats: Rec = {};

    // Ability scores (D&D 5e style)
    if (system.abilities) {
      const abilities: Rec = {};
      stats.abilities = abilities;
      for (const [key, ability] of Object.entries(rec(system.abilities))) {
        if (typeof ability === 'object' && ability !== null) {
          abilities[key] = {
            score: at(ability, 'value') || 10,
            modifier: at(ability, 'mod') || 0,
          };
        }
      }
    }

    // Skills
    if (system.skills) {
      const skills: Rec = {};
      stats.skills = skills;
      for (const [key, skill] of Object.entries(rec(system.skills))) {
        if (typeof skill === 'object' && skill !== null) {
          skills[key] = {
            value: at(skill, 'value') || 0,
            proficient: at(skill, 'proficient') || false,
            ability: at(skill, 'ability') || '',
          };
        }
      }
    }

    // Saves
    if (system.saves) {
      const saves: Rec = {};
      stats.saves = saves;
      for (const [key, save] of Object.entries(rec(system.saves))) {
        if (typeof save === 'object' && save !== null) {
          saves[key] = {
            value: at(save, 'value') || 0,
            proficient: at(save, 'proficient') || false,
          };
        }
      }
    }

    return stats;
  }

  private formatItems(items: unknown[]): Rec[] {
    // Return ALL items with minimal data
    return items.map(rawItem => {
      const item = rec(rawItem);
      const system = rec(item.system);
      // Return minimal data - just enough to identify and filter items
      const formattedItem: Rec = {
        id: item.id,
        name: item.name,
        type: item.type,
      };

      // Include quantity if present
      if (system.quantity !== undefined && system.quantity !== 1) {
        formattedItem.quantity = system.quantity;
      }

      // Include traits for PF2e items (feats, equipment, spells, etc.)
      const traits = at(system, 'traits', 'value');
      if (traits) {
        formattedItem.traits = Array.isArray(traits) ? traits : [];
      }

      // Include rarity for PF2e items
      const rarity = at(system, 'traits', 'rarity');
      if (rarity) {
        formattedItem.rarity = rarity;
      }

      // Include level for PF2e items (feats, spells, etc.)
      if (at(system, 'level', 'value') !== undefined) {
        formattedItem.level = at(system, 'level', 'value');
      } else if (system.level !== undefined) {
        formattedItem.level = system.level;
      }

      // Include action cost for PF2e feats/actions
      const actionType = at(system, 'actionType', 'value');
      if (actionType) {
        formattedItem.actionType = actionType;
      }

      // Include equipped status for equippable items
      if (system.equipped !== undefined) {
        formattedItem.equipped = system.equipped;
      }

      // Include attuned status for D&D 5e magic items
      if (system.attunement !== undefined) {
        formattedItem.attunement = system.attunement;
      }

      return formattedItem;
    });
  }

  private formatEffects(effects: unknown[]): Rec[] {
    return effects.map(rawEffect => {
      const effect = rec(rawEffect);
      const duration = effect.duration ? rec(effect.duration) : null;
      return {
        id: effect.id,
        name: effect.name,
        disabled: effect.disabled,
        duration: duration
          ? {
              // Foundry 14 durations are {value, units, ...}; the module reports
              // {type, duration, remaining}. Read the module's names, fall back to v14's.
              type: duration.type ?? duration.units,
              ...(duration.duration !== undefined || duration.value !== undefined
                ? { duration: duration.duration ?? duration.value }
                : {}),
              remaining: duration.remaining,
            }
          : null,
        // v14 removed ActiveEffect#icon in favor of img
        hasIcon: !!(effect.icon ?? effect.img),
      };
    });
  }
}

/**
 * The module's `getCharacterEntity` envelope (`{success, entityType, entity}`) as the tool
 * result: `entityType` next to the entity's own fields. A GM-gate refusal (`{success: false,
 * error}`) becomes an error.
 */
export function flattenEntityResult(result: unknown): Record<string, unknown> {
  const envelope =
    result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  if (envelope.success !== true) {
    throw new Error(typeof envelope.error === 'string' ? envelope.error : 'No entity returned');
  }
  const entity =
    envelope.entity !== null && typeof envelope.entity === 'object'
      ? (envelope.entity as Record<string, unknown>)
      : {};
  return { entityType: envelope.entityType, ...entity };
}
