import { describe, expect, it } from 'vitest';

import type { AuditEntry } from '../vault/audit.js';

import { actionKey, computeUndoState, redoFeatures, UNDO_FEATURE } from './undo-state.js';

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

  it('goes by ring order, not by appliedAt (the clocks can differ)', () => {
    const same = '2026-10-07T12:00:00.000Z';
    const a = entry('a', { appliedAt: same });
    const u1 = entry('u1', { mode: 'undo', undoOf: 'a', appliedAt: same });
    const redo = entry('r', { mode: 'undo', undoOf: 'u1', appliedAt: same });
    // Same time: ring order decides, so r is newest and a is live.
    expect(computeUndoState([a, u1, redo]).has('a')).toBe(false);
    // The redo came from a browser whose clock is behind: it is still the newest in the ring.
    const t1 = entry('t1', { appliedAt: '2026-10-07T11:00:00.000Z' });
    const t2 = entry('t2', {
      mode: 'undo',
      undoOf: 't1',
      appliedAt: '2026-10-07T11:00:05.000Z',
    });
    const t3 = entry('t3', {
      mode: 'undo',
      undoOf: 't2',
      appliedAt: '2026-10-07T11:00:02.000Z',
    });
    const state = computeUndoState([t1, t2, t3]);
    expect(state.has('t1')).toBe(false);
    expect(state.get('t2')?.undoneBy).toBe('t3');
  });
});

describe('redoFeatures', () => {
  const features = (ring: AuditEntry[], ids: string[]): string[] =>
    redoFeatures(ring, ids).features.sort();

  it('names the feature a redo brings back, and nothing for a plain undo', () => {
    const own = entry('own', { feature: 'ownership' });
    const undo = entry('u', { feature: 'ownership', mode: 'undo', undoOf: 'own' });
    // Undoing the undo redoes the ownership change: its switch must be on.
    expect(features([own, undo], ['u'])).toEqual(['ownership']);
    // Undoing the change itself is a plain undo.
    expect(features([own, undo], ['own'])).toEqual([]);
    // A change and its undo taken back together cancel out.
    expect(features([own, undo], ['own', 'u'])).toEqual([]);
  });

  it('looks through a planned undo to the AI changes it undid', () => {
    const own = entry('own', { feature: 'ownership' });
    const hp = entry('hp', { feature: 'live-play' });
    const planned = entry('p', {
      feature: UNDO_FEATURE,
      undoes: { changes: ['own', 'hp'], actions: ['a1'] },
    });
    expect(features([own, hp, planned], ['p'])).toEqual(['live-play', 'ownership']);
    // A redo of a planned undo, taken back again, is an undo: no switch.
    const redo = entry('r', { feature: UNDO_FEATURE, mode: 'undo', undoOf: 'p' });
    expect(features([own, hp, planned, redo], ['r'])).toEqual([]);
  });

  it('follows a chain of any length: an odd number of undo links brings the change back', () => {
    // A, then P1 (planned) undoes A, Q1 = undo-change(P1) redoes A, Q2 = undo-change(Q1) undoes it.
    const a = entry('a', { feature: 'ownership' });
    const p1 = entry('p1', { feature: UNDO_FEATURE, undoes: { changes: ['a'] } });
    const q1 = entry('q1', { feature: UNDO_FEATURE, mode: 'undo', undoOf: 'p1' });
    const q2 = entry('q2', { feature: UNDO_FEATURE, mode: 'undo', undoOf: 'q1' });
    const ring = [a, p1, q1, q2];
    expect(features(ring, ['p1'])).toEqual(['ownership']);
    expect(features(ring, ['q1'])).toEqual([]);
    // undo-change(Q2) re-applies Q1, which brings A back.
    expect(features(ring, ['q2'])).toEqual(['ownership']);
    // Planned undos only: P2 undoes P1 (A back), P3 undoes P2 (A gone); taking P3 back brings A.
    const p2 = entry('p2', { feature: UNDO_FEATURE, undoes: { changes: ['p1'] } });
    const p3 = entry('p3', { feature: UNDO_FEATURE, undoes: { changes: ['p2'] } });
    expect(features([a, p1, p2, p3], ['p2'])).toEqual([]);
    expect(features([a, p1, p2, p3], ['p3'])).toEqual(['ownership']);
  });

  it('needs no switch to take a change back through a legacy redo, or for a pair that cancels', () => {
    const a = entry('a', { feature: 'ownership' });
    const u = entry('u', { feature: 'ownership', mode: 'undo', undoOf: 'a' });
    const r = entry('r', { feature: 'ownership', mode: 'undo', undoOf: 'u' });
    // Undoing the redo takes A back.
    expect(features([a, u, r], ['r'])).toEqual([]);
    // A rewind holding the undo and its redo, but not A: they cancel.
    expect(features([a, u, r], ['u', 'r'])).toEqual([]);
  });

  it('refuses when a change on the way has left the ring, or asks the legacy feature', () => {
    // The planned undo is still there, the change it undid is not: what comes back is unknown.
    const p = entry('p', { feature: UNDO_FEATURE, undoes: { changes: ['gone'] } });
    expect(redoFeatures([p], ['p'])).toEqual({ features: [], unknown: true });
    // A legacy undo names its original's feature: that switch is required.
    const u = entry('u', { feature: 'ownership', mode: 'undo', undoOf: 'gone' });
    expect(redoFeatures([u], ['u'])).toEqual({ features: ['ownership'], unknown: false });
  });
});
