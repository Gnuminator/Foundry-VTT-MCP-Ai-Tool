import { toolRef } from '@gnuminator/shared';
import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';
import { SystemRegistry } from '../systems/system-registry.js';
import {
  detectGameSystem,
  getCreatureLevel,
  getCreatureType,
  hasSpellcasting,
  type GameSystem,
} from '../utils/system-detection.js';
import {
  CreatureSizeInputs,
  GenericFiltersSchema,
  describeFilters,
} from '../utils/compendium-filters.js';
import {
  armorClassSummary,
  armorProperties,
  creatureSizeWord,
  flatHasSpells,
  hasLegendaryActions,
  itemRarityLabel,
  movementSummary,
  sizeWord,
  spellSchoolName,
  weaponDamageSummary,
} from './creature-format.js';
import { arr, at, isRec, rec, text as show, type Rec } from './bridge-data.js';

export interface CompendiumToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
  systemRegistry?: SystemRegistry;
}

export class CompendiumTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private systemRegistry: SystemRegistry | null;
  private gameSystem: GameSystem | null = null;

  constructor({ foundryClient, logger, systemRegistry }: CompendiumToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'CompendiumTools' });
    this.systemRegistry = systemRegistry ?? null;
  }

  /**
   * Get or detect the game system (cached)
   */
  private async getGameSystem(): Promise<GameSystem> {
    if (!this.gameSystem) {
      this.gameSystem = await detectGameSystem(this.foundryClient, this.logger);
    }
    return this.gameSystem;
  }

  /**
   * Tool definitions for compendium operations
   */
  getToolDefinitions(): { name: string; description: string; inputSchema: object }[] {
    return [
      {
        name: 'search-compendium',
        description:
          'Search through compendium packs by name. IMPORTANT LIMITATIONS: (1) Text search only matches entity NAMES - descriptions and traits are NOT searchable. (2) Filters use name heuristics only (not actual system data) and only work on Actor packs - challengeRating and creatureType filters search for keywords like "ancient", "legendary", "humanoid", etc. in entity names. For accurate filtering by level/CR, traits, or rarity, use list-creatures-by-criteria instead. For best results, use broad name-based searches (e.g., "dragon", "knight") and inspect individual items with get-compendium-item.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Search query to find items in compendiums by name only. Use broad, simple terms (e.g., "dragon", "sword", "feat"). Descriptions and traits are NOT searchable.',
            },
            packType: {
              type: 'string',
              description: 'Optional filter by pack type (e.g., "Item", "Actor", "JournalEntry")',
            },
            filters: {
              type: 'object',
              description:
                'LIMITED FUNCTIONALITY: Only works on Actor packs using name-based heuristics. challengeRating searches for keywords like "ancient" (CR 15+), "adult" (CR 10+), "captain" (CR 5+). creatureType searches for type keywords in names. Does NOT check actual system data. For accurate filtering, use list-creatures-by-criteria instead.',
              properties: {
                challengeRating: {
                  oneOf: [
                    { type: 'number', description: 'Exact CR value (e.g., 12)' },
                    {
                      type: 'object',
                      properties: {
                        min: { type: 'number', description: 'Minimum CR' },
                        max: { type: 'number', description: 'Maximum CR' },
                      },
                    },
                  ],
                },
                creatureType: {
                  type: 'string',
                  description:
                    'Creature type (e.g., "humanoid", "dragon", "beast", "undead", "fey", "fiend", "celestial", "construct", "elemental", "giant", "monstrosity", "ooze", "plant")',
                  enum: [
                    'humanoid',
                    'dragon',
                    'beast',
                    'undead',
                    'fey',
                    'fiend',
                    'celestial',
                    'construct',
                    'elemental',
                    'giant',
                    'monstrosity',
                    'ooze',
                    'plant',
                    'aberration',
                  ],
                },
                size: {
                  type: 'string',
                  description:
                    'Creature size (e.g., "medium", "large", "huge"; dnd5e keys such as "med" also work)',
                  enum: [...CreatureSizeInputs],
                },
                alignment: {
                  type: 'string',
                  description:
                    'Creature alignment (e.g., "lawful good", "chaotic evil", "neutral")',
                },
                hasLegendaryActions: {
                  type: 'boolean',
                  description: 'Filter for creatures with legendary actions',
                },
                spellcaster: {
                  type: 'boolean',
                  description: 'Filter for creatures that can cast spells (D&D 5e)',
                },
              },
            },
            limit: {
              type: 'number',
              description:
                'Maximum number of results to return (default: 50 for discovery searches, max: 50)',
              minimum: 1,
              maximum: 50,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'search-rules',
        description:
          'Full-text rules search over rulebook journal pages and item, spell and feature descriptions, in the allowlisted rules packs only. Returns ids and an excerpt; a whole journal is large, so prefer a bigger excerptChars to opening it with get-compendium-item (itemId = documentId) or, for world journals, list-journals.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Rule or term in plain words, e.g. "grapple". Filler words are ignored.',
            },
            limit: {
              type: 'number',
              description: 'Maximum hits, 1 to 25 (default 10).',
            },
            excerptChars: {
              type: 'number',
              description:
                'Excerpt length per hit, 80 to 4000 (default 240). Raise it to read a rule.',
            },
            includeWorld: {
              type: 'boolean',
              description: 'Also search world journals (adventure text). Off by default.',
            },
            includeOtherBooks: {
              type: 'boolean',
              description: 'Also search packs outside the rules allowlist. Off by default.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get-compendium-item',
        description:
          'Retrieve detailed information about a specific compendium item. Use compact mode for UI performance when full details are not needed.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: {
              type: 'string',
              description: 'ID of the compendium pack containing the item',
              ...toolRef('compendium-pack', 'id'),
            },
            itemId: {
              type: 'string',
              description: 'ID of the specific item to retrieve',
              ...toolRef('compendium-entry', 'id', { parent: 'packId' }),
            },
            compact: {
              type: 'boolean',
              description:
                'Return condensed stat block (recommended for UI performance). Includes key stats, abilities, and actions but omits lengthy descriptions and technical data.',
              default: false,
            },
          },
          required: ['packId', 'itemId'],
        },
      },
      {
        name: 'list-creatures-by-criteria',
        description:
          'CREATURE DISCOVERY (D&D 5e): Get a comprehensive list of creatures matching specific criteria (Challenge Rating, type, size, spellcasting, legendary actions). Perfect for encounter building - returns minimal data so Claude can use built-in monster knowledge to identify suitable creatures by name, then pull full details only for final selections. Features intelligent pack prioritization and high result limits for complete surveys.',
        inputSchema: {
          type: 'object',
          properties: {
            challengeRating: {
              oneOf: [
                { type: 'number', description: 'Exact CR value (e.g., 12)' },
                { type: 'string', description: 'Exact CR value as string (e.g., "12")' },
                {
                  type: 'object',
                  properties: {
                    min: { type: 'number', description: 'Minimum CR (default: 0)' },
                    max: { type: 'number', description: 'Maximum CR (default: 30)' },
                  },
                  description: 'CR range object (e.g., {"min": 10, "max": 15})',
                },
              ],
              description:
                'Filter by Challenge Rating - accepts number, string, or range object. Use ranges for broader discovery (e.g., {"min": 10, "max": 15}) or exact values (12 or "12")',
            },
            creatureType: {
              type: 'string',
              description: 'Filter by creature type',
              enum: [
                'humanoid',
                'dragon',
                'beast',
                'undead',
                'fey',
                'fiend',
                'celestial',
                'construct',
                'elemental',
                'giant',
                'monstrosity',
                'ooze',
                'plant',
                'aberration',
              ],
            },
            size: {
              type: 'string',
              description: 'Filter by creature size',
              enum: [...CreatureSizeInputs],
            },
            hasSpells: {
              type: 'boolean',
              description: 'Filter for spellcasting creatures',
            },
            hasLegendaryActions: {
              type: 'boolean',
              description: 'Filter for creatures with legendary actions (D&D 5e)',
            },
            limit: {
              type: 'number',
              description:
                'Maximum results to return (default: 500 for comprehensive surveys, max: 1000)',
              minimum: 1,
              maximum: 1000,
              default: 500,
            },
          },
          required: [],
        },
      },
      {
        name: 'list-compendium-packs',
        description: 'List all available compendium packs',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Optional filter by pack type',
            },
          },
        },
      },
    ];
  }

  async handleSearchCompendium(args: unknown): Promise<unknown> {
    // Detect game system for appropriate filtering
    const gameSystem = await this.getGameSystem();

    const schema = z.object({
      query: z.string().min(2, 'Search query must be at least 2 characters'),
      packType: z.string().optional(),
      filters: GenericFiltersSchema.optional(),
      limit: z.number().min(1).max(50).default(50),
    });

    // Add defensive parsing for MCP argument structure inconsistencies
    let parsedArgs;
    try {
      parsedArgs = schema.parse(args);
    } catch (zodError) {
      // Try alternative argument structures that MCP might send
      if (typeof args === 'string') {
        parsedArgs = schema.parse({ query: args });
      } else if (isRec(args) && typeof args.query === 'undefined') {
        // Handle case where arguments might be nested differently
        const firstKey = Object.keys(args)[0];
        if (firstKey && typeof args[firstKey] === 'string') {
          parsedArgs = schema.parse({ query: args[firstKey] });
        } else {
          throw zodError;
        }
      } else {
        // Log the problematic args for debugging
        this.logger.debug('Failed to parse search args, using fallback', {
          args: typeof args === 'object' ? JSON.stringify(args) : args,
          error: zodError instanceof Error ? zodError.message : 'Unknown parsing error',
        });
        throw zodError;
      }
    }

    const { query, packType, filters, limit } = parsedArgs;

    // Log system detection and filters
    this.logger.info('Compendium search with system detection', {
      gameSystem,
      query,
      filters: filters ? describeFilters(filters, gameSystem) : 'none',
    });

    try {
      const results = (await this.foundryClient.query('foundry-mcp-bridge.searchCompendium', {
        query,
        packType,
        filters,
      })) as unknown[];

      // Limit results
      const limitedResults = results.slice(0, limit);

      this.logger.debug('Compendium search completed', {
        query,
        gameSystem,
        totalFound: results.length,
        returned: limitedResults.length,
      });

      return {
        query,
        gameSystem, // Include detected system in response
        filterDescription: filters ? describeFilters(filters, gameSystem) : 'no filters',
        results: limitedResults.map(item => this.formatCompendiumItem(item, gameSystem)),
        totalFound: results.length,
        showing: limitedResults.length,
        hasMore: results.length > limit,
      };
    } catch (error) {
      this.logger.error('Failed to search compendium', error);
      throw new Error(
        `Failed to search compendium: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  async handleSearchRules(args: unknown): Promise<unknown> {
    const schema = z.object({
      query: z.string().min(2, 'Search query must be at least 2 characters').max(300),
      limit: z.number().int().min(1).max(25).default(10),
      includeWorld: z.boolean().default(false),
      excerptChars: z.number().int().min(80).max(4000).default(240),
      includeOtherBooks: z.boolean().default(false),
    });
    const parsed = schema.parse(typeof args === 'string' ? { query: args } : args);
    try {
      // The first search after a reload builds the index of every rules pack: allow it time.
      return await this.foundryClient.query('foundry-mcp-bridge.searchRules', parsed, {
        timeoutMs: 60_000,
      });
    } catch (error) {
      this.logger.error('Failed to search rules', error);
      throw new Error(
        `Failed to search rules: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  async handleGetCompendiumItem(args: unknown): Promise<unknown> {
    const schema = z.object({
      packId: z.string().min(1, 'Pack ID cannot be empty'),
      itemId: z.string().min(1, 'Item ID cannot be empty'),
      compact: z.boolean().default(false),
    });

    const { packId, itemId, compact } = schema.parse(args);

    try {
      // Use the proper document retrieval method that already exists in actor creation
      const raw: unknown = await this.foundryClient.query(
        'foundry-mcp-bridge.getCompendiumDocumentFull',
        {
          packId,
          documentId: itemId,
        }
      );

      if (!raw) {
        throw new Error(`Item ${itemId} not found in pack ${packId}`);
      }

      const item = rec(raw);

      // Format the response using the detailed item data
      const baseResponse = {
        id: item.id,
        name: item.name,
        type: item.type,
        pack: {
          id: item.pack,
          label: item.packLabel,
        },
        description: this.extractDescription(item),
        hasImage: !!item.img,
        imageUrl: item.img,
      };

      if (compact) {
        // Compact response for UI performance
        const compactStats = this.extractCompactStats(item);
        return {
          ...baseResponse,
          stats: compactStats,
          properties: this.extractItemProperties(item),
          items: arr(item.items).slice(0, 5), // Limit items to prevent bloat
          mode: 'compact',
        };
      } else {
        // Full response
        return {
          ...baseResponse,
          fullDescription: this.extractFullDescription(item),
          system: this.sanitizeSystemData(rec(item.system)),
          properties: this.extractItemProperties(item),
          items: item.items || [],
          effects: item.effects || [],
          fullData: item.fullData,
          mode: 'full',
        };
      }
    } catch (error) {
      this.logger.error('Failed to get compendium item', error);
      throw new Error(
        `Failed to retrieve item: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  async handleListCreaturesByCriteria(args: unknown): Promise<unknown> {
    // Detect game system for appropriate filtering
    const gameSystem = await this.getGameSystem();

    // Use generic filters schema to support both systems
    const schema = z.object({
      // D&D 5e: challengeRating
      challengeRating: z
        .union([
          z.object({
            min: z.number().optional().default(0),
            max: z.number().optional().default(30),
          }),
          z
            .string()
            .refine(
              val => {
                try {
                  const parsed = rec(JSON.parse(val));
                  return typeof parsed.min === 'number' || typeof parsed.max === 'number';
                } catch {
                  return false;
                }
              },
              {
                message: 'Challenge rating range must be valid JSON object with min/max numbers',
              }
            )
            .transform(val => {
              const parsed = JSON.parse(val) as { min?: number; max?: number };
              return {
                min: parsed.min || 0,
                max: parsed.max || 30,
              };
            }),
          z.number(),
          z
            .string()
            .refine(val => !isNaN(parseFloat(val)), {
              message: 'Challenge rating must be a valid number',
            })
            .transform(val => parseFloat(val)),
        ])
        .optional(),

      // Common filters
      creatureType: z.string().optional(), // Accept any string, validate per system
      size: z.enum(CreatureSizeInputs).optional(), // words or dnd5e keys ('med')

      // Spellcasting flags (different names per system)
      hasSpells: z
        .union([
          z.boolean(),
          z
            .string()
            .refine(val => ['true', 'false'].includes(val.toLowerCase()))
            .transform(val => val.toLowerCase() === 'true'),
        ])
        .optional(),
      hasLegendaryActions: z
        .union([
          z.boolean(),
          z
            .string()
            .refine(val => ['true', 'false'].includes(val.toLowerCase()))
            .transform(val => val.toLowerCase() === 'true'),
        ])
        .optional(),

      limit: z
        .union([
          z.number().min(1).max(1000),
          z
            .string()
            .refine(val => {
              const num = parseInt(val, 10);
              return !isNaN(num) && num >= 1 && num <= 1000;
            })
            .transform(val => parseInt(val, 10)),
        ])
        .optional()
        .default(100),
    });

    let params;
    try {
      params = schema.parse(args);
      this.logger.debug('Parsed creature criteria parameters successfully', params);
    } catch (parseError) {
      this.logger.error('Failed to parse creature criteria parameters', { args, parseError });
      if (parseError instanceof z.ZodError) {
        const errorDetails = parseError.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join('; ');
        throw new Error(
          `Parameter validation failed: ${errorDetails}. Received args: ${JSON.stringify(args)}`,
          { cause: parseError }
        );
      }
      throw parseError;
    }

    // Log system detection and criteria
    const criteriaDescription = this.describeCriteria(params, gameSystem);
    this.logger.info('Creature criteria search with system detection', {
      gameSystem,
      criteria: criteriaDescription,
    });

    try {
      const results: unknown = await this.foundryClient.query(
        'foundry-mcp-bridge.listCreaturesByCriteria',
        params
      );
      const response = at(results, 'response');
      const responseCreatures = at(response, 'creatures') as unknown[] | undefined;
      const resultList = results as unknown[];

      this.logger.debug('Creature criteria search completed', {
        gameSystem,
        criteriaCount: Object.keys(params).length,
        totalFound: responseCreatures?.length || 0,
        limit: params.limit,
        packsSearched: at(response, 'searchSummary', 'packsSearched') || 0,
      });

      // Extract search summary for transparency
      const searchSummary = at(response, 'searchSummary') ?? {
        packsSearched: 0,
        topPacks: [],
        totalCreaturesFound: responseCreatures?.length || 0,
      };

      return {
        gameSystem, // Include detected system
        criteriaDescription, // Human-readable criteria
        creatures: (responseCreatures ?? resultList).map(creature =>
          this.formatCreatureListItem(creature, gameSystem)
        ),
        totalFound: responseCreatures?.length || resultList.length,
        criteria: params,
        searchSummary: {
          ...rec(searchSummary),
          searchStrategy: `Prioritized pack search - D&D 5e content first, then modules, then campaign-specific`,
          note: 'Packs searched in priority order to find most relevant creatures first',
        },
        optimizationNote:
          'Use creature names to identify suitable options, then call get-compendium-item for final details only',
      };
    } catch (error) {
      this.logger.error('Failed to list creatures by criteria', error);
      throw new Error(
        `Failed to list creatures: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  async handleListCompendiumPacks(args: unknown): Promise<unknown> {
    const schema = z.object({
      type: z.string().optional(),
    });

    const { type } = schema.parse(args);

    this.logger.info('Listing compendium packs', { type });

    try {
      const packs = (await this.foundryClient.query(
        'foundry-mcp-bridge.getAvailablePacks'
      )) as Rec[];

      // Filter by type if specified
      const filteredPacks = type ? packs.filter(pack => pack.type === type) : packs;

      this.logger.debug('Successfully retrieved compendium packs', {
        total: packs.length,
        filtered: filteredPacks.length,
        type,
      });

      return {
        packs: filteredPacks.map(pack => ({
          id: pack.id,
          label: pack.label,
          type: pack.type,
          system: pack.system,
          private: pack.private,
        })),
        total: filteredPacks.length,
        availableTypes: [...new Set(packs.map(pack => pack.type))],
      };
    } catch (error) {
      this.logger.error('Failed to list compendium packs', error);
      throw new Error(
        `Failed to list compendium packs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  private formatCompendiumItem(rawItem: unknown, gameSystem?: GameSystem): Rec {
    const item = rec(rawItem);
    const formatted: Rec = {
      id: item.id,
      name: item.name,
      type: item.type,
      pack: {
        id: item.pack,
        label: item.packLabel,
      },
      description: this.extractDescription(item),
      hasImage: !!item.img,
      summary: this.createItemSummary(item),
    };

    if (item.type === 'npc' || item.type === 'character') {
      const stats: Rec = {};

      if (gameSystem === 'dnd5e') {
        // Level/CR
        const level = getCreatureLevel(item, gameSystem);
        if (level !== undefined) {
          stats.challengeRating = level;
        }

        // Creature type
        const creatureType = getCreatureType(item, gameSystem);
        if (creatureType) stats.creatureType = creatureType;

        const system = rec(item.system);

        // Hit Points
        const hp = at(system, 'attributes', 'hp', 'value');
        const maxHp = at(system, 'attributes', 'hp', 'max');
        if (hp !== undefined || maxHp !== undefined) {
          stats.hitPoints = { current: hp, max: maxHp };
        }

        // Armor Class
        const ac = at(system, 'attributes', 'ac', 'value');
        if (ac !== undefined) stats.armorClass = ac;

        // Size (dnd5e stores a key such as "med"; report the word)
        const size = creatureSizeWord(item);
        if (size) stats.size = size;

        // Alignment
        const alignment =
          at(system, 'details', 'alignment', 'value') ||
          at(system, 'details', 'alignment') ||
          system.alignment;
        if (alignment) stats.alignment = alignment;
      } else {
        // Fallback: Legacy D&D 5e extraction
        const system = rec(item.system);
        const cr = at(system, 'details', 'cr') || system.cr;
        if (cr !== undefined) stats.challengeRating = cr;

        const hp = at(system, 'attributes', 'hp', 'value') || at(system, 'hp', 'value');
        const maxHp = at(system, 'attributes', 'hp', 'max') || at(system, 'hp', 'max');
        if (hp !== undefined || maxHp !== undefined) {
          stats.hitPoints = { current: hp, max: maxHp };
        }

        const ac = at(system, 'attributes', 'ac', 'value') || at(system, 'ac', 'value');
        if (ac !== undefined) stats.armorClass = ac;

        const creatureType = at(system, 'details', 'type', 'value') || at(system, 'type', 'value');
        if (creatureType) stats.creatureType = creatureType;

        const size = creatureSizeWord(item);
        if (size) stats.size = size;

        const alignment = at(system, 'details', 'alignment') || system.alignment;
        if (alignment) stats.alignment = alignment;
      }

      if (Object.keys(stats).length > 0) {
        formatted.stats = stats;
      }
    }

    return formatted;
  }

  private extractDescription(item: unknown): string {
    const system = rec(at(item, 'system'));

    // Try different common description fields
    const description =
      at(system, 'description', 'value') ||
      at(system, 'description', 'content') ||
      system.description ||
      at(system, 'details', 'description') ||
      '';

    return this.truncateText(this.stripHtml(description), 200);
  }

  private extractFullDescription(item: unknown): string {
    const system = rec(at(item, 'system'));

    const description =
      at(system, 'description', 'value') ||
      at(system, 'description', 'content') ||
      system.description ||
      at(system, 'details', 'description') ||
      '';

    return this.stripHtml(description);
  }

  private createItemSummary(item: Rec): string {
    const parts: string[] = [];

    parts.push(`${show(item.type)} from ${show(item.packLabel)}`);

    const system = rec(item.system);

    // Add relevant summary information based on item type
    switch ((item.type as string).toLowerCase()) {
      case 'spell':
        if (system.level === 0) parts.push('Cantrip');
        else if (system.level) parts.push(`Level ${show(system.level)}`);
        if (system.school) parts.push(spellSchoolName(system.school) ?? show(system.school));
        break;
      case 'weapon': {
        // dnd5e 4+ keeps damage in system.damage.base; 3.x in system.damage.parts
        const damage = weaponDamageSummary(system);
        if (damage) parts.push(damage);
        break;
      }
      case 'equipment':
      case 'item': {
        // dnd5e 6 armor and shields are `equipment` with an armor `type.value`
        const ac = armorClassSummary(system);
        if (ac) parts.push(ac);
        // '' rarity with a filled rarities list still gets a label
        const rarity = itemRarityLabel(system.rarity) ?? itemRarityLabel(system.rarities);
        if (rarity) parts.push(rarity);
        if (at(system, 'price', 'value'))
          parts.push(
            `${show(at(system, 'price', 'value'))} ${show(at(system, 'price', 'denomination') || 'gp')}`
          );
        break;
      }
    }

    return parts.join(' • ');
  }

  private formatCreatureListItem(rawCreature: unknown, gameSystem?: GameSystem): Rec {
    const creature = rec(rawCreature);
    const system = rec(creature.system);
    const formatted: Rec = {
      name: creature.name,
      id: creature.id,
      pack: { id: creature.pack, label: creature.packLabel },
    };

    if (gameSystem) {
      // The module's creature index returns FLAT records (challengeRating,
      // creatureType, size, hasSpells, hasLegendaryActions); older modules
      // returned raw actor data under `system`. Read the flat value first and
      // fall back to the system paths.
      const level =
        typeof creature.challengeRating === 'number'
          ? creature.challengeRating
          : getCreatureLevel(creature, gameSystem);
      if (level !== undefined) {
        formatted.challengeRating = level;
      }

      const creatureType =
        typeof creature.creatureType === 'string' && creature.creatureType !== ''
          ? creature.creatureType
          : getCreatureType(creature, gameSystem);
      if (creatureType) {
        formatted.creatureType = creatureType;
      }

      // dnd5e stores a size key ("med"); report the word
      formatted.size = creatureSizeWord(creature) ?? 'medium';

      // Feature flags
      const hasSpells = flatHasSpells(creature) ?? hasSpellcasting(creature, gameSystem);
      const flags: Rec = {
        spellcaster: hasSpells,
      };
      formatted.flags = flags;

      // D&D 5e specific flags
      if (gameSystem === 'dnd5e') {
        flags.legendary = hasLegendaryActions(creature);

        const typeStr = typeof creatureType === 'string' ? creatureType.toLowerCase() : '';
        flags.undead = typeStr === 'undead';
        flags.dragon = typeStr === 'dragon';
        flags.fiend = typeStr === 'fiend';
      }
    } else {
      // Legacy fallback (D&D 5e assumptions)
      const challengeRating =
        creature.challengeRating ?? at(system, 'details', 'cr') ?? system.cr ?? 0;
      const creatureType = show(
        creature.creatureType ??
          at(system, 'details', 'type', 'value') ??
          at(system, 'type', 'value') ??
          'unknown'
      );
      const size = creatureSizeWord(creature) ?? 'medium';

      const hasSpells =
        creature.hasSpells ??
        !!(
          system.spells ||
          at(system, 'attributes', 'spellcasting') ||
          (Number(at(system, 'details', 'spellLevel')) > 0 && at(system, 'details', 'spellLevel'))
        );
      const hasLegendary = hasLegendaryActions(creature);

      formatted.challengeRating = challengeRating;
      formatted.creatureType = creatureType;
      formatted.size = size;
      formatted.flags = {
        spellcaster: hasSpells,
        legendary: hasLegendary,
        undead: creatureType.toLowerCase() === 'undead',
        dragon: creatureType.toLowerCase() === 'dragon',
        fiend: creatureType.toLowerCase() === 'fiend',
      };
    }

    return formatted;
  }

  /**
   * Helper method to describe criteria in human-readable format
   */
  private describeCriteria(params: Rec, gameSystem: GameSystem): string {
    const parts: string[] = [];

    if (gameSystem === 'dnd5e') {
      if (params.challengeRating !== undefined) {
        if (typeof params.challengeRating === 'number') {
          parts.push(`CR ${params.challengeRating}`);
        } else if (typeof params.challengeRating === 'object') {
          const min = at(params, 'challengeRating', 'min') ?? 0;
          const max = at(params, 'challengeRating', 'max') ?? 30;
          parts.push(`CR ${show(min)}-${show(max)}`);
        }
      }
    }

    if (params.creatureType) parts.push(show(params.creatureType));
    if (params.size) parts.push(show(params.size));
    if (params.hasSpells) parts.push('spellcaster');
    if (params.hasLegendaryActions) parts.push('legendary');

    return parts.length > 0 ? parts.join(', ') : 'no criteria';
  }

  private extractCompactStats(item: Rec): Rec {
    const system = rec(item.system);
    const stats: Rec = {};

    // Core combat stats
    const ac = at(system, 'attributes', 'ac', 'value');
    if (ac) stats.armorClass = ac;
    const maxHp = at(system, 'attributes', 'hp', 'max');
    if (maxHp) stats.hitPoints = maxHp;
    const cr = at(system, 'details', 'cr');
    if (cr !== undefined) stats.challengeRating = cr;

    // Basic info
    const creatureType = at(system, 'details', 'type', 'value');
    if (creatureType) stats.creatureType = creatureType;
    const size = sizeWord(at(system, 'traits', 'size'));
    if (size) stats.size = size;
    const alignment = at(system, 'details', 'alignment');
    if (alignment) stats.alignment = alignment;

    // Key abilities (only show notable ones)
    if (system.abilities) {
      const abilities: Rec = {};
      for (const [key, ability] of Object.entries(rec(system.abilities))) {
        const value = at(ability, 'value') as number | undefined;
        if (value !== undefined) {
          const mod = Math.floor((value - 10) / 2);
          if (Math.abs(mod) >= 2) {
            // Only show significant modifiers
            abilities[key.toUpperCase()] = { value, modifier: mod };
          }
        }
      }
      if (Object.keys(abilities).length > 0) stats.abilities = abilities;
    }

    // Speed
    // (dnd5e 6 keeps speeds under movement.speeds.<type>; older data at movement.<type>)
    const speed = movementSummary(at(system, 'attributes', 'movement'));
    if (speed) stats.speed = speed;

    return stats;
  }

  private extractItemProperties(item: Rec): Rec {
    const system = rec(item.system);
    const itemType = (item.type as string).toLowerCase();
    const properties: Rec = {};

    // Common properties across different item types
    // The same label as the search summary ("Very Rare"), from rarity or dnd5e 6 rarities
    const rarity = itemRarityLabel(system.rarity) ?? itemRarityLabel(system.rarities);
    if (rarity) properties.rarity = rarity;
    if (system.price) properties.price = system.price;
    if (system.weight) properties.weight = system.weight;
    if (system.quantity) properties.quantity = system.quantity;

    // Spell-specific properties
    if (itemType === 'spell') {
      if (system.level !== undefined) properties.spellLevel = system.level;
      if (system.school) properties.school = system.school;
      if (system.components) properties.components = system.components;
      if (system.duration) properties.duration = system.duration;
      if (system.range) properties.range = system.range;
    }

    // Weapon-specific properties
    if (itemType === 'weapon') {
      if (system.damage) properties.damage = system.damage;
      if (system.weaponType) properties.weaponType = system.weaponType;
      if (system.properties) properties.weaponProperties = system.properties;
    }

    // Armor-specific properties: dnd5e 6 armor is `equipment` with an armor `type.value`
    if (itemType === 'equipment') {
      Object.assign(properties, armorProperties(system));
    }

    return properties;
  }

  private sanitizeSystemData(systemData: Rec): Rec {
    // Remove potentially large or unnecessary fields
    const sanitized = { ...systemData };

    // Remove large description fields (already handled separately)
    delete sanitized.description;
    delete sanitized.details;

    // Remove internal/technical fields
    delete sanitized._id;
    delete sanitized.folder;
    delete sanitized.sort;
    delete sanitized.ownership;

    return sanitized;
  }

  private stripHtml(input: unknown): string {
    let text = input;
    if (!text) return '';

    // Handle objects with value property (e.g., {value: "text"})
    if (typeof text === 'object' && text !== null) {
      const obj = text as Rec;
      if (obj.value) {
        text = obj.value;
      } else if (obj.content) {
        text = obj.content;
      } else {
        // For other objects, try to stringify or return empty
        try {
          text = JSON.stringify(text);
        } catch {
          return '';
        }
      }
    }

    // Handle arrays
    if (Array.isArray(text)) {
      return text.map(item => this.stripHtml(item)).join(' ');
    }

    // Ensure we have a string before calling replace()
    if (typeof text !== 'string') {
      // An object that is left here would print as "[object Object]", which is dropped below.
      const stringified = typeof text === 'object' ? '' : show(text || '');
      if (!stringified || stringified === '[object Object]') {
        return '';
      }
      text = stringified;
    }

    return (text as string).replace(/<[^>]*>/g, '').trim();
  }

  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return `${text.substring(0, maxLength - 3)}...`;
  }
}
