/**
 * Characterization tests for `useNpcActivity` in the `actor-builder` domain —
 * the one method the two parallel actor-builder nets each ceded to the other
 * (a blind-split gap). This file closes it.
 *
 * `data-access.actor-builder-npc.test.ts` covers createNpcActor + the stat-block
 * builders; `data-access.actor-builder-items.test.ts` covers useItem + spells +
 * compendium imports. `useNpcActivity` (run an NPC's attack activity, or just use
 * the item) belongs to neither half, so it is pinned here.
 *
 * Driven through the Phase 9 Foundry-mock harness (in-memory, no browser).
 *
 * Harness gaps worked around locally (never editing shared harness files):
 *   - `makeItem` carries no dnd5e `system.activities`; an attack activity with
 *     `rollAttack`/`rollDamage` `vi.fn()` stubs is attached per-test (and the
 *     item's own `use` stub for the no-activity path).
 *   - `game.user.targets` is set locally to exercise targeted-token AC resolution.
 *   - `game.system.id` is overridden to a non-dnd5e value to hit the guard.
 *   - The default harness system version (4.0.0) drives the dnd5e v4+ branch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from './constants.js';
import {
  createTestWorld,
  makeActor,
  makeItem,
  makeToken,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

/** An item whose single attack activity returns the given attack/damage rolls. */
function attackItem(opts: { id?: string; name?: string; attack?: any; damage?: any }): {
  item: any;
  rollAttack: any;
  rollDamage: any;
} {
  const rollAttack = vi.fn(() =>
    Promise.resolve(opts.attack ?? { total: 18, isCritical: false, formula: '1d20+5' })
  );
  const rollDamage = vi.fn(() => Promise.resolve(opts.damage ?? { total: 9 }));
  const activity = { type: 'attack', rollAttack, rollDamage };
  const item = makeItem({
    id: opts.id ?? 'atk1',
    name: opts.name ?? 'Claw',
    type: 'weapon',
    system: {
      activities: {
        getByType: (t: string) => (t === 'attack' ? [activity] : []),
        contents: [activity],
      },
    },
  });
  return { item, rollAttack, rollDamage };
}

/** An NPC actor that owns the given items, resolvable by `findActorByIdentifier`. */
function npcWith(name: string, items: any[]): any {
  return world.addActor({ name, type: 'npc', items });
}

// ===========================================================================

describe('FoundryDataAccess — useNpcActivity', () => {
  it('throws when the system is not dnd5e', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    await expect(da.useNpcActivity({ actorName: 'Bandit', itemName: 'Claw' })).rejects.toThrow(
      'use-npc-activity requires the dnd5e game system'
    );
  });

  it('throws CHARACTER_NOT_FOUND when the actor is missing', async () => {
    await expect(da.useNpcActivity({ actorName: 'Ghost', itemName: 'Claw' })).rejects.toThrow(
      ERROR_MESSAGES.CHARACTER_NOT_FOUND
    );
  });

  it('throws when the item is not on the actor', async () => {
    npcWith('Bandit', []);
    await expect(da.useNpcActivity({ actorName: 'Bandit', itemName: 'Claw' })).rejects.toThrow(
      'Item "Claw" not found on "Bandit"'
    );
  });

  it('runs an attack activity and reports a hit vs an explicit targetAC', async () => {
    const { item, rollAttack, rollDamage } = attackItem({
      attack: { total: 18, isCritical: false, formula: '1d20+5' },
      damage: { total: 9 },
    });
    npcWith('Bandit', [item]);

    const result = await da.useNpcActivity({ actorName: 'Bandit', itemName: 'Claw', targetAC: 15 });

    expect(rollAttack).toHaveBeenCalledTimes(1);
    expect(rollDamage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      actor: 'Bandit',
      item: 'Claw',
      hadAttack: true,
      attackTotal: 18,
      targetName: null,
      targetAC: 15,
      hit: true, // 18 >= 15
      isCritical: false,
      damageTotal: 9,
      formula: '1d20+5',
    });
  });

  it('posts publicly by default and GM-only on request, in the running Foundry’s mode names', async () => {
    const { item, rollAttack, rollDamage } = attackItem({});
    npcWith('Bandit', [item]);
    await da.useNpcActivity({ actorName: 'Bandit', itemName: 'Claw' });
    expect(rollAttack.mock.calls[0]).toEqual([
      {},
      { configure: false },
      { create: true, rollMode: 'publicroll' },
    ]);

    // Foundry v14 names visibility by message mode; dnd5e 6 passes `rollMode` on unmapped.
    (globalThis as any).CONFIG.ChatMessage = { modes: { public: {}, gm: {}, blind: {}, self: {} } };
    await da.useNpcActivity({ actorName: 'Bandit', itemName: 'Claw', isPublic: false });
    expect(rollAttack.mock.calls[1][2]).toEqual({ create: true, rollMode: 'gm' });
    expect(rollDamage.mock.calls[1][2]).toEqual({ create: true, rollMode: 'gm' });
  });

  it('reports a miss when the attack total is below the target AC', async () => {
    const { item } = attackItem({ attack: { total: 12, formula: '1d20+5' }, damage: { total: 4 } });
    npcWith('Bandit', [item]);

    const result = await da.useNpcActivity({ actorName: 'Bandit', itemName: 'Claw', targetAC: 20 });

    expect(result.hit).toBe(false); // 12 < 20
    expect(result.attackTotal).toBe(12);
  });

  it('sums array-shaped damage rolls', async () => {
    const { item } = attackItem({
      attack: { total: 19, formula: '1d20+6' },
      damage: [{ total: 5 }, { total: 4 }],
    });
    npcWith('Bandit', [item]);

    const result = await da.useNpcActivity({ actorName: 'Bandit', itemName: 'Claw', targetAC: 10 });

    expect(result.damageTotal).toBe(9); // 5 + 4
  });

  it('resolves the target from the GM-targeted token when no targetAC is passed', async () => {
    const { item } = attackItem({ attack: { total: 16, formula: '1d20+4' }, damage: { total: 6 } });
    npcWith('Bandit', [item]);
    (globalThis as any).game.user.targets = new Set([
      { name: 'Goblin', actor: { system: { attributes: { ac: { value: 15 } } } } },
    ]);

    const result = await da.useNpcActivity({ actorName: 'Bandit', itemName: 'Claw' });

    expect(result.targetName).toBe('Goblin');
    expect(result.targetAC).toBe(15);
    expect(result.hit).toBe(true); // 16 >= 15
  });

  it('falls back to using the item (no attack) when it has no attack activity', async () => {
    const use = vi.fn(() => Promise.resolve({}));
    const item = makeItem({
      id: 'feat1',
      name: 'Frightful Presence',
      type: 'feat',
      system: { activities: { getByType: () => [], contents: [] } },
    });
    item.use = use;
    npcWith('Dragon', [item]);

    const result = await da.useNpcActivity({ actorName: 'Dragon', itemName: 'Frightful Presence' });

    expect(use).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      actor: 'Dragon',
      item: 'Frightful Presence',
      hadAttack: false,
      attackTotal: null,
      targetName: null,
      targetAC: null,
      hit: null, // no targetAC + no attackSucceeded
      isCritical: false,
      damageTotal: null,
      formula: null,
    });
  });

  it('matches the item by partial (substring) name', async () => {
    const { item } = attackItem({ id: 'b1', name: 'Bite (Reach)' });
    npcWith('Wolf', [item]);

    const result = await da.useNpcActivity({ actorName: 'Wolf', itemName: 'bite', targetAC: 10 });

    expect(result.item).toBe('Bite (Reach)');
    expect(result.hadAttack).toBe(true);
  });
});

describe('FoundryDataAccess: useNpcActivity on an unlinked token', () => {
  /** A world NPC plus an unlinked token on the active scene with its own synthetic copy. */
  function bossOnScene(
    tokenCount = 1,
    tokenName = 'Boss'
  ): { worldAttack: any; tokenAttacks: any[] } {
    const world_ = attackItem({ id: 'w1', name: 'Bite' });
    world.addActor({ id: 'sorvan', name: 'Boss', type: 'npc', items: [world_.item] });
    const tokenAttacks: any[] = [];
    const tokens = Array.from({ length: tokenCount }, (_, i) => {
      const own = attackItem({ id: `t${i}bite`, name: 'Bite' });
      tokenAttacks.push(own.rollAttack);
      return makeToken({
        id: `tok${i}`,
        name: tokenCount === 1 ? tokenName : `${tokenName} ${i + 1}`,
        actorId: 'sorvan',
        actorLink: false,
        actor: makeActor({ id: 'sorvan', name: 'Boss', type: 'npc', items: [own.item] }),
      });
    });
    world.addScene({ id: 's1', active: true, tokens });
    return { worldAttack: world_.rollAttack, tokenAttacks };
  }

  it("uses the token's synthetic actor when named, not the world actor", async () => {
    const { worldAttack, tokenAttacks } = bossOnScene();

    await da.useNpcActivity({ actorName: 'Boss', itemName: 'Bite' });

    expect(tokenAttacks[0]).toHaveBeenCalledTimes(1);
    expect(worldAttack).not.toHaveBeenCalled();
  });

  it('uses the only token made from a world actor id (the dashboard picker sends ids)', async () => {
    const { worldAttack, tokenAttacks } = bossOnScene();

    await da.useNpcActivity({ actorName: 'sorvan', itemName: 'Bite' });

    expect(tokenAttacks[0]).toHaveBeenCalledTimes(1);
    expect(worldAttack).not.toHaveBeenCalled();
  });

  it('uses the only token made from a world actor named, when the token has its own name', async () => {
    const { worldAttack, tokenAttacks } = bossOnScene(1, 'Boss Token');

    await da.useNpcActivity({ actorName: 'Boss', itemName: 'Bite' });

    expect(tokenAttacks[0]).toHaveBeenCalledTimes(1);
    expect(worldAttack).not.toHaveBeenCalled();
  });

  it('keeps the world actor when several tokens share that actor id', async () => {
    const { worldAttack, tokenAttacks } = bossOnScene(2);

    await da.useNpcActivity({ actorName: 'sorvan', itemName: 'Bite' });

    expect(worldAttack).toHaveBeenCalledTimes(1);
    for (const t of tokenAttacks) expect(t).not.toHaveBeenCalled();
  });

  describe('activities by name (dnd5e 4+)', () => {
    const use = (): any => vi.fn(() => Promise.resolve([{}]));
    /** An item with a save activity (damage) beside its attack activity. */
    function cloudItem(extra: { use?: any; legendary?: boolean } = {}): any {
      const save = {
        id: 'sv1',
        type: 'save',
        name: 'Cloud',
        save: { ability: new Set(['dex']), dc: { value: 14 } },
        damage: { onSave: 'half', parts: [{}] },
        use: extra.use ?? use(),
        rollDamage: vi.fn(() =>
          Promise.resolve([
            { total: 6, options: { type: 'piercing' }, formula: '1d8+2' },
            { total: 3, options: { type: 'poison' } },
            { total: 2, options: { type: 'piercing' } },
          ])
        ),
      };
      const attack: any = {
        id: 'at1',
        type: 'attack',
        name: 'Swipe',
        activation: { type: extra.legendary ? 'legendary' : 'action' },
        use: extra.use ?? use(),
        rollAttack: vi.fn(() => Promise.resolve({ total: 17, formula: '1d20+5' })),
        rollDamage: vi.fn(() => Promise.resolve({ total: 4 })),
      };
      const all = [attack, save];
      return {
        save,
        attack,
        item: makeItem({
          id: 'cl1',
          name: 'Mucus Cloud',
          type: 'feat',
          system: {
            activities: {
              getByType: (t: string) => all.filter(a => a.type === t),
              contents: all,
            },
          },
        }),
      };
    }

    it('uses a save activity, rolls its damage and sums it per damage type', async () => {
      const { item, save, attack } = cloudItem();
      npcWith('Bandit', [item]);
      const result = await da.useNpcActivity({
        actorName: 'Bandit',
        itemName: 'Mucus Cloud',
        activity: 'cloud',
      });
      expect(save.use).toHaveBeenCalledTimes(1);
      expect(save.use.mock.calls[0][0]).toEqual({
        subsequentActions: false,
        create: { measuredTemplate: false },
      });
      expect(attack.rollAttack).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        hadAttack: false,
        damageTotal: 11,
        formula: '1d8+2',
        activity: 'Cloud',
        activityType: 'save',
        save: { abilities: ['dex'], dc: 14, onSave: 'half' },
      });
      expect(result.damageByType).toEqual([
        { type: 'piercing', total: 8 },
        { type: 'poison', total: 3 },
      ]);
    });

    it('refuses an unknown activity and lists the real ones', async () => {
      const { item } = cloudItem();
      npcWith('Bandit', [item]);
      await expect(
        da.useNpcActivity({ actorName: 'Bandit', itemName: 'Mucus Cloud', activity: 'Nope' })
      ).rejects.toThrow(/has no activity "Nope" \(it has: Swipe, Cloud\)/);
    });

    it('stops with nothing rolled when dnd5e refuses the use (no uses or legendary actions left)', async () => {
      const { item, save } = cloudItem({ use: vi.fn(() => Promise.resolve(undefined)) });
      npcWith('Bandit', [item]);
      await expect(
        da.useNpcActivity({ actorName: 'Bandit', itemName: 'Mucus Cloud', activity: 'Cloud' })
      ).rejects.toThrow(/could not be used .*nothing was rolled/);
      expect(save.rollDamage).not.toHaveBeenCalled();
    });

    it('uses a legendary attack once before the attack roll, and plain attacks not at all', async () => {
      const legendary = cloudItem({ legendary: true });
      npcWith('Bandit', [legendary.item]);
      await da.useNpcActivity({
        actorName: 'Bandit',
        itemName: 'Mucus Cloud',
        activity: 'Swipe',
      });
      expect(legendary.attack.use).toHaveBeenCalledTimes(1);
      expect(legendary.attack.rollAttack).toHaveBeenCalledTimes(1);
      expect(legendary.attack.use.mock.invocationCallOrder[0]).toBeLessThan(
        legendary.attack.rollAttack.mock.invocationCallOrder[0]
      );
      const plain = cloudItem();
      world.addActor({ name: 'Wolf', type: 'npc', items: [plain.item] });
      await da.useNpcActivity({ actorName: 'Wolf', itemName: 'Mucus Cloud', activity: 'Swipe' });
      expect(plain.attack.use).not.toHaveBeenCalled();
      expect(plain.attack.rollAttack).toHaveBeenCalledTimes(1);
    });

    it('reports the legendary actions spent before and after', async () => {
      const { item, attack } = cloudItem({ legendary: true });
      const actor = npcWith('Bandit', [item]);
      actor.system = { ...(actor.system ?? {}), resources: { legact: { max: 3, spent: 1 } } };
      attack.use = vi.fn(() => {
        actor.system.resources.legact.spent = 2;
        return Promise.resolve([{}]);
      });
      const result = await da.useNpcActivity({
        actorName: 'Bandit',
        itemName: 'Mucus Cloud',
        activity: 'Swipe',
      });
      expect(result.legendarySpent).toEqual({ before: 1, after: 2 });
    });
  });
});
