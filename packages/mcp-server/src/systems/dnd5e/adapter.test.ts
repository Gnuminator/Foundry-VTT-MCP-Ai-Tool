/**
 * Unit tests for DnD5eAdapter — pure Node logic, no FoundryClient, no bridge.
 *
 * All inputs are constructed from the fields the adapter source actually reads.
 * Tests are organized one describe-block per public method.
 */

import { describe, expect, it } from 'vitest';

import { DnD5eAdapter } from './adapter.js';
import type { DnD5eCreatureIndex, SystemCreatureIndex } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid DnD5eCreatureIndex */
function makeDragon(overrides?: Partial<DnD5eCreatureIndex['systemData']>): DnD5eCreatureIndex {
  return {
    id: 'actor-001',
    name: 'Adult Red Dragon',
    type: 'npc',
    packName: 'dnd5e.monsters',
    packLabel: 'D&D 5e Monsters',
    system: 'dnd5e',
    systemData: {
      challengeRating: 17,
      creatureType: 'dragon',
      size: 'huge',
      alignment: 'chaotic evil',
      hasSpellcasting: false,
      hasLegendaryActions: true,
      hitPoints: 256,
      armorClass: 19,
      ...overrides,
    },
  };
}

/** Build a minimal SystemCreatureIndex (base interface, no D&D-specific systemData) */
function makeGenericCreature(): SystemCreatureIndex {
  return {
    id: 'generic-001',
    name: 'Unknown Creature',
    type: 'npc',
    packName: 'some.pack',
    packLabel: 'Some Pack',
    system: 'dnd5e',
    systemData: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DnD5eAdapter', () => {
  const adapter = new DnD5eAdapter();

  // -------------------------------------------------------------------------
  describe('getMetadata()', () => {
    it('returns id "dnd5e"', () => {
      expect(adapter.getMetadata().id).toBe('dnd5e');
    });

    it('returns displayName containing "5th Edition"', () => {
      expect(adapter.getMetadata().displayName).toContain('5th Edition');
    });

    it('returns name "dnd5e"', () => {
      expect(adapter.getMetadata().name).toBe('dnd5e');
    });

    it('reports version "1.0.0"', () => {
      expect(adapter.getMetadata().version).toBe('1.0.0');
    });

    it('has all supportedFeatures flags set to true', () => {
      const { supportedFeatures } = adapter.getMetadata();
      expect(supportedFeatures.creatureIndex).toBe(true);
      expect(supportedFeatures.characterStats).toBe(true);
      expect(supportedFeatures.spellcasting).toBe(true);
      expect(supportedFeatures.powerLevel).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('canHandle()', () => {
    it('returns true for "dnd5e"', () => {
      expect(adapter.canHandle('dnd5e')).toBe(true);
    });

    it('returns true for uppercase "DND5E" (case-insensitive)', () => {
      expect(adapter.canHandle('DND5E')).toBe(true);
    });

    it('returns true for mixed-case "Dnd5e"', () => {
      expect(adapter.canHandle('Dnd5e')).toBe(true);
    });

    it('returns false for "pf2e"', () => {
      expect(adapter.canHandle('pf2e')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(adapter.canHandle('')).toBe(false);
    });

    it('returns false for "dnd5e-custom"', () => {
      expect(adapter.canHandle('dnd5e-custom')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('getFilterSchema()', () => {
    it('returns a Zod schema with a safeParse method', () => {
      const schema = adapter.getFilterSchema();
      expect(typeof schema.safeParse).toBe('function');
    });

    it('accepts a valid filter object', () => {
      const schema = adapter.getFilterSchema();
      const result = schema.safeParse({ creatureType: 'dragon', size: 'huge' });
      expect(result.success).toBe(true);
    });

    it('rejects an invalid creatureType', () => {
      const schema = adapter.getFilterSchema();
      const result = schema.safeParse({ creatureType: 'robot' });
      expect(result.success).toBe(false);
    });

    it('accepts challengeRating as a number', () => {
      const schema = adapter.getFilterSchema();
      const result = schema.safeParse({ challengeRating: 5 });
      expect(result.success).toBe(true);
    });

    it('accepts challengeRating as a range object', () => {
      const schema = adapter.getFilterSchema();
      const result = schema.safeParse({ challengeRating: { min: 1, max: 10 } });
      expect(result.success).toBe(true);
    });

    it('accepts empty object (no filters)', () => {
      const schema = adapter.getFilterSchema();
      const result = schema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('matchesFilters()', () => {
    const dragon = makeDragon();

    it('returns true when no filters are provided', () => {
      expect(adapter.matchesFilters(dragon, {})).toBe(true);
    });

    it('matches exact CR', () => {
      expect(adapter.matchesFilters(dragon, { challengeRating: 17 })).toBe(true);
    });

    it('rejects wrong exact CR', () => {
      expect(adapter.matchesFilters(dragon, { challengeRating: 5 })).toBe(false);
    });

    it('matches CR within range', () => {
      expect(adapter.matchesFilters(dragon, { challengeRating: { min: 10, max: 20 } })).toBe(true);
    });

    it('rejects CR below range minimum', () => {
      expect(adapter.matchesFilters(dragon, { challengeRating: { min: 18 } })).toBe(false);
    });

    it('rejects CR above range maximum', () => {
      expect(adapter.matchesFilters(dragon, { challengeRating: { max: 16 } })).toBe(false);
    });

    it('matches creatureType', () => {
      expect(adapter.matchesFilters(dragon, { creatureType: 'dragon' })).toBe(true);
    });

    it('rejects wrong creatureType', () => {
      expect(adapter.matchesFilters(dragon, { creatureType: 'undead' })).toBe(false);
    });

    it('matches size', () => {
      expect(adapter.matchesFilters(dragon, { size: 'huge' })).toBe(true);
    });

    it('rejects wrong size', () => {
      expect(adapter.matchesFilters(dragon, { size: 'tiny' })).toBe(false);
    });

    it('matches alignment (substring)', () => {
      expect(adapter.matchesFilters(dragon, { alignment: 'chaotic' })).toBe(true);
    });

    it('rejects non-matching alignment', () => {
      expect(adapter.matchesFilters(dragon, { alignment: 'lawful' })).toBe(false);
    });

    it('matches hasLegendaryActions true', () => {
      expect(adapter.matchesFilters(dragon, { hasLegendaryActions: true })).toBe(true);
    });

    it('rejects hasLegendaryActions false for a legendary creature', () => {
      expect(adapter.matchesFilters(dragon, { hasLegendaryActions: false })).toBe(false);
    });

    it('matches spellcaster false for non-spellcaster', () => {
      expect(adapter.matchesFilters(dragon, { spellcaster: false })).toBe(true);
    });

    it('rejects spellcaster true for non-spellcaster', () => {
      expect(adapter.matchesFilters(dragon, { spellcaster: true })).toBe(false);
    });

    it('returns false for invalid filter schema (unknown creatureType value)', () => {
      expect(adapter.matchesFilters(dragon, { creatureType: 'unicorn-invalid' })).toBe(false);
    });

    it('returns true for a spellcasting creature when spellcaster:true', () => {
      const wizard = makeDragon({ hasSpellcasting: true, hasLegendaryActions: false });
      expect(adapter.matchesFilters(wizard, { spellcaster: true })).toBe(true);
    });

    it('returns false when creature has no CR and a CR filter is set', () => {
      const noCr = makeGenericCreature(); // systemData has no challengeRating
      expect(adapter.matchesFilters(noCr, { challengeRating: 5 })).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('getDataPaths()', () => {
    it('returns challengeRating path "system.details.cr"', () => {
      expect(adapter.getDataPaths().challengeRating).toBe('system.details.cr');
    });

    it('returns creatureType path "system.details.type.value"', () => {
      expect(adapter.getDataPaths().creatureType).toBe('system.details.type.value');
    });

    it('returns size path "system.traits.size"', () => {
      expect(adapter.getDataPaths().size).toBe('system.traits.size');
    });

    it('returns hitPoints path "system.attributes.hp"', () => {
      expect(adapter.getDataPaths().hitPoints).toBe('system.attributes.hp');
    });

    it('returns armorClass path "system.attributes.ac.value"', () => {
      expect(adapter.getDataPaths().armorClass).toBe('system.attributes.ac.value');
    });

    it('returns null for perception (does not exist in D&D 5e)', () => {
      expect(adapter.getDataPaths().perception).toBeNull();
    });

    it('returns null for saves (does not exist in D&D 5e)', () => {
      expect(adapter.getDataPaths().saves).toBeNull();
    });

    it('returns null for rarity (does not exist in D&D 5e)', () => {
      expect(adapter.getDataPaths().rarity).toBeNull();
    });

    it('returns legendaryActions path "system.resources.legact"', () => {
      expect(adapter.getDataPaths().legendaryActions).toBe('system.resources.legact');
    });
  });

  // -------------------------------------------------------------------------
  describe('formatCreatureForList()', () => {
    const dragon = makeDragon();

    it('includes id, name, type', () => {
      const result = adapter.formatCreatureForList(dragon);
      expect(result.id).toBe('actor-001');
      expect(result.name).toBe('Adult Red Dragon');
      expect(result.type).toBe('npc');
    });

    it('includes pack with id and label', () => {
      const result = adapter.formatCreatureForList(dragon);
      expect(result.pack).toEqual({ id: 'dnd5e.monsters', label: 'D&D 5e Monsters' });
    });

    it('includes stats.challengeRating', () => {
      const result = adapter.formatCreatureForList(dragon);
      expect(result.stats?.challengeRating).toBe(17);
    });

    it('includes stats.creatureType', () => {
      const result = adapter.formatCreatureForList(dragon);
      expect(result.stats?.creatureType).toBe('dragon');
    });

    it('includes stats.size', () => {
      const result = adapter.formatCreatureForList(dragon);
      expect(result.stats?.size).toBe('huge');
    });

    it('includes stats.alignment', () => {
      const result = adapter.formatCreatureForList(dragon);
      expect(result.stats?.alignment).toBe('chaotic evil');
    });

    it('includes stats.hitPoints', () => {
      const result = adapter.formatCreatureForList(dragon);
      expect(result.stats?.hitPoints).toBe(256);
    });

    it('includes stats.armorClass', () => {
      const result = adapter.formatCreatureForList(dragon);
      expect(result.stats?.armorClass).toBe(19);
    });

    it('sets stats.hasLegendaryActions=true for legendary creature', () => {
      const result = adapter.formatCreatureForList(dragon);
      expect(result.stats?.hasLegendaryActions).toBe(true);
    });

    it('does NOT include hasLegendaryActions for non-legendary creature', () => {
      const simple = makeDragon({ hasLegendaryActions: false });
      const result = adapter.formatCreatureForList(simple);
      expect(result.stats?.hasLegendaryActions).toBeUndefined();
    });

    it('sets stats.spellcaster=true for spellcasting creature', () => {
      const caster = makeDragon({ hasSpellcasting: true });
      const result = adapter.formatCreatureForList(caster);
      expect(result.stats?.spellcaster).toBe(true);
    });

    it('sets hasImage=true when creature has img', () => {
      const withImg = { ...dragon, img: 'icons/dragon.png' };
      const result = adapter.formatCreatureForList(withImg);
      expect(result.hasImage).toBe(true);
    });

    it('does not set hasImage when img is absent', () => {
      const result = adapter.formatCreatureForList(dragon);
      expect(result.hasImage).toBeUndefined();
    });

    it('does not include stats key when systemData is empty', () => {
      const plain = makeGenericCreature();
      const result = adapter.formatCreatureForList(plain);
      expect(result.stats).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('formatCreatureForDetails()', () => {
    const dragon = makeDragon();

    it('includes all list fields', () => {
      const details = adapter.formatCreatureForDetails(dragon);
      expect(details.id).toBe('actor-001');
      expect(details.name).toBe('Adult Red Dragon');
      expect(details.pack).toBeDefined();
      expect(details.stats).toBeDefined();
    });

    it('includes detailedStats block', () => {
      const details = adapter.formatCreatureForDetails(dragon);
      expect(details.detailedStats).toBeDefined();
    });

    it('detailedStats has challengeRating', () => {
      const details = adapter.formatCreatureForDetails(dragon);
      expect(details.detailedStats.challengeRating).toBe(17);
    });

    it('detailedStats has creatureType', () => {
      const details = adapter.formatCreatureForDetails(dragon);
      expect(details.detailedStats.creatureType).toBe('dragon');
    });

    it('detailedStats has hasLegendaryActions', () => {
      const details = adapter.formatCreatureForDetails(dragon);
      expect(details.detailedStats.hasLegendaryActions).toBe(true);
    });

    it('detailedStats has hasSpellcasting', () => {
      const details = adapter.formatCreatureForDetails(dragon);
      expect(details.detailedStats.hasSpellcasting).toBe(false);
    });

    it('includes img when present', () => {
      const withImg = { ...dragon, img: 'icons/dragon.png' };
      const details = adapter.formatCreatureForDetails(withImg);
      expect(details.img).toBe('icons/dragon.png');
    });

    it('does not include img field when absent', () => {
      const details = adapter.formatCreatureForDetails(dragon);
      expect(details.img).toBeUndefined();
    });

    it('detailedStats includes level when set', () => {
      const leveled = makeDragon({ level: 5 });
      const details = adapter.formatCreatureForDetails(leveled);
      expect(details.detailedStats.level).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  describe('describeFilters()', () => {
    it('returns "no filters" for empty object', () => {
      expect(adapter.describeFilters({})).toBe('no filters');
    });

    it('includes CR when challengeRating is a number', () => {
      const result = adapter.describeFilters({ challengeRating: 5 });
      expect(result).toContain('CR');
      expect(result).toContain('5');
    });

    it('includes CR range when challengeRating is an object', () => {
      const result = adapter.describeFilters({ challengeRating: { min: 3, max: 10 } });
      expect(result).toContain('3');
      expect(result).toContain('10');
    });

    it('includes creatureType in description', () => {
      const result = adapter.describeFilters({ creatureType: 'undead' });
      expect(result).toContain('undead');
    });

    it('includes size in description', () => {
      const result = adapter.describeFilters({ size: 'large' });
      expect(result).toContain('large');
    });

    it('includes alignment in description', () => {
      const result = adapter.describeFilters({ alignment: 'neutral evil' });
      expect(result).toContain('neutral evil');
    });

    it('includes "legendary" when hasLegendaryActions is true', () => {
      const result = adapter.describeFilters({ hasLegendaryActions: true });
      expect(result).toContain('legendary');
    });

    it('does NOT include "legendary" when hasLegendaryActions is false', () => {
      const result = adapter.describeFilters({ hasLegendaryActions: false });
      expect(result).not.toContain('legendary');
    });

    it('includes "spellcaster" when spellcaster is true', () => {
      const result = adapter.describeFilters({ spellcaster: true });
      expect(result).toContain('spellcaster');
    });

    it('combines multiple filters', () => {
      const result = adapter.describeFilters({ creatureType: 'dragon', size: 'huge' });
      expect(result).toContain('dragon');
      expect(result).toContain('huge');
    });

    it('returns "invalid filters" for schema-invalid input', () => {
      const result = adapter.describeFilters({ creatureType: 'robot-invalid' });
      expect(result).toBe('invalid filters');
    });
  });

  // -------------------------------------------------------------------------
  describe('getPowerLevel()', () => {
    it('returns challengeRating when present', () => {
      const dragon = makeDragon({ challengeRating: 17 });
      expect(adapter.getPowerLevel(dragon)).toBe(17);
    });

    it('returns 0 for CR 0', () => {
      const weak = makeDragon({ challengeRating: 0 });
      expect(adapter.getPowerLevel(weak)).toBe(0);
    });

    it('returns level when challengeRating is absent', () => {
      const character: DnD5eCreatureIndex = {
        id: 'char-001',
        name: 'Gandalf',
        type: 'character',
        packName: 'world.actors',
        packLabel: 'World Actors',
        system: 'dnd5e',
        systemData: {
          level: 10,
          hasSpellcasting: true,
          hasLegendaryActions: false,
        },
      };
      expect(adapter.getPowerLevel(character)).toBe(10);
    });

    it('returns undefined when neither CR nor level is present', () => {
      const empty = makeGenericCreature();
      expect(adapter.getPowerLevel(empty)).toBeUndefined();
    });

    it('prefers challengeRating over level when both are set', () => {
      const both = makeDragon({ challengeRating: 17, level: 20 });
      expect(adapter.getPowerLevel(both)).toBe(17);
    });
  });

  // -------------------------------------------------------------------------
  describe('extractCharacterStats()', () => {
    /** Minimal NPC actor data shaped like Foundry's actor.toObject() */
    function makeNpcActorData(overrides?: Record<string, any>) {
      return {
        name: 'Goblin Boss',
        type: 'npc',
        system: {
          details: {
            cr: 1,
            type: { value: 'humanoid' },
            alignment: 'neutral evil',
          },
          traits: {
            size: 'small',
          },
          attributes: {
            hp: { value: 21, max: 21, temp: 0 },
            ac: { value: 17 },
            spellcasting: null,
          },
          abilities: {
            str: { value: 10, mod: 0 },
            dex: { value: 14, mod: 2 },
            con: { value: 10, mod: 0 },
            int: { value: 10, mod: 0 },
            wis: { value: 8, mod: -1 },
            cha: { value: 10, mod: 0 },
          },
          skills: {
            ste: { value: 1, total: 6, proficient: 1 },
          },
          resources: {
            legact: { value: 0, max: 0 },
          },
        },
        ...overrides,
      };
    }

    it('extracts name', () => {
      const stats = adapter.extractCharacterStats(makeNpcActorData());
      expect(stats.name).toBe('Goblin Boss');
    });

    it('extracts type', () => {
      const stats = adapter.extractCharacterStats(makeNpcActorData());
      expect(stats.type).toBe('npc');
    });

    it('extracts challengeRating as a number', () => {
      const stats = adapter.extractCharacterStats(makeNpcActorData());
      expect(stats.challengeRating).toBe(1);
    });

    it('extracts hitPoints with current, max, temp', () => {
      const stats = adapter.extractCharacterStats(makeNpcActorData());
      expect(stats.hitPoints).toEqual({ current: 21, max: 21, temp: 0 });
    });

    it('extracts armorClass', () => {
      const stats = adapter.extractCharacterStats(makeNpcActorData());
      expect(stats.armorClass).toBe(17);
    });

    it('extracts abilities with value and modifier', () => {
      const stats = adapter.extractCharacterStats(makeNpcActorData());
      expect(stats.abilities.str).toEqual({ value: 10, modifier: 0 });
      expect(stats.abilities.dex).toEqual({ value: 14, modifier: 2 });
      expect(stats.abilities.wis).toEqual({ value: 8, modifier: -1 });
    });

    it('extracts skills with value, modifier, proficient', () => {
      const stats = adapter.extractCharacterStats(makeNpcActorData());
      expect(stats.skills.ste).toEqual({ value: 1, modifier: 6, proficient: 1 });
    });

    it('extracts creatureType for npc', () => {
      const stats = adapter.extractCharacterStats(makeNpcActorData());
      expect(stats.creatureType).toBe('humanoid');
    });

    it('extracts size for npc', () => {
      const stats = adapter.extractCharacterStats(makeNpcActorData());
      expect(stats.size).toBe('small');
    });

    it('extracts alignment for npc', () => {
      const stats = adapter.extractCharacterStats(makeNpcActorData());
      expect(stats.alignment).toBe('neutral evil');
    });

    it('extracts legendaryActions for npc', () => {
      const stats = adapter.extractCharacterStats(makeNpcActorData());
      expect(stats.legendaryActions).toEqual({ available: 0, max: 0 });
    });

    it('detects spellcasting when system.spells is present', () => {
      const actorWithSpells = makeNpcActorData();
      actorWithSpells.system.spells = { spell1: { value: 2, max: 2 } };
      const stats = adapter.extractCharacterStats(actorWithSpells);
      expect(stats.spellcasting?.hasSpells).toBe(true);
    });

    it('does not include spellcasting when no spells present', () => {
      const stats = adapter.extractCharacterStats(makeNpcActorData());
      expect(stats.spellcasting).toBeUndefined();
    });

    it('extracts level for a PC character', () => {
      const pcActorData = {
        name: 'Frodo',
        type: 'character',
        system: {
          details: {
            level: { value: 5 },
          },
          attributes: {
            hp: { value: 40, max: 40, temp: 0 },
            ac: { value: 14 },
          },
          abilities: {},
          skills: {},
        },
      };
      const stats = adapter.extractCharacterStats(pcActorData);
      expect(stats.level).toBe(5);
    });

    it('handles missing optional sections gracefully (no throw)', () => {
      const minimal = { name: 'Skeleton', type: 'npc', system: {} };
      expect(() => adapter.extractCharacterStats(minimal)).not.toThrow();
    });

    it('does not include creatureType/size/alignment for a PC (type=character)', () => {
      const pcData = {
        name: 'Legolas',
        type: 'character',
        system: {
          details: { level: { value: 8 } },
          attributes: { hp: { value: 60, max: 60, temp: 0 }, ac: { value: 15 } },
          abilities: {},
          skills: {},
        },
      };
      const stats = adapter.extractCharacterStats(pcData);
      expect(stats.creatureType).toBeUndefined();
      expect(stats.size).toBeUndefined();
      expect(stats.alignment).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('extractCreatureData()', () => {
    it('throws an error (runs in Foundry module, not MCP server)', () => {
      expect(() => adapter.extractCreatureData({}, {})).toThrow();
    });

    it('throws an Error instance with a descriptive message', () => {
      let caught: unknown;
      try {
        adapter.extractCreatureData({}, {});
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(/Foundry module/i);
    });
  });
});
