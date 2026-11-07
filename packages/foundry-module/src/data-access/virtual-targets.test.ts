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
    installModules([mkModule('alpha', true), mkModule('beta', false)]);
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

  it('lists users with role and owned actors, never a password', () => {
    g.game.users = [
      {
        id: 'u1',
        name: 'Ask',
        role: 1,
        isGM: false,
        active: true,
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
        owns: ['Cora'],
      },
      {
        id: 'u2',
        name: 'Danni',
        role: 'GAMEMASTER',
        isGM: true,
        active: false,
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
      {
        id: 'j1',
        name: 'Notes',
        default: 'NONE',
        users: { u1: { name: 'Ask', level: 'OBSERVER' } },
      },
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
    installModules([mkModule('alpha', true), mkModule('beta', false)]);
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

const mkModule = (id: string, active: boolean, requires: any[] = [], extra: any = {}): any => ({
  id,
  title: id.toUpperCase(),
  version: '1',
  active,
  relationships: { requires: new Set(requires) },
  ...extra,
});

function installModules(list: any[]): void {
  g.game.modules = new Map<string, any>(list.map(m => [m.id, m]));
  g.game.system = { id: 'dnd5e', relationships: { requires: new Set() } };
  g.game.world = { relationships: { requires: new Set() } };
}

const moduleOp = (changes: Record<string, boolean>): GuardedOp => ({
  kind: 'update',
  uuid: 'GameSetting.core.moduleConfiguration',
  changes: Object.fromEntries(Object.entries(changes).map(([id, on]) => [`value.${id}`, on])),
});

describe('module toggles: apply-time checks', () => {
  it('refuses an apply when a module it needs went off since the plan (closure grew)', async () => {
    installModules([
      mkModule('alpha', true),
      mkModule('beta', false, [{ id: 'lib', type: 'module' }]),
      mkModule('lib', true),
    ]);
    world.setSetting('core', 'moduleConfiguration', { alpha: true, beta: false, lib: true });
    const req = await request([moduleOp({ beta: true })]);
    // lib is switched off by someone else between plan and apply
    world.setSetting('core', 'moduleConfiguration', { alpha: true, beta: false, lib: false });
    await expect(applyGuardedOps(req)).rejects.toThrow(/Conflict.*now needs LIB, which is off/);
    expect((world.settings.get('core.moduleConfiguration') as any).beta).toBe(false);
  });

  it('refuses turning off a module another active module now needs', async () => {
    installModules([mkModule('lib', true), mkModule('child', true, [{ id: 'lib' }])]);
    world.setSetting('core', 'moduleConfiguration', { lib: true, child: false });
    const req = await request([moduleOp({ lib: false })]);
    world.setSetting('core', 'moduleConfiguration', { lib: true, child: true });
    await expect(applyGuardedOps(req)).rejects.toThrow(/CHILD is on and needs LIB/);
  });

  it('refuses a module the world or system requires, and an incompatible one', async () => {
    installModules([mkModule('core-lib', true), mkModule('old', false, [], { unavailable: true })]);
    g.game.world.relationships.requires = new Set([{ id: 'core-lib', type: 'module' }]);
    world.setSetting('core', 'moduleConfiguration', { 'core-lib': true, old: false });
    await expect(applyGuardedOps(await request([moduleOp({ 'core-lib': false })]))).rejects.toThrow(
      /required by the world/
    );
    await expect(applyGuardedOps(await request([moduleOp({ old: true })]))).rejects.toThrow(
      /not usable in this world/
    );
  });

  it('flags forced and unavailable modules in the read', () => {
    installModules([
      mkModule('core-lib', true),
      mkModule('old', false, [], { unavailable: true }),
      mkModule('plain', true),
    ]);
    g.game.system.relationships.requires = new Set([{ id: 'core-lib', type: 'module' }]);
    const byId = Object.fromEntries(
      (getSetupInfo({ area: 'module' }) as any).modules.map((m: any) => [m.id, m])
    );
    expect(byId['core-lib'].forcedOn).toBe('system');
    expect(byId.old.unavailable).toBe(true);
    expect(byId.plain.forcedOn).toBeUndefined();
  });

  it('returns the whole closure of an exact target even past the list cap', () => {
    const many = Array.from({ length: 450 }, (_, i) =>
      mkModule(`m${String(i).padStart(3, '0')}`, true)
    );
    installModules([
      ...many,
      mkModule('zz-child', true, [{ id: 'zz-lib', type: 'module' }]),
      mkModule('zz-lib', true),
    ]);
    const all = getSetupInfo({ area: 'module' }) as any;
    expect(all.total).toBe(452);
    expect(all.shown).toBe(400);
    const one = getSetupInfo({ area: 'module', target: 'zz-lib' }) as any;
    expect(one.modules.map((m: any) => m.id)).toEqual(['zz-child', 'zz-lib']);
  });

  it('names a module list that is too large for a plan', async () => {
    installModules([mkModule('alpha', true)]);
    const big = Object.fromEntries(Array.from({ length: 2500 }, (_, i) => [`mod${i}`, true]));
    world.setSetting('core', 'moduleConfiguration', big);
    expect((getSetupInfo({ area: 'module' }) as any).listTooLarge).toBe(true);
    // the snapshot of a too-large list reads as "not found", so the apply names the real reason
    await expect(applyGuardedOps(await request([moduleOp({ alpha: false })]))).rejects.toThrow(
      /too much data/
    );
  });

  it('checks the closure of a removed flag too (the undo of a first switch-on)', async () => {
    installModules([
      mkModule('fresh', true),
      mkModule('child', false, [{ id: 'fresh', type: 'module' }]),
    ]);
    world.setSetting('core', 'moduleConfiguration', { fresh: true, child: false });
    const op: GuardedOp = {
      kind: 'update',
      uuid: 'GameSetting.core.moduleConfiguration',
      changes: {},
      unset: ['value.fresh'],
    };
    const req = await request([op]);
    world.setSetting('core', 'moduleConfiguration', { fresh: true, child: true });
    await expect(applyGuardedOps(req)).rejects.toThrow(/CHILD is on and needs FRESH/);
  });

  it('names a module list that grew past the limit after the plan', async () => {
    installModules([mkModule('alpha', true)]);
    const req = await request([moduleOp({ alpha: false })]);
    const big = Object.fromEntries(Array.from({ length: 2500 }, (_, i) => [`mod${i}`, true]));
    world.setSetting('core', 'moduleConfiguration', big);
    await expect(applyGuardedOps(req)).rejects.toThrow(/Conflict.*too much data/);
  });

  it('does not treat a type-less requirement on the system as a module', async () => {
    installModules([mkModule('sysmod', false, [{ id: 'dnd5e' }])]);
    world.setSetting('core', 'moduleConfiguration', { sysmod: false });
    await expect(
      applyGuardedOps(await request([moduleOp({ sysmod: true })]))
    ).resolves.toBeDefined();
  });

  it('judges on from the module configuration first, in the read and at apply', () => {
    installModules([mkModule('a', false), mkModule('b', true)]);
    world.setSetting('core', 'moduleConfiguration', { a: true, b: false });
    const byId = Object.fromEntries(
      (getSetupInfo({ area: 'module' }) as any).modules.map((m: any) => [m.id, m])
    );
    expect(byId.a.active).toBe(true);
    expect(byId.b.active).toBe(false);
  });

  it('marks the whole chain below a module the world requires as forced on', () => {
    installModules([
      mkModule('top', true, [{ id: 'mid', type: 'module' }]),
      mkModule('mid', true, [{ id: 'low', type: 'module' }]),
      mkModule('low', true),
      mkModule('other', true),
    ]);
    g.game.world.relationships.requires = new Set([{ id: 'top', type: 'module' }]);
    const byId = Object.fromEntries(
      (getSetupInfo({ area: 'module' }) as any).modules.map((m: any) => [m.id, m])
    );
    expect(byId.low.forcedOn).toBe('world');
    expect(byId.mid.forcedOn).toBe('world');
    expect(byId.other.forcedOn).toBeUndefined();
  });

  it('walks each way on its own and keeps the target row past the cap', () => {
    const many = Array.from({ length: 450 }, (_, i) =>
      mkModule(`m${String(i).padStart(3, '0')}`, true, [{ id: 'zz-lib', type: 'module' }])
    );
    installModules([
      ...many,
      mkModule('zz-target', true, [{ id: 'zz-lib', type: 'module' }]),
      mkModule('zz-lib', true),
    ]);
    const one = getSetupInfo({ area: 'module', target: 'zz-target' }) as any;
    // the target and the library it needs, not the 450 other users of that library
    expect(one.modules.map((m: any) => m.id)).toEqual(['zz-lib', 'zz-target']);
    // turning the library off needs all its users: the target row survives the cap
    const lib = getSetupInfo({ area: 'module', target: 'zz-lib' }) as any;
    expect(lib.modules.length).toBe(400);
    expect(lib.modules.some((m: any) => m.id === 'zz-lib')).toBe(true);
  });

  it('puts a module with no entry in the list back by removing the flag it added', async () => {
    installModules([mkModule('alpha', true), mkModule('fresh', false)]);
    world.setSetting('core', 'moduleConfiguration', { alpha: true });
    const applied = await applyGuardedOps(await request([moduleOp({ fresh: true })]));
    expect((world.settings.get('core.moduleConfiguration') as any).fresh).toBe(true);
    await applyGuardedOps(undoRequest(applied));
    expect(world.settings.get('core.moduleConfiguration')).toEqual({ alpha: true });
  });
});

describe('module toggles: failure and reload', () => {
  function reloadSpy(): string[] {
    vi.useFakeTimers();
    onTestFinished(() => vi.useRealTimers());
    const emitted: string[] = [];
    const mockGame = g.game;
    const { user, socket } = mockGame;
    mockGame.user = { ...(user ?? {}), can: (): boolean => true };
    mockGame.socket = { emit: (e: string): number => emitted.push(e) };
    onTestFinished(() => {
      mockGame.user = user;
      mockGame.socket = socket;
    });
    return emitted;
  }
  const missingPackOp: GuardedOp = {
    kind: 'update',
    uuid: 'PackConfig.nope.gone',
    changes: { locked: true },
  };

  it('rolls back a failed multi-flag apply and reloads nothing', async () => {
    installModules([mkModule('alpha', true), mkModule('beta', false)]);
    const emitted = reloadSpy();
    // the pack does not exist, so op 1 fails after the module list was written
    const req = await request([moduleOp({ beta: true }), missingPackOp]);
    await expect(applyGuardedOps(req)).rejects.toThrow(/Op 1 .*rolled back/);
    expect(world.settings.get('core.moduleConfiguration')).toEqual({ alpha: true, beta: false });
    await vi.advanceTimersByTimeAsync(MODULE_RELOAD_DELAY_MS + 10);
    expect(emitted).toEqual([]);
  });

  it('still reloads when the rollback of the module list did not complete', async () => {
    installModules([mkModule('alpha', true), mkModule('beta', false)]);
    const emitted = reloadSpy();
    const req = await request([moduleOp({ beta: true }), missingPackOp]);
    const settings = g.game.settings;
    const realSet = settings.set.bind(settings);
    let calls = 0;
    settings.set = (...args: unknown[]): Promise<unknown> =>
      ++calls > 1 ? Promise.reject(new Error('disk full')) : realSet(...args);
    await expect(applyGuardedOps(req)).rejects.toThrow(/rollback incomplete.*windows reload/);
    settings.set = realSet;
    await vi.advanceTimersByTimeAsync(MODULE_RELOAD_DELAY_MS + 10);
    expect(emitted).toEqual(['reload']);
  });

  it('keeps two applies at once apart: one failing does not cancel the other reload', async () => {
    installModules([mkModule('alpha', true), mkModule('beta', false)]);
    const emitted = reloadSpy();
    const good = await request([moduleOp({ beta: true })]);
    const bad = await request([setting('dnd5e.diagonalMovement', '1')]);
    world.setSetting('dnd5e', 'diagonalMovement', 'changed');
    const results = await Promise.allSettled([applyGuardedOps(good), applyGuardedOps(bad)]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    await vi.advanceTimersByTimeAsync(MODULE_RELOAD_DELAY_MS + 10);
    expect(emitted).toEqual(['reload']);
  });
});

describe('users listing', () => {
  it('caps the rows it shows and counts them', () => {
    g.game.users = Array.from({ length: 60 }, (_, i) => ({
      id: `u${i}`,
      name: `User ${String(i).padStart(2, '0')}`,
      role: 1,
    }));
    const info = getSetupInfo({ area: 'user' }) as any;
    expect(info.total).toBe(60);
    expect(info.shown).toBe(50);
    expect(info.users).toHaveLength(50);
  });

  it('keys per-user ownership by id, so two users with one name stay apart', () => {
    g.game.users = [
      { id: 'u1', name: 'Ask', role: 1 },
      { id: 'u2', name: 'Ask', role: 1 },
    ];
    g.game.journal = [{ id: 'j1', name: 'Notes', ownership: { default: 0, u1: 2, u2: 3 } }];
    const doc = (getSetupInfo({ area: 'ownership', target: 'journal' }) as any).documents[0];
    expect(doc.users).toEqual({
      u1: { name: 'Ask', level: 'OBSERVER' },
      u2: { name: 'Ask', level: 'OWNER' },
    });
  });
});
