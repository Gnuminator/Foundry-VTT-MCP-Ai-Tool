import { ERROR_MESSAGES } from '../constants.js';
import * as shared from './shared.js';
import type { CharacterInfo, SpellcastingEntry, SpellInfo } from './types.js';

/** Character info + item search domain — extracted from FoundryDataAccess. */
export class CharacterDataAccess {
  /**
   * Get character/actor information by name or ID
   */
  async getCharacterInfo(identifier: string): Promise<CharacterInfo> {
    let actor: Actor | undefined;

    // Try to find by ID first, then by name
    if (identifier.length === 16) {
      // Foundry ID length
      actor = game.actors.get(identifier);
    }

    if (!actor) {
      actor = game.actors.find(a => a.name?.toLowerCase() === identifier.toLowerCase());
    }

    if (!actor) {
      throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${identifier}`);
    }

    // Build character data structure
    const characterData: CharacterInfo = {
      id: actor.id || '',
      name: actor.name || '',
      type: actor.type,
      ...(actor.img ? { img: actor.img } : {}),
      system: shared.sanitizeData((actor as any).system),
      items: actor.items.map(item => {
        return {
          id: item.id,
          name: item.name,
          type: item.type,
          ...(item.img ? { img: item.img } : {}),
          system: shared.sanitizeData(item.system),
        };
      }),
      effects: actor.effects.map(effect => {
        const eff = effect as any;
        const dur = eff.duration;
        const durRaw = eff._source?.duration;
        return {
          id: effect.id,
          name: eff.name || eff.label || 'Unknown Effect',
          ...(eff.icon ? { icon: eff.icon } : {}),
          disabled: eff.disabled,
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
      }),
    };

    const actorAny = actor as any;

    // Include actions (strikes, spells, etc.)
    if (actorAny.system?.actions) {
      characterData.actions = actorAny.system.actions.map((action: any) => ({
        name: action.label || action.name,
        type: action.type,
        ...(action.item ? { itemId: action.item.id } : {}),
        ...(action.variants
          ? {
              variants: action.variants.map((v: any) => ({
                label: v.label,
                ...(v.traits ? { traits: v.traits } : {}),
              })),
            }
          : {}),
        ...(action.ready !== undefined ? { ready: action.ready } : {}),
      }));
    }

    // Include item variants and toggles
    const itemVariants: any[] = [];
    const itemToggles: any[] = [];

    actor.items.forEach(item => {
      const itemAny = item as any;

      // Extract rule element variants (e.g., weapon variants, stance toggles)
      if (itemAny.system?.rules) {
        itemAny.system.rules.forEach((rule: any, ruleIndex: number) => {
          // Variants (ChoiceSet, RollOption with choices)
          if (rule.key === 'ChoiceSet' || (rule.key === 'RollOption' && rule.choices)) {
            itemVariants.push({
              itemId: item.id,
              itemName: item.name,
              ruleIndex: ruleIndex,
              ruleKey: rule.key,
              label: rule.label || rule.prompt,
              ...(rule.selection ? { selected: rule.selection } : {}),
              ...(rule.choices ? { choices: rule.choices } : {}),
            });
          }

          // Toggles (RollOption toggleable, ToggleProperty)
          if ((rule.key === 'RollOption' && rule.toggleable) || rule.key === 'ToggleProperty') {
            itemToggles.push({
              itemId: item.id,
              itemName: item.name,
              ruleIndex: ruleIndex,
              ruleKey: rule.key,
              label: rule.label,
              option: rule.option,
              ...(rule.value !== undefined ? { enabled: rule.value } : {}),
              ...(rule.toggleable !== undefined ? { toggleable: rule.toggleable } : {}),
            });
          }
        });
      }

      // Also check for item-level toggles (e.g., equipped, identified)
      if (itemAny.system?.equipped !== undefined) {
        itemToggles.push({
          itemId: item.id,
          itemName: item.name,
          type: 'equipped',
          enabled: itemAny.system.equipped,
        });
      }
    });

    // Add to character data if any found
    if (itemVariants.length > 0) {
      characterData.itemVariants = itemVariants;
    }
    if (itemToggles.length > 0) {
      characterData.itemToggles = itemToggles;
    }

    // Extract spellcasting data
    const spellcastingEntries = this.extractSpellcastingData(actor);
    if (spellcastingEntries.length > 0) {
      characterData.spellcasting = spellcastingEntries;
    }

    return characterData;
  }

  /**
   * Search within a character's items, spells, actions, and effects
   * More token-efficient than getCharacterInfo when you need specific items
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

    // Find the actor
    const actor = shared.findActorByIdentifier(characterIdentifier);
    if (!actor) {
      throw new Error(`Character not found: ${characterIdentifier}`);
    }

    const actorAny = actor as any;
    const systemId = (game.system as any).id;
    const matches: Array<any> = [];

    // Normalize search query
    const searchQuery = query?.toLowerCase().trim();
    const searchType = type?.toLowerCase().trim();
    const searchCategory = category?.toLowerCase().trim();

    // Helper to check if text matches query (safely handles non-strings)
    const matchesQuery = (text: unknown): boolean => {
      if (!searchQuery) return true;
      if (typeof text !== 'string') return false;
      return text.toLowerCase().includes(searchQuery);
    };

    // Helper to check if item matches type filter
    const matchesType = (itemType: string): boolean => {
      if (!searchType) return true;
      return itemType.toLowerCase() === searchType;
    };

    // Search items
    for (const item of actor.items) {
      const itemSystem = item.system as any;

      // Check type filter
      if (!matchesType(item.type)) continue;

      // Check query filter (name or description)
      // Ensure description is a string (could be an object in some systems)
      let description = itemSystem?.description?.value || itemSystem?.description;
      if (typeof description !== 'string') description = '';
      if (!matchesQuery(item.name) && !matchesQuery(description)) continue;

      // Build result based on item type
      const result: any = {
        id: item.id,
        name: item.name,
        type: item.type,
      };

      // Add description (truncated for token efficiency)
      if (description) {
        // Strip HTML and truncate
        const plainText = description.replace(/<[^>]*>/g, '').trim();
        result.description =
          plainText.length > 300 ? plainText.substring(0, 300) + '...' : plainText;
      }

      // Spell-specific fields
      if (item.type === 'spell') {
        result.level = itemSystem?.level?.value ?? itemSystem?.level ?? itemSystem?.rank ?? 0;
        const itemRaw = (item as any)._source?.system;
        result.prepared =
          itemSystem?.prepared ?? itemRaw?.preparation?.prepared ?? itemSystem?.location?.prepared;
        result.expended = itemSystem?.location?.expended;

        // Get targeting info
        if (systemId === 'dnd5e') {
          const targeting = this.extractDnD5eSpellTargeting(itemSystem);
          if (targeting.range) result.range = targeting.range;
          if (targeting.target) result.target = targeting.target;
          if (targeting.area) result.area = targeting.area;
          result.actionCost = itemSystem?.activation?.type;
        }

        // Category filter for spells
        if (searchCategory) {
          const spellLevel = result.level || 0;
          const isPrepared = result.prepared !== false;
          const isCantrip = spellLevel === 0;
          const isFocus =
            itemSystem?.traits?.value?.includes('focus') || itemSystem?.category?.value === 'focus';

          if (searchCategory === 'cantrip' && !isCantrip) continue;
          if (searchCategory === 'prepared' && !isPrepared) continue;
          if (searchCategory === 'focus' && !isFocus) continue;
        }
      }

      // Equipment-specific fields
      if (['weapon', 'armor', 'equipment', 'consumable', 'backpack', 'loot'].includes(item.type)) {
        result.quantity = itemSystem?.quantity ?? 1;
        result.equipped = itemSystem?.equipped ?? false;
        result.invested = itemSystem?.equipped?.invested ?? itemSystem?.invested ?? undefined;

        // Category filter for equipment
        if (searchCategory) {
          if (searchCategory === 'equipped' && !result.equipped) continue;
          if (searchCategory === 'invested' && !result.invested) continue;
        }
      }

      // Feat/feature fields — no additional extraction needed for D&D 5e

      // Action fields — no additional extraction needed for D&D 5e

      matches.push(result);

      // Stop if we've reached the limit
      if (matches.length >= limit) break;
    }

    // Also search actions if type filter includes 'action' or is empty
    if (!searchType || searchType === 'action') {
      const actions =
        actorAny.system?.actions || actorAny.items?.filter((i: any) => i.type === 'action') || [];
      for (const action of actions) {
        if (matches.length >= limit) break;

        const actionName = action.name || action.label || '';
        if (!matchesQuery(actionName)) continue;

        const result: any = {
          id: action.id || action.slug || actionName,
          name: actionName,
          type: 'action',
          actionType: action.type || action.actionType || 'action',
        };

        matches.push(result);
      }
    }

    // Search effects if type filter includes 'effect' or is empty
    if (!searchType || searchType === 'effect') {
      const effects = actor.effects || [];
      for (const effect of effects) {
        if (matches.length >= limit) break;

        const effectAny = effect as any;
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
      {
        characterId: actor.id,
        query,
        type,
        category,
        matchCount: matches.length,
      },
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
   * Extract spellcasting data from an actor (D&D 5e)
   */
  private extractSpellcastingData(actor: Actor): SpellcastingEntry[] {
    const entries: SpellcastingEntry[] = [];
    const actorAny = actor as any;
    const systemId = (game.system as any).id;

    // Get all spell items from the actor
    const spellItems = actor.items.filter(item => item.type === 'spell');

    if (systemId === 'dnd5e') {
      // D&D 5e: Extract from classes with spellcasting
      const classes = actor.items.filter(item => item.type === 'class');
      const spellSlots = actorAny.system?.spells || {};

      // Group spells by their source class or create a general entry
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

        if (!spellsByClass[sourceClass]) {
          spellsByClass[sourceClass] = [];
        }

        const targeting = this.extractDnD5eSpellTargeting(spellSystem);
        spellsByClass[sourceClass].push({
          id: spell.id || '',
          name: spell.name || '',
          level: spellSystem?.level || 0,
          prepared: spellSystem?.prepared ?? spellRaw?.preparation?.prepared ?? true,
          traits: [], // D&D 5e doesn't use traits the same way
          actionCost: spellSystem?.activation?.type || undefined,
          range: targeting.range,
          target: targeting.target,
          area: targeting.area,
        });
      }

      // Create entries for each spellcasting class
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
            spells: classSpells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
          });
        }
      }

      // If no class-based entries found but we have spells, create a general entry
      if (entries.length === 0 && spellItems.length > 0) {
        const allSpells: SpellInfo[] = [];
        for (const spell of spellItems) {
          const spellSystem = spell.system as any;
          const targeting = this.extractDnD5eSpellTargeting(spellSystem);
          allSpells.push({
            id: spell.id || '',
            name: spell.name || '',
            level: spellSystem?.level || 0,
            prepared: spellSystem?.preparation?.prepared ?? true,
            actionCost: spellSystem?.activation?.type || undefined,
            range: targeting.range,
            target: targeting.target,
            area: targeting.area,
          });
        }

        entries.push({
          id: 'spellcasting',
          name: 'Spellcasting',
          type: 'prepared',
          slots: this.extractDnD5eSpellSlots(spellSlots),
          spells: allSpells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
        });
      }
    }

    return entries;
  }

  /**
   * Extract D&D 5e spell slots from actor system data
   */
  private extractDnD5eSpellSlots(
    spellsData: any
  ): Record<string, { value: number; max: number }> | undefined {
    const slots: Record<string, { value: number; max: number }> = {};

    // D&D 5e stores slots as spell1, spell2, etc.
    for (let level = 1; level <= 9; level++) {
      const slotKey = `spell${level}`;
      const slotData = spellsData?.[slotKey];
      if (slotData && (slotData.max > 0 || slotData.value > 0)) {
        slots[`level${level}`] = {
          value: slotData.value ?? 0,
          max: slotData.max ?? 0,
        };
      }
    }

    // Also check for pact slots (warlock)
    const pactSlot = spellsData?.pact;
    if (pactSlot && (pactSlot.max > 0 || pactSlot.value > 0)) {
      slots['pact'] = {
        value: pactSlot.value ?? 0,
        max: pactSlot.max ?? 0,
      };
    }

    return Object.keys(slots).length > 0 ? slots : undefined;
  }

  /**
   * Extract spell targeting info for D&D 5e
   * D&D 5e spells have: target.type ("self", "creature", "point", etc.), range.value, range.units
   */
  private extractDnD5eSpellTargeting(spellSystem: any): {
    range?: string;
    target?: string;
    area?: string;
  } {
    const result: { range?: string; target?: string; area?: string } = {};

    // Range (e.g., "60 feet", "Self", "Touch")
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

    // Target type (e.g., "1 creature", "self", "area")
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

    // Area (for AoE spells - e.g., "20-foot radius", "30-foot cone")
    const areaType = spellSystem?.target?.template?.type;
    const areaSize = spellSystem?.target?.template?.size;
    const areaUnits = spellSystem?.target?.template?.units || 'ft';
    if (areaType && areaSize) {
      result.area = `${areaSize}-${areaUnits} ${areaType}`;
      // If spell has area, target is usually "area"
      if (!result.target || result.target === 'point') {
        result.target = 'area';
      }
    }

    return result;
  }

  /**
   * Get detailed information about a specific entity within a character (item, action, or effect)
   */
  async getCharacterEntity(data: {
    characterIdentifier: string;
    entityIdentifier: string;
  }): Promise<any> {
    shared.validateFoundryState();

    try {
      // Find the character first
      const actors = game.actors?.contents || [];
      const character = actors.find(
        (actor: any) =>
          actor.id === data.characterIdentifier ||
          actor.name.toLowerCase() === data.characterIdentifier.toLowerCase()
      );

      if (!character) {
        throw new Error(`Character not found: "${data.characterIdentifier}"`);
      }

      // Search in items first (by ID or name)
      const items = character.items?.contents || [];
      let entity = items.find(
        (item: any) =>
          item.id === data.entityIdentifier ||
          item.name.toLowerCase() === data.entityIdentifier.toLowerCase()
      );

      if (entity) {
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

      // Search in actions (for systems that have actions as separate entities)
      if ((character as any).system?.actions) {
        const actions = Array.isArray((character as any).system.actions)
          ? (character as any).system.actions
          : Object.values((character as any).system.actions || {});

        entity = actions.find(
          (action: any) =>
            action.id === data.entityIdentifier ||
            action.name?.toLowerCase() === data.entityIdentifier.toLowerCase()
        );

        if (entity) {
          return {
            success: true,
            entityType: 'action',
            entity,
          };
        }
      }

      // Search in effects
      const effects = character.effects?.contents || [];
      entity = effects.find(
        (effect: any) =>
          effect.id === data.entityIdentifier ||
          effect.name?.toLowerCase() === data.entityIdentifier.toLowerCase()
      );

      if (entity) {
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

      throw new Error(
        `Entity not found: "${data.entityIdentifier}" in character "${character.name}"`
      );
    } catch (error) {
      throw new Error(
        `Failed to get character entity: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
