/**
 * `FoundryDataAccess.getLevelUpOptions`: read-only level-up advice from a class item's
 * advancement data (dnd5e 6 `Item#advancement.byLevel`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from './constants.js';
import {
  createTestWorld,
  makeActor,
  makeItem,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

type Adv = Record<string, any>;

function adv(type: string, extra: Adv = {}): Adv {
  return { id: `${type}-${extra.id ?? 'x'}`, type, name: type, appliesToClass: true, ...extra };
}

function classItem(
  levels: number,
  byLevel: Record<number, Adv[]>,
  system: Adv = {}
): ReturnType<typeof makeItem> {
  return makeItem({
    name: 'Fighter',
    type: 'class',
    system: { levels, identifier: 'fighter', hd: { denomination: 'd10' }, ...system },
    advancement: { byLevel },
  });
}

function actorWith(...items: ReturnType<typeof makeItem>[]): ReturnType<typeof makeActor> {
  return makeActor({
    id: 'bbbbbbbbbbbbbbbb',
    name: 'Brienne',
    type: 'character',
    system: { details: { level: 3 } },
    items,
  });
}

describe('getLevelUpOptions', () => {
  it('lists the next level grants and the open choices', async () => {
    const fighter = classItem(3, {
      4: [
        adv('HitPoints', { id: 'hp', hitDie: 'd10', average: 6 }),
        adv('AbilityScoreImprovement', { id: 'asi', configuration: { points: 2, cap: 2 } }),
      ],
    });
    world.actors.add(actorWith(fighter));

    const out = await da.getLevelUpOptions({ identifier: 'Brienne' });

    expect(out.characterLevel).toBe(3);
    const [cls] = out.classes;
    expect(cls.className).toBe('Fighter');
    expect(cls.nextLevel).toBe(4);
    expect(cls.openChoices.map((c: Adv) => c.kind)).toEqual(['hit-points', 'asi-or-feat']);
    expect(cls.openChoices[0].detail).toMatchObject({ hitDie: 'd10', average: 6 });
  });

  it('asks for a subclass only when the character has none', async () => {
    const byLevel = { 3: [adv('Subclass', { id: 'sub' })] };
    world.actors.add(actorWith(classItem(2, byLevel)));
    let out = await da.getLevelUpOptions({ identifier: 'Brienne' });
    expect(out.classes[0].openChoices.map((c: Adv) => c.kind)).toEqual(['subclass']);

    world.actors.add(
      makeActor({
        id: 'cccccccccccccccc',
        name: 'Gwendoline',
        type: 'character',
        items: [
          classItem(2, byLevel),
          makeItem({ name: 'Champion', type: 'subclass', system: { classIdentifier: 'fighter' } }),
        ],
      })
    );
    out = await da.getLevelUpOptions({ identifier: 'Gwendoline' });
    expect(out.classes[0].openChoices).toEqual([]);
    expect(out.classes[0].subclass).toEqual({ name: 'Champion' });
  });

  it('flags advancement from earlier levels that was never finished', async () => {
    const fighter = classItem(3, {
      1: [adv('HitPoints', { id: 'hp1', configuredForLevel: () => true })],
      // dnd5e's ASI always answers true from configuredForLevel; a skipped one has no value.type.
      2: [
        adv('AbilityScoreImprovement', { id: 'asi2', configuredForLevel: () => true, value: {} }),
      ],
      3: [adv('Subclass', { id: 'sub3', configuredForLevel: () => false })],
    });
    world.actors.add(actorWith(fighter));

    const out = await da.getLevelUpOptions({ identifier: 'Brienne' });

    expect(out.classes[0].unfinishedAdvancement).toEqual([
      expect.objectContaining({ level: 2, type: 'AbilityScoreImprovement' }),
      expect.objectContaining({ level: 3, type: 'Subclass' }),
    ]);
  });

  it('treats an item choice with only a replacement as no open choice', async () => {
    const fighter = classItem(1, {
      2: [
        adv('ItemChoice', {
          id: 'fs',
          configuration: { choices: { 2: { count: 0, replacement: true } }, type: 'feat' },
        }),
        adv('ItemChoice', {
          id: 'ms',
          configuration: { choices: { 2: { count: 2 } }, type: 'feat' },
        }),
      ],
    });
    world.actors.add(actorWith(fighter));
    const out = await da.getLevelUpOptions({ identifier: 'Brienne' });
    expect(out.classes[0].nextLevelGrants).toHaveLength(2);
    expect(out.classes[0].openChoices).toHaveLength(1);
    expect(out.classes[0].openChoices[0].advancementId).toBe('ms');
  });

  it('skips advancement the class restriction excludes', async () => {
    const fighter = classItem(1, {
      2: [adv('Size', { id: 's', appliesToClass: false })],
    });
    world.actors.add(actorWith(fighter));
    const out = await da.getLevelUpOptions({ identifier: 'Brienne' });
    expect(out.classes[0].nextLevelGrants).toEqual([]);
  });

  it('does not flag an ASI that has a chosen type', async () => {
    const fighter = classItem(2, {
      2: [
        adv('AbilityScoreImprovement', {
          id: 'asi',
          configuredForLevel: () => true,
          value: { type: 'asi' },
        }),
      ],
    });
    world.actors.add(actorWith(fighter));
    const out = await da.getLevelUpOptions({ identifier: 'Brienne' });
    expect(out.classes[0].unfinishedAdvancement).toEqual([]);
  });

  it('includes the subclass advancement at the new class level', async () => {
    const champion = makeItem({
      name: 'Champion',
      type: 'subclass',
      system: { classIdentifier: 'fighter' },
      advancement: {
        byLevel: {
          3: [adv('ItemGrant', { id: 'crit', configuration: { items: [] } })],
          2: [adv('Subclass', { id: 'old', configuredForLevel: () => false })],
        },
      },
    });
    world.actors.add(actorWith(classItem(2, {}), champion));
    const out = await da.getLevelUpOptions({ identifier: 'Brienne' });
    expect(out.classes[0].nextLevelGrants).toEqual([
      expect.objectContaining({ advancementId: 'crit', source: 'Champion' }),
    ]);
    expect(out.classes[0].unfinishedAdvancement).toEqual([
      expect.objectContaining({ level: 2, source: 'Champion' }),
    ]);
  });

  it('reads the species advancement once at character level', async () => {
    const species = makeItem({
      name: 'Elf',
      type: 'race',
      advancement: { byLevel: { 4: [adv('ScaleValue', { id: 'sv', identifier: 'x' })] } },
    });
    world.actors.add(actorWith(classItem(3, {}), species));
    const out = await da.getLevelUpOptions({ identifier: 'Brienne' });
    expect(out.species).toMatchObject({ name: 'Elf' });
    expect(out.species?.unfinishedAdvancement).toEqual([]);
  });

  it('reports no next level at class level 20', async () => {
    world.actors.add(actorWith(classItem(20, {})));
    const out = await da.getLevelUpOptions({ identifier: 'Brienne' });
    expect(out.classes[0].nextLevel).toBeNull();
  });

  it('rejects an unknown character and an unknown class', async () => {
    await expect(da.getLevelUpOptions({ identifier: 'Nobody' })).rejects.toThrow(
      ERROR_MESSAGES.CHARACTER_NOT_FOUND
    );
    world.actors.add(actorWith(classItem(1, {})));
    await expect(
      da.getLevelUpOptions({ identifier: 'Brienne', className: 'bard' })
    ).rejects.toThrow(/no class "bard"/);
  });
});
