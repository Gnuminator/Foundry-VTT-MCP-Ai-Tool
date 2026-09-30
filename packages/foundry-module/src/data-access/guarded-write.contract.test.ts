/**
 * The module keeps its own copy of the guarded-write wire types (it does not
 * import the shared package). This pins the runtime vocabulary to the shared
 * contract so the two cannot drift.
 */
import { describe, expect, it } from 'vitest';
import {
  GUARDED_OP_KINDS as MODULE_KINDS,
  GUARDED_OUTCOME_MEMORY as MODULE_MEMORY,
  inverseOf,
  type GuardedOpResult,
} from './guarded-write.js';
import {
  GUARDED_OP_KINDS as SHARED_KINDS,
  GUARDED_OUTCOME_MEMORY as SHARED_MEMORY,
  inverseGuardedOp,
} from '../../../../shared/src/guarded-write.js';

describe('guarded-write wire contract', () => {
  it('module and shared agree on the op kinds', () => {
    expect([...MODULE_KINDS]).toEqual([...SHARED_KINDS]);
  });

  it('module and shared agree on how many apply outcomes are remembered', () => {
    expect(MODULE_MEMORY).toBe(SHARED_MEMORY);
  });
});

describe('inverse ops', () => {
  const samples: GuardedOpResult[] = [
    {
      index: 0,
      kind: 'update',
      uuid: 'Actor.a',
      documentName: 'Actor',
      name: 'A',
      parentUuid: null,
      before: [
        { path: 'name', present: true, value: 'A' },
        { path: 'flags.foundry-mcp-bridge.rules', present: false },
      ],
      after: [],
    },
    {
      index: 1,
      kind: 'create',
      uuid: 'Actor.a.Item.i',
      documentName: 'Item',
      name: 'I',
      parentUuid: 'Actor.a',
      modifiedTime: 5,
    },
    {
      index: 2,
      kind: 'delete',
      uuid: 'Actor.a.Item.j',
      documentName: 'Item',
      name: 'J',
      parentUuid: 'Actor.a',
      deleted: { _id: 'j', name: 'J' },
    },
    {
      index: 3,
      kind: 'delete',
      uuid: 'JournalEntry.k',
      documentName: 'JournalEntry',
      name: 'K',
      parentUuid: null,
      deleted: { _id: 'k' },
    },
  ];

  it('module rollback and backend undo build the same inverse ops', () => {
    for (const sample of samples) expect(inverseOf(sample)).toEqual(inverseGuardedOp(sample));
  });
});
