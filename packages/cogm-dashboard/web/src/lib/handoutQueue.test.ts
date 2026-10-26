import { describe, expect, it } from 'vitest';

import { moveUpPlan, requeueArgs, type QueueRow } from './handoutQueue';

const row = (uuid: string, exists = true): QueueRow => ({ uuid, exists, sceneId: null });
const q = [row('a'), row('b'), row('c'), row('d')];

describe('moveUpPlan', () => {
  it('re-queues the row above, then everything after the moved row', () => {
    expect(moveUpPlan(q, 1)?.map(r => r.uuid)).toEqual(['a', 'c', 'd']);
    expect(moveUpPlan(q, 3)?.map(r => r.uuid)).toEqual(['c']);
  });
  it('has nothing to do for the first row or a bad index', () => {
    expect(moveUpPlan(q, 0)).toBeNull();
    expect(moveUpPlan(q, 4)).toBeNull();
  });
  it('refuses when a row to re-queue was deleted', () => {
    expect(moveUpPlan([row('a'), row('b'), row('c', false)], 1)).toBeNull();
    expect(moveUpPlan([row('a'), row('b', false)], 1)).toBeNull();
  });
});

describe('requeueArgs', () => {
  it('keeps scene and players when set', () => {
    expect(requeueArgs({ uuid: 'u', exists: true, sceneId: 's', players: ['p'] })).toEqual({
      action: 'queue',
      pageUuid: 'u',
      sceneId: 's',
      players: ['p'],
    });
    expect(requeueArgs(row('u'))).toEqual({ action: 'queue', pageUuid: 'u' });
  });
});
