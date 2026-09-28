/**
 * Merging the append-only change history with the audit ring
 * (docs/OBSIDIAN-PLAN.md O2 item 5, shared contract 2).
 */
import { describe, expect, it } from 'vitest';

import { mergeChangeHistory, type RingChangeEntry } from './audit-merge.js';

function ring(overrides: Partial<RingChangeEntry> = {}): RingChangeEntry {
  return {
    changeId: 'chg-1',
    feature: 'tarokka',
    summary: 'Store a reading',
    risk: 'write',
    target: 'vault',
    mode: 'apply',
    appliedAt: '2026-09-28T09:00:00.000Z',
    diff: ['a diff line'],
    ...overrides,
  };
}

function rawLine(overrides: Record<string, unknown> = {}): unknown {
  return {
    v: 1,
    changeId: 'chg-1',
    planId: 'plan-1',
    feature: 'tarokka',
    summary: 'Store a reading',
    risk: 'write',
    target: 'vault',
    mode: 'apply',
    appliedAt: '2026-09-28T09:00:00.000Z',
    diff: ['a diff line'],
    ...overrides,
  };
}

describe('mergeChangeHistory', () => {
  it('includes a ring-only entry (from before the history file existed)', () => {
    const merged = mergeChangeHistory([ring()], []);
    expect(merged).toEqual([expect.objectContaining({ changeId: 'chg-1' })]);
  });

  it('includes a jsonl-only entry', () => {
    const merged = mergeChangeHistory([], [rawLine()]);
    expect(merged).toEqual([expect.objectContaining({ changeId: 'chg-1', feature: 'tarokka' })]);
  });

  it('skips malformed jsonl lines', () => {
    const merged = mergeChangeHistory([], [rawLine(), { garbage: true }, 'nope', null]);
    expect(merged).toHaveLength(1);
  });

  it('when an id is in both, the ring wins for undoneBy/undoneAt', () => {
    const merged = mergeChangeHistory(
      [ring({ undoneBy: 'chg-2', undoneAt: '2026-09-28T09:05:00.000Z' })],
      [rawLine()]
    );
    expect(merged).toEqual([
      expect.objectContaining({
        changeId: 'chg-1',
        undoneBy: 'chg-2',
        undoneAt: '2026-09-28T09:05:00.000Z',
      }),
    ]);
  });

  it('derives undoneBy/undoneAt for a jsonl-only apply from a jsonl undo line', () => {
    const merged = mergeChangeHistory(
      [],
      [
        rawLine(),
        rawLine({
          changeId: 'chg-2',
          mode: 'undo',
          undoOf: 'chg-1',
          appliedAt: '2026-09-28T09:10:00.000Z',
          summary: 'Undo: Store a reading',
        }),
      ]
    );
    const apply = merged.find(e => e.changeId === 'chg-1');
    expect(apply).toMatchObject({ undoneBy: 'chg-2', undoneAt: '2026-09-28T09:10:00.000Z' });
    const undo = merged.find(e => e.changeId === 'chg-2');
    expect(undo).toMatchObject({ mode: 'undo', undoOf: 'chg-1' });
  });

  it('does not derive an undo for an apply with no matching undo line', () => {
    const merged = mergeChangeHistory([], [rawLine()]);
    expect(merged[0]?.undoneBy).toBeUndefined();
  });
});
