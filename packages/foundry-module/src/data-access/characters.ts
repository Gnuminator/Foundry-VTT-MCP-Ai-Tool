import { ERROR_MESSAGES } from '../constants.js';
import * as shared from './shared.js';
import type {
  CharacterEffect,
  CharacterInfo,
  CharacterItem,
  SpellcastingEntry,
  SpellInfo,
} from './types.js';

/**
 * Character/actor inspection domain for `FoundryDataAccess`.
 *
 * Three read surfaces an AI model uses to reason about a single actor:
 *   - {@link getCharacterInfo} — the full dossier (system data, items, effects,
 *     toggles, and dnd5e spellcasting), sanitized for tool output.
 *   - {@link searchCharacterItems} — a token-efficient filtered slice of an
 *     actor's items/spells/actions/effects (by query, type, and category).
 *   - {@link getCharacterEntity} — one specific item/action/effect in full.
 *
 * Foundry documents are duck-typed throughout (`game.actors`, `actor.items`,
 * `actor.effects` are Collections; `system` is system-specific), so reads use
 * defensive `?.`/`||` fallbacks. This is a dnd5e-only build — the extraction
 * logic targets the dnd5e schema (spell level/preparation, equipped-item
 * toggles, class-based spellcasting), and the characterization nets pin the
 * paths that matter.
 */
export class CharacterDataAccess {
  /**
   * Build the full character dossier by name or 16-char id.
   *
   * Lookup order: a 16-character identifier is tried as an actor id first, then
   * any identifier is matched against actor names (case-insensitive, exact).
   * Throws `CHARACTER_NOT_FOUND` when nothing matches. `system` and every item's
   * `system` are passed through {@link shared.sanitizeData} so tool output is
   * free of cycles, sensitive fields, and deprecated-accessor warnings.
   */
  async getCharacterInfo(identifier: string): Promise<CharacterInfo> {
    const actor = this.resolveActorById16OrName(identifier);

    const characterData: CharacterInfo = {
      id: actor.id || '',
      name: actor.name || '',
      type: actor.type,
      ...(actor.img ? { img: actor.img } : {}),
      system: shared.sanitizeData((actor as any).system),
      items: actor.items.map(item => this.summarizeItem(item)),
      effects: actor.effects.map(effect => this.summarizeEffect(effect)),
    };

    // dnd5e equipped-item toggles.
    const toggles = this.extractEquippedToggles(actor);
    if (toggles.length > 0) {
      characterData.itemToggles = toggles;
    }

    // dnd5e class-based spellcasting (slots + per-class spell lists).
    const spellcasting = this.extractSpellcastingData(actor);
    if (spellcasting.length > 0) {
      characterData.spellcasting = spellcasting;
    }

    return characterData;
  }

  /**
   * Search within a character's items, spells, actions, and effects — a
   * token-efficient alternative to {@link getCharacterInfo} when only specific
   * entries are needed.
   *
   * Filters (all optional, AND-combined): `query` (case-insensitive substring on
   * name or description), `type` (exact item/entry type), `category` (dnd5e
   * spell: cantrip/prepared; equipment: equipped — any other value is inert).
   * `limit` (default 20) caps the total matches across all three sources. The
   * supplied query/type/category are echoed back into the envelope only when
   * provided.
   */
  async searchCharacterItems(params: {
    characterIdentifier: string;
    query?: string | undefined;
    type?: string | undefined;
    category?: string | undefined;
    limit?: number | undefined;
  }): Promise<{
    characterId: string;
    characterName: string;
    query?: string;
    type?: string;
    category?: string;
    matches: Array<{
      id: string;
      name: string;
      type: string;
      description?: string;
      // For spells
      level?: number;
      prepared?: boolean;
      expended?: boolean;
      range?: string;
      target?: string;
      area?: string;
      actionCost?: string;
      traits?: string[];
      // For items
      quantity?: number;
      equipped?: boolean;
      invested?: boolean;
      // For actions
      actionType?: string;
    }>;
    totalMatches: number;
  }> {
    shared.validateFoundryState();

    const { characterIdentifier, query, type, category, limit = 20 } = params;

    const actor = shared.findActorByIdentifier(characterIdentifier);
    if (!actor) {
      throw new Error(`Character not found: ${characterIdentifier}`);
    }

    const systemId = (game.system as any).id;
    const matches: Array<any> = [];

    const searchQuery = query?.toLowerCase().trim();
    const searchType = type?.toLowerCase().trim();
    const searchCategory = category?.toLowerCase().trim();

    // Empty query matches everything; non-string fields never match.
    const matchesQuery = (text: unknown): boolean => {
      if (!searchQuery) return true;
      if (typeof text !== 'string') return false;
      return text.toLowerCase().includes(searchQuery);
    };
    const matchesType = (itemType: string): boolean =>
      !searchType || itemType.toLowerCase() === searchType;

    // --- Items (and embedded spells/equipment) ---
    for (const item of actor.items) {
      if (matches.length >= limit) break;
      if (!matchesType(item.type)) continue;

      const itemSystem = item.system;
      const description = this.itemDescription(itemSystem);
      if (!matchesQuery(item.name) && !matchesQuery(description)) continue;

      const result: any = { id: item.id, name: item.name, type: item.type };
      if (description) {
        result.description = this.truncateDescription(description);
      }

      // Type-specific fields + category filtering. A category mismatch skips
      // the item entirely (mirrors the original `continue`-based control flow).
      if (item.type === 'spell') {
        if (!this.applySpellFields(result, item, itemSystem, systemId, searchCategory)) continue;
      } else if (this.isEquipmentType(item.type)) {
        if (!this.applyEquipmentFields(result, itemSystem, searchCategory)) continue;
      }

      matches.push(result);
    }

    // --- Effects (when no type filter, or type === 'effect') ---
    if (!searchType || searchType === 'effect') {
      for (const effect of actor.effects || []) {
        if (matches.length >= limit) break;
        const effectAny = effect;
        if (!matchesQuery(effectAny.name || effectAny.label)) continue;
        matches.push({
          id: effectAny.id,
          name: effectAny.name || effectAny.label,
          type: 'effect',
          description: effectAny.description || undefined,
        });
      }
    }

    shared.auditLog(
      'searchCharacterItems',
      { characterId: actor.id, query, type, category, matchCount: matches.length },
      'success'
    );

    const result: {
      characterId: string;
      characterName: string;
      query?: string;
      type?: string;
      category?: string;
      matches: any[];
      totalMatches: number;
    } = {
      characterId: actor.id || '',
      characterName: actor.name || '',
      matches,
      totalMatches: matches.length,
    };

    if (query) result.query = query;
    if (type) result.type = type;
    if (category) result.category = category;

    return result;
  }

  /**
   * Fetch one entity (item, action, or effect) belonging to a character, in
   * full. The character is resolved by id or case-insensitive name; the entity
   * by id or case-insensitive name, searched items → actions → effects in that
   * order. Both "character not found" and "entity not found" surface wrapped in
   * a `Failed to get character entity: …` error.
   */
  async getCharacterEntity(data: {
    characterIdentifier: string;
    entityIdentifier: string;
  }): Promise<any> {
    shared.validateFoundryState();

    try {
      const actors = game.actors?.contents || [];
      const character = actors.find(
        (actor: any) =>
          actor.id === data.characterIdentifier ||
          actor.name.toLowerCase() === data.characterIdentifier.toLowerCase()
      );
      if (!character) {
        throw new Error(`Character not found: "${data.characterIdentifier}"`);
      }

      const found =
        this.findItemEntity(character, data.entityIdentifier) ??
        this.findActionEntity(character, data.entityIdentifier) ??
        this.findEffectEntity(character, data.entityIdentifier);

      if (found) {
        return found;
      }

      throw new Error(
        `Entity not found: "${data.entityIdentifier}" in character "${character.name}"`
      );
    } catch (error) {
      throw new Error(
        `Failed to get character entity: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // ===== getCharacterInfo internals =====

  /**
   * Resolve an actor by identifier, forgivingly. Order:
   *   1. a 16-character identifier is tried as an actor id;
   *   2. exact name match (case-insensitive) — wins even with duplicate names
   *      (returns the first), preserving the original behavior;
   *   3. a *unique* case-insensitive partial (substring) match — so "Silvera"
   *      resolves to "Silvera Frostmantle" without the caller knowing the full name;
   *   4. if a partial matches more than one actor it's ambiguous: throw a
   *      "did you mean …" error listing the candidates (name + id) so the caller
   *      can disambiguate with the full name or the id;
   *   5. otherwise `CHARACTER_NOT_FOUND`.
   */
  private resolveActorById16OrName(identifier: string): Actor {
    if (identifier.length === 16) {
      const byId = game.actors.get(identifier);
      if (byId) return byId;
    }

    const needle = identifier.toLowerCase();

    const exact = game.actors.find(a => a.name?.toLowerCase() === needle);
    if (exact) return exact;

    const partial = game.actors.filter(a => a.name?.toLowerCase().includes(needle) ?? false);
    if (partial.length === 1) return partial[0]!;
    if (partial.length > 1) {
      const shown = partial
        .slice(0, 10)
        .map(a => `${a.name} (${a.id})`)
        .join(', ');
      const more = partial.length > 10 ? `, …(+${partial.length - 10} more)` : '';
      throw new Error(
        `Multiple characters match "${identifier}": ${shown}${more}. ` +
          `Use the exact name or the 16-character id.`
      );
    }

    throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${identifier}`);
  }

  /** Item summary for the dossier: identity + sanitized system data. */
  private summarizeItem(item: any): CharacterItem {
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      ...(item.img ? { img: item.img } : {}),
      system: shared.sanitizeData(item.system),
    };
  }

  /**
   * Effect summary for the dossier. The `duration` block is only included when
   * the effect carries a live duration, and its fields fall back from the
   * derived `duration` to the raw `_source.duration`.
   */
  private summarizeEffect(effect: any): CharacterEffect {
    const dur = effect.duration;
    const durRaw = effect._source?.duration;
    return {
      id: effect.id,
      name: effect.name || effect.label || 'Unknown Effect',
      ...(effect.icon ? { icon: effect.icon } : {}),
      disabled: effect.disabled,
      ...(dur
        ? {
            duration: {
              type: dur.units ?? durRaw?.type ?? 'none',
              duration: dur.seconds ?? durRaw?.duration,
              remaining: dur.remaining,
            },
          }
        : {}),
    };
  }

  /**
   * dnd5e equipped-item toggles: any item exposing `system.equipped` is reported
   * as a toggle carrying its current equipped state.
   */
  private extractEquippedToggles(actor: any): any[] {
    const toggles: any[] = [];

    actor.items.forEach((item: any) => {
      const sys = item.system;
      if (sys?.equipped !== undefined) {
        toggles.push({
          itemId: item.id,
          itemName: item.name,
          type: 'equipped',
          enabled: sys.equipped,
        });
      }
    });

    return toggles;
  }

  // ===== searchCharacterItems internals =====

  private isEquipmentType(type: string): boolean {
    return ['weapon', 'armor', 'equipment', 'consumable', 'backpack', 'loot'].includes(type);
  }

  /** A string description for query matching (handles `description.value` shapes). */
  private itemDescription(itemSystem: any): string {
    const raw = itemSystem?.description?.value || itemSystem?.description;
    return typeof raw === 'string' ? raw : '';
  }

  /** Strip HTML and cap a description at 300 chars for token efficiency. */
  private truncateDescription(description: string): string {
    const plainText = description.replace(/<[^>]*>/g, '').trim();
    return plainText.length > 300 ? `${plainText.substring(0, 300)}...` : plainText;
  }

  /**
   * Populate spell-specific fields on a search result and apply the spell
   * category filter. Returns `false` when the item should be skipped (category
   * mismatch).
   */
  private applySpellFields(
    result: any,
    item: any,
    itemSystem: any,
    systemId: string,
    searchCategory?: string
  ): boolean {
    result.level = itemSystem?.level?.value ?? itemSystem?.level ?? 0;
    const itemRaw = item._source?.system;
    result.prepared = itemSystem?.prepared ?? itemRaw?.preparation?.prepared;

    if (systemId === 'dnd5e') {
      const targeting = this.extractDnD5eSpellTargeting(itemSystem);
      if (targeting.range) result.range = targeting.range;
      if (targeting.target) result.target = targeting.target;
      if (targeting.area) result.area = targeting.area;
      result.actionCost = itemSystem?.activation?.type;
    }

    // dnd5e recognizes only cantrip/prepared; any other category is inert.
    if (searchCategory) {
      const isCantrip = (result.level || 0) === 0;
      const isPrepared = result.prepared !== false;

      if (searchCategory === 'cantrip' && !isCantrip) return false;
      if (searchCategory === 'prepared' && !isPrepared) return false;
    }

    return true;
  }

  /**
   * Populate equipment-specific fields on a search result and apply the
   * equipment category filter. Returns `false` when the item should be skipped.
   */
  private applyEquipmentFields(result: any, itemSystem: any, searchCategory?: string): boolean {
    result.quantity = itemSystem?.quantity ?? 1;
    result.equipped = itemSystem?.equipped ?? false;

    // dnd5e recognizes only `equipped`; any other category is inert.
    if (searchCategory) {
      if (searchCategory === 'equipped' && !result.equipped) return false;
    }

    return true;
  }

  // ===== getCharacterEntity internals =====

  /** Find an item by id or name and return the item entity envelope, else null. */
  private findItemEntity(character: any, entityIdentifier: string): any {
    const items = character.items?.contents || [];
    const entity = items.find(
      (item: any) =>
        item.id === entityIdentifier || item.name.toLowerCase() === entityIdentifier.toLowerCase()
    );
    if (!entity) return null;

    return {
      success: true,
      entityType: 'item',
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        img: entity.img,
        description: entity.system?.description?.value || entity.system?.description || '',
        system: entity.system,
      },
    };
  }

  /** Find an action in `system.actions` (array or record) and return it, else null. */
  private findActionEntity(character: any, entityIdentifier: string): any {
    const rawActions = character.system?.actions;
    if (!rawActions) return null;

    const actions = Array.isArray(rawActions) ? rawActions : Object.values(rawActions || {});
    const entity = actions.find(
      (action: any) =>
        action.id === entityIdentifier ||
        action.name?.toLowerCase() === entityIdentifier.toLowerCase()
    );
    if (!entity) return null;

    return { success: true, entityType: 'action', entity };
  }

  /** Find an effect by id or name and return the effect entity envelope, else null. */
  private findEffectEntity(character: any, entityIdentifier: string): any {
    const effects = character.effects?.contents || [];
    const entity = effects.find(
      (effect: any) =>
        effect.id === entityIdentifier ||
        effect.name?.toLowerCase() === entityIdentifier.toLowerCase()
    );
    if (!entity) return null;

    return {
      success: true,
      entityType: 'effect',
      entity: {
        id: entity.id,
        name: entity.name || entity.label,
        icon: entity.icon,
        disabled: entity.disabled,
        duration: entity.duration,
        changes: entity.changes,
      },
    };
  }

  // ===== dnd5e spellcasting extraction =====

  /**
   * Build dnd5e spellcasting entries. Spells are grouped by their source class
   * (via `sourceItem`/`sourceClass`, defaulting to `general`); one entry is
   * emitted per spellcasting class (progression !== 'none') carrying that
   * class's slots + spells. When no class-based entry can be formed but the
   * actor has spells, a single general "Spellcasting" entry is emitted instead.
   */
  private extractSpellcastingData(actor: Actor): SpellcastingEntry[] {
    const entries: SpellcastingEntry[] = [];
    const actorAny = actor as any;
    const systemId = (game.system as any).id;

    const spellItems = actor.items.filter(item => item.type === 'spell');
    if (systemId !== 'dnd5e') {
      return entries;
    }

    const classes = actor.items.filter(item => item.type === 'class');
    const spellSlots = actorAny.system?.spells || {};

    // Bucket each spell under its originating class (or 'general').
    const spellsByClass: Record<string, SpellInfo[]> = {};
    for (const spell of spellItems) {
      const spellSystem = spell.system as any;
      const spellRaw = (spell as any)._source?.system || spellSystem;
      const sourceItem = spellSystem?.sourceItem;
      const sourceClass =
        (sourceItem
          ? typeof sourceItem === 'string'
            ? sourceItem
            : sourceItem.identifier || sourceItem.id
          : spellRaw?.sourceClass) || 'general';

      (spellsByClass[sourceClass] ??= []).push(this.toClassSpellInfo(spell, spellSystem, spellRaw));
    }

    // One entry per spellcasting class.
    for (const classItem of classes) {
      const classSystem = classItem.system as any;
      if (
        classSystem?.spellcasting?.progression &&
        classSystem.spellcasting.progression !== 'none'
      ) {
        const className = classItem.name || 'Unknown';
        const classSpells =
          spellsByClass[classItem.id || ''] || spellsByClass[className.toLowerCase()] || [];

        entries.push({
          id: classItem.id || '',
          name: `${className} Spellcasting`,
          type: classSystem?.spellcasting?.type || 'prepared',
          ability: classSystem?.spellcasting?.ability || undefined,
          slots: this.extractDnD5eSpellSlots(spellSlots),
          spells: classSpells.sort(this.bySpellLevelThenName),
        });
      }
    }

    // Fallback: a general entry when there are spells but no class entry formed.
    if (entries.length === 0 && spellItems.length > 0) {
      const allSpells = spellItems.map(spell => this.toGeneralSpellInfo(spell, spell.system));
      entries.push({
        id: 'spellcasting',
        name: 'Spellcasting',
        type: 'prepared',
        slots: this.extractDnD5eSpellSlots(spellSlots),
        spells: allSpells.sort(this.bySpellLevelThenName),
      });
    }

    return entries;
  }

  /** Stable spell ordering: by level, then alphabetically by name. */
  private bySpellLevelThenName = (a: SpellInfo, b: SpellInfo): number =>
    a.level - b.level || a.name.localeCompare(b.name);

  /** SpellInfo for a class-grouped spell (prefers raw preparation data). */
  private toClassSpellInfo(spell: any, spellSystem: any, spellRaw: any): SpellInfo {
    const targeting = this.extractDnD5eSpellTargeting(spellSystem);
    return {
      id: spell.id || '',
      name: spell.name || '',
      level: spellSystem?.level || 0,
      prepared: spellSystem?.prepared ?? spellRaw?.preparation?.prepared ?? true,
      traits: [], // dnd5e doesn't use pf2e-style traits
      actionCost: spellSystem?.activation?.type || undefined,
      range: targeting.range,
      target: targeting.target,
      area: targeting.area,
    };
  }

  /** SpellInfo for the general (no-class) fallback entry. */
  private toGeneralSpellInfo(spell: any, spellSystem: any): SpellInfo {
    const targeting = this.extractDnD5eSpellTargeting(spellSystem);
    return {
      id: spell.id || '',
      name: spell.name || '',
      level: spellSystem?.level || 0,
      prepared: spellSystem?.preparation?.prepared ?? true,
      actionCost: spellSystem?.activation?.type || undefined,
      range: targeting.range,
      target: targeting.target,
      area: targeting.area,
    };
  }

  /**
   * Extract dnd5e spell slots (`spell1`..`spell9` plus warlock `pact`) from the
   * actor's `system.spells`. Only slots with a non-zero max or current value are
   * included; returns `undefined` when there are none.
   */
  private extractDnD5eSpellSlots(
    spellsData: any
  ): Record<string, { value: number; max: number }> | undefined {
    const slots: Record<string, { value: number; max: number }> = {};

    for (let level = 1; level <= 9; level++) {
      const slotData = spellsData?.[`spell${level}`];
      if (slotData && (slotData.max > 0 || slotData.value > 0)) {
        slots[`level${level}`] = { value: slotData.value ?? 0, max: slotData.max ?? 0 };
      }
    }

    const pactSlot = spellsData?.pact;
    if (pactSlot && (pactSlot.max > 0 || pactSlot.value > 0)) {
      slots['pact'] = { value: pactSlot.value ?? 0, max: pactSlot.max ?? 0 };
    }

    return Object.keys(slots).length > 0 ? slots : undefined;
  }

  /**
   * Derive human-readable range/target/area strings from a dnd5e spell's
   * `range`/`target`/`target.template` data. Area-template spells whose target
   * is unset or "point" are reported as targeting an "area".
   */
  private extractDnD5eSpellTargeting(spellSystem: any): {
    range?: string;
    target?: string;
    area?: string;
  } {
    const result: { range?: string; target?: string; area?: string } = {};

    const rangeValue = spellSystem?.range?.value;
    const rangeUnits = spellSystem?.range?.units;
    if (rangeUnits === 'self') {
      result.range = 'Self';
    } else if (rangeUnits === 'touch') {
      result.range = 'Touch';
    } else if (rangeUnits === 'spec') {
      result.range = spellSystem?.range?.special || 'Special';
    } else if (rangeValue && rangeUnits) {
      result.range = `${rangeValue} ${rangeUnits}`;
    }

    const targetType = spellSystem?.target?.type;
    const targetValue = spellSystem?.target?.value;
    if (targetType === 'self') {
      result.target = 'self';
    } else if (targetType === 'creature' || targetType === 'ally' || targetType === 'enemy') {
      result.target = targetValue
        ? `${targetValue} ${targetType}${targetValue > 1 ? 's' : ''}`
        : targetType;
    } else if (targetType === 'object') {
      result.target = targetValue ? `${targetValue} object${targetValue > 1 ? 's' : ''}` : 'object';
    } else if (targetType === 'space' || targetType === 'point') {
      result.target = 'point';
    } else if (targetType) {
      result.target = targetType;
    }

    const areaType = spellSystem?.target?.template?.type;
    const areaSize = spellSystem?.target?.template?.size;
    const areaUnits = spellSystem?.target?.template?.units || 'ft';
    if (areaType && areaSize) {
      result.area = `${areaSize}-${areaUnits} ${areaType}`;
      if (!result.target || result.target === 'point') {
        result.target = 'area';
      }
    }

    return result;
  }
}
