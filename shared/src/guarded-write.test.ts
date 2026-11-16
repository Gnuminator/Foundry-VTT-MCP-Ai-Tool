import { describe, expect, it } from 'vitest';
import { expectedAfterApply, type GuardedOpResult } from './guarded-write.js';

describe('expectedAfterApply', () => {
  it('carries the content hash of a created document into the undo snapshot', () => {
    const created = {
      kind: 'create',
      uuid: 'Actor.a.ActiveEffect.e',
      modifiedTime: 5,
      contentHash: 'abc123',
    } as unknown as GuardedOpResult;
    expect(expectedAfterApply(created)).toEqual({
      exists: true,
      modifiedTime: 5,
      contentHash: 'abc123',
    });
  });

  it('leaves the hash out when the module sent none (an older module)', () => {
    const created = { kind: 'create', uuid: 'x', modifiedTime: 5 } as unknown as GuardedOpResult;
    expect(expectedAfterApply(created)).toEqual({ exists: true, modifiedTime: 5 });
  });
});
