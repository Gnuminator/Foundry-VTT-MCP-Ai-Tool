/**
 * The module mirrors the change journal contract (I-109) because the browser
 * cannot resolve `@gnuminator/shared`. This pins the copies to the shared file
 * so the two cannot drift: every constant, the ignored-path rule, and (at
 * type-check time) the record, stash and response shapes.
 */
import { describe, expect, it } from 'vitest';
import {
  CHANGE_JOURNAL_ACTION_GAP_MS as MODULE_GAP,
  CHANGE_JOURNAL_ACTION_MAX_MS as MODULE_ACTION_MAX_MS,
  CHANGE_JOURNAL_ACTION_MAX_OPS as MODULE_ACTION_MAX_OPS,
  CHANGE_JOURNAL_DOCUMENTS as MODULE_DOCUMENTS,
  CHANGE_JOURNAL_IGNORED_PATHS as MODULE_IGNORED,
  CHANGE_JOURNAL_MAX_BUFFER_BYTES as MODULE_MAX_BUFFER,
  CHANGE_JOURNAL_MAX_LIMIT as MODULE_MAX_LIMIT,
  CHANGE_JOURNAL_MAX_RECORD_BYTES as MODULE_MAX_BYTES,
  CHANGE_JOURNAL_RING as MODULE_RING,
  CHANGE_JOURNAL_VERSION as MODULE_VERSION,
  isIgnoredChangePath as moduleIsIgnored,
  type ChangeJournalOptions as ModuleOptions,
  type ChangeJournalResponse as ModuleResponse,
  type ChangeRecord as ModuleRecord,
} from './change-journal-types.js';
import {
  CHANGE_JOURNAL_ACTION_GAP_MS as SHARED_GAP,
  CHANGE_JOURNAL_ACTION_MAX_MS as SHARED_ACTION_MAX_MS,
  CHANGE_JOURNAL_ACTION_MAX_OPS as SHARED_ACTION_MAX_OPS,
  CHANGE_JOURNAL_DOCUMENTS as SHARED_DOCUMENTS,
  CHANGE_JOURNAL_IGNORED_PATHS as SHARED_IGNORED,
  CHANGE_JOURNAL_MAX_BUFFER_BYTES as SHARED_MAX_BUFFER,
  CHANGE_JOURNAL_MAX_LIMIT as SHARED_MAX_LIMIT,
  CHANGE_JOURNAL_MAX_RECORD_BYTES as SHARED_MAX_BYTES,
  CHANGE_JOURNAL_RING as SHARED_RING,
  CHANGE_JOURNAL_VERSION as SHARED_VERSION,
  isIgnoredChangePath as sharedIsIgnored,
  type ChangeJournalOptions as SharedOptions,
  type ChangeJournalResponse as SharedResponse,
  type ChangeRecord as SharedRecord,
} from '../../../shared/src/change-journal.js';

// Compile-time drift check: each pair must be assignable both ways.
export function assertSameShapes(
  shared: { record: SharedRecord; options: SharedOptions; response: SharedResponse },
  module: { record: ModuleRecord; options: ModuleOptions; response: ModuleResponse }
): void {
  const asModule: typeof module = shared;
  const asShared: typeof shared = module;
  void asModule;
  void asShared;
}

describe('change journal wire contract', () => {
  it('module and shared agree on every constant', () => {
    expect(MODULE_VERSION).toBe(SHARED_VERSION);
    expect(MODULE_RING).toBe(SHARED_RING);
    expect(MODULE_MAX_LIMIT).toBe(SHARED_MAX_LIMIT);
    expect(MODULE_MAX_BYTES).toBe(SHARED_MAX_BYTES);
    expect(MODULE_MAX_BUFFER).toBe(SHARED_MAX_BUFFER);
    expect(MODULE_GAP).toBe(SHARED_GAP);
    expect(MODULE_ACTION_MAX_MS).toBe(SHARED_ACTION_MAX_MS);
    expect(MODULE_ACTION_MAX_OPS).toBe(SHARED_ACTION_MAX_OPS);
  });

  it('module and shared agree on the covered documents and ignored paths', () => {
    expect([...MODULE_DOCUMENTS]).toEqual([...SHARED_DOCUMENTS]);
    expect([...MODULE_IGNORED]).toEqual([...SHARED_IGNORED]);
  });

  it('module and shared ignore the same paths', () => {
    const samples = [
      '_id',
      '_stats',
      '_stats.modifiedTime',
      '_statsX',
      'sort',
      'sorting',
      'sort.x',
      '_movementHistory',
      '_movementHistory.0',
      'delta',
      'delta.name',
      'deltaX',
      'flags.core.sheetLock',
      'flags.core.sheetLock.x',
      'flags.core.sheetLockX',
      'flags.core',
      'flags.foundry-mcp-bridge.rules',
      'name',
      'system.attributes.hp.value',
      'x._id',
      '',
    ];
    for (const path of samples) {
      expect(moduleIsIgnored(path), path).toBe(sharedIsIgnored(path));
    }
    for (const path of SHARED_IGNORED) {
      expect(moduleIsIgnored(path), path).toBe(true);
      expect(moduleIsIgnored(`${path}.child`), path).toBe(true);
    }
  });
});
