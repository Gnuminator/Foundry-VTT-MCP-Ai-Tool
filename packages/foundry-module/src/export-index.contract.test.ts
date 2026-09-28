/**
 * The module mirrors the runtime values of the export-index contract (the
 * browser cannot resolve `@gnuminator/shared`). This pins the copies to the
 * shared contract so the two cannot drift.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STORY_ITEM_TYPES as MODULE_STORY_TYPES,
  EXPORT_INDEX_LIMITS as MODULE_LIMITS,
  EXPORT_INDEX_QUERY as MODULE_QUERY,
  EXPORT_INDEX_SCHEMA as MODULE_SCHEMA,
  EXPORT_KINDS as MODULE_KINDS,
  FOUNDRY_UUID_MAX_LENGTH as MODULE_UUID_MAX,
  FOUNDRY_UUID_SOURCE as MODULE_UUID_SOURCE,
} from './export-index.js';
import {
  DEFAULT_STORY_ITEM_TYPES as SHARED_STORY_TYPES,
  EXPORT_INDEX_LIMITS as SHARED_LIMITS,
  EXPORT_INDEX_QUERY as SHARED_QUERY,
  EXPORT_INDEX_SCHEMA as SHARED_SCHEMA,
  EXPORT_KINDS as SHARED_KINDS,
  FOUNDRY_UUID_MAX_LENGTH as SHARED_UUID_MAX,
  FOUNDRY_UUID_SOURCE as SHARED_UUID_SOURCE,
  isFoundryUuid,
} from '../../../shared/src/export-index.js';

describe('export-index wire contract', () => {
  it('module and shared agree on the query name and schema version', () => {
    expect(MODULE_QUERY).toBe(SHARED_QUERY);
    expect(MODULE_SCHEMA).toBe(SHARED_SCHEMA);
  });

  it('module and shared agree on the kind order used for paging', () => {
    expect([...MODULE_KINDS]).toEqual([...SHARED_KINDS]);
  });

  it('module and shared agree on the default story item types', () => {
    expect([...MODULE_STORY_TYPES]).toEqual([...SHARED_STORY_TYPES]);
  });

  it('module and shared agree on every limit', () => {
    expect(MODULE_LIMITS).toEqual(SHARED_LIMITS);
  });

  it('module and shared agree on the uuid pattern and its length limit', () => {
    expect(MODULE_UUID_SOURCE).toBe(SHARED_UUID_SOURCE);
    expect(MODULE_UUID_MAX).toBe(SHARED_UUID_MAX);
  });

  it('the mirrored uuid pattern accepts and refuses what the shared guard does', () => {
    const pattern = new RegExp(MODULE_UUID_SOURCE);
    const id = 'AbCdEfGhIjKlMnOp';
    const samples: unknown[] = [
      `Actor.${id}`,
      `JournalEntry.${id}.JournalEntryPage.${id}`,
      `Compendium.dnd5e.monsters.Actor.${id}`,
      `actor.${id}`,
      `Actor.${id.slice(1)}`,
      `Actor.${id}.Item`,
      'Actor',
      '',
      `Actor.${id}\n`,
      42,
      null,
    ];
    for (const sample of samples) {
      const accepted = typeof sample === 'string' && pattern.test(sample);
      const sharedAccepted = isFoundryUuid(sample);
      // The shared guard also enforces the length limit, which these samples never reach.
      expect(accepted, String(sample)).toBe(sharedAccepted);
    }
  });
});
