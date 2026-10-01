/**
 * Unit tests for the live play plans (F5): `planLiveChange` turns one
 * `plan-actor-change` request into guarded ops. Nothing is written; these tests
 * pin the ops and the preview lines, and that the damage dry run writes nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_PLAN_QUERY, LIVE_PLAY_FEATURE_ID, planLiveChange } from './live-plan.js';
import {
  LIVE_PLAN_QUERY as SHARED_QUERY,
  LIVE_PLAY_FEATURE_ID as SHARED_FEATURE,
} from '../../../shared/src/live-play.js';
import {
  createTestWorld,
  makeEffect,
  makeItem,
  makeToken,
  type TestWorld,
} from './test-support/foundry-mock/index.js';

let world: TestWorld;
let restore: () => void;
let hooks: HooksStub;

const g = globalThis as any;

interface HooksStub {
  /** Number of handlers still registered under a hook name. */
  count: (name: string) => number;
}

/**
 * The mock's `Hooks.call` ignores return values and `Hooks.off` is a no-op, so tests that run
 * the damage dry run install this small stub: `call` stops and returns false when a handler does.
 */
function installHooksStub(): HooksStub {
  const handlers = new Map<string, Array<{ id: number; fn: (...args: any[]) => unknown }>>();
  let seq = 0;
  g.Hooks = {
    on: (name: string, fn: (...args: any[]) => unknown): number => {
      const id = (seq += 1);
      handlers.set(name, [...(handlers.get(name) ?? []), { id, fn }]);
      return id;
    },
    off: (name: string, id: number): void => {
      handlers.set(
        name,
        (handlers.get(name) ?? []).filter(h => h.id !== id)
      );
    },
    call: (name: string, ...args: any[]): boolean => {
      for (const h of [...(handlers.get(name) ?? [])]) {
        if (h.fn(...args) === false) return false;
      }
      return true;
    },
  };
  return { count: name => (handlers.get(name) ?? []).length };
}

const STATUS_EFFECTS = {
  prone: { _id: 'dnd5eprone000000', name: 'Prone', img: 'prone.svg' },
  poisoned: { _id: 'dnd5epoisoned000', name: 'Poisoned', img: 'poisoned.svg' },
  unconscious: {
    _id: 'dnd5eunconscious',
    name: 'Unconscious',
    img: 'unconscious.svg',
    riders: ['prone'],
  },
  coverHalf: {
    _id: 'dnd5ecoverHalf00',
    name: 'Half Cover',
    img: 'half.svg',
    exclusiveGroup: 'cover',
  },
  coverThreeQuarters: {
    _id: 'dnd5ecoverThreeQ',
    name: 'Three-Quarters Cover',
    img: 'threeq.svg',
    exclusiveGroup: 'cover',
  },
  exhaustion: { _id: 'dnd5eexhaustion0', name: 'Exhaustion', img: 'exh.svg', levels: 6 },
};

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
  hooks = installHooksStub();
  g.CONFIG.statusEffects = structuredClone(STATUS_EFFECTS);
  g.CONFIG.DND5E = { damageTypes: { fire: { label: 'Fire' }, slashing: { label: 'Slashing' } } };
});

afterEach(() => {
  restore();
});

interface FakeActorOptions {
  id: string;
  name: string;
  hp?: { value: number; max: number; temp?: number } | null;
  statuses?: string[];
  effects?: any[];
  items?: any[];
  system?: Record<string, any>;
  /** A damage type this actor resists (halved). */
  resists?: string;
  uuid?: string;
}

/**
 * An actor with a fake `applyDamage` that mimics dnd5e 6.0.5: it computes the updates, calls
 * `dnd5e.preApplyDamage` and only writes when no hook returned false.
 */
function addActor(opts: FakeActorOptions): any {
  const system: Record<string, any> = { ...opts.system };
  if (opts.hp !== null) {
    system.attributes = {
      ...system.attributes,
      hp: { temp: 0, ...(opts.hp ?? { value: 10, max: 10 }) },
    };
  }
  const actor: any = world.addActor({
    id: opts.id,
    name: opts.name,
    type: 'npc',
    uuid: opts.uuid ?? `Actor.${opts.id}`,
    system,
    effects: opts.effects ?? [],
    items: opts.items ?? [],
    statuses: new Set(opts.statuses ?? []),
  });
  actor.writes = 0;
  actor.applyOptions = [] as any[];
  actor.applyDamage = (damages: any[], options: Record<string, any> = {}): Promise<any> => {
    actor.applyOptions.push(options);
    const hp = actor.system.attributes.hp;
    let amount = 0;
    for (const d of damages) {
      if (d.type === 'healing') amount -= d.value;
      else amount += d.type === opts.resists ? Math.floor(d.value / 2) : d.value;
    }
    if (typeof options.multiplier === 'number') amount = Math.floor(amount * options.multiplier);
    // Like dnd5e: temp HP soak up damage first; healing never touches them.
    const temp = hp.temp ?? 0;
    const absorbed = Math.min(Math.max(amount, 0), temp);
    const updates = {
      'system.attributes.hp.value': Math.min(Math.max(hp.value - (amount - absorbed), 0), hp.max),
      'system.attributes.hp.temp': temp - absorbed,
    };
    if (g.Hooks.call('dnd5e.preApplyDamage', actor, amount, updates, options) === false) {
      return Promise.resolve(actor);
    }
    actor.writes += 1;
    hp.value = updates['system.attributes.hp.value'];
    return Promise.resolve(actor);
  };
  return actor;
}

function effect(
  id: string,
  name: string,
  statuses: string[],
  extra: Record<string, any> = {}
): any {
  return makeEffect({ id, name, uuid: `Actor.a1.ActiveEffect.${id}`, statuses, ...extra });
}

const hpRequest = (extra: Record<string, unknown>): Record<string, unknown> => ({
  scope: 'actor',
  targets: ['Wolf'],
  ...extra,
});

describe('wire contract', () => {
  it('mirrors the shared constants', () => {
    expect(LIVE_PLAN_QUERY).toBe(SHARED_QUERY);
    expect(LIVE_PLAY_FEATURE_ID).toBe(SHARED_FEATURE);
  });
});

describe('request checks', () => {
  it('refuses another game system', async () => {
    g.game.system.id = 'pf2e';
    addActor({ id: 'a1', name: 'Wolf' });
    await expect(planLiveChange(hpRequest({ action: 'damage', amount: 1 }))).rejects.toThrow(
      /need the dnd5e game system/
    );
  });

  it('refuses an unknown scope and an unknown action', async () => {
    addActor({ id: 'a1', name: 'Wolf' });
    await expect(planLiveChange({ scope: 'party', targets: ['Wolf'] })).rejects.toThrow(
      /Unknown live change scope/
    );
    await expect(planLiveChange(hpRequest({ action: 'explode' }))).rejects.toThrow(
      /Unknown action "explode"/
    );
  });

  it('asks for at least one target', async () => {
    await expect(
      planLiveChange(hpRequest({ action: 'damage', amount: 1, targets: [] }))
    ).rejects.toThrow(/Name at least one target/);
  });
});

describe('target resolution', () => {
  it('throws for an unknown target and names it', async () => {
    addActor({ id: 'a1', name: 'Wolf' });
    await expect(
      planLiveChange(hpRequest({ action: 'damage', amount: 3, targets: ['Wolf', 'Ghost'] }))
    ).rejects.toThrow('No token on the current scene or actor named "Ghost"');
  });

  it('resolves an actor by id, exact name or a unique partial name', async () => {
    addActor({ id: 'a1', name: 'Grey Wolf', hp: { value: 10, max: 10 } });
    addActor({ id: 'a2', name: 'Dire Bear', hp: { value: 10, max: 10 } });
    for (const target of ['a1', 'grey wolf', 'wolf']) {
      const plan = await planLiveChange(
        hpRequest({ action: 'damage', amount: 3, targets: [target] })
      );
      expect(plan.targets[0]?.actorUuid).toBe('Actor.a1');
    }
  });

  it('does not guess between two partial matches', async () => {
    addActor({ id: 'a1', name: 'Grey Wolf' });
    addActor({ id: 'a2', name: 'Pack Wolf' });
    await expect(planLiveChange(hpRequest({ action: 'damage', amount: 3 }))).rejects.toThrow(
      /named "Wolf"/
    );
  });

  it('resolves an unlinked token to its own synthetic actor', async () => {
    const synthetic = addActor({
      id: 'a',
      name: 'Wolf',
      hp: { value: 11, max: 11 },
      uuid: 'Scene.s.Token.t.Actor.a',
    });
    // A synthetic actor is not a world actor: only the token reaches it.
    world.actors.delete('a');
    const scene = world.addScene({
      id: 's',
      name: 'Arena',
      active: true,
      tokens: [makeToken({ id: 't', name: 'Wolf 1', actor: synthetic })],
    });
    expect(scene.tokens.size).toBe(1);
    const plan = await planLiveChange(
      hpRequest({ action: 'damage', amount: 4, targets: ['Wolf 1'] })
    );
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        uuid: 'Scene.s.Token.t.Actor.a',
        changes: { 'system.attributes.hp.value': 7 },
      },
    ]);
    expect(plan.targets[0]).toMatchObject({
      target: 'Wolf 1',
      actorUuid: 'Scene.s.Token.t.Actor.a',
    });
    // By token id too.
    const byId = await planLiveChange(hpRequest({ action: 'damage', amount: 4, targets: ['t'] }));
    expect(byId.targets[0]?.target).toBe('Wolf 1');
  });

  it('plans one change when a token and its actor are both named', async () => {
    const actor = addActor({ id: 'a1', name: 'Wolf', hp: { value: 10, max: 10 } });
    world.addScene({
      id: 's',
      name: 'Arena',
      active: true,
      tokens: [makeToken({ id: 't', name: 'Wolf Token', actor })],
    });
    const plan = await planLiveChange(
      hpRequest({ action: 'damage', amount: 2, targets: ['Wolf Token', 'a1'] })
    );
    expect(plan.ops).toHaveLength(1);
  });
});

describe('damage and healing (dry run)', () => {
  it('plans only the changed hit point paths, preview line included, and writes nothing', async () => {
    const wolf = addActor({ id: 'a1', name: 'Wolf', hp: { value: 11, max: 11 }, resists: 'fire' });
    const plan = await planLiveChange(
      hpRequest({ action: 'damage', amount: 12, damageType: 'fire' })
    );
    expect(wolf.writes).toBe(0);
    expect(wolf.system.attributes.hp.value).toBe(11);
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1', changes: { 'system.attributes.hp.value': 5 } },
    ]);
    expect(plan.targets).toEqual([
      { target: 'Wolf', actorUuid: 'Actor.a1', line: 'Wolf: 12 fire damage, 6 taken, HP 11 to 5' },
    ]);
    expect(plan.summary).toBe('12 fire damage to Wolf');
    expect(wolf.applyOptions[0]).toMatchObject({ foundryMcpDryRun: expect.any(String) });
  });

  it('removes its hook after the dry run, so real damage afterwards is not captured', async () => {
    const wolf = addActor({ id: 'a1', name: 'Wolf', hp: { value: 10, max: 10 } });
    await planLiveChange(hpRequest({ action: 'damage', amount: 3 }));
    expect(hooks.count('dnd5e.preApplyDamage')).toBe(0);
    await wolf.applyDamage([{ value: 3, type: '' }]);
    expect(wolf.writes).toBe(1);
    expect(wolf.system.attributes.hp.value).toBe(7);
  });

  it('passes the multiplier and ignore flag on and shows a critical', async () => {
    const wolf = addActor({ id: 'a1', name: 'Wolf', hp: { value: 20, max: 20 } });
    const plan = await planLiveChange(
      hpRequest({
        action: 'damage',
        amount: 5,
        damageType: 'slashing',
        multiplier: 2,
        ignoreResistance: true,
      })
    );
    expect(wolf.applyOptions[0]).toMatchObject({ multiplier: 2, ignore: true });
    expect(plan.targets[0]?.line).toBe('Wolf: 5 slashing damage x2, 10 taken, HP 20 to 10');
  });

  it('leaves out an empty temp HP that dnd5e writes as 0 (null or missing becomes 0)', async () => {
    const wolf = addActor({ id: 'a1', name: 'Wolf', hp: { value: 10, max: 10 } });
    for (const empty of [null, undefined]) {
      wolf.system.attributes.hp.temp = empty;
      const plan = await planLiveChange(hpRequest({ action: 'damage', amount: 3 }));
      expect(plan.ops).toEqual([
        { kind: 'update', uuid: 'Actor.a1', changes: { 'system.attributes.hp.value': 7 } },
      ]);
    }
  });

  it('still plans a real change to 0 (temp HP used up)', async () => {
    addActor({ id: 'a1', name: 'Wolf', hp: { value: 10, max: 10, temp: 3 } });
    const plan = await planLiveChange(hpRequest({ action: 'damage', amount: 3 }));
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1', changes: { 'system.attributes.hp.temp': 0 } },
    ]);
    expect(plan.targets[0]?.line).toBe('Wolf: 3 damage, temp HP 3 to 0');
  });

  it('plans healing and says what it heals', async () => {
    addActor({ id: 'a1', name: 'Wolf', hp: { value: 4, max: 11 } });
    const plan = await planLiveChange(hpRequest({ action: 'healing', amount: 5 }));
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1', changes: { 'system.attributes.hp.value': 9 } },
    ]);
    expect(plan.targets[0]?.line).toBe('Wolf: heals 5, HP 4 to 9');
    expect(plan.summary).toBe('Heal Wolf by 5');
  });

  it('skips healing at full HP, and a plan with no ops throws "Nothing to change"', async () => {
    addActor({ id: 'a1', name: 'Wolf', hp: { value: 11, max: 11 } });
    await expect(planLiveChange(hpRequest({ action: 'healing', amount: 5 }))).rejects.toThrow(
      'Nothing to change: Wolf: heals 5, no change (at full HP)'
    );
  });

  it('keeps the other targets when one is skipped', async () => {
    addActor({ id: 'a1', name: 'Wolf', hp: { value: 11, max: 11 } });
    addActor({ id: 'a2', name: 'Bear', hp: { value: 3, max: 11 } });
    const plan = await planLiveChange(
      hpRequest({ action: 'healing', amount: 5, targets: ['Wolf', 'Bear'] })
    );
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({ uuid: 'Actor.a2' });
    expect(plan.targets.map(t => [t.target, t.skipped === true])).toEqual([
      ['Wolf', true],
      ['Bear', false],
    ]);
  });

  it('gives a skipped preview when another hook cancels the damage first', async () => {
    addActor({ id: 'a1', name: 'Wolf', hp: { value: 10, max: 10 } });
    const bear = addActor({ id: 'a2', name: 'Bear', hp: { value: 10, max: 10 } });
    // Registered before the dry run, so it runs first and stops the hook chain.
    g.Hooks.on('dnd5e.preApplyDamage', (actor: any) => (actor.id === 'a2' ? false : undefined));
    const plan = await planLiveChange(
      hpRequest({ action: 'damage', amount: 4, targets: ['Wolf', 'Bear'] })
    );
    expect(plan.ops).toHaveLength(1);
    expect(plan.targets[1]).toEqual({
      target: 'Bear',
      actorUuid: 'Actor.a2',
      line: 'Bear: dnd5e or another module cancelled the damage',
      skipped: true,
    });
    expect(bear.writes).toBe(0);
    expect(hooks.count('dnd5e.preApplyDamage')).toBe(1);
  });

  it('skips an actor without hit points', async () => {
    addActor({ id: 'a1', name: 'Wolf', hp: { value: 10, max: 10 } });
    addActor({ id: 'a2', name: 'Statue', hp: null });
    const plan = await planLiveChange(
      hpRequest({ action: 'damage', amount: 4, targets: ['Wolf', 'Statue'] })
    );
    expect(plan.targets[1]).toMatchObject({ line: 'Statue: has no hit points', skipped: true });
  });

  it('refuses a negative amount and an actor that cannot take damage', async () => {
    const wolf = addActor({ id: 'a1', name: 'Wolf' });
    await expect(planLiveChange(hpRequest({ action: 'damage', amount: -1 }))).rejects.toThrow(
      /amount of 0 or more/
    );
    delete wolf.applyDamage;
    await expect(planLiveChange(hpRequest({ action: 'damage', amount: 1 }))).rejects.toThrow(
      /Wolf cannot take damage/
    );
  });
});

describe('temp-hp', () => {
  it('sets temp HP when higher than the current ones', async () => {
    addActor({ id: 'a1', name: 'Wolf', hp: { value: 10, max: 10, temp: 2 } });
    const plan = await planLiveChange(hpRequest({ action: 'temp-hp', amount: 8 }));
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1', changes: { 'system.attributes.hp.temp': 8 } },
    ]);
    expect(plan.targets[0]?.line).toBe('Wolf: 8 temp HP, temp HP 2 to 8');
    expect(plan.summary).toBe('8 temp HP for Wolf');
  });

  it('skips temp HP that would not be higher', async () => {
    addActor({ id: 'a1', name: 'Wolf', hp: { value: 10, max: 10, temp: 8 } });
    await expect(planLiveChange(hpRequest({ action: 'temp-hp', amount: 5 }))).rejects.toThrow(
      /Nothing to change: Wolf: already has 8 temp HP \(temp HP do not stack\)/
    );
  });
});

describe('condition on', () => {
  it('creates the status effect with its id kept', async () => {
    addActor({ id: 'a1', name: 'Wolf' });
    const plan = await planLiveChange(hpRequest({ action: 'condition', condition: 'poisoned' }));
    expect(plan.ops).toEqual([
      {
        kind: 'create',
        documentName: 'ActiveEffect',
        parentUuid: 'Actor.a1',
        data: {
          name: 'Poisoned',
          img: 'poisoned.svg',
          statuses: ['poisoned'],
          _id: 'dnd5epoisoned000',
        },
        keepId: true,
      },
    ]);
    expect(plan.targets[0]?.line).toBe('Wolf: Poisoned');
    expect(plan.summary).toBe('Poisoned on Wolf');
  });

  it('finds a condition by name', async () => {
    addActor({ id: 'a1', name: 'Wolf' });
    const plan = await planLiveChange(hpRequest({ action: 'condition', condition: 'Half Cover' }));
    expect(plan.ops[0]).toMatchObject({ data: { statuses: ['coverHalf'] } });
  });

  it('uses dnd5e fromStatusEffect when it exists', async () => {
    addActor({ id: 'a1', name: 'Wolf' });
    const fromStatusEffect = vi.fn((id: string) =>
      Promise.resolve({
        toObject: (): object => ({ _id: 'kept', name: id, statuses: [id], type: 'condition' }),
      })
    );
    g.CONFIG.ActiveEffect = { documentClass: { fromStatusEffect } };
    const plan = await planLiveChange(hpRequest({ action: 'condition', condition: 'prone' }));
    expect(fromStatusEffect).toHaveBeenCalledWith('prone');
    expect(plan.ops[0]).toMatchObject({
      data: { _id: 'kept', type: 'condition', statuses: ['prone'] },
      keepId: true,
    });
  });

  it('creates a missing rider first (Unconscious brings Prone)', async () => {
    addActor({ id: 'a1', name: 'Wolf' });
    const plan = await planLiveChange(hpRequest({ action: 'condition', condition: 'unconscious' }));
    expect(plan.ops.map(o => (o as any).data.statuses)).toEqual([['prone'], ['unconscious']]);
    expect(plan.ops.every(o => (o as any).keepId === true)).toBe(true);
    expect(plan.targets[0]?.line).toBe('Wolf: Unconscious (adds Prone)');
  });

  it('does not create a rider the actor already has', async () => {
    addActor({ id: 'a1', name: 'Wolf', statuses: ['prone'] });
    const plan = await planLiveChange(hpRequest({ action: 'condition', condition: 'unconscious' }));
    expect(plan.ops).toHaveLength(1);
    expect(plan.targets[0]?.line).toBe('Wolf: Unconscious');
  });

  it('deletes the other effect of an exclusive group (cover) before the create', async () => {
    addActor({
      id: 'a1',
      name: 'Wolf',
      effects: [effect('e9', 'Three-Quarters Cover', ['coverThreeQuarters'])],
    });
    const plan = await planLiveChange(hpRequest({ action: 'condition', condition: 'coverHalf' }));
    expect(plan.ops.map(o => o.kind)).toEqual(['delete', 'create']);
    expect(plan.ops[0]).toEqual({ kind: 'delete', uuid: 'Actor.a1.ActiveEffect.e9' });
    expect(plan.targets[0]?.line).toBe('Wolf: Half Cover (removes Three-Quarters Cover)');
  });

  it('skips a condition the actor already has', async () => {
    addActor({ id: 'a1', name: 'Wolf', statuses: ['poisoned'] });
    await expect(
      planLiveChange(hpRequest({ action: 'condition', condition: 'poisoned' }))
    ).rejects.toThrow('Nothing to change: Wolf: is already Poisoned');
  });

  it('rejects an unknown condition and a missing one', async () => {
    addActor({ id: 'a1', name: 'Wolf' });
    await expect(
      planLiveChange(hpRequest({ action: 'condition', condition: 'sparkly' }))
    ).rejects.toThrow(/Unknown condition "sparkly"\. Known: .*poisoned/);
    await expect(planLiveChange(hpRequest({ action: 'condition' }))).rejects.toThrow(
      /Name the condition/
    );
  });
});

describe('condition off', () => {
  it('deletes the effects that carry the status', async () => {
    addActor({
      id: 'a1',
      name: 'Wolf',
      effects: [
        effect('e1', 'Poisoned', ['poisoned']),
        effect('e2', 'Poisoned (spell)', ['poisoned']),
        effect('e3', 'Blessed', []),
      ],
    });
    const plan = await planLiveChange(
      hpRequest({ action: 'condition', condition: 'poisoned', active: false })
    );
    expect(plan.ops).toEqual([
      { kind: 'delete', uuid: 'Actor.a1.ActiveEffect.e1' },
      { kind: 'delete', uuid: 'Actor.a1.ActiveEffect.e2' },
    ]);
    expect(plan.targets[0]?.line).toBe('Wolf: remove Poisoned');
    expect(plan.summary).toBe('Remove Poisoned from Wolf');
  });

  it('skips an actor without the condition', async () => {
    addActor({ id: 'a1', name: 'Wolf' });
    await expect(
      planLiveChange(hpRequest({ action: 'condition', condition: 'poisoned', active: false }))
    ).rejects.toThrow('Nothing to change: Wolf: is not Poisoned');
  });
});

describe('exhaustion levels', () => {
  const exhaustionOf = (level: number): Record<string, unknown> => ({
    attributes: { exhaustion: level },
  });

  it('goes one up by default, as an update of the level', async () => {
    addActor({ id: 'a1', name: 'Wolf', system: exhaustionOf(1) });
    const plan = await planLiveChange(hpRequest({ action: 'condition', condition: 'exhaustion' }));
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1', changes: { 'system.attributes.exhaustion': 2 } },
    ]);
    expect(plan.targets[0]?.line).toBe('Wolf: Exhaustion 1 to 2');
  });

  it('sets an explicit level, and removes it with active false', async () => {
    addActor({ id: 'a1', name: 'Wolf', system: exhaustionOf(1) });
    const set = await planLiveChange(
      hpRequest({ action: 'condition', condition: 'exhaustion', level: 4 })
    );
    expect(set.ops[0]).toMatchObject({ changes: { 'system.attributes.exhaustion': 4 } });
    const off = await planLiveChange(
      hpRequest({ action: 'condition', condition: 'exhaustion', active: false })
    );
    expect(off.ops[0]).toMatchObject({ changes: { 'system.attributes.exhaustion': 0 } });
    expect(off.summary).toBe('Remove Exhaustion from Wolf');
  });

  it('caps the level at 6 and skips an unchanged one', async () => {
    addActor({ id: 'a1', name: 'Wolf', system: exhaustionOf(6) });
    await expect(
      planLiveChange(hpRequest({ action: 'condition', condition: 'exhaustion' }))
    ).rejects.toThrow('Nothing to change: Wolf: Exhaustion is already 6');
  });

  it('skips an actor without an exhaustion level', async () => {
    addActor({ id: 'a1', name: 'Wolf' });
    await expect(
      planLiveChange(hpRequest({ action: 'condition', condition: 'exhaustion' }))
    ).rejects.toThrow(/Wolf: has no Exhaustion level/);
  });
});

describe('clear-conditions', () => {
  it('removes effects by name', async () => {
    addActor({
      id: 'a1',
      name: 'Wolf',
      effects: [effect('e1', 'Poisoned', []), effect('e2', 'Blessed', [])],
    });
    const plan = await planLiveChange(
      hpRequest({ action: 'clear-conditions', conditions: ['poisoned'] })
    );
    expect(plan.ops).toEqual([{ kind: 'delete', uuid: 'Actor.a1.ActiveEffect.e1' }]);
    expect(plan.targets[0]?.line).toBe('Wolf: remove Poisoned');
    expect(plan.summary).toBe('Clear poisoned on Wolf');
  });

  it('matches effects by status id as well', async () => {
    addActor({
      id: 'a1',
      name: 'Wolf',
      effects: [effect('e1', 'Knocked down', ['prone']), effect('e2', 'Blessed', [])],
    });
    const plan = await planLiveChange(
      hpRequest({ action: 'clear-conditions', conditions: ['Prone'] })
    );
    expect(plan.ops).toEqual([{ kind: 'delete', uuid: 'Actor.a1.ActiveEffect.e1' }]);
  });

  it('removes only expired effects when no names are given', async () => {
    addActor({
      id: 'a1',
      name: 'Wolf',
      effects: [
        effect('e1', 'Flag expired', [], { expired: true }),
        effect('e2', 'Ran out', [], { duration: { remaining: 0 } }),
        effect('e3', 'Still going', [], { duration: { remaining: 3 } }),
        effect('e4', 'No timer', []),
      ],
    });
    const plan = await planLiveChange(hpRequest({ action: 'clear-conditions' }));
    expect(plan.ops).toEqual([
      { kind: 'delete', uuid: 'Actor.a1.ActiveEffect.e1' },
      { kind: 'delete', uuid: 'Actor.a1.ActiveEffect.e2' },
    ]);
    expect(plan.summary).toBe('Clear expired effects on Wolf');
  });

  it('says so when there is nothing to remove', async () => {
    addActor({ id: 'a1', name: 'Wolf', effects: [effect('e4', 'No timer', [])] });
    await expect(planLiveChange(hpRequest({ action: 'clear-conditions' }))).rejects.toThrow(
      'Nothing to change: Wolf: nothing to remove (no expired effects)'
    );
  });
});

describe('resource', () => {
  it('sets spell slots by level keyword', async () => {
    addActor({
      id: 'a1',
      name: 'Mira',
      system: { spells: { spell3: { value: 3, max: 3 } } },
    });
    const plan = await planLiveChange(
      hpRequest({ action: 'resource', resource: 'spell3', value: 1, targets: ['Mira'] })
    );
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1', changes: { 'system.spells.spell3.value': 1 } },
    ]);
    expect(plan.targets[0]?.line).toBe('Mira: level 3 spell slots 3 to 1 of 3');
    expect(plan.summary).toBe('Set level 3 spell slots to 1 for Mira');
  });

  it('reads "level 3" and "3rd" as spell3, and pact slots', async () => {
    addActor({
      id: 'a1',
      name: 'Mira',
      system: { spells: { spell3: { value: 3, max: 3 }, pact: { value: 2, max: 2 } } },
    });
    for (const resource of ['level 3', '3rd']) {
      const plan = await planLiveChange(
        hpRequest({ action: 'resource', resource, value: 0, targets: ['Mira'] })
      );
      expect(plan.ops[0]).toMatchObject({ changes: { 'system.spells.spell3.value': 0 } });
    }
    const pact = await planLiveChange(
      hpRequest({ action: 'resource', resource: 'pact', value: 1, targets: ['Mira'] })
    );
    expect(pact.ops[0]).toMatchObject({ changes: { 'system.spells.pact.value': 1 } });
  });

  it('sets a class resource found by its label, case-insensitive', async () => {
    addActor({
      id: 'a1',
      name: 'Paldin',
      system: { resources: { primary: { label: 'Channel Divinity', value: 2, max: 3 } } },
    });
    const plan = await planLiveChange(
      hpRequest({ action: 'resource', resource: 'channel divinity', value: 1, targets: ['Paldin'] })
    );
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1', changes: { 'system.resources.primary.value': 1 } },
    ]);
    expect(plan.targets[0]?.line).toBe('Paldin: Channel Divinity 2 to 1 of 3');
  });

  it('writes item uses through spent (dnd5e 3+), on the item', async () => {
    const wand = makeItem({
      id: 'i1',
      name: 'Wand of Magic',
      uuid: 'Actor.a1.Item.i1',
      system: { uses: { spent: 0, max: 7, value: 7 } },
    });
    addActor({ id: 'a1', name: 'Zana', items: [wand] });
    const plan = await planLiveChange(
      hpRequest({ action: 'resource', resource: 'wand of magic', value: 5, targets: ['Zana'] })
    );
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1.Item.i1', changes: { 'system.uses.spent': 2 } },
    ]);
    expect(plan.targets[0]?.line).toBe('Zana: Wand of Magic uses 7 to 5 of 7');
  });

  it('writes uses.value when the item has no spent', async () => {
    const potion = makeItem({
      id: 'i2',
      name: 'Healing Potion',
      uuid: 'Actor.a1.Item.i2',
      system: { uses: { value: 3, max: 3 } },
    });
    addActor({ id: 'a1', name: 'Bront', items: [potion] });
    const plan = await planLiveChange(
      hpRequest({ action: 'resource', resource: 'potion', value: 1, targets: ['Bront'] })
    );
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1.Item.i2', changes: { 'system.uses.value': 1 } },
    ]);
  });

  it('skips a value that is already set', async () => {
    addActor({ id: 'a1', name: 'Mira', system: { spells: { spell1: { value: 2, max: 4 } } } });
    await expect(
      planLiveChange(
        hpRequest({ action: 'resource', resource: 'spell1', value: 2, targets: ['Mira'] })
      )
    ).rejects.toThrow('Nothing to change: Mira: level 1 spell slots already 2 of 4');
  });

  it('throws for a value above the maximum, an unknown resource and a bad value', async () => {
    addActor({ id: 'a1', name: 'Mira', system: { spells: { spell1: { value: 2, max: 2 } } } });
    await expect(
      planLiveChange(
        hpRequest({ action: 'resource', resource: 'spell1', value: 5, targets: ['Mira'] })
      )
    ).rejects.toThrow(/5 is more than the maximum 2 for "spell1" on Mira/);
    await expect(
      planLiveChange(
        hpRequest({ action: 'resource', resource: 'Nope', value: 1, targets: ['Mira'] })
      )
    ).rejects.toThrow(/No resource "Nope" on Mira/);
    await expect(
      planLiveChange(
        hpRequest({ action: 'resource', resource: 'spell2', value: 1, targets: ['Mira'] })
      )
    ).rejects.toThrow(/Mira has no level 2 spell slots/);
    await expect(
      planLiveChange(hpRequest({ action: 'resource', resource: 'spell1', targets: ['Mira'] }))
    ).rejects.toThrow(/whole number of 0 or more/);
    await expect(
      planLiveChange(hpRequest({ action: 'resource', value: 1, targets: ['Mira'] }))
    ).rejects.toThrow(/Name the resource/);
  });
});
