import { describe, expect, it } from 'vitest';

import type { AuditEntry } from '../vault/audit.js';

import { actionKey, computeUndoState } from './undo-state.js';

let clock = Date.parse('2026-10-07T10:00:00Z');

function entry(changeId: string, extra: Partial<AuditEntry> = {}): AuditEntry {
  clock += 1000;
  return {
    changeId,
    planId: null,
    feature: 'live-play',
    summary: changeId,
    risk: 'write',
    target: 'foundry',
    mode: 'apply',
    appliedAt: new Date(clock).toISOString(),
    diff: [],
    ...extra,
  };
}

describe('computeUndoState', () => {
  it('is empty when nothing was undone', () => {
    expect(computeUndoState([entry('a'), entry('b')]).size).toBe(0);
  });

  it('marks the change a legacy undo entry names in undoOf', () => {
    const a = entry('a');
    const u = entry('u', { mode: 'undo', undoOf: 'a' });
    const state = computeUndoState([a, u]);
    expect(state.get('a')).toEqual({ undoneBy: 'u', undoneAt: u.appliedAt });
    expect(state.has('u')).toBe(false);
  });

  it('brings a change back when its undo is undone (redo), and undoes it again', () => {
    const a = entry('a');
    const u1 = entry('u1', { mode: 'undo', undoOf: 'a' });
    expect(computeUndoState([a, u1]).has('a')).toBe(true);

    const redo = entry('r', { mode: 'undo', undoOf: 'u1' });
    const afterRedo = computeUndoState([a, u1, redo]);
    expect(afterRedo.has('a')).toBe(false); // live again
    expect(afterRedo.get('u1')?.undoneBy).toBe('r');

    const again = entry('u2', { mode: 'undo', undoOf: 'r' });
    const afterAgain = computeUndoState([a, u1, redo, again]);
    expect(afterAgain.get('r')?.undoneBy).toBe('u2');
    expect(afterAgain.has('u1')).toBe(false); // the first undo is live again ...
    expect(afterAgain.get('a')?.undoneBy).toBe('u1'); // ... so a is undone again
  });

  it('marks the audit changes and journal actions an undo-planner entry names', () => {
    const a = entry('a');
    const e = entry('e', {
      feature: 'change-undo',
      undoes: { actions: ['x1', 'x2'], changes: ['a'] },
    });
    const state = computeUndoState([a, e]);
    expect(state.get('a')?.undoneBy).toBe('e');
    expect(state.get(actionKey('x1'))?.undoneBy).toBe('e');
    expect(state.get('act:x2')?.undoneBy).toBe('e');
    expect(state.has('e')).toBe(false);
  });

  it('undoing a planner entry (its redo) makes its targets live again', () => {
    const a = entry('a');
    const e = entry('e', { feature: 'change-undo', undoes: { actions: ['x1'], changes: ['a'] } });
    const redo = entry('r', { mode: 'undo', undoOf: 'e' });
    const state = computeUndoState([a, e, redo]);
    expect(state.has('a')).toBe(false);
    expect(state.has('act:x1')).toBe(false);
    expect(state.get('e')?.undoneBy).toBe('r');
  });

  it('keeps the newest live undoer when two entries name the same target', () => {
    const a = entry('a');
    const e1 = entry('e1', { undoes: { changes: ['a'] } });
    const e2 = entry('e2', { undoes: { changes: ['a'] } });
    expect(computeUndoState([a, e1, e2]).get('a')?.undoneBy).toBe('e2');
  });

  it('orders by appliedAt first, then by ring order', () => {
    const same = '2026-10-07T12:00:00.000Z';
    const a = entry('a', { appliedAt: same });
    const u1 = entry('u1', { mode: 'undo', undoOf: 'a', appliedAt: same });
    const redo = entry('r', { mode: 'undo', undoOf: 'u1', appliedAt: same });
    // Same time: ring order decides, so r is newest and a is live.
    expect(computeUndoState([a, u1, redo]).has('a')).toBe(false);
    // The ring may hold entries out of time order; the time wins.
    const t1 = entry('t1', { appliedAt: '2026-10-07T11:00:00.000Z' });
    const t2 = entry('t2', {
      mode: 'undo',
      undoOf: 't1',
      appliedAt: '2026-10-07T11:00:01.000Z',
    });
    const t3 = entry('t3', {
      mode: 'undo',
      undoOf: 't2',
      appliedAt: '2026-10-07T11:00:02.000Z',
    });
    expect(computeUndoState([t3, t1, t2]).has('t1')).toBe(false);
  });
});
