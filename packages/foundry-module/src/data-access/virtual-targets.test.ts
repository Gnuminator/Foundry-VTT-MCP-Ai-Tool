/**
 * Foundry setup targets (D-135): a setting and a pack's configuration as guarded-write targets.
 * Snapshot, apply, undo through the real `applyGuardedOps`, the conflict check, and the refusals
 * (the bridge's own switches, the permission table, secrets).
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
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
import { MODULE_RELOAD_DELAY_MS, SETUP_FEATURE_ID, isSecretSetting } from './virtual-targets.js';

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
  g.game.settings.register = (): undefined => undefined;
  registerGuardedFeature({ id: SETUP_FEATURE_ID, name: 'Foundry setup', hint: 'Test.' });
  world.setSetting(MODULE_ID, 'allowWriteOperations', true);
  world.setSetting(MODULE_ID, `feature.${SETUP_FEATURE_ID}.enabled`, true);
  g.game.i18n = { localize: (s: string): string => s };
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
    g.CONFIG.Setting = { documentClass: { create: (): Promise<null> => Promise.resolve(null) } };
    const create: GuardedOp = { kind: 'create', documentName: 'Setting', data: { key: 'x' } };
    await expect(snapshotGuardedOps([create])).rejects.toThrow(/not as documents/);
  });

  it('hides secrets under camelCase key names and object keys', async () => {
    g.game.settings.settings.set('somemod.discordToken', {
      name: 'Bot',
      config: true,
      type: String,
    });
    world.setSetting('somemod', 'discordToken', 'MTA0NzE2NTk4.Gx7Yk2.abcdefghijklmnop');
    g.game.settings.settings.set('somemod.options', {
      name: 'Options',
      config: true,
      type: Object,
    });
    world.setSetting('somemod', 'options', { token: 'MTA0NzE2NTk4.Gx7Yk2.abcdefghijklmnop' });
    for (const key of ['somemod.discordToken', 'somemod.options']) {
      const [snap] = await snapshotGuardedOps([setting(key, 'x')]);
      expect(snap).toEqual({ exists: false });
    }
    expect(isSecretSetting('somemod', 'plain', { token: 'short' })).toBe(false);
  });

  it('refuses a new value that looks like a secret, and one that is too long to read back', async () => {
    const hook = 'https://discord.com/api/webhooks/123/abcdefghijklmnopqrstuvwxyz';
    await expect(snapshotGuardedOps([setting('dnd5e.diagonalMovement', hook)])).rejects.toThrow(
      /looks like a secret/
    );
    world.setSetting('dnd5e', 'diagonalMovement', 'x'.repeat(5000));
    // Too long to read back: "not found", so an undo of other changes is not blocked by it.
    await expect(snapshotGuardedOps([setting('dnd5e.diagonalMovement', 'y')])).resolves.toEqual([
      { exists: false },
    ]);
  });

  it('checks the new value against the setting field before anything is confirmed', async () => {
    g.game.settings.settings.set('dnd5e.choosy', {
      name: 'Choosy',
      config: true,
      type: { validate: (v: unknown) => (v === 'a' ? undefined : { message: 'not a choice' }) },
    });
    world.setSetting('dnd5e', 'choosy', 'a');
    await expect(snapshotGuardedOps([setting('dnd5e.choosy', 'zzz')])).rejects.toThrow(
      /does not accept that value \(not a choice\)/
    );
    const [ok] = await snapshotGuardedOps([setting('dnd5e.choosy', 'a')]);
    expect(ok).toMatchObject({ exists: true });
  });

  it('keeps the Assistant GM role at OWNER on a pack', async () => {
    world.setSetting('core', 'compendiumConfiguration', {});
    const lower: GuardedOp = {
      kind: 'update',
      uuid: 'PackConfig.dnd5e.monsters',
      changes: { ownership: { PLAYER: 'NONE', ASSISTANT: 'NONE' } },
    };
    await applyGuardedOps(await request([lower]));
    const stored = world.settings.get('core.compendiumConfiguration') as any;
    expect(stored['dnd5e.monsters'].ownership).toEqual({ PLAYER: 'NONE', ASSISTANT: 'OWNER' });
  });

  it('refuses to read a Setting document into a snapshot by update or delete', async () => {
    const previous = g.fromUuid;
    g.fromUuid = (): Promise<unknown> => Promise.resolve({ documentName: 'Setting', id: 's1' });
    onTestFinished(() => {
      g.fromUuid = previous;
    });
    const update: GuardedOp = {
      kind: 'update',
      uuid: 'Setting.s1',
      changes: { value: 'x' },
    };
    const del: GuardedOp = { kind: 'delete', uuid: 'Setting.s1' };
    await expect(snapshotGuardedOps([update])).rejects.toThrow(/not as documents/);
    await expect(snapshotGuardedOps([del])).rejects.toThrow(/not as documents/);
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

  it('lists modules with what they require and what needs them', () => {
    const mk = (id: string, active: boolean, requires: any[] = []): any => ({
      id,
      title: id.toUpperCase(),
      version: '1',
      active,
      relationships: { requires: new Set(requires) },
    });
    g.game.modules = new Map<string, any>([
      ['lib', mk('lib', true)],
      ['child', mk('child', true, [{ id: 'lib', type: 'module' }])],
      [
        'off',
        mk('off', false, [
          { id: 'gone', type: 'module' },
          { id: 'dnd5e', type: 'system' },
        ]),
      ],
    ]);
    g.game.system = { id: 'dnd5e' };
    const info = getSetupInfo({ area: 'module', target: '' }) as any;
    const byId = Object.fromEntries(info.modules.map((m: any) => [m.id, m]));
    expect(byId.lib.requiredBy).toEqual(['child']);
    expect(byId.child.requires).toEqual([{ id: 'lib', installed: true, active: true }]);
    expect(byId.off.requires).toEqual([
      { id: 'gone', installed: false, active: false },
      { id: 'dnd5e', installed: true, active: true },
    ]);
    expect((getSetupInfo({ area: 'module', target: 'chil' }) as any).modules).toHaveLength(1);
  });

  it('lists users with role, password flag and owned actors, never a password', () => {
    g.game.users = [
      {
        id: 'u1',
        name: 'Ask',
        role: 1,
        isGM: false,
        active: true,
        hasPassword: true,
        password: 'x',
      },
      { id: 'u2', name: 'Danni', role: 4, isGM: true, active: false },
    ];
    g.game.actors = [
      { name: 'Cora', ownership: { u1: 3, default: 0 } },
      { name: 'Wolf', ownership: {} },
    ];
    const info = getSetupInfo({ area: 'user' }) as any;
    expect(info.users).toEqual([
      {
        id: 'u1',
        name: 'Ask',
        role: 'PLAYER',
        isGM: false,
        active: true,
        hasPassword: true,
        owns: ['Cora'],
      },
      {
        id: 'u2',
        name: 'Danni',
        role: 'GAMEMASTER',
        isGM: true,
        active: false,
        hasPassword: null,
        owns: [],
      },
    ]);
    expect(JSON.stringify(info)).not.toContain('"x"');
  });

  it('lists journal and scene ownership by user name', () => {
    g.game.users = [{ id: 'u1', name: 'Ask', role: 1 }];
    g.game.journal = [
      { id: 'j1', name: 'Notes', ownership: { default: 0, u1: 2 } },
      { id: 'j2', name: 'Other', ownership: { default: 1 } },
    ];
    g.game.scenes = [{ id: 's1', name: 'Map', ownership: { default: 2 } }];
    const info = getSetupInfo({ area: 'ownership', target: 'journal:note' }) as any;
    expect(info.documents).toEqual([
      { id: 'j1', name: 'Notes', default: 'NONE', users: { Ask: 'OBSERVER' } },
    ]);
    expect((getSetupInfo({ area: 'ownership', target: 'scene' }) as any).documents[0].default).toBe(
      'OBSERVER'
    );
    expect(() => getSetupInfo({ area: 'ownership', target: 'actor:x' })).toThrow(/journal/);
  });

  it('lets an undo put a pack back that has the Assistant below OWNER', async () => {
    world.setSetting('core', 'compendiumConfiguration', {
      'dnd5e.monsters': { ownership: { PLAYER: 'NONE', ASSISTANT: 'OBSERVER' } },
    });
    const op: GuardedOp = {
      kind: 'update',
      uuid: 'PackConfig.dnd5e.monsters',
      changes: { ownership: { PLAYER: 'NONE', ASSISTANT: 'OBSERVER' } },
    };
    await expect(snapshotGuardedOps([op])).resolves.toHaveLength(1);
  });

  it('applies and then undoes a pack that had the Assistant below OWNER', async () => {
    world.setSetting('core', 'compendiumConfiguration', {
      'dnd5e.monsters': { ownership: { PLAYER: 'OBSERVER', ASSISTANT: 'OBSERVER' } },
    });
    const op: GuardedOp = {
      kind: 'update',
      uuid: 'PackConfig.dnd5e.monsters',
      changes: { ownership: { PLAYER: 'NONE', ASSISTANT: 'OWNER' } },
    };
    const applied = await applyGuardedOps(await request([op]));
    await applyGuardedOps(undoRequest(applied));
    const stored = world.settings.get('core.compendiumConfiguration') as any;
    expect(stored['dnd5e.monsters'].ownership.PLAYER).toBe('OBSERVER');
    expect(stored['dnd5e.monsters'].ownership.ASSISTANT).toBe('OWNER');
  });

  it('reloads the windows once, after the whole apply, only when the module list changed', async () => {
    vi.useFakeTimers();
    onTestFinished(() => vi.useRealTimers());
    const emitted: string[] = [];
    const gm = globalThis as any;
    const mockGame = gm.game;
    const { user, socket } = mockGame;
    gm.game.user = { ...(user ?? {}), can: (): boolean => true };
    gm.game.socket = { emit: (e: string): number => emitted.push(e) };
    onTestFinished(() => {
      mockGame.user = user;
      mockGame.socket = socket;
    });
    await applyGuardedOps(
      await request([
        {
          kind: 'update',
          uuid: 'GameSetting.core.moduleConfiguration',
          changes: { 'value.beta': true },
        },
      ])
    );
    expect(emitted).toEqual([]);
    await vi.advanceTimersByTimeAsync(MODULE_RELOAD_DELAY_MS + 10);
    expect(emitted).toEqual(['reload']);
    await applyGuardedOps(await request([setting('dnd5e.diagonalMovement', '5105')]));
    await vi.advanceTimersByTimeAsync(MODULE_RELOAD_DELAY_MS + 10);
    expect(emitted).toEqual(['reload']);
  });
});
