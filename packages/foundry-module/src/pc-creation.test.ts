/**
 * `planPcCreation` (pc-creation-tool): one Actor create op with the pack items inlined. The
 * globals are small stand-ins; dnd5e's `createWithContents` is mimicked just far enough to pin how
 * the planner calls it (container links, per-item overrides, refusals).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PC_CREATION_FEATURE_ID as SHARED_FEATURE,
  PC_CREATION_QUERY as SHARED_QUERY,
} from '@gnuminator/shared';
import { planPcCreation, PC_CREATION_FEATURE_ID, PC_CREATION_QUERY } from './pc-creation.js';
import { NON_WRITE_METHODS } from './write-gate.js';

const g = globalThis as any;
let saved: Record<string, unknown>;

function item(
  name: string,
  type: string,
  system: Record<string, unknown> = {},
  contents: any[] = []
): any {
  return { documentName: 'Item', name, type, system: { ...system }, contents };
}

const docs = new Map<string, any>();

beforeEach(() => {
  saved = { game: g.game, fromUuid: g.fromUuid, CONFIG: g.CONFIG, foundry: g.foundry };
  docs.clear();
  let n = 0;
  g.foundry = { utils: { randomID: (): string => `id${++n}` } };
  g.fromUuid = async (uuid: string): Promise<any> => docs.get(uuid) ?? null;
  g.game = {
    user: { isGM: true },
    users: {
      contents: [
        { id: 'u1', name: 'Gamemaster', isGM: true },
        { id: 'u2', name: 'Christian', isGM: false },
      ],
    },
    actors: { contents: [] },
    items: {
      fromCompendium: (it: any): any => ({
        _id: `src-${it.name}`,
        name: it.name,
        type: it.type,
        system: structuredClone(it.system),
      }),
    },
  };
  g.CONFIG = {
    Item: {
      documentClass: {
        // The shape of dnd5e's helper: copy every item and its contents, link by container id.
        async createWithContents(items: any[], options: any): Promise<any[]> {
          const out: any[] = [];
          const walk = async (it: any, container: string | null, depth: number): Promise<void> => {
            const data = await options.transformAll(it, { container, depth });
            data.system.container = container;
            data._id = `new${out.length + 1}`;
            out.push(data);
            for (const c of it.contents) await walk(c, data._id, depth + 1);
          };
          for (const it of items) await walk(it, null, 0);
          return out;
        },
      },
    },
  };
});
afterEach(() => {
  Object.assign(g, saved);
});

describe('names', () => {
  it('mirror the shared contract and the query is a read', () => {
    expect(PC_CREATION_QUERY).toBe(SHARED_QUERY);
    expect(PC_CREATION_FEATURE_ID).toBe(SHARED_FEATURE);
    expect(NON_WRITE_METHODS).toContain('planPcCreation');
  });
});

describe('planPcCreation', () => {
  it('makes one Actor create op with ownership and the items inlined, containers linked', async () => {
    docs.set(
      'Compendium.p.Item.pack',
      item('Explorer Pack', 'container', {}, [item('Rope', 'loot', { quantity: 1 })])
    );
    docs.set('Compendium.p.Item.mace', item('Mace', 'weapon', { equipped: false, quantity: 1 }));
    docs.set('Compendium.p.Item.bless', item('Bless', 'spell', { prepared: 0 }));
    const plan = await planPcCreation({
      name: 'Ebbe',
      owner: 'christian',
      items: [
        { uuid: 'Compendium.p.Item.pack' },
        { uuid: 'Compendium.p.Item.mace', equipped: true, quantity: 2 },
        { uuid: 'Compendium.p.Item.bless', prepared: true },
      ],
    });
    expect(plan.ops).toHaveLength(1);
    const op: any = plan.ops[0];
    expect(op).toMatchObject({ kind: 'create', documentName: 'Actor', keepId: true });
    expect(op.parentUuid).toBeUndefined();
    expect(op.data).toMatchObject({
      name: 'Ebbe',
      type: 'character',
      ownership: { default: 0, u2: 3 },
    });
    const [pack, rope, mace, bless] = op.data.items;
    expect(rope.system.container).toBe(pack._id);
    expect(mace.system).toMatchObject({ equipped: true, quantity: 2 });
    expect(bless.system.prepared).toBe(1);
    expect(plan.items.find(i => i.name === 'Rope')?.inside).toBe('Explorer Pack');
    expect(plan.actor).toEqual({ name: 'Ebbe', owner: 'Christian' });
    expect(plan.summary).toMatch(/4 items/);
  });

  describe('sheet links (dnd5e _onCreate does not run for inlined items)', () => {
    async function plan(): Promise<any> {
      docs.set('Compendium.p.Item.elf', item('High Elf', 'race'));
      docs.set('Compendium.p.Item.acolyte', item('Acolyte', 'background'));
      docs.set(
        'Compendium.p.Item.wizard',
        item('Wizard', 'class', { spellcasting: { ability: 'int', progression: 'full' } })
      );
      const result = await planPcCreation({
        name: 'Mira',
        items: [
          { uuid: 'Compendium.p.Item.elf' },
          { uuid: 'Compendium.p.Item.acolyte' },
          { uuid: 'Compendium.p.Item.wizard' },
        ],
      });
      return result.ops[0];
    }
    const idOf = (op: any, type: string): string =>
      op.data.items.find((i: any) => i.type === type)._id;

    it('sets details.race to the new species item id', async () => {
      const op = await plan();
      expect(op.data.system.details.race).toBe(idOf(op, 'race'));
    });

    it('sets details.background to the new background item id', async () => {
      const op = await plan();
      expect(op.data.system.details.background).toBe(idOf(op, 'background'));
    });

    it('sets details.originalClass to the new class item id', async () => {
      const op = await plan();
      expect(op.data.system.details.originalClass).toBe(idOf(op, 'class'));
    });

    it('sets attributes.spellcasting to the class spellcasting ability', async () => {
      const op = await plan();
      expect(op.data.system.attributes.spellcasting).toBe('int');
    });

    it('leaves spellcasting unset for a class without one and adds no system without links', async () => {
      docs.set(
        'Compendium.p.Item.fighter',
        item('Fighter', 'class', { spellcasting: { ability: '', progression: 'none' } })
      );
      docs.set('Compendium.p.Item.mace', item('Mace', 'weapon'));
      const withClass: any = (
        await planPcCreation({ name: 'F', items: [{ uuid: 'Compendium.p.Item.fighter' }] })
      ).ops[0];
      expect(withClass.data.system.attributes).toBeUndefined();
      expect(withClass.data.system.details.originalClass).toBe(withClass.data.items[0]._id);
      const plain: any = (
        await planPcCreation({ name: 'M', items: [{ uuid: 'Compendium.p.Item.mace' }] })
      ).ops[0];
      expect(plain.data.system).toBeUndefined();
    });
  });

  it('refuses a missing item, a GM owner, an unknown user and a non-GM caller', async () => {
    await expect(
      planPcCreation({ name: 'X', items: [{ uuid: 'Compendium.p.Item.nope' }] })
    ).rejects.toThrow(/Not an item/);
    await expect(planPcCreation({ name: 'X', owner: 'Gamemaster' })).rejects.toThrow(/is a GM/);
    await expect(planPcCreation({ name: 'X', owner: 'Nobody' })).rejects.toThrow(/No Foundry user/);
    await expect(planPcCreation({ name: ' ' })).rejects.toThrow(/needs a name/);
    g.game.user.isGM = false;
    await expect(planPcCreation({ name: 'X' })).rejects.toThrow(/Only a GM/);
  });

  it('warns about advancement, wrong overrides and a duplicate name', async () => {
    docs.set('Compendium.p.Item.cleric', item('Cleric', 'class'));
    docs.set('Compendium.p.Item.rope', item('Rope', 'loot', { quantity: 1 }));
    g.game.actors.contents = [{ name: 'Ebbe', type: 'character' }];
    const plan = await planPcCreation({
      name: 'Ebbe',
      items: [
        { uuid: 'Compendium.p.Item.cleric' },
        { uuid: 'Compendium.p.Item.rope', equipped: true, prepared: true },
      ],
    });
    const text = plan.warnings.join('\n');
    expect(text).toMatch(/advancement does not run/);
    expect(text).toMatch(/already exists/);
    expect(text).toMatch(/cannot be equipped/);
    expect(text).toMatch(/not a spell/);
  });

  it('makes a bare character without items', async () => {
    const plan = await planPcCreation({ name: 'Solo' });
    expect((plan.ops[0] as any).data.items).toEqual([]);
    expect(plan.actor.owner).toBeNull();
  });
});
