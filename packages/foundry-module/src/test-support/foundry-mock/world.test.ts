/**
 * The Foundry mock's uuid resolution (F5 lane L0): world, embedded and an unlinked token's
 * synthetic actor (`Scene.s.Token.t.Actor.a`), sync and async.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestWorld, makeActor, makeToken, type TestWorld } from './index.js';

const g = globalThis as any;
let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
});

afterEach(() => {
  restore();
});

describe('fromUuid in the mock', () => {
  it("resolves an unlinked token's synthetic actor, sync and async", async () => {
    const synthetic = makeActor({ id: 'wolf', name: 'Wolf 2' });
    world.addScene({
      id: 's1',
      tokens: [
        makeToken({
          id: 't2',
          name: 'Wolf 2',
          actorId: 'wolf',
          actorLink: false,
          actor: synthetic,
        }),
      ],
    });
    expect(g.fromUuidSync('Scene.s1.Token.t2')?.name).toBe('Wolf 2');
    expect(g.fromUuidSync('Scene.s1.Token.t2.Actor.wolf')).toBe(synthetic);
    await expect(g.fromUuid('Scene.s1.Token.t2.Actor.wolf')).resolves.toBe(synthetic);
    expect(g.fromUuidSync('Scene.s1.Token.t2.Actor.other')).toBeNull();
  });

  it('resolves world documents asynchronously too', async () => {
    world.addActor({ id: 'a1', name: 'Ireena' });
    await expect(g.fromUuid('Actor.a1')).resolves.toMatchObject({ name: 'Ireena' });
    await expect(g.fromUuid('Actor.missing')).resolves.toBeNull();
  });
});
