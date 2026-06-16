import { MODULE_ID } from '../constants.js';
import * as shared from './shared.js';
import { PersistentCreatureIndex } from './creature-index.js';
import type {
  CompendiumSearchResult,
  EnhancedCreatureIndex,
  DnD5eCreatureIndex,
  CompendiumEntryFull,
} from './types.js';

/**
 * Compendium search + document-lookup domain for `FoundryDataAccess`.
 *
 * Three surfaces:
 *   - {@link searchCompendium} — name search across packs, with an optional
 *     enhanced creature-index fast path for filtered Actor searches.
 *   - {@link listCreaturesByCriteria} — structured creature filtering, backed by
 *     the persistent enhanced index (or a text-search fallback when it's off).
 *   - {@link getCompendiumDocumentFull} — one document hydrated with its system
 *     data, items, and effects.
 *
 * The enhanced creature index is opt-in via the `enableEnhancedCreatureIndex`
 * setting; when it's off (the default), both search methods use plain pack-index
 * text matching. The {@link PersistentCreatureIndex} is injected so the index can
 * be built/queried without the facade.
 */
export class CompendiumDataAccess {
  constructor(private persistentIndex: PersistentCreatureIndex) {}

  /**
   * Search compendium packs for entries whose name contains every query term
   * (case-insensitive, AND semantics). `packType` restricts to one document type
   * (Scene packs are always excluded); `filters` enables creature-aware ranking
   * and, when the enhanced index is enabled, a structured fast path. Results are
   * sorted exact-match-first then by relevance/name and capped at 50.
   */
  async searchCompendium(
    query: string,
    packType?: string,
    filters?: {
      challengeRating?: number | { min?: number; max?: number };
      creatureType?: string;
      size?: string;
      alignment?: string;
      hasLegendaryActions?: boolean;
      spellcaster?: boolean;
    }
  ): Promise<CompendiumSearchResult[]> {
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      throw new Error('Search query must be a string with at least 2 characters');
    }

    // Fast path: a filtered Actor search can be served straight from the enhanced
    // creature index when it's enabled. Returns null to fall through to basic search.
    const enhanced = await this.tryEnhancedActorSearch(packType, filters);
    if (enhanced) {
      return enhanced;
    }

    return this.basicNameSearch(query, packType, filters);
  }

  /**
   * Plain pack-index name search: the default path when the enhanced index is
   * off, and the fallback when an enhanced attempt fails.
   */
  private async basicNameSearch(
    query: string,
    packType?: string,
    filters?: any
  ): Promise<CompendiumSearchResult[]> {
    const searchTerms = query
      .toLowerCase()
      .trim()
      .split(' ')
      .filter(term => term && typeof term === 'string' && term.length > 0);

    if (searchTerms.length === 0) {
      throw new Error('Search query must contain valid search terms');
    }

    const results: CompendiumSearchResult[] = [];

    for (const pack of this.searchablePacks(packType)) {
      try {
        if (!pack.indexed) {
          await pack.getIndex({});
        }

        for (const entry of Array.from(pack.index.values())) {
          try {
            const typedEntry = entry as any;
            if (
              !typedEntry?.name ||
              typeof typedEntry.name !== 'string' ||
              typedEntry.name.trim().length === 0
            ) {
              continue;
            }

            if (!this.nameMatchesAllTerms(typedEntry.name, searchTerms)) {
              continue;
            }

            // Creature-aware name filtering for filtered Actor searches.
            if (
              filters &&
              this.shouldApplyFilters(entry, filters) &&
              pack.metadata.type === 'Actor' &&
              !this.passesActorNameFilters(typedEntry, filters)
            ) {
              continue;
            }

            results.push(this.toIndexResult(typedEntry, pack));
          } catch (entryError) {
            console.warn(
              `[${MODULE_ID}] Error processing entry in pack ${pack.metadata.id}:`,
              entryError
            );
            continue;
          }

          if (results.length >= 100) break;
        }
      } catch (error) {
        console.warn(`[${MODULE_ID}] Failed to search pack ${pack.metadata.id}:`, error);
      }

      if (results.length >= 100) break;
    }

    results.sort((a, b) => this.compareSearchResults(a, b, filters, query));
    return results.slice(0, 50);
  }

  /** Packs eligible for a search: type-matched (when given) and never Scenes. */
  private searchablePacks(packType?: string): any[] {
    return Array.from(game.packs.values()).filter(pack => {
      if (packType && pack.metadata.type !== packType) return false;
      return pack.metadata.type !== 'Scene';
    });
  }

  /** True when every search term is a substring of the (lower-cased) name. */
  private nameMatchesAllTerms(name: string, searchTerms: string[]): boolean {
    const lower = name.toLowerCase();
    return searchTerms.every(term => !!term && typeof term === 'string' && lower.includes(term));
  }

  /** Build a search result from a pack index entry. */
  private toIndexResult(typedEntry: any, pack: any): CompendiumSearchResult {
    return {
      id: typedEntry._id || '',
      name: typedEntry.name,
      type: typedEntry.type || 'unknown',
      img: typedEntry.img || undefined,
      pack: pack.metadata.id,
      packLabel: pack.metadata.label,
      description: typedEntry.description || '',
      hasImage: !!typedEntry.img,
      summary: `${typedEntry.type} from ${pack.metadata.label}`,
    };
  }

  /**
   * Translate creature filters into name keywords (CR tier + creature-type
   * synonyms) and test the entry against them. Used to narrow filtered Actor
   * searches that run through the basic index path.
   */
  private passesActorNameFilters(typedEntry: any, filters: any): boolean {
    const searchCriteria: any = {};

    if (filters.challengeRating) {
      const crTerms: string[] = [];
      if (typeof filters.challengeRating === 'number') {
        if (filters.challengeRating >= 15) crTerms.push('ancient', 'legendary', 'elder', 'greater');
        else if (filters.challengeRating >= 10)
          crTerms.push('adult', 'warlord', 'champion', 'master');
        else if (filters.challengeRating >= 5) crTerms.push('captain', 'knight', 'priest', 'mage');
        else crTerms.push('guard', 'soldier', 'warrior', 'scout');
      }
      searchCriteria.searchTerms = crTerms;
    }

    if (filters.creatureType) {
      const typeTerms = [filters.creatureType];
      if (filters.creatureType.toLowerCase() === 'humanoid') {
        typeTerms.push('human', 'elf', 'dwarf', 'orc', 'goblin');
      }
      searchCriteria.searchTerms = [...(searchCriteria.searchTerms || []), ...typeTerms];
    }

    return this.matchesSearchCriteria(typedEntry, searchCriteria);
  }

  /** Result comparator: exact-name matches first, then relevance (when filtered), then alphabetical. */
  private compareSearchResults(
    a: CompendiumSearchResult,
    b: CompendiumSearchResult,
    filters: any,
    query: string
  ): number {
    const q = query.toLowerCase();
    const aExact = a.name.toLowerCase() === q;
    const bExact = b.name.toLowerCase() === q;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    if (filters) {
      const aScore = this.calculateRelevanceScore(a, filters, query);
      const bScore = this.calculateRelevanceScore(b, filters, query);
      if (aScore !== bScore) return bScore - aScore;
    }

    return a.name.localeCompare(b.name);
  }

  /** Only NPC/creature entries with at least one defined filter are worth filtering. */
  private shouldApplyFilters(entry: any, filters: any): boolean {
    if (entry.type !== 'npc' && entry.type !== 'character' && entry.type !== 'creature') {
      return false;
    }
    return Object.keys(filters).some(key => filters[key] !== undefined);
  }

  /**
   * Heuristic relevance score for ranking filtered results: rewards creature-type
   * and CR matches, common creature names, and query-term hits in the name.
   */
  private calculateRelevanceScore(entry: any, filters: any, query: string): number {
    let score = 0;
    const system = entry.system || {};

    if (filters.creatureType) {
      const entryType = system.details?.type?.value || system.type?.value || '';
      if (entryType.toLowerCase() === filters.creatureType.toLowerCase()) {
        score += 20;
      }
    }

    if (filters.challengeRating !== undefined) {
      const entryCR = system.details?.cr || system.cr || 0;
      if (typeof filters.challengeRating === 'number') {
        if (entryCR === filters.challengeRating) score += 15;
      } else if (typeof filters.challengeRating === 'object') {
        const { min, max } = filters.challengeRating;
        if (min !== undefined && max !== undefined && entryCR >= min && entryCR <= max) {
          score += 10;
          const rangeMid = (min + max) / 2;
          score += Math.max(0, 5 - Math.abs(entryCR - rangeMid));
        }
      }
    }

    const commonNames = [
      'knight',
      'warrior',
      'guard',
      'soldier',
      'mage',
      'priest',
      'bandit',
      'orc',
      'goblin',
      'dragon',
    ];
    const lowerName = entry.name.toLowerCase();
    if (commonNames.some(name => lowerName.includes(name))) {
      score += 5;
    }

    for (const term of query.toLowerCase().split(' ')) {
      if (term.length > 2 && lowerName.includes(term)) {
        score += 3;
      }
    }

    return score;
  }

  /**
   * List creatures matching structured criteria. Uses the persistent enhanced
   * index for instant filtering when enabled; otherwise (and on any enhanced
   * failure) falls back to a keyword search via {@link searchCompendium}.
   */
  async listCreaturesByCriteria(criteria: {
    challengeRating?: number | { min?: number; max?: number };
    creatureType?: string;
    size?: string;
    hasSpells?: boolean;
    hasLegendaryActions?: boolean;
    limit?: number;
  }): Promise<{ creatures: any[]; searchSummary: any }> {
    const limit = criteria.limit || 500;

    if (!game.settings.get(MODULE_ID, 'enableEnhancedCreatureIndex')) {
      return this.fallbackBasicCreatureSearch(criteria, limit);
    }

    try {
      const enhancedCreatures = await this.persistentIndex.getEnhancedIndex();

      const filteredCreatures = enhancedCreatures
        .filter(creature => this.passesEnhancedCriteria(creature, criteria))
        .sort((a, b) => {
          const crA = a.challengeRating;
          const crB = b.challengeRating;
          return crA !== crB ? crA - crB : a.name.localeCompare(b.name);
        })
        .slice(0, limit);

      const results = filteredCreatures.map(creature => this.toEnhancedResult(creature));
      const searchSummary = this.buildEnhancedSummary(enhancedCreatures, results, criteria);

      return { creatures: results, searchSummary };
    } catch (error) {
      console.error(`[${MODULE_ID}] Enhanced creature search failed:`, error);
      return this.fallbackBasicCreatureSearch(criteria, limit);
    }
  }

  /** Map an enhanced (dnd5e) creature index entry to the result shape. */
  private toEnhancedResult(creature: EnhancedCreatureIndex): any {
    const d = creature;
    return {
      id: d.id,
      name: d.name,
      type: d.type,
      pack: d.pack,
      packLabel: d.packLabel,
      description: d.description || '',
      hasImage: !!d.img,
      creatureType: d.creatureType,
      size: d.size,
      hitPoints: d.hitPoints,
      armorClass: d.armorClass,
      hasSpells: d.hasSpells,
      alignment: d.alignment,
      summary: `CR ${d.challengeRating} ${d.creatureType} from ${d.packLabel}`,
      challengeRating: d.challengeRating,
      hasLegendaryActions: d.hasLegendaryActions,
    };
  }

  /** Build the pack-distribution + metadata summary for an enhanced-index search. */
  private buildEnhancedSummary(
    enhancedCreatures: EnhancedCreatureIndex[],
    results: any[],
    criteria: any
  ): any {
    const resultsByPack = new Map<string, number>();
    for (const creature of results) {
      resultsByPack.set(creature.packLabel, (resultsByPack.get(creature.packLabel) || 0) + 1);
    }

    const uniquePacks = Array.from(new Set(enhancedCreatures.map(c => c.pack)));
    const topPacks = uniquePacks.slice(0, 5).map(packId => {
      const sample = enhancedCreatures.find(c => c.pack === packId);
      return { id: packId, label: sample?.packLabel || 'Unknown Pack', priority: 100 };
    });

    return {
      packsSearched: uniquePacks.length,
      topPacks,
      totalCreaturesFound: results.length,
      resultsByPack: Object.fromEntries(resultsByPack),
      criteria,
      indexMetadata: {
        totalIndexedCreatures: enhancedCreatures.length,
        searchMethod: 'enhanced_persistent_index',
      },
    };
  }

  /** Dispatch enhanced-criteria matching (dnd5e is the only supported system). */
  private passesEnhancedCriteria(creature: EnhancedCreatureIndex, criteria: any): boolean {
    return this.passesDnD5eCriteria(creature, criteria);
  }

  /** Whether a dnd5e creature index entry satisfies every supplied criterion. */
  private passesDnD5eCriteria(
    creature: DnD5eCreatureIndex,
    criteria: {
      challengeRating?: number | { min?: number; max?: number };
      creatureType?: string;
      size?: string;
      hasSpells?: boolean;
      hasLegendaryActions?: boolean;
    }
  ): boolean {
    if (criteria.challengeRating !== undefined) {
      if (typeof criteria.challengeRating === 'number') {
        if (creature.challengeRating !== criteria.challengeRating) return false;
      } else if (typeof criteria.challengeRating === 'object') {
        const { min, max } = criteria.challengeRating;
        if (min !== undefined && creature.challengeRating < min) return false;
        if (max !== undefined && creature.challengeRating > max) return false;
      }
    }

    if (
      criteria.creatureType &&
      creature.creatureType.toLowerCase() !== criteria.creatureType.toLowerCase()
    ) {
      return false;
    }

    if (criteria.size && creature.size.toLowerCase() !== criteria.size.toLowerCase()) {
      return false;
    }

    if (criteria.hasSpells !== undefined && creature.hasSpells !== criteria.hasSpells) {
      return false;
    }

    if (
      criteria.hasLegendaryActions !== undefined &&
      creature.hasLegendaryActions !== criteria.hasLegendaryActions
    ) {
      return false;
    }

    return true;
  }

  /**
   * Keyword-search fallback for {@link listCreaturesByCriteria} when the enhanced
   * index is unavailable: derives search terms from the criteria (creature type
   * + CR-tier name patterns) and runs a basic Actor search.
   */
  private async fallbackBasicCreatureSearch(
    criteria: any,
    limit: number
  ): Promise<{ creatures: any[]; searchSummary: any }> {
    console.warn(`[${MODULE_ID}] Falling back to basic search due to enhanced index failure`);

    const searchTerms: string[] = [];

    if (criteria.creatureType) {
      searchTerms.push(criteria.creatureType);
    }

    if (criteria.challengeRating && typeof criteria.challengeRating === 'number') {
      if (criteria.challengeRating >= 15) searchTerms.push('ancient', 'legendary');
      else if (criteria.challengeRating >= 10) searchTerms.push('adult', 'champion');
      else if (criteria.challengeRating >= 5) searchTerms.push('captain', 'knight');
    }

    const searchQuery = searchTerms.join(' ') || 'monster';
    const basicResults = await this.searchCompendium(searchQuery, 'Actor');

    return {
      creatures: basicResults.slice(0, limit),
      searchSummary: {
        packsSearched: 0,
        topPacks: [],
        totalCreaturesFound: basicResults.length,
        resultsByPack: {},
        criteria,
        fallback: true,
        searchMethod: 'basic_fallback',
      },
    };
  }

  /** Name/description include+exclude matching over an index entry. */
  private matchesSearchCriteria(
    entry: any,
    criteria: {
      searchTerms?: string[];
      excludeTerms?: string[];
      size?: string;
      hasSpells?: boolean;
      hasLegendaryActions?: boolean;
    }
  ): boolean {
    const searchText = `${(entry.name || '').toLowerCase()} ${(entry.description || '').toLowerCase()}`;

    if (criteria.searchTerms && criteria.searchTerms.length > 0) {
      const hasMatch = criteria.searchTerms.some(term => searchText.includes(term.toLowerCase()));
      if (!hasMatch) return false;
    }

    if (criteria.excludeTerms && criteria.excludeTerms.length > 0) {
      const hasExcluded = criteria.excludeTerms.some(term =>
        searchText.includes(term.toLowerCase())
      );
      if (hasExcluded) return false;
    }

    return true;
  }

  /**
   * Enhanced fast path for filtered Actor searches. Returns mapped results when
   * the enhanced index is enabled and applicable, or `null` to fall through to
   * the basic name search (also on any enhanced failure).
   */
  private async tryEnhancedActorSearch(
    packType: string | undefined,
    filters:
      | {
          challengeRating?: number | { min?: number; max?: number };
          creatureType?: string;
          size?: string;
          hasLegendaryActions?: boolean;
        }
      | undefined
  ): Promise<CompendiumSearchResult[] | null> {
    if (!filters || packType !== 'Actor') return null;
    if (!(filters.challengeRating || filters.creatureType || filters.hasLegendaryActions)) {
      return null;
    }
    if (!game.settings.get(MODULE_ID, 'enableEnhancedCreatureIndex')) return null;

    try {
      const criteria: any = { limit: 100 };
      if (filters.challengeRating) criteria.challengeRating = filters.challengeRating;
      if (filters.creatureType) criteria.creatureType = filters.creatureType;
      if (filters.size) criteria.size = filters.size;
      if (filters.hasLegendaryActions) criteria.hasLegendaryActions = filters.hasLegendaryActions;

      const enhancedResult = await this.listCreaturesByCriteria(criteria);

      // The enhanced index is already filtered — no extra name filtering needed.
      return enhancedResult.creatures.map(
        creature =>
          ({
            id: creature.id || creature.name,
            name: creature.name,
            type: creature.type || 'npc',
            pack: creature.pack,
            packLabel: creature.packLabel || creature.pack,
            description: creature.description || '',
            hasImage: creature.hasImage || !!creature.img,
            summary: `CR ${creature.challengeRating} ${creature.creatureType} from ${creature.packLabel}`,
            challengeRating: creature.challengeRating,
            creatureType: creature.creatureType,
            size: creature.size,
            hasLegendaryActions: creature.hasLegendaryActions,
          }) as CompendiumSearchResult & {
            challengeRating: number;
            creatureType: string;
            size: string;
            hasLegendaryActions: boolean;
          }
      );
    } catch (error) {
      console.warn(`[${MODULE_ID}] Enhanced search failed, falling back to basic search:`, error);
      return null;
    }
  }

  /**
   * Hydrate a single compendium document with its sanitized system data, raw
   * object, and (for actors) embedded items and effects. Throws when the pack or
   * document can't be resolved.
   */
  async getCompendiumDocumentFull(
    packId: string,
    documentId: string
  ): Promise<CompendiumEntryFull> {
    const pack = game.packs.get(packId);
    if (!pack) {
      throw new Error(`Compendium pack ${packId} not found`);
    }

    const document = await pack.getDocument(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found in pack ${packId}`);
    }

    const doc = document as any;
    const fullEntry: CompendiumEntryFull = {
      id: document.id || '',
      name: document.name || '',
      type: doc.type || 'unknown',
      img: doc.img || undefined,
      pack: packId,
      packLabel: pack.metadata.label,
      system: shared.sanitizeData(doc.system || {}),
      fullData: shared.sanitizeData(document.toObject()),
    };

    if (doc.items) {
      fullEntry.items = doc.items.map((item: any) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        img: item.img || undefined,
        system: shared.sanitizeData(item.system || {}),
      }));
    }

    if (doc.effects) {
      fullEntry.effects = doc.effects.map((effect: any) => ({
        id: effect.id,
        name: effect.name || effect.label || 'Unknown Effect',
        icon: effect.icon || undefined,
        disabled: effect.disabled || false,
        duration: shared.sanitizeData(effect.duration || {}),
      }));
    }

    return fullEntry;
  }
}
