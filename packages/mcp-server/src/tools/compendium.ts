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
  movementSummary,
  sizeWord,
  spellSchoolName,
  weaponDamageSummary,
} from './creature-format.js';

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
    this.systemRegistry = systemRegistry || null;
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
  getToolDefinitions() {
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

  async handleSearchCompendium(args: any): Promise<any> {
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
      } else if (args && typeof args === 'object' && typeof args.query === 'undefined') {
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
      const results = await this.foundryClient.query('foundry-mcp-bridge.searchCompendium', {
        query,
        packType,
        filters,
      });

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
        results: limitedResults.map((item: any) => this.formatCompendiumItem(item, gameSystem)),
        totalFound: results.length,
        showing: limitedResults.length,
        hasMore: results.length > limit,
      };
    } catch (error) {
      this.logger.error('Failed to search compendium', error);
      throw new Error(
        `Failed to search compendium: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleGetCompendiumItem(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string().min(1, 'Pack ID cannot be empty'),
      itemId: z.string().min(1, 'Item ID cannot be empty'),
      compact: z.boolean().default(false),
    });

    const { packId, itemId, compact } = schema.parse(args);

    try {
      // Use the proper document retrieval method that already exists in actor creation
      const item = await this.foundryClient.query('foundry-mcp-bridge.getCompendiumDocumentFull', {
        packId,
        documentId: itemId,
      });

      if (!item) {
        throw new Error(`Item ${itemId} not found in pack ${packId}`);
      }

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
          items: (item.items || []).slice(0, 5), // Limit items to prevent bloat
          mode: 'compact',
        };
      } else {
        // Full response
        return {
          ...baseResponse,
          fullDescription: this.extractFullDescription(item),
          system: this.sanitizeSystemData(item.system || {}),
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
        `Failed to retrieve item: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleListCreaturesByCriteria(args: any): Promise<any> {
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
                  const parsed = JSON.parse(val);
                  return (
                    typeof parsed === 'object' &&
                    parsed !== null &&
                    (typeof parsed.min === 'number' || typeof parsed.max === 'number')
                  );
                } catch {
                  return false;
                }
              },
              {
                message: 'Challenge rating range must be valid JSON object with min/max numbers',
              }
            )
            .transform(val => {
              const parsed = JSON.parse(val);
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
          `Parameter validation failed: ${errorDetails}. Received args: ${JSON.stringify(args)}`
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
      const results = await this.foundryClient.query(
        'foundry-mcp-bridge.listCreaturesByCriteria',
        params
      );

      this.logger.debug('Creature criteria search completed', {
        gameSystem,
        criteriaCount: Object.keys(params).length,
        totalFound: results.response?.creatures?.length || 0,
        limit: params.limit,
        packsSearched: results.response?.searchSummary?.packsSearched || 0,
      });

      // Extract search summary for transparency
      const searchSummary = results.response?.searchSummary || {
        packsSearched: 0,
        topPacks: [],
        totalCreaturesFound: results.response?.creatures?.length || 0,
      };

      return {
        gameSystem, // Include detected system
        criteriaDescription, // Human-readable criteria
        creatures: (results.response?.creatures || results).map((creature: any) =>
          this.formatCreatureListItem(creature, gameSystem)
        ),
        totalFound: results.response?.creatures?.length || results.length,
        criteria: params,
        searchSummary: {
          ...searchSummary,
          searchStrategy: `Prioritized pack search - D&D 5e content first, then modules, then campaign-specific`,
          note: 'Packs searched in priority order to find most relevant creatures first',
        },
        optimizationNote:
          'Use creature names to identify suitable options, then call get-compendium-item for final details only',
      };
    } catch (error) {
      this.logger.error('Failed to list creatures by criteria', error);
      throw new Error(
        `Failed to list creatures: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleListCompendiumPacks(args: any): Promise<any> {
    const schema = z.object({
      type: z.string().optional(),
    });

    const { type } = schema.parse(args);

    this.logger.info('Listing compendium packs', { type });

    try {
      const packs = await this.foundryClient.query('foundry-mcp-bridge.getAvailablePacks');

      // Filter by type if specified
      const filteredPacks = type ? packs.filter((pack: any) => pack.type === type) : packs;

      this.logger.debug('Successfully retrieved compendium packs', {
        total: packs.length,
        filtered: filteredPacks.length,
        type,
      });

      return {
        packs: filteredPacks.map((pack: any) => ({
          id: pack.id,
          label: pack.label,
          type: pack.type,
          system: pack.system,
          private: pack.private,
        })),
        total: filteredPacks.length,
        availableTypes: [...new Set(packs.map((pack: any) => pack.type))],
      };
    } catch (error) {
      this.logger.error('Failed to list compendium packs', error);
      throw new Error(
        `Failed to list compendium packs: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private formatCompendiumItem(item: any, gameSystem?: GameSystem): any {
    const formatted: any = {
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
      const stats: any = {};

      if (gameSystem === 'dnd5e') {
        // Level/CR
        const level = getCreatureLevel(item, gameSystem);
        if (level !== undefined) {
          stats.challengeRating = level;
        }

        // Creature type
        const creatureType = getCreatureType(item, gameSystem);
        if (creatureType) stats.creatureType = creatureType;

        const system = item.system || {};

        // Hit Points
        const hp = system.attributes?.hp?.value;
        const maxHp = system.attributes?.hp?.max;
        if (hp !== undefined || maxHp !== undefined) {
          stats.hitPoints = { current: hp, max: maxHp };
        }

        // Armor Class
        const ac = system.attributes?.ac?.value;
        if (ac !== undefined) stats.armorClass = ac;

        // Size (dnd5e stores a key such as "med"; report the word)
        const size = creatureSizeWord(item);
        if (size) stats.size = size;

        // Alignment
        const alignment =
          system.details?.alignment?.value || system.details?.alignment || system.alignment;
        if (alignment) stats.alignment = alignment;
      } else {
        // Fallback: Legacy D&D 5e extraction
        const system = item.system || {};
        const cr = system.details?.cr || system.cr;
        if (cr !== undefined) stats.challengeRating = cr;

        const hp = system.attributes?.hp?.value || system.hp?.value;
        const maxHp = system.attributes?.hp?.max || system.hp?.max;
        if (hp !== undefined || maxHp !== undefined) {
          stats.hitPoints = { current: hp, max: maxHp };
        }

        const ac = system.attributes?.ac?.value || system.ac?.value;
        if (ac !== undefined) stats.armorClass = ac;

        const creatureType = system.details?.type?.value || system.type?.value;
        if (creatureType) stats.creatureType = creatureType;

        const size = creatureSizeWord(item);
        if (size) stats.size = size;

        const alignment = system.details?.alignment || system.alignment;
        if (alignment) stats.alignment = alignment;
      }

      if (Object.keys(stats).length > 0) {
        formatted.stats = stats;
      }
    }

    return formatted;
  }

  private extractDescription(item: any): string {
    const system = item.system || {};

    // Try different common description fields
    const description =
      system.description?.value ||
      system.description?.content ||
      system.description ||
      system.details?.description ||
      '';

    return this.truncateText(this.stripHtml(description), 200);
  }

  private extractFullDescription(item: any): string {
    const system = item.system || {};

    const description =
      system.description?.value ||
      system.description?.content ||
      system.description ||
      system.details?.description ||
      '';

    return this.stripHtml(description);
  }

  private createItemSummary(item: any): string {
    const parts = [];

    parts.push(`${item.type} from ${item.packLabel}`);

    const system = item.system || {};

    // Add relevant summary information based on item type
    switch (item.type.toLowerCase()) {
      case 'spell':
        if (system.level === 0) parts.push('Cantrip');
        else if (system.level) parts.push(`Level ${system.level}`);
        if (system.school) parts.push(spellSchoolName(system.school) ?? system.school);
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
        if (system.rarity) parts.push(system.rarity);
        if (system.price?.value)
          parts.push(`${system.price.value} ${system.price.denomination || 'gp'}`);
        break;
      }
    }

    return parts.join(' • ');
  }

  private formatCreatureListItem(creature: any, gameSystem?: GameSystem): any {
    const system = creature.system || {};
    const formatted: any = {
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
      formatted.flags = {
        spellcaster: hasSpells,
      };

      // D&D 5e specific flags
      if (gameSystem === 'dnd5e') {
        formatted.flags.legendary = hasLegendaryActions(creature);

        const typeStr = typeof creatureType === 'string' ? creatureType.toLowerCase() : '';
        formatted.flags.undead = typeStr === 'undead';
        formatted.flags.dragon = typeStr === 'dragon';
        formatted.flags.fiend = typeStr === 'fiend';
      }
    } else {
      // Legacy fallback (D&D 5e assumptions)
      const challengeRating = creature.challengeRating ?? system.details?.cr ?? system.cr ?? 0;
      const creatureType =
        creature.creatureType ?? system.details?.type?.value ?? system.type?.value ?? 'unknown';
      const size = creatureSizeWord(creature) ?? 'medium';

      const hasSpells =
        creature.hasSpells ??
        !!(
          system.spells ||
          system.attributes?.spellcasting ||
          (system.details?.spellLevel && system.details.spellLevel > 0)
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
  private describeCriteria(params: any, gameSystem: GameSystem): string {
    const parts: string[] = [];

    if (gameSystem === 'dnd5e') {
      if (params.challengeRating !== undefined) {
        if (typeof params.challengeRating === 'number') {
          parts.push(`CR ${params.challengeRating}`);
        } else if (typeof params.challengeRating === 'object') {
          const min = params.challengeRating.min ?? 0;
          const max = params.challengeRating.max ?? 30;
          parts.push(`CR ${min}-${max}`);
        }
      }
    }

    if (params.creatureType) parts.push(params.creatureType);
    if (params.size) parts.push(params.size);
    if (params.hasSpells) parts.push('spellcaster');
    if (params.hasLegendaryActions) parts.push('legendary');

    return parts.length > 0 ? parts.join(', ') : 'no criteria';
  }

  private extractCompactStats(item: any): any {
    const system = item.system || {};
    const stats: any = {};

    // Core combat stats
    if (system.attributes?.ac?.value) stats.armorClass = system.attributes.ac.value;
    if (system.attributes?.hp?.max) stats.hitPoints = system.attributes.hp.max;
    if (system.details?.cr !== undefined) stats.challengeRating = system.details.cr;

    // Basic info
    if (system.details?.type?.value) stats.creatureType = system.details.type.value;
    const size = sizeWord(system.traits?.size);
    if (size) stats.size = size;
    if (system.details?.alignment) stats.alignment = system.details.alignment;

    // Key abilities (only show notable ones)
    if (system.abilities) {
      const abilities: any = {};
      for (const [key, ability] of Object.entries(system.abilities)) {
        const abil = ability as any;
        if (abil.value !== undefined) {
          const mod = Math.floor((abil.value - 10) / 2);
          if (Math.abs(mod) >= 2) {
            // Only show significant modifiers
            abilities[key.toUpperCase()] = { value: abil.value, modifier: mod };
          }
        }
      }
      if (Object.keys(abilities).length > 0) stats.abilities = abilities;
    }

    // Speed
    // (dnd5e 6 keeps speeds under movement.speeds.<type>; older data at movement.<type>)
    const speed = movementSummary(system.attributes?.movement);
    if (speed) stats.speed = speed;

    return stats;
  }

  private extractItemProperties(item: any): any {
    const system = item.system || {};
    const properties: any = {};

    // Common properties across different item types
    if (system.rarity) properties.rarity = system.rarity;
    if (system.price) properties.price = system.price;
    if (system.weight) properties.weight = system.weight;
    if (system.quantity) properties.quantity = system.quantity;

    // Spell-specific properties
    if (item.type.toLowerCase() === 'spell') {
      if (system.level !== undefined) properties.spellLevel = system.level;
      if (system.school) properties.school = system.school;
      if (system.components) properties.components = system.components;
      if (system.duration) properties.duration = system.duration;
      if (system.range) properties.range = system.range;
    }

    // Weapon-specific properties
    if (item.type.toLowerCase() === 'weapon') {
      if (system.damage) properties.damage = system.damage;
      if (system.weaponType) properties.weaponType = system.weaponType;
      if (system.properties) properties.weaponProperties = system.properties;
    }

    // Armor-specific properties: dnd5e 6 armor is `equipment` with an armor `type.value`
    if (item.type.toLowerCase() === 'equipment') {
      Object.assign(properties, armorProperties(system));
    }

    return properties;
  }

  private sanitizeSystemData(systemData: any): any {
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

  private stripHtml(text: any): string {
    if (!text) return '';

    // Handle objects with value property (e.g., {value: "text"})
    if (typeof text === 'object' && text !== null) {
      if (text.value) {
        text = text.value;
      } else if (text.content) {
        text = text.content;
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
      const stringified = String(text || '');
      if (!stringified || stringified === '[object Object]') {
        return '';
      }
      text = stringified;
    }

    return text.replace(/<[^>]*>/g, '').trim();
  }

  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return `${text.substring(0, maxLength - 3)}...`;
  }
}
