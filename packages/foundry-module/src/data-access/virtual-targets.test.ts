/**
 * Foundry setup targets (D-135): a setting and a pack's configuration as guarded-write targets.
 * Snapshot, apply, undo through the real `applyGuardedOps`, the conflict check, and the refusals
 * (the bridge's own switches, the permission table, secrets).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestWorld, type TestWorld } from '../test-support/foundry-mock/index.js';
import { registerGuardedFeature, resetGuardedFeaturesForTests } from '../guarded-features.js';
import {
  applyGuardedOps,
  inverseOf,
  resetGuardedOutcomes,
  snapshotGuardedOps,
  type GuardedApplyRequest,
  type GuardedApplyResult,
  type GuardedOp,
  type OpSnapshot,
} from './guarded-write.js';
import { getSetupInfo } from './setup-info.js';
import { SETUP_FEATURE_ID } from './virtual-targets.js';

const MODULE_ID = 'foundry-mcp-bridge';
const g = globalThis as any;

let world: TestWorld;
let restore: () => void;
let seq = 0;

beforeEach(() => {
  world = createTestWorld({ foundryVersion: '14.360' });
  restore = world.install();
  resetGuardedFeaturesForTests();
  resetGuardedOutcomes();
  g.game.settings.register = () => undefined;
  registerGuardedFeature({ id: SETUP_FEATURE_ID, name: 'Foundry setup', hint: 'Test.' });
  world.setSetting(MODULE_ID, 'allowWriteOperations', true);
  world.setSetting(MODULE_ID, `feature.${SETUP_FEATURE_ID}.enabled`, true);
  g.game.i18n = { localize: (s: string) => s };
  const registered = new Map<string, Record<string, unknown>>([
    ['dnd5e.diagonalMovement', { name: 'Diagonal', scope: 'world', type: String, config: true }],
    ['dnd5e.apiKey', { name: 'Key', scope: 'world', type: String, config: true }],
    ['core.permissions', { name: 'Perms', scope: 'world', type: Object, config: false }],
    ['core.moduleConfiguration', { name: 'Modules', scope: 'world', type: Object, config: false }],
    [
      'core.compendiumConfiguration',
      { name: 'Packs', scope: 'world', type: Object, config: false },
    ],
    [`${MODULE_ID}.allowWriteOperations`, { name: 'Writes', scope: 'world', type: Boolean }],
    ['somemod.hiddenText', { name: 'Hidden', scope: 'world', type: String, config: false }],
  ]);
  g.game.settings.settings = registered;
  world.setSetting('dnd5e', 'diagonalMovement', '555');
  world.setSetting('dnd5e', 'apiKey', 'sk-secret');
  world.setSetting('core', 'permissions', { X: [1] });
  world.setSetting('core', 'moduleConfiguration', { alpha: true, beta: false });
  world.setSetting('core', 'compendiumConfiguration', {
    'world.other': { locked: true },
  });
  world.setSetting('somemod', 'hiddenText', 'token');
  const packs = new Map<string, any>([
    [
      'dnd5e.monsters',
      {
        collection: 'dnd5e.monsters',
        metadata: { label: 'Monsters' },
        documentName: 'Actor',
        ownership: { PLAYER: 'OBSERVER', ASSISTANT: 'OWNER' },
        locked: false,
        folder: null,
      },
    ],
  ]);
  (packs as any).contents = [...packs.values()];
  g.game.packs = Object.assign(packs, { [Symbol.iterator]: () => packs.values() });
  g.game.folders = [{ id: 'f1', name: 'Hidden', type: 'Compendium' }];
});

afterEach(() => {
  restore();
  resetGuardedFeaturesForTests();
});

async function request(
  ops: GuardedOp[],
  overrides: Partial<GuardedApplyRequest> = {}
): Promise<GuardedApplyRequest> {
  return {
    changeId: `chg-${(seq += 1)}`,
    feature: SETUP_FEATURE_ID,
    mode: 'apply',
    summary: 'Test setup change',
    ops,
    expected: await snapshotGuardedOps(ops),
    ...overrides,
  };
}

function undoRequest(applied: GuardedApplyResult): GuardedApplyRequest {
  const results = [...applied.results].reverse();
  return {
    changeId: `undo-${applied.changeId}`,
    feature: 'change-undo',
    mode: 'undo',
    summary: 'Undo',
    ops: results.map(inverseOf),
    expected: results.map((r): OpSnapshot => ({ exists: true, values: r.after ?? [] })),
  };
}

const setting = (key: string, value: unknown): GuardedOp => ({
  kind: 'update',
  uuid: `GameSetting.${key}`,
  changes: { value },
});

describe('settings as a guarded target', () => {
  it('snapshots, applies and undoes a setting', async () => {
    const ops = [setting('dnd5e.diagonalMovement', '5105')];
    const [snap] = await snapshotGuardedOps(ops);
    expect(snap).toMatchObject({ exists: true, documentName: 'Setting' });
    expect(snap?.values).toEqual([{ path: 'value', present: true, value: '555' }]);
    const applied = await applyGuardedOps(await request(ops));
    expect(world.settings.get('dnd5e.diagonalMovement')).toBe('5105');
    await applyGuardedOps(undoRequest(applied));
    expect(world.settings.get('dnd5e.diagonalMovement')).toBe('555');
  });

  it('reports a conflict when someone else changed the setting since', async () => {
    const ops = [setting('dnd5e.diagonalMovement', '5105')];
    const req = await request(ops);
    world.setSetting('dnd5e', 'diagonalMovement', '111');
    await expect(applyGuardedOps(req)).rejects.toThrow(/Conflict.*"value" changed since/);
    expect(world.settings.get('dnd5e.diagonalMovement')).toBe('111');
  });

  it('turns one module on or off and leaves the others alone', async () => {
    const ops: GuardedOp[] = [
      {
        kind: 'update',
        uuid: 'GameSetting.core.moduleConfiguration',
        changes: { 'value.beta': true },
      },
    ];
    const applied = await applyGuardedOps(await request(ops));
    expect(world.settings.get('core.moduleConfiguration')).toEqual({ alpha: true, beta: true });
    await applyGuardedOps(undoRequest(applied));
    expect(world.settings.get('core.moduleConfiguration')).toEqual({ alpha: true, beta: false });
  });

  it('refuses the whole module list, the bridge switches, the permission table and pack config', async () => {
    const bad: GuardedOp[] = [
      { kind: 'update', uuid: 'GameSetting.core.moduleConfiguration', changes: { value: {} } },
      setting(`${MODULE_ID}.allowWriteOperations`, false),
      setting('core.permissions', {}),
      setting('core.compendiumConfiguration', {}),
    ];
    for (const op of bad) await expect(snapshotGuardedOps([op])).rejects.toThrow();
  });

  it('treats a secret and an unknown setting as not found, never reading one into a snapshot', async () => {
    for (const key of ['dnd5e.apiKey', 'somemod.hiddenText', 'dnd5e.nope']) {
      const [snap] = await snapshotGuardedOps([setting(key, 'x')]);
      expect(snap).toEqual({ exists: false });
    }
    // A value that holds a secret-looking string counts too, whatever the key is called.
    g.game.settings.settings.set('somemod.config', { name: 'Config', config: true, type: Object });
    world.setSetting('somemod', 'config', {
      hook: 'https://discord.com/api/webhooks/123/abcdefghijklmnopqrstuvwxyz',
    });
    const [hooked] = await snapshotGuardedOps([setting('somemod.config', {})]);
    expect(hooked).toEqual({ exists: false });
    await expect(applyGuardedOps(await request([setting('dnd5e.apiKey', 'x')]))).rejects.toThrow(
      /not found/
    );
  });

  it('accepts only the path "value" (and never walks into the prototype)', async () => {
    const odd = (path: string): GuardedOp => ({
      kind: 'update',
      uuid: 'GameSetting.dnd5e.diagonalMovement',
      changes: { [path]: 'x' },
    });
    await expect(snapshotGuardedOps([odd('value.x')])).rejects.toThrow(/"value" only/);
    await expect(snapshotGuardedOps([odd('value.__proto__.isGM')])).rejects.toThrow(/Unsafe path/);
    const modules: GuardedOp = {
      kind: 'update',
      uuid: 'GameSetting.core.moduleConfiguration',
      changes: { 'value.__proto__': true },
    };
    await expect(snapshotGuardedOps([modules])).rejects.toThrow(/Unsafe path/);
  });

  it('refuses a Setting document by create or delete', async () => {
    g.CONFIG.Setting = { documentClass: { create: () => Promise.resolve(null) } };
    const create: GuardedOp = { kind: 'create', documentName: 'Setting', data: { key: 'x' } };
    await expect(applyGuardedOps(await request([create]))).rejects.toThrow(/not as documents/);
  });

  it('plans nothing for a setting with no value yet', async () => {
    g.game.settings.settings.set('dnd5e.fresh', { name: 'Fresh', config: true, type: String });
    await expect(applyGuardedOps(await request([setting('dnd5e.fresh', 'x')]))).rejects.toThrow(
      /no value yet/
    );
  });

  it('is written only by the Foundry setup feature (and its undo), whatever other switch is on', async () => {
    registerGuardedFeature({ id: 'live-play', name: 'Live play', hint: 'Test.' });
    world.setSetting(MODULE_ID, 'feature.live-play.enabled', true);
    const ops = [setting('dnd5e.diagonalMovement', '5105')];
    await expect(applyGuardedOps(await request(ops, { feature: 'live-play' }))).rejects.toThrow(
      /only written by the "foundry-setup" feature/
    );
    expect(world.settings.get('dnd5e.diagonalMovement')).toBe('555');
    const pack: GuardedOp = {
      kind: 'update',
      uuid: 'PackConfig.dnd5e.monsters',
      changes: { locked: true },
    };
    await expect(applyGuardedOps(await request([pack], { feature: 'live-play' }))).rejects.toThrow(
      /only written by/
    );
  });

  it('never turns the AI Tool module itself off', async () => {
    const op: GuardedOp = {
      kind: 'update',
      uuid: 'GameSetting.core.moduleConfiguration',
      changes: { [`value.${MODULE_ID}`]: false },
    };
    await expect(snapshotGuardedOps([op])).rejects.toThrow(/AI Tool module cannot be turned off/);
  });

  it('does not take a plain "token" or "auth" setting for a secret', () => {
    g.game.settings.settings.set('dnd5e.tokenVision', { name: 'Token vision', config: true });
    g.game.settings.settings.set('somemod.botToken', { name: 'Bot token', config: true });
    const info = getSetupInfo({ area: 'setting', target: 'tokenVision' }) as any;
    expect(info.settings[0].redacted).toBeUndefined();
    const secret = getSetupInfo({ area: 'setting', target: 'somemod.botToken' }) as any;
    expect(secret.settings[0].redacted).toBe(true);
  });

  it('keeps a DataField-typed setting usable (Foundry 14 renames the field to the setting id)', () => {
    class StringField {
      name = 'dnd5e.fieldy';
    }
    g.game.settings.settings.set('dnd5e.fieldy', {
      name: 'Fieldy',
      scope: 'world',
      config: true,
      type: new StringField(),
    });
    world.setSetting('dnd5e', 'fieldy', 'abc');
    const info = getSetupInfo({ area: 'setting', target: 'dnd5e.fieldy' }) as any;
    expect(info.settings[0]).toMatchObject({ type: 'String', value: 'abc' });
  });
});

describe('pack configuration as a guarded target', () => {
  const pack = (changes: Record<string, unknown>, unset?: string[]): GuardedOp => ({
    kind: 'update',
    uuid: 'PackConfig.dnd5e.monsters',
    changes,
    ...(unset ? { unset } : {}),
  });

  it('writes the ownership map, keeps other packs, and undo removes the entry', async () => {
    const ops = [pack({ ownership: { PLAYER: 'NONE', TRUSTED: 'NONE', ASSISTANT: 'OWNER' } })];
    const [snap] = await snapshotGuardedOps(ops);
    expect(snap).toMatchObject({ exists: true, documentName: 'CompendiumPack', name: 'Monsters' });
    expect(snap?.values?.[0]?.present).toBe(false);
    const applied = await applyGuardedOps(await request(ops));
    expect(world.settings.get('core.compendiumConfiguration')).toEqual({
      'world.other': { locked: true },
      'dnd5e.monsters': { ownership: { PLAYER: 'NONE', TRUSTED: 'NONE', ASSISTANT: 'OWNER' } },
    });
    await applyGuardedOps(undoRequest(applied));
    expect(world.settings.get('core.compendiumConfiguration')).toEqual({
      'world.other': { locked: true },
    });
  });

  it('refuses a field a pack configuration does not have, and an unknown pack is missing', async () => {
    await expect(snapshotGuardedOps([pack({ label: 'x' })])).rejects.toThrow(/no "label"/);
    const [gone] = await snapshotGuardedOps([
      { kind: 'update', uuid: 'PackConfig.dnd5e.nope', changes: { locked: true } },
    ]);
    expect(gone).toEqual({ exists: false });
  });
});

describe('getSetupInfo', () => {
  it('lists visible settings by a part of the name and redacts secrets', () => {
    const info = getSetupInfo({ area: 'setting', target: 'dnd5e' }) as any;
    const byId = Object.fromEntries(info.settings.map((s: any) => [s.id, s]));
    expect(byId['dnd5e.diagonalMovement'].value).toBe('555');
    expect(byId['dnd5e.apiKey'].redacted).toBe(true);
    expect(byId['dnd5e.apiKey'].value).toBeUndefined();
  });

  it('shows a hidden setting only for its exact key', () => {
    const none = getSetupInfo({ area: 'setting', target: 'hidden' }) as any;
    expect(none.settings).toHaveLength(0);
    const exact = getSetupInfo({ area: 'setting', target: 'core.moduleConfiguration' }) as any;
    expect(exact.settings[0].value).toEqual({ alpha: true, beta: false });
  });

  it('lists packs with their ownership and the compendium folders', () => {
    const info = getSetupInfo({ area: 'pack', target: 'monsters' }) as any;
    expect(info.packs[0]).toMatchObject({
      id: 'dnd5e.monsters',
      ownership: { PLAYER: 'OBSERVER', ASSISTANT: 'OWNER' },
      configured: {},
    });
    expect(info.folders).toEqual([{ id: 'f1', name: 'Hidden' }]);
    expect(() => getSetupInfo({ area: 'bogus' })).toThrow();
  });
});
