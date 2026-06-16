/**
 * Characterization tests for `getModuleErrors` and `clearModuleErrors` in
 * `FoundryDataAccess` (delegates to `ModulesDataAccess`).
 *
 * These pin the *current* behavior so a from-scratch reimplementation in
 * Phase 9 can be verified to parity.  The `diagnostics` singleton is spied
 * upon so only the data-access layer's own logic is exercised — no real
 * buffer manipulation required.
 *
 * Harness: Phase 9 Foundry-mock (`src/test-support/foundry-mock/index.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';
import { diagnostics } from './diagnostics.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

/** A minimal DiagnosticEntry fixture. */
function makeEntry(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    id: 'diag-abc-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    timestampMs: 1735689600000,
    level: 'error',
    message: 'Something went wrong',
    stack: null,
    source: null,
    module: 'module:some-mod',
    kind: 'console',
    userName: null,
    ...overrides,
  };
}

const STUB_SUMMARY = {
  total: 1,
  byModule: { 'module:some-mod': 1 },
  byLevel: { error: 1 },
};

// =============================================================================
// getModuleErrors — filters object construction
// =============================================================================

describe('FoundryDataAccess — getModuleErrors: filters passed to diagnostics.getErrors', () => {
  it('passes an empty filters object when no data keys are provided', async () => {
    const getErrorsSpy = vi.spyOn(diagnostics, 'getErrors').mockReturnValue([makeEntry()]);
    vi.spyOn(diagnostics, 'summary').mockReturnValue(STUB_SUMMARY);

    await da.getModuleErrors({});

    expect(getErrorsSpy).toHaveBeenCalledWith({});
    expect(Object.keys(getErrorsSpy.mock.calls[0][0])).toHaveLength(0);
  });

  it('passes only level when level is provided', async () => {
    const getErrorsSpy = vi
      .spyOn(diagnostics, 'getErrors')
      .mockReturnValue([makeEntry({ level: 'error' })]);
    vi.spyOn(diagnostics, 'summary').mockReturnValue(STUB_SUMMARY);

    await da.getModuleErrors({ level: 'error' });

    expect(getErrorsSpy).toHaveBeenCalledWith({ level: 'error' });
    expect(Object.keys(getErrorsSpy.mock.calls[0][0])).toEqual(['level']);
  });

  it('passes only moduleId when moduleId is provided', async () => {
    const getErrorsSpy = vi.spyOn(diagnostics, 'getErrors').mockReturnValue([]);
    vi.spyOn(diagnostics, 'summary').mockReturnValue({ total: 0, byModule: {}, byLevel: {} });

    await da.getModuleErrors({ moduleId: 'my-module' });

    expect(getErrorsSpy).toHaveBeenCalledWith({ moduleId: 'my-module' });
    expect(Object.keys(getErrorsSpy.mock.calls[0][0])).toEqual(['moduleId']);
  });

  it('passes only sinceTimestamp when sinceTimestamp is provided', async () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const getErrorsSpy = vi.spyOn(diagnostics, 'getErrors').mockReturnValue([]);
    vi.spyOn(diagnostics, 'summary').mockReturnValue({ total: 0, byModule: {}, byLevel: {} });

    await da.getModuleErrors({ sinceTimestamp: ts });

    expect(getErrorsSpy).toHaveBeenCalledWith({ sinceTimestamp: ts });
    expect(Object.keys(getErrorsSpy.mock.calls[0][0])).toEqual(['sinceTimestamp']);
  });

  it('passes only limit when limit is provided', async () => {
    const getErrorsSpy = vi.spyOn(diagnostics, 'getErrors').mockReturnValue([]);
    vi.spyOn(diagnostics, 'summary').mockReturnValue({ total: 0, byModule: {}, byLevel: {} });

    await da.getModuleErrors({ limit: 25 });

    expect(getErrorsSpy).toHaveBeenCalledWith({ limit: 25 });
    expect(Object.keys(getErrorsSpy.mock.calls[0][0])).toEqual(['limit']);
  });

  it('passes all four keys when all are provided', async () => {
    const getErrorsSpy = vi.spyOn(diagnostics, 'getErrors').mockReturnValue([makeEntry()]);
    vi.spyOn(diagnostics, 'summary').mockReturnValue(STUB_SUMMARY);

    await da.getModuleErrors({
      level: 'warn',
      moduleId: 'some-mod',
      sinceTimestamp: '2026-01-01T00:00:00.000Z',
      limit: 50,
    });

    expect(getErrorsSpy).toHaveBeenCalledWith({
      level: 'warn',
      moduleId: 'some-mod',
      sinceTimestamp: '2026-01-01T00:00:00.000Z',
      limit: 50,
    });
    expect(Object.keys(getErrorsSpy.mock.calls[0][0]).sort()).toEqual(
      ['level', 'limit', 'moduleId', 'sinceTimestamp'].sort()
    );
  });

  it('omits undefined keys even when sibling keys are present', async () => {
    // level provided, moduleId explicitly undefined → only level in filters
    const getErrorsSpy = vi
      .spyOn(diagnostics, 'getErrors')
      .mockReturnValue([makeEntry({ level: 'warn' })]);
    vi.spyOn(diagnostics, 'summary').mockReturnValue(STUB_SUMMARY);

    await da.getModuleErrors({ level: 'warn', moduleId: undefined });

    const calledFilters = getErrorsSpy.mock.calls[0][0];
    expect(calledFilters).toEqual({ level: 'warn' });
    expect('moduleId' in calledFilters).toBe(false);
  });
});

// =============================================================================
// getModuleErrors — return shape
// =============================================================================

describe('FoundryDataAccess — getModuleErrors: return shape', () => {
  it('returns { success:true, count, summary, errors } where errors is exactly what getErrors returned', async () => {
    const entries = [makeEntry(), makeEntry({ id: 'diag-abc-2', message: 'Another error' })];
    vi.spyOn(diagnostics, 'getErrors').mockReturnValue(entries);
    vi.spyOn(diagnostics, 'summary').mockReturnValue(STUB_SUMMARY);

    const result = await da.getModuleErrors({});

    expect(result.success).toBe(true);
    expect(result.errors).toBe(entries); // same reference — not a copy
    expect(result.count).toBe(2);
    expect(result.summary).toBe(STUB_SUMMARY); // same reference
  });

  it('count equals errors.length for a single-element array', async () => {
    const entries = [makeEntry()];
    vi.spyOn(diagnostics, 'getErrors').mockReturnValue(entries);
    vi.spyOn(diagnostics, 'summary').mockReturnValue(STUB_SUMMARY);

    const result = await da.getModuleErrors({});

    expect(result.count).toBe(1);
  });

  it('count is 0 and errors is [] when getErrors returns empty array', async () => {
    vi.spyOn(diagnostics, 'getErrors').mockReturnValue([]);
    vi.spyOn(diagnostics, 'summary').mockReturnValue({ total: 0, byModule: {}, byLevel: {} });

    const result = await da.getModuleErrors({});

    expect(result.count).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('summary is exactly what diagnostics.summary() returned', async () => {
    const customSummary = {
      total: 7,
      byModule: { 'module:a': 5, 'module:b': 2 },
      byLevel: { error: 4, warn: 3 },
    };
    vi.spyOn(diagnostics, 'getErrors').mockReturnValue([]);
    vi.spyOn(diagnostics, 'summary').mockReturnValue(customSummary);

    const result = await da.getModuleErrors({});

    expect(result.summary).toEqual(customSummary);
  });
});

// =============================================================================
// clearModuleErrors
// =============================================================================

describe('FoundryDataAccess — clearModuleErrors: delegates to diagnostics.clear()', () => {
  it('returns { success:true, cleared:N } where N is what diagnostics.clear() returned', async () => {
    // diagnostics.clear() returns number (count of entries cleared)
    vi.spyOn(diagnostics, 'clear').mockReturnValue(42);

    const result = await da.clearModuleErrors();

    expect(result).toEqual({ success: true, cleared: 42 });
  });

  it('cleared is 0 when diagnostics.clear() returns 0', async () => {
    vi.spyOn(diagnostics, 'clear').mockReturnValue(0);

    const result = await da.clearModuleErrors();

    expect(result.cleared).toBe(0);
    expect(result.success).toBe(true);
  });

  it('calls diagnostics.clear() exactly once', async () => {
    const clearSpy = vi.spyOn(diagnostics, 'clear').mockReturnValue(5);

    await da.clearModuleErrors();

    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('cleared mirrors diagnostics.clear() return faithfully for larger values', async () => {
    vi.spyOn(diagnostics, 'clear').mockReturnValue(499);

    const result = await da.clearModuleErrors();

    expect(result.cleared).toBe(499);
  });
});
