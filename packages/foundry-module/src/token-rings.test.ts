/**
 * `planTokenRings` (I-093): read-only planner behind the `token-rings` feature, driven through the
 * Foundry-mock harness.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  TOKEN_RINGS_BATCH as SHARED_BATCH,
  TOKEN_RINGS_FEATURE_ID as SHARED_FEATURE,
  TOKEN_RINGS_PLAN_QUERY as SHARED_QUERY,
} from '../../../shared/src/token-rings.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import {
  planTokenRings,
  TOKEN_RINGS_BATCH,
  TOKEN_RINGS_FEATURE_ID,
  TOKEN_RINGS_PLAN_QUERY,
} from './token-rings.js';
import { NON_WRITE_METHODS, WRITE_METHODS } from './write-gate.js';

let world: TestWorld;
let restore: () => void;

function add(id: string, name: string, type: string, ring = false): void {
  const actor = world.addActor({ id, name, type });
  actor.uuid = `Actor.${id}`;
  actor.prototypeToken = { ring: { enabled: ring } };
}

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
  add('a1', 'Strahd', 'npc');
  add('a2', 'Ireena', 'npc', true);
  add('a3', 'Danni', 'character');
  add('a4', 'Party', 'group');
});
afterEach(() => restore());

describe('planTokenRings', () => {
  it('mirrors the shared names and is not a write method', () => {
    expect(TOKEN_RINGS_PLAN_QUERY).toBe(SHARED_QUERY);
    expect(TOKEN_RINGS_FEATURE_ID).toBe(SHARED_FEATURE);
    expect(TOKEN_RINGS_BATCH).toBe(SHARED_BATCH);
    expect(NON_WRITE_METHODS).toContain(TOKEN_RINGS_PLAN_QUERY);
    expect(WRITE_METHODS).not.toContain(TOKEN_RINGS_PLAN_QUERY);
  });

  it('plans one update per actor without a ring and skips groups and finished actors', () => {
    const plan = planTokenRings({ action: 'enable' });
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1', changes: { 'prototypeToken.ring.enabled': true } },
      { kind: 'update', uuid: 'Actor.a3', changes: { 'prototypeToken.ring.enabled': true } },
    ]);
    expect(plan).toMatchObject({ count: 2, remaining: 0, alreadyDone: 1 });
  });

  it('disable only touches actors that have a ring', () => {
    const plan = planTokenRings({ action: 'disable' });
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a2', changes: { 'prototypeToken.ring.enabled': false } },
    ]);
  });

  it('filters by actor type and by name (case insensitive)', () => {
    expect(planTokenRings({ action: 'enable', actorType: 'character' }).count).toBe(1);
    const named = planTokenRings({ action: 'enable', names: ['strahd'] });
    expect(named.ops).toHaveLength(1);
    expect(named.summary).toContain('1 named actor');
  });

  it('refuses when nothing matches or everything is done', () => {
    expect(() => planTokenRings({ action: 'enable', names: ['Nobody'] })).toThrow(/No character/);
    expect(() => planTokenRings({ action: 'enable', actorType: 'npc', names: ['Ireena'] })).toThrow(
      /already have/
    );
    expect(() => planTokenRings({ action: 'spin' })).toThrow(/Unknown token ring action/);
    expect(() => planTokenRings(null)).toThrow(/request is required/);
  });

  it('caps a plan at the batch size and reports what remains', () => {
    for (let i = 0; i < TOKEN_RINGS_BATCH + 5; i++) add(`n${i}`, `Goblin ${i}`, 'npc');
    const plan = planTokenRings({ action: 'enable' });
    expect(plan.ops).toHaveLength(TOKEN_RINGS_BATCH);
    expect(plan.remaining).toBe(TOKEN_RINGS_BATCH + 5 + 2 - TOKEN_RINGS_BATCH);
    expect(plan.summary).toContain('more need another plan');
  });
});
