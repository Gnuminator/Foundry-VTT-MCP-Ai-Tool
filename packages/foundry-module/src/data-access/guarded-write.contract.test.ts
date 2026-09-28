/**
 * The module keeps its own copy of the guarded-write wire types (it does not
 * import the shared package). This pins the runtime vocabulary to the shared
 * contract so the two cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { GUARDED_OP_KINDS as MODULE_KINDS } from './guarded-write.js';
import { GUARDED_OP_KINDS as SHARED_KINDS } from '../../../../shared/src/guarded-write.js';

describe('guarded-write wire contract', () => {
  it('module and shared agree on the op kinds', () => {
    expect([...MODULE_KINDS]).toEqual([...SHARED_KINDS]);
  });
});
