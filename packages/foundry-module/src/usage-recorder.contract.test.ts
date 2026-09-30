/**
 * The module keeps its own copy of the usage-log contract (it does not import
 * the shared package at runtime: a bare package specifier cannot load in the
 * browser). This pins the copied vocabulary, limits and sanitizer to
 * `shared/src/usage.ts` so the two cannot drift.
 */
import { describe, expect, it } from 'vitest';
import {
  USAGE_CODE_RE as MODULE_CODE_RE,
  USAGE_KINDS as MODULE_KINDS,
  USAGE_LIMITS as MODULE_LIMITS,
  USAGE_NAME_MAX as MODULE_NAME_MAX,
  USAGE_NAME_PREFIX as MODULE_PREFIX,
  USAGE_NAME_RE as MODULE_NAME_RE,
  USAGE_OUTCOMES as MODULE_OUTCOMES,
  USAGE_SOCKET_CHANNEL,
  USAGE_SURFACES as MODULE_SURFACES,
  sanitizeUsageBatch as moduleBatch,
  sanitizeUsageEvent as moduleSanitize,
} from './usage-recorder.js';
import { MODULE_ID } from './constants.js';
import {
  USAGE_CODE_RE as SHARED_CODE_RE,
  USAGE_KINDS as SHARED_KINDS,
  USAGE_LIMITS as SHARED_LIMITS,
  USAGE_NAME_MAX as SHARED_NAME_MAX,
  USAGE_NAME_PREFIX as SHARED_PREFIX,
  USAGE_NAME_RE as SHARED_NAME_RE,
  USAGE_OUTCOMES as SHARED_OUTCOMES,
  USAGE_SURFACES as SHARED_SURFACES,
  sanitizeUsageBatch as sharedBatch,
  sanitizeUsageEvent as sharedSanitize,
} from '../../../shared/src/usage.js';

describe('usage-log wire contract', () => {
  it('module and shared agree on kinds, surfaces and outcomes', () => {
    expect([...MODULE_KINDS]).toEqual([...SHARED_KINDS]);
    expect([...MODULE_SURFACES]).toEqual([...SHARED_SURFACES]);
    expect([...MODULE_OUTCOMES]).toEqual([...SHARED_OUTCOMES]);
  });

  it('module and shared agree on the name and code rules', () => {
    expect(MODULE_NAME_RE.source).toBe(SHARED_NAME_RE.source);
    expect(MODULE_NAME_RE.flags).toBe(SHARED_NAME_RE.flags);
    expect(MODULE_CODE_RE.source).toBe(SHARED_CODE_RE.source);
    expect(MODULE_CODE_RE.flags).toBe(SHARED_CODE_RE.flags);
    expect(MODULE_NAME_MAX).toBe(SHARED_NAME_MAX);
    expect(MODULE_PREFIX).toEqual(SHARED_PREFIX);
  });

  it('module and shared agree on the limits', () => {
    expect({ ...MODULE_LIMITS }).toEqual({ ...SHARED_LIMITS });
  });

  it('the socket channel is module.<module id>', () => {
    expect(USAGE_SOCKET_CHANNEL).toBe(`module.${MODULE_ID}`);
  });

  it('module and shared sanitize the same way', () => {
    const now = 1_800_000_000_000;
    const base = { clientId: 'abc123', seq: 4, t: now - 1000, kind: 'action', name: 'module.x.y' };
    const samples: unknown[] = [
      base,
      { ...base, count: 3, code: 'nope', extra: 'dropped' },
      { ...base, kind: 'error', code: 'save-failed' },
      { ...base, kind: 'error', code: 'Bad Code!' },
      { ...base, kind: 'view', durationMs: 999_999_999_999 },
      { ...base, kind: 'tool', name: 'tool.get-world-info' },
      { ...base, kind: 'tool' },
      { ...base, name: 'dash.x.y' },
      { ...base, name: 'module.Bad' },
      { ...base, name: `module.${'a'.repeat(100)}` },
      { ...base, clientId: 'has space' },
      { ...base, seq: -1 },
      { ...base, t: now + 10 * 60_000 },
      { ...base, who: { role: 'gm', userId: 'u1', name: 'Zed\u0001' } },
      { ...base, kind: 'bogus' },
      'nope',
      null,
    ];
    for (const sample of samples) {
      expect(moduleSanitize(sample, { now })).toEqual(sharedSanitize(sample, { now }));
      const who = { role: 'player' as const, userId: 'p1', name: 'Pia' };
      expect(moduleSanitize(sample, { now, surface: 'module', who })).toEqual(
        sharedSanitize(sample, { now, surface: 'module', who })
      );
    }
  });

  it('module and shared agree on batches (size cap and dropped count)', () => {
    const many = Array.from({ length: 130 }, (_, i) => ({
      clientId: 'c1',
      seq: i,
      t: 1000,
      kind: 'action',
      name: i % 10 === 0 ? 'bad name' : 'module.a.b',
    }));
    expect(moduleBatch(many, { surface: 'module' })).toEqual(
      sharedBatch(many, { surface: 'module' })
    );
    expect(moduleBatch('x')).toEqual(sharedBatch('x'));
  });
});
