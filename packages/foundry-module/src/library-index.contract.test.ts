/**
 * The module mirrors the runtime values of the Library contract (the browser cannot resolve
 * `@gnuminator/shared`). This pins the copies to the shared contract so the two cannot drift.
 */
import { describe, expect, it } from 'vitest';
import {
  LIBRARY_DOCUMENTS_QUERY as MODULE_DOCUMENTS_QUERY,
  LIBRARY_INDEX_QUERY as MODULE_INDEX_QUERY,
  LIBRARY_LIMITS as MODULE_LIMITS,
  LIBRARY_PACK_ID_PATTERN as MODULE_PACK_ID_PATTERN,
  LIBRARY_SCHEMA as MODULE_SCHEMA,
} from './library-index.js';
import {
  LIBRARY_DOCUMENTS_QUERY as SHARED_DOCUMENTS_QUERY,
  LIBRARY_INDEX_QUERY as SHARED_INDEX_QUERY,
  LIBRARY_LIMITS as SHARED_LIMITS,
  LIBRARY_PACK_ID_PATTERN as SHARED_PACK_ID_PATTERN,
  LIBRARY_SCHEMA as SHARED_SCHEMA,
} from '../../../shared/src/library-index.js';

describe('library-index wire contract', () => {
  it('module and shared agree on the index query name', () => {
    expect(MODULE_INDEX_QUERY).toBe(SHARED_INDEX_QUERY);
  });

  it('module and shared agree on the documents query name', () => {
    expect(MODULE_DOCUMENTS_QUERY).toBe(SHARED_DOCUMENTS_QUERY);
  });

  it('the two query names differ from each other', () => {
    expect(MODULE_INDEX_QUERY).not.toBe(MODULE_DOCUMENTS_QUERY);
  });

  it('module and shared agree on the schema version', () => {
    expect(MODULE_SCHEMA).toBe(SHARED_SCHEMA);
  });

  it('module and shared agree on every limit', () => {
    expect(MODULE_LIMITS).toEqual(SHARED_LIMITS);
  });

  it('module and shared carry the same set of limit keys', () => {
    expect(Object.keys(MODULE_LIMITS).sort()).toEqual(Object.keys(SHARED_LIMITS).sort());
  });

  it('module and shared agree on the pack id pattern', () => {
    expect(MODULE_PACK_ID_PATTERN).toBe(SHARED_PACK_ID_PATTERN);
  });

  it('the pack id pattern accepts real pack ids and refuses garbage', () => {
    const pattern = new RegExp(SHARED_PACK_ID_PATTERN);
    for (const ok of ['world.ddb-monsters', 'dnd5e.spells', 'a-b_c.d-e']) {
      expect(pattern.test(ok)).toBe(true);
    }
    for (const bad of ['nodot', '.x', 'a.b.c', '../x', '', 'a b.c', 'x.y\n']) {
      expect(pattern.test(bad)).toBe(false);
    }
  });

  it('pages the index at 1000 rows and 512 KB', () => {
    expect(SHARED_LIMITS.indexPageMax).toBe(1000);
    expect(SHARED_LIMITS.indexPageBytes).toBe(512 * 1024);
  });
});
