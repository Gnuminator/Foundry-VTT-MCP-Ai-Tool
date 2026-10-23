import { describe, expect, it, vi } from 'vitest';
import type { LiveTargetPreview } from '@gnuminator/shared';

import { RulesCheckTools, findActivityData, itemRangeLabel } from './rules-check.js';

const logger: any = {
  child: () => logger,
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

const resources = {
  success: true,
  actorId: 'a1',
  actorName: 'Ilvara',
  spellSlots: { level1: { current: 2, max: 4, expended: 2 } },
};
const spell = {
  success: true,
  entityType: 'item',
  entity: {
    id: 'i1',
    name: 'Magic Missile',
    type: 'spell',
    level: 1,
    activities: [
      { id: 'x', name: 'Cast', type: 'attack', activation: 'Action', range: '120 Feet' },
    ],
    system: {},
  },
};
const combat = {
  success: true,
  active: true,
  round: 1,
  turn: 0,
  current: { name: 'Ilvara' },
  combatants: [{ name: 'Ilvara', actorId: 'a1', isCurrentTurn: true }],
};

function tools(opts: {
  enabled?: boolean;
  entity?: unknown;
  combat?: unknown;
  distance?: unknown;
}): { t: RulesCheckTools; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async (method: string) => {
    switch (method) {
      case 'foundry-mcp-bridge.listGuardedFeatures':
        return [{ id: 'rules-check', enabled: opts.enabled ?? true }];
      case 'foundry-mcp-bridge.getCharacterResources':
        return resources;
      case 'foundry-mcp-bridge.getCharacterEntity':
        return opts.entity ?? spell;
      case 'foundry-mcp-bridge.getCombatState':
        return opts.combat ?? combat;
      case 'foundry-mcp-bridge.measureDistance':
        if (opts.distance instanceof Error) throw opts.distance;
        return opts.distance ?? { success: true, distance: 30, units: 'ft' };
      default:
        throw new Error(`unexpected ${method}`);
    }
  });
  return { t: new RulesCheckTools({ foundryClient: { query }, logger }), query };
}

describe('itemRangeLabel', () => {
  it('prefers the item range over the activity label and reads reach, self and touch', () => {
    expect(itemRangeLabel({ range: { value: 150, long: 600, units: 'ft' } })).toBe('150/600 ft');
    expect(itemRangeLabel({ range: { value: 120, units: 'ft' } })).toBe('120 ft');
    expect(itemRangeLabel({ range: { value: null, reach: 5, units: 'ft' } })).toBe('5 ft');
    expect(itemRangeLabel({ range: { units: 'self' } })).toBe('self');
    expect(itemRangeLabel({ range: { units: 'touch' } })).toBe('touch');
    expect(itemRangeLabel({})).toBeNull();
  });
});

describe('tryCheck', () => {
  it('returns the report when on, and null when off or when anything throws', async () => {
    const on = await tools({}).t.tryCheck({ actor: 'Ilvara', item: 'Magic Missile' });
    expect(on?.item).toBe('Magic Missile');
    expect(await tools({ enabled: false }).t.tryCheck({ actor: 'Ilvara', item: 'x' })).toBeNull();
    expect(await tools({}).t.tryCheck({})).toBeNull();
  });
});

describe('tryCheckMove', () => {
  const preview = (distance: number): LiveTargetPreview => ({
    target: 'Ilvara',
    actorUuid: 'u',
    line: 'x',
    move: { distance, units: 'ft', speed: 30, speedUnits: 'ft' },
  });

  it('pins the combatant by token id when several share a name', async () => {
    const zombies = {
      success: true,
      active: true,
      round: 1,
      current: { name: 'Zombie' },
      combatants: [
        { name: 'Zombie', tokenId: 't1', isCurrentTurn: true },
        { name: 'Zombie', tokenId: 't2', isCurrentTurn: false },
      ],
    };
    const mine = (id: string): LiveTargetPreview => ({
      ...preview(20),
      target: 'Zombie',
      actorUuid: `Scene.s1.Token.${id}`,
    });
    const t2 = await tools({ combat: zombies }).t.tryCheckMove([mine('t2')]);
    expect(t2?.checks[0]?.status).toBe('info');
    expect(t2?.checks[0]?.reason).toContain("Zombie's turn, not Zombie's");
    const t1 = await tools({ combat: zombies }).t.tryCheckMove([mine('t1')]);
    expect(t1?.checks[0]?.status).toBe('pass');
    // A token that is not in the fight gets no verdict, even if its name matches a combatant.
    expect(await tools({ combat: zombies }).t.tryCheckMove([mine('t9')])).toBeNull();
  });

  it('checks a planned move against speed in a fight; null when off, no move or no fight', async () => {
    expect((await tools({}).t.tryCheckMove([preview(65)]))?.verdict).toBe('problem');
    expect(await tools({ enabled: false }).t.tryCheckMove([preview(65)])).toBeNull();
    expect(await tools({}).t.tryCheckMove([{ target: 'a', actorUuid: 'u', line: 'x' }])).toBeNull();
    const idle = tools({ combat: { success: true, active: false } });
    expect(await idle.t.tryCheckMove([preview(65)])).toBeNull();
  });
});

describe('check-action', () => {
  it('takes the reach for a melee attack with a thrown weapon, and skips slots for innate spells', async () => {
    const dagger = {
      success: true,
      entityType: 'item',
      entity: {
        name: 'Dagger',
        type: 'weapon',
        activities: [{ id: 'a', name: 'Attack', activation: 'Action', range: '60 ft' }],
        system: {
          range: { value: 20, long: 60, reach: 5, units: 'ft' },
          activities: [{ _id: 'a', attack: { type: { value: 'melee' } } }],
        },
      },
    };
    const far = { success: true, distance: 30, units: 'ft' };
    const { t } = tools({ entity: dagger, distance: far });
    const r = await t.handleToolCall('check-action', {
      actor: 'Ilvara',
      item: 'Dagger',
      target: 'Z',
    });
    expect(r.checks.find(c => c.check === 'range')?.status).toBe('fail');

    const innate = {
      success: true,
      entityType: 'item',
      entity: {
        name: 'Misty Step',
        type: 'spell',
        level: 2,
        activities: [{ id: 'a', name: 'Cast', activation: 'Bonus Action' }],
        system: { method: 'innate' },
      },
    };
    const r2 = await tools({ entity: innate }).t.handleToolCall('check-action', {
      actor: 'Ilvara',
      item: 'Misty Step',
    });
    expect(r2.checks.find(c => c.check === 'slots')?.status).toBe('info');
  });

  it('fails an unprepared spell, but not one that never prepares or reports nothing', async () => {
    const spellWith = (system: Record<string, unknown>): unknown => ({
      success: true,
      entityType: 'item',
      entity: {
        name: 'Shield',
        type: 'spell',
        level: 1,
        activities: [{ id: 'a', name: 'Cast', activation: 'Reaction' }],
        system,
      },
    });
    const status = async (system: Record<string, unknown>): Promise<string | undefined> => {
      const r = await tools({ entity: spellWith(system) }).t.handleToolCall('check-action', {
        actor: 'Ilvara',
        item: 'Shield',
      });
      return r.checks.find(c => c.check === 'slots')?.status;
    };
    expect(await status({ method: 'spell', prepared: 0 })).toBe('fail');
    expect(await status({ method: 'spell', prepared: 1 })).toBe('pass');
    expect(await status({ method: 'spell', prepared: 2 })).toBe('pass');
    expect(await status({ method: 'innate', prepared: 0 })).toBe('info');
    expect(await status({})).toBe('pass');
  });

  it('does not trust the slots of an NPC, which may live on its token', async () => {
    const npcSpell = {
      ...spell,
      entity: { ...spell.entity, system: { method: 'spell', prepared: 0 } },
    };
    const query = vi.fn(async (method: string, args?: Record<string, unknown>) => {
      // The module reads characterName or characterId only; anything else throws like the real query.
      if (method === 'foundry-mcp-bridge.getCharacterInfo') {
        if (!args?.characterName && !args?.characterId) {
          throw new Error('characterName or characterId is required');
        }
        return { type: 'npc' };
      }
      if (method === 'foundry-mcp-bridge.listGuardedFeatures') {
        return [{ id: 'rules-check', enabled: true }];
      }
      if (method === 'foundry-mcp-bridge.getCharacterResources') return resources;
      if (method === 'foundry-mcp-bridge.getCharacterEntity') return npcSpell;
      return combat;
    });
    const t = new RulesCheckTools({ foundryClient: { query }, logger });
    const r = await t.handleToolCall('check-action', { actor: 'Ilvara', item: 'Magic Missile' });
    // An NPC's prepared 0 is not "unprepared", and its slots are not trusted.
    const slots = r.checks.find(c => c.check === 'slots');
    expect(slots?.status).toBe('unknown');
    expect(slots?.reason).not.toMatch(/not prepared/);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getCharacterInfo', {
      characterName: 'a1',
    });
  });

  it('finds an activity in a map by id as well as in an array', () => {
    expect(findActivityData({ a: { x: 1 } }, 'a')).toEqual({ x: 1 });
    expect(findActivityData([{ _id: 'a', x: 2 }], 'a')).toEqual({ _id: 'a', x: 2 });
    expect(findActivityData([], 'a')).toEqual({});
    expect(findActivityData({ a: {} }, undefined)).toEqual({});
  });

  it('cannot tell the turn when unlinked tokens share the actor', async () => {
    const twins = {
      ...combat,
      combatants: [
        { name: 'Wolf 1', actorId: 'a1', isCurrentTurn: true },
        { name: 'Wolf 2', actorId: 'a1', isCurrentTurn: false },
      ],
    };
    const r = await tools({ combat: twins }).t.handleToolCall('check-action', {
      actor: 'Ilvara',
      item: 'Magic Missile',
    });
    expect(r.checks[0]?.status).toBe('unknown');
  });

  it('warns between normal and long range of a bow', async () => {
    const bow = {
      success: true,
      entityType: 'item',
      entity: {
        name: 'Longbow',
        type: 'weapon',
        activities: [{ id: 'a', name: 'Shoot', activation: 'Action', range: '600 ft' }],
        system: { range: { value: 150, long: 600, units: 'ft' } },
      },
    };
    const { t } = tools({ entity: bow, distance: { success: true, distance: 300, units: 'ft' } });
    const r = await t.handleToolCall('check-action', {
      actor: 'Ilvara',
      item: 'Longbow',
      target: 'Z',
    });
    expect(r.checks.find(c => c.check === 'range')?.status).toBe('warn');
  });

  it('is one read-only tool', () => {
    const defs = tools({}).t.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['check-action']);
    expect(defs[0]?.description).toMatch(/off by default/);
  });

  it('refuses while the switch is off and reads nothing else', async () => {
    const { t, query } = tools({ enabled: false });
    await expect(t.handleToolCall('check-action', { actor: 'Ilvara', item: 'x' })).rejects.toThrow(
      /switched off/
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reports a legal cast with slots, range and turn', async () => {
    const { t } = tools({});
    const r = await t.handleToolCall('check-action', {
      actor: 'Ilvara',
      item: 'Magic Missile',
      target: 'Zombie',
    });
    expect(r.verdict).toBe('legal');
    expect(r.checks.map(c => c.check)).toEqual(['turn', 'action-cost', 'range', 'slots']);
    expect(r.checks.find(c => c.check === 'slots')?.reason).toMatch(/2 of 4/);
  });

  it('measures from the combatant token name', async () => {
    const named = {
      ...combat,
      combatants: [{ name: 'Ilvara (token)', actorId: 'a1', isCurrentTurn: true }],
    };
    const { t, query } = tools({ combat: named });
    await t.handleToolCall('check-action', {
      actor: 'Ilvara',
      item: 'Magic Missile',
      target: 'Zombie',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.measureDistance', {
      fromTokenName: 'Ilvara (token)',
      toTokenName: 'Zombie',
    });
  });

  it('keeps going with unknown range when the distance cannot be measured', async () => {
    const { t } = tools({ distance: new Error('no such token') });
    const r = await t.handleToolCall('check-action', {
      actor: 'Ilvara',
      item: 'Magic Missile',
      target: 'Ghost',
    });
    expect(r.checks.find(c => c.check === 'range')?.status).toBe('unknown');
    expect(r.verdict).toBe('unclear');
  });

  it('treats a scene measured in metres as unmeasurable', async () => {
    const { t } = tools({ distance: { success: true, distance: 9, units: 'm' } });
    const r = await t.handleToolCall('check-action', {
      actor: 'Ilvara',
      item: 'Magic Missile',
      target: 'Z',
    });
    expect(r.checks.find(c => c.check === 'range')?.reason).toMatch(/not feet/);
  });

  it('works without a running combat', async () => {
    const { t } = tools({ combat: { success: true, active: false } });
    const r = await t.handleToolCall('check-action', { actor: 'Ilvara', item: 'Magic Missile' });
    expect(r.checks[0]?.status).toBe('info');
  });

  it('names the activities when the requested one is missing', async () => {
    const { t } = tools({});
    await expect(
      t.handleToolCall('check-action', { actor: 'Ilvara', item: 'Magic Missile', activity: 'Nope' })
    ).rejects.toThrow(/has no activity "Nope".*Cast/);
  });

  it('warns when the actor already concentrates and the spell needs it', async () => {
    const entity = JSON.parse(JSON.stringify(spell));
    entity.entity.system = { properties: ['concentration'] };
    const { t, query } = tools({ entity });
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (m: string, a?: unknown) =>
      m === 'foundry-mcp-bridge.getCharacterResources'
        ? { ...resources, concentration: { active: true, spell: 'Bless' } }
        : original(m, a)
    );
    const r = await t.handleToolCall('check-action', { actor: 'Ilvara', item: 'Magic Missile' });
    expect(r.checks.find(c => c.check === 'concentration')?.status).toBe('warn');
  });

  it('refuses an effect', async () => {
    const { t } = tools({
      entity: { success: true, entityType: 'effect', entity: { name: 'Bless' } },
    });
    await expect(
      t.handleToolCall('check-action', { actor: 'Ilvara', item: 'Bless' })
    ).rejects.toThrow(/effect/);
  });
});
