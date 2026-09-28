import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STORY_ITEM_TYPES,
  EXPORT_INDEX_LIMITS,
  EXPORT_INDEX_QUERY,
  EXPORT_KINDS,
  FOUNDRY_UUID_MAX_LENGTH,
  OPEN_REQUEST_HEADER,
  isFoundryUuid,
} from './export-index.js';

const ID = 'abcdefABCDEF0123';

describe('export-index contract', () => {
  it('names the query and the paging order', () => {
    expect(EXPORT_INDEX_QUERY).toBe('getExportIndex');
    expect(EXPORT_KINDS).toEqual(['actor', 'scene', 'journal', 'item']);
    expect(DEFAULT_STORY_ITEM_TYPES).toEqual([
      'weapon',
      'equipment',
      'consumable',
      'tool',
      'loot',
      'container',
    ]);
  });

  it('keeps the limits consistent', () => {
    const l = EXPORT_INDEX_LIMITS;
    expect(l.pageDefault).toBeLessThanOrEqual(l.pageMax);
    expect(l.idsPageDefault).toBeLessThanOrEqual(l.idsPageMax);
    expect(l.responseBudgetBytes).toBeLessThan(l.responseHardCapBytes);
    expect(l.textPerPageBytes).toBeLessThanOrEqual(l.textPerJournalBytes);
  });

  it('accepts world, embedded and compendium uuids', () => {
    expect(isFoundryUuid(`Actor.${ID}`)).toBe(true);
    expect(isFoundryUuid(`JournalEntry.${ID}.JournalEntryPage.${ID}`)).toBe(true);
    expect(isFoundryUuid(`Compendium.dnd5e.monsters.Actor.${ID}`)).toBe(true);
    expect(isFoundryUuid(`Compendium.my-module.my_pack.Item.${ID}`)).toBe(true);
  });

  it('refuses everything else', () => {
    for (const bad of [
      '',
      'Actor',
      `actor.${ID}`,
      `Actor.${ID.slice(1)}`,
      `Actor.${ID}.`,
      `Actor.${ID}?x=1`,
      `.${ID}`,
      `Compendium.dnd5e.monsters.${ID}`,
      `Actor.${ID}\nScene.${ID}`,
      `javascript:alert(1)`,
      42,
      null,
    ]) {
      expect(isFoundryUuid(bad)).toBe(false);
    }
    const long = `Actor.${ID}${`.Item.${ID}`.repeat(20)}`;
    expect(long.length).toBeGreaterThan(FOUNDRY_UUID_MAX_LENGTH);
    expect(isFoundryUuid(long)).toBe(false);
  });

  it('uses a lower-case header name (Node lower-cases incoming headers)', () => {
    expect(OPEN_REQUEST_HEADER).toBe(OPEN_REQUEST_HEADER.toLowerCase());
  });
});
