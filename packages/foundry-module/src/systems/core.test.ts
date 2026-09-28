/**
 * Tests for the Foundry core version adapter. Every shim is checked against a
 * v13-shaped and a v14-shaped fixture.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestWorld, type TestWorld } from '../test-support/foundry-mock/index.js';
import {
  coreBuild,
  coreGeneration,
  coreSupportsQuerySender,
  currentLevelId,
  effectChanges,
  effectDuration,
  effectImg,
  hasTypedActiveEffects,
  sceneBackgroundSrc,
  supportsMeasuredTemplates,
  unsetKeyUpdate,
} from './core.js';

let world: TestWorld;
let restore: () => void;
const g = globalThis as any;

beforeEach(() => {
  world = createTestWorld({ foundryVersion: '13.351' });
  restore = world.install();
});

afterEach(() => {
  restore();
  delete g._del;
  delete g.canvas;
});

/** A minimal collection with `get` and `contents`, like Foundry's. */
function collection<T extends { id: string }>(
  items: T[]
): { get: (id: string) => T | undefined; contents: T[] } {
  return { get: (id: string): T | undefined => items.find(i => i.id === id), contents: items };
}

describe('core generation and build', () => {
  it('reads game.release', () => {
    g.game.release = { generation: 14, build: 368 };
    expect(coreGeneration()).toBe(14);
    expect(coreBuild()).toBe(368);
  });

  it('falls back to the version string', () => {
    g.game.release = undefined;
    g.game.version = '14.360';
    expect(coreGeneration()).toBe(14);
    expect(coreBuild()).toBe(360);
  });

  it.each([
    [13, 351, false],
    [14, 351, false],
    [14, 352, true],
    [14, 368, true],
    [15, 1, true],
  ])('query sender on %i.%i: %s', (generation, build, expected) => {
    g.game.release = { generation, build };
    expect(coreSupportsQuerySender()).toBe(expected);
  });
});

describe('feature detection', () => {
  it('typed ActiveEffects only when foundry.data.ActiveEffectTypeDataModel exists', () => {
    expect(hasTypedActiveEffects()).toBe(false);
    g.foundry.data = { ActiveEffectTypeDataModel: class {} };
    expect(hasTypedActiveEffects()).toBe(true);
  });

  it('MeasuredTemplates: always on v13; on v14 only if BaseMeasuredTemplate still exists', () => {
    expect(supportsMeasuredTemplates()).toBe(true);
    g.game.release = { generation: 14, build: 368 };
    g.foundry.documents = {};
    expect(supportsMeasuredTemplates()).toBe(false);
    g.foundry.documents = { BaseMeasuredTemplate: class {} };
    expect(supportsMeasuredTemplates()).toBe(true);
  });

  it("measured templates: Scene's embedded types decide over the 14.368 compatibility shim", () => {
    const sceneWith = (...types: string[]): unknown =>
      class {
        static metadata = { embedded: Object.fromEntries(types.map(t => [t, `${t}s`])) };
      };
    g.game.release = { generation: 14, build: 368 };
    // Seen live on 14.368: the deprecated class still exists, the Scene cannot hold one.
    g.foundry.documents = {
      BaseMeasuredTemplate: class {},
      BaseScene: sceneWith('Note', 'Region', 'Level', 'Token'),
    };
    expect(supportsMeasuredTemplates()).toBe(false);
    g.game.release = { generation: 13, build: 351 };
    g.foundry.documents = {
      BaseMeasuredTemplate: class {},
      BaseScene: sceneWith('MeasuredTemplate', 'Note', 'Token'),
    };
    expect(supportsMeasuredTemplates()).toBe(true);
  });
});

describe('scene levels and background', () => {
  it('v13 scene: no level, background from background.src', () => {
    const scene: any = { id: 's1', background: { src: 'maps/barovia.webp' }, _source: {} };
    expect(currentLevelId(scene)).toBeUndefined();
    expect(sceneBackgroundSrc(scene)).toBe('maps/barovia.webp');
  });

  it('v14 scene: the viewed level when the canvas shows this scene', () => {
    const levels = collection([
      { id: 'defaultLevel0000', background: { src: 'ground.webp' } },
      { id: 'upperLevel000000', background: { src: 'upper.webp' } },
    ]);
    const scene: any = { id: 's1', levels, initialLevel: 'defaultLevel0000', _source: {} };
    g.canvas = { scene: { id: 's1' }, level: { id: 'upperLevel000000' } };
    expect(currentLevelId(scene)).toBe('upperLevel000000');
    expect(sceneBackgroundSrc(scene)).toBe('upper.webp');
  });

  it('v14 scene not on the canvas: the initial level (id or document), else the first', () => {
    const levels = collection([{ id: 'defaultLevel0000', background: { src: 'ground.webp' } }]);
    g.canvas = { scene: { id: 'other' }, level: { id: 'x' } };
    expect(currentLevelId({ id: 's1', levels, initialLevel: 'defaultLevel0000' } as any)).toBe(
      'defaultLevel0000'
    );
    expect(
      currentLevelId({ id: 's1', levels, initialLevel: { id: 'defaultLevel0000' } } as any)
    ).toBe('defaultLevel0000');
    expect(currentLevelId({ id: 's1', levels, initialLevel: null } as any)).toBe(
      'defaultLevel0000'
    );
  });
});

describe('unsetKeyUpdate', () => {
  it('v13: parent.-=key', () => {
    expect(unsetKeyUpdate('flags.foundry-mcp-bridge.rules')).toEqual({
      'flags.foundry-mcp-bridge.-=rules': null,
    });
    expect(unsetKeyUpdate('top')).toEqual({ '-=top': null });
  });

  it('v14: the _del ForcedDeletion marker', () => {
    const marker = Symbol('ForcedDeletion');
    g._del = marker;
    expect(unsetKeyUpdate('flags.foundry-mcp-bridge.rules')).toEqual({
      'flags.foundry-mcp-bridge.rules': marker,
    });
  });
});

describe('ActiveEffect shape', () => {
  it('v13 changes (numeric mode) map to v14 types', () => {
    const effect: any = {
      changes: [
        { key: 'system.abilities.wis.bonuses.save', mode: 2, value: '-1', priority: 20 },
        { key: 'system.attributes.ac.bonus', mode: 5, value: '15' },
        { key: 'x', mode: 99, value: 1 },
      ],
      duration: {},
    };
    expect(effectChanges(effect)).toEqual([
      { key: 'system.abilities.wis.bonuses.save', type: 'add', value: '-1', priority: 20 },
      { key: 'system.attributes.ac.bonus', type: 'override', value: '15' },
      { key: 'x', type: 'custom', value: 1 },
    ]);
  });

  it('v14 changes come from system.changes (string type, phase)', () => {
    const effect: any = {
      system: {
        changes: [
          {
            key: 'system.abilities.wis.save.roll.bonus',
            type: 'add',
            value: '-1',
            phase: 'initial',
          },
        ],
      },
      changes: [{ key: 'stale', mode: 2, value: 0 }],
      duration: {},
    };
    expect(effectChanges(effect)).toEqual([
      { key: 'system.abilities.wis.save.roll.bonus', type: 'add', value: '-1', phase: 'initial' },
    ]);
  });

  it('v13 duration: rounds, turns, seconds, permanent, expired by remaining', () => {
    expect(effectDuration({ duration: { rounds: 10, remaining: 3 } } as any)).toEqual({
      value: 10,
      units: 'rounds',
      expired: false,
    });
    expect(effectDuration({ duration: { turns: 2 } } as any)).toMatchObject({ units: 'turns' });
    expect(effectDuration({ duration: { seconds: 60 } } as any)).toMatchObject({
      value: 60,
      units: 'seconds',
    });
    expect(effectDuration({ duration: {} } as any)).toEqual({
      value: null,
      units: null,
      expired: false,
    });
    expect(effectDuration({ duration: { rounds: 1, remaining: 0 } } as any).expired).toBe(true);
  });

  it('v14 duration: {value, units} and the expired flag', () => {
    expect(
      effectDuration({
        duration: { value: 3, units: 'rounds', expiry: null },
        expired: false,
      } as any)
    ).toEqual({ value: 3, units: 'rounds', expired: false });
    expect(
      effectDuration({ duration: { value: 1, units: 'minutes' }, expired: true } as any)
    ).toMatchObject({ expired: true });
    expect(effectDuration({ duration: { value: null, units: 'rounds' } } as any)).toMatchObject({
      value: null,
      units: null,
    });
  });

  it('image: img, else the removed icon field', () => {
    expect(effectImg({ img: 'a.svg' } as any)).toBe('a.svg');
    expect(effectImg({ icon: 'legacy.svg' } as any)).toBe('legacy.svg');
    expect(effectImg({} as any)).toBeNull();
  });
});
