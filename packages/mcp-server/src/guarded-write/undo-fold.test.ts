import type { GuardedOp, PathValue } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { foldEvents, opOf, orderOps, rootOfUuid, type DocEvent } from './undo-fold.js';

let order = 0;

function ev(partial: Partial<DocEvent> & Pick<DocEvent, 'op' | 'uuid'>): DocEvent {
  order += 1;
  return {
    t: order * 1000,
    order,
    itemId: `i${order}`,
    documentName: partial.uuid.split('.').slice(-2)[0] ?? 'Actor',
    parentUuid: null,
    name: 'Thing',
    ...partial,
  };
}

const num = (path: string, value: number): PathValue => ({ path, present: true, value });
const absent = (path: string): PathValue => ({ path, present: false });

describe('rootOfUuid', () => {
  it('walks up to the thing, stopping below a scene', () => {
    expect(rootOfUuid('Actor.a')).toBe('Actor.a');
    expect(rootOfUuid('Actor.a.Item.i')).toBe('Actor.a');
    expect(rootOfUuid('Actor.a.Item.i.ActiveEffect.e')).toBe('Actor.a');
    expect(rootOfUuid('Scene.s.Token.t.Actor.x.Item.i')).toBe('Scene.s.Token.t');
    expect(rootOfUuid('Scene.s.Token.t.Actor.x')).toBe('Scene.s.Token.t');
    expect(rootOfUuid('Combat.c.Combatant.k')).toBe('Combat.c');
    expect(rootOfUuid('JournalEntry.j.JournalEntryPage.p')).toBe('JournalEntry.j');
    expect(rootOfUuid('Scene.s.Wall.w')).toBe('Scene.s.Wall.w');
    expect(rootOfUuid('Scene.s')).toBe('Scene.s');
    expect(rootOfUuid('Compendium.dnd5e.items.Item.x')).toBe('Compendium.dnd5e.items.Item.x');
  });
});

describe('foldEvents', () => {
  it('restores the before of the OLDEST change on a path, never replaying two ops', () => {
    const net = foldEvents([
      ev({ op: 'update', uuid: 'Actor.a', before: [num('hp', 10)], after: [num('hp', 8)] }),
      ev({ op: 'update', uuid: 'Actor.a', before: [num('hp', 8)], after: [num('hp', 5)] }),
    ]);
    expect(net).toHaveLength(1);
    expect(net[0]).toMatchObject({
      kind: 'update',
      uuid: 'Actor.a',
      paths: [{ path: 'hp', before: num('hp', 10), after: num('hp', 5) }],
    });
  });

  it('treats an absent before as an unset, and lists unrecorded paths', () => {
    const [net] = foldEvents([
      ev({
        op: 'update',
        uuid: 'Actor.a',
        before: [absent('flags.x'), num('hp', 3)],
        after: [num('flags.x', 1), num('hp', 4)],
        unknownBefore: ['system.mystery', 'hp'],
      }),
    ]);
    const op = opOf(net);
    expect(op).toEqual({
      kind: 'update',
      uuid: 'Actor.a',
      changes: { hp: 3 },
      unset: ['flags.x'],
    });
    expect((net as { unrecorded: string[] }).unrecorded).toEqual(['system.mystery']);
  });

  it('turns a create (with later updates) into a delete only', () => {
    const net = foldEvents([
      ev({ op: 'create', uuid: 'Actor.a.Item.i', modifiedTime: 5 }),
      ev({ op: 'update', uuid: 'Actor.a.Item.i', before: [num('q', 1)], after: [num('q', 2)] }),
    ]);
    expect(net).toEqual([
      {
        kind: 'delete',
        uuid: 'Actor.a.Item.i',
        documentName: 'Item',
        name: 'Thing',
        modifiedTime: 5,
      },
    ]);
  });

  it('needs nothing for a create that was deleted inside the set', () => {
    const net = foldEvents([
      ev({ op: 'create', uuid: 'Actor.a' }),
      ev({ op: 'update', uuid: 'Actor.a', before: [num('hp', 1)], after: [num('hp', 2)] }),
      ev({ op: 'delete', uuid: 'Actor.a', source: { _id: 'a', name: 'X' } }),
    ]);
    expect(net).toEqual([]);
  });

  it('turns update then delete into a create with the older before folded into the source', () => {
    const net = foldEvents([
      ev({ op: 'update', uuid: 'Actor.a', before: [num('hp', 10)], after: [num('hp', 6)] }),
      ev({ op: 'update', uuid: 'Actor.a', before: [num('hp', 6)], after: [num('hp', 4)] }),
      ev({
        op: 'delete',
        uuid: 'Actor.a',
        parentUuid: null,
        source: { _id: 'a', name: 'Wolf', hp: 4, flags: { x: 1 } },
      }),
    ]);
    expect(net).toHaveLength(1);
    expect(net[0]).toMatchObject({
      kind: 'create',
      uuid: 'Actor.a',
      data: { _id: 'a', name: 'Wolf', hp: 10, flags: { x: 1 } },
    });
    expect(opOf(net[0])).toMatchObject({ kind: 'create', keepId: true });
  });

  it('removes a key whose older before was absent when re-creating', () => {
    const [net] = foldEvents([
      ev({
        op: 'update',
        uuid: 'Actor.a',
        before: [absent('flags.x')],
        after: [num('flags.x', 1)],
      }),
      ev({
        op: 'delete',
        uuid: 'Actor.a',
        source: { _id: 'a', flags: { x: 1, y: 2 } },
      }),
    ]);
    expect(net).toMatchObject({ kind: 'create', data: { _id: 'a', flags: { y: 2 } } });
  });

  it('keeps the parent of a deleted embedded document', () => {
    const [net] = foldEvents([
      ev({
        op: 'delete',
        uuid: 'Actor.a.Item.i',
        documentName: 'Item',
        parentUuid: 'Actor.a',
        source: { _id: 'i', name: 'Dagger' },
      }),
    ]);
    expect(opOf(net)).toEqual({
      kind: 'create',
      documentName: 'Item',
      parentUuid: 'Actor.a',
      data: { _id: 'i', name: 'Dagger' },
      keepId: true,
    });
  });

  it('puts the lower path inside a higher path when the lower one is older', () => {
    const [net] = foldEvents([
      ev({
        op: 'update',
        uuid: 'Actor.a',
        before: [{ path: 'ownership.u1', present: true, value: 2 }],
        after: [{ path: 'ownership.u1', present: true, value: 0 }],
      }),
      ev({
        op: 'update',
        uuid: 'Actor.a',
        before: [{ path: 'ownership', present: true, value: { default: 0, u1: 0 } }],
        after: [{ path: 'ownership', present: true, value: { default: 0 } }],
      }),
    ]);
    expect(opOf(net)).toMatchObject({
      changes: { ownership: { default: 0, u1: 2 } },
    });
  });

  it('keeps the older higher path and drops the later lower one', () => {
    const [net] = foldEvents([
      ev({
        op: 'update',
        uuid: 'Actor.a',
        before: [{ path: 'ownership', present: true, value: { default: 0 } }],
        after: [{ path: 'ownership', present: true, value: { default: 0, u1: 3 } }],
      }),
      ev({
        op: 'update',
        uuid: 'Actor.a',
        before: [{ path: 'ownership.u1', present: true, value: 3 }],
        after: [{ path: 'ownership.u1', present: true, value: 1 }],
      }),
    ]);
    expect(opOf(net)).toMatchObject({ changes: { ownership: { default: 0 } } });
    expect((net as { paths: unknown[] }).paths).toHaveLength(1);
  });

  it('skips a document that only has its own create and a delete elsewhere in time', () => {
    // Created, deleted, created again (an AI undo restored it): net it exists again, nothing else happened.
    const net = foldEvents([
      ev({ op: 'delete', uuid: 'Actor.a', source: { _id: 'a' } }),
      ev({ op: 'create', uuid: 'Actor.a' }),
    ]);
    expect(net).toEqual([]);
  });
});

describe('orderOps', () => {
  it('deletes embedded documents first, then updates, then creates parents before children', () => {
    const ops: GuardedOp[] = [
      { kind: 'create', documentName: 'Item', parentUuid: 'Actor.a', data: { _id: 'i' } },
      { kind: 'update', uuid: 'Actor.b', changes: { x: 1 } },
      { kind: 'delete', uuid: 'Actor.c' },
      { kind: 'create', documentName: 'Actor', data: { _id: 'a' } },
      { kind: 'delete', uuid: 'Actor.d.Item.z' },
    ];
    const ordered = orderOps(ops);
    expect(ordered.map(o => o.kind)).toEqual(['delete', 'delete', 'update', 'create', 'create']);
    expect(ordered[0]).toMatchObject({ uuid: 'Actor.d.Item.z' });
    expect(ordered[3]).toMatchObject({ documentName: 'Actor' });
    expect(ordered[4]).toMatchObject({ documentName: 'Item' });
  });
});
