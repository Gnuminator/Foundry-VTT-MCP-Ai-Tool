/**
 * `planRoomSetup` with `action: practice` (idea 2.14): one plan, generic content, ids that tie the
 * tokens, combatants and journal together. Nothing is written; these tests pin the ops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { planRoomSetup } from './room-setup.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';

let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
});
afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

const ops = (plan: { ops: any[] }, doc: string): any[] =>
  plan.ops.filter((o: any) => o.documentName === doc);

describe('practice room', () => {
  it('makes a dummy, one owned hero per player, a scene, a journal and a begun combat', async () => {
    world.addUser({ id: 'u1', name: 'Anna' });
    world.addUser({ id: 'u2', name: 'Ben' });
    const plan = await planRoomSetup({ action: 'practice' });

    const actors = ops(plan, 'Actor');
    expect(actors.map(a => a.data.name)).toEqual([
      'Training Dummy',
      'Practice Hero (Anna)',
      'Practice Hero (Ben)',
    ]);
    expect(actors[1].data.ownership).toEqual({ default: 0, u1: 3 });
    expect(actors[2].data.ownership).toEqual({ default: 0, u2: 3 });
    for (const op of plan.ops) expect(op.keepId).toBe(true);

    const hero = actors[1].data;
    expect(hero.items.map((i: any) => i.name)).toEqual(['Practice Sword', 'Practice Spark']);
    for (const item of hero.items) {
      const acts = Object.values<any>(item.system.activities);
      expect(acts).toHaveLength(1);
      expect(acts[0].type).toBe('attack');
    }

    const scene = ops(plan, 'Scene')[0].data;
    expect(scene.navigation).toBe(false);
    expect(scene.active).toBe(false);
    expect(scene.tokens).toHaveLength(3);
    const combat = ops(plan, 'Combat')[0].data;
    expect(combat.scene).toBe(scene._id);
    expect(combat.round).toBe(1);
    expect(combat.combatants).toHaveLength(2);
    for (const c of combat.combatants) {
      const token = scene.tokens.find((t: any) => t._id === c.tokenId);
      expect(token.actorId).toBe(c.actorId);
    }
    expect(plan.tokens).toHaveLength(3);
  });

  it('gives one hero everyone may use when the world has no player yet', async () => {
    const plan = await planRoomSetup({ action: 'practice', name: 'Try-out' });
    const hero = ops(plan, 'Actor')[1].data;
    expect(hero.ownership).toEqual({ default: 3 });
    expect(ops(plan, 'Scene')[0].data.name).toBe('Try-out');
  });

  it('writes the step journal in English and Danish and keeps content generic', async () => {
    const plan = await planRoomSetup({ action: 'practice' });
    const journal = ops(plan, 'JournalEntry')[0].data;
    expect(journal.name).toBe('Practice room: how to');
    expect(journal.pages.map((p: any) => p.name)).toEqual([
      'Practice room: how to',
      'Øverum: sådan gør du',
    ]);
    expect(journal.ownership).toEqual({ default: 2 });
    expect(JSON.stringify(plan.ops)).not.toMatch(/strahd/i);
  });

  it('refuses a second room while a Training Dummy exists', async () => {
    world.addActor({ id: 'd', name: 'Training Dummy', type: 'npc' });
    await expect(planRoomSetup({ action: 'practice', name: 'Other' })).rejects.toThrow(
      /Training Dummy already exists/
    );
  });

  it('refuses a name that is already a scene', async () => {
    world.addScene({ id: 's', name: 'Practice Room', uuid: 'Scene.s' });
    await expect(planRoomSetup({ action: 'practice' })).rejects.toThrow(/already exists/);
  });
});
