// The pin store: parsing what is saved, runs and counts, suggestions, pins and renames.
import { describe, expect, it } from 'vitest';

import {
  MAX_PINS,
  MAX_RECENT,
  callKey,
  defaultLabel,
  parseStore,
  suggestions,
  withPin,
  withRename,
  withRun,
  withoutPin,
  type PinStore,
} from './tool-pins';

const EMPTY: PinStore = { pins: [], recent: [], counts: [] };
const run = (
  tool: string,
  args: Record<string, unknown> = {}
): { tool: string; args: Record<string, unknown>; mutates: 'read' } => ({
  tool,
  args,
  mutates: 'read' as const,
});

describe('callKey', () => {
  it('is the same for the same call whatever the key order', () => {
    expect(callKey('t', { a: 1, b: { c: 2, d: 3 } })).toBe(
      callKey('t', { b: { d: 3, c: 2 }, a: 1 })
    );
    expect(callKey('t', { a: 1 })).not.toBe(callKey('t', { a: 2 }));
  });
});

describe('parseStore', () => {
  it('gives an empty store for anything that is not one', () => {
    expect(parseStore(undefined)).toEqual(EMPTY);
    expect(parseStore('x')).toEqual(EMPTY);
    expect(parseStore([])).toEqual(EMPTY);
  });
  it('drops bad entries and treats an unknown class as a write', () => {
    const store = parseStore({
      pins: [
        { id: 'a', label: 'A', tool: 'get-world-info', args: {}, mutates: 'read' },
        { id: 'b', label: 'B', tool: 'x', args: 'no', mutates: 'weird' },
        { label: 'no id', tool: 'x' },
      ],
      recent: [{ tool: 't', at: 'soon' }],
    });
    expect(store.pins.map(p => [p.id, p.mutates, p.args])).toEqual([
      ['a', 'read', {}],
      ['b', 'write', {}],
    ]);
    expect(store.recent).toEqual([]);
  });
});

describe('withRun and suggestions', () => {
  it('keeps the newest call first, once, and at most MAX_RECENT', () => {
    let s = EMPTY;
    for (let i = 0; i < MAX_RECENT + 3; i++) s = withRun(s, run('t', { i }), i);
    expect(s.recent).toHaveLength(MAX_RECENT);
    s = withRun(s, run('t', { i: MAX_RECENT + 2 - 3 }), 100);
    expect(s.recent[0]?.args).toEqual({ i: MAX_RECENT - 1 });
    expect(
      s.recent.filter(r => callKey(r.tool, r.args) === callKey('t', { i: MAX_RECENT - 1 }))
    ).toHaveLength(1);
  });
  it('suggests the three most used calls used at least twice, not already pinned', () => {
    let s = EMPTY;
    const times = (tool: string, n: number): void => {
      for (let i = 0; i < n; i++) s = withRun(s, run(tool), 1);
    };
    times('a', 5);
    times('b', 4);
    times('c', 3);
    times('d', 2);
    times('once', 1);
    expect(suggestions(s).map(c => c.tool)).toEqual(['a', 'b', 'c']);
    s = withPin(s, { ...run('a'), label: 'A' }, 'p1');
    expect(suggestions(s).map(c => c.tool)).toEqual(['b', 'c', 'd']);
  });
});

describe('pins', () => {
  it('adds, renames (never to nothing) and removes', () => {
    let s = withPin(EMPTY, { ...run('t'), label: 'First' }, 'p1');
    s = withRename(s, 'p1', '  Second ');
    expect(s.pins[0]?.label).toBe('Second');
    expect(withRename(s, 'p1', '   ')).toBe(s);
    expect(withoutPin(s, 'p1').pins).toEqual([]);
  });
  it('stops at MAX_PINS', () => {
    let s = EMPTY;
    for (let i = 0; i < MAX_PINS + 2; i++) s = withPin(s, { ...run('t'), label: `P${i}` }, `p${i}`);
    expect(s.pins).toHaveLength(MAX_PINS);
  });
  it('names a pin after its tool and action', () => {
    expect(defaultLabel('plan-scene-mood', { action: 'restore' })).toBe('plan-scene-mood restore');
    expect(defaultLabel('get-party', {})).toBe('get-party');
  });
});
