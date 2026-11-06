import { describe, expect, it, vi, type Mock } from 'vitest';

import { FoundrySetupTools } from './foundry-setup.js';

/**
 * Tests for FoundrySetupTools (D-135): `plan-foundry-setup` reads setup through the bridge's
 * `getSetupInfo` and hands one pseudo-uuid `update` op to the guarded-write service (a fake here).
 */

const settingRow = {
  id: 'dnd5e.diagonalMovement',
  name: 'Diagonal movement',
  scope: 'world',
  type: 'String',
  config: true,
  requiresReload: false,
  choices: { '555': 'Equidistant', '5105': 'Alternating' },
  value: '555',
};
const secretRow = {
  id: 'dnd5e.apiKey',
  name: 'Key',
  scope: 'world',
  type: 'String',
  redacted: true,
};
const rangeRow = {
  id: 'core.fontSize',
  name: 'Font',
  scope: 'client',
  type: 'Number',
  config: true,
  requiresReload: true,
  range: { min: 10, max: 20 },
  value: 14,
};
const packRow = {
  id: 'dnd5e.monsters',
  label: 'Monsters',
  ownership: { PLAYER: 'OBSERVER', ASSISTANT: 'OWNER' },
  configured: {},
  locked: false,
  folder: null,
};

const userRows = [
  { id: 'u1', name: 'Ask', role: 'PLAYER', isGM: false },
  { id: 'u2', name: 'Danni', role: 'GAMEMASTER', isGM: true },
  { id: 'u3', name: 'David', role: 'TRUSTED', isGM: false },
];
const ownershipRows = [
  { id: 'j1', name: 'Strahd notes', default: 'NONE', users: { Ask: 'OBSERVER' } },
  { id: 'j2', name: 'Strahd history', default: 'NONE', users: {} },
];

const dep = (id: string, installed = true, active = true): any => ({ id, installed, active });
const moduleRows = [
  { id: 'lib', title: 'Lib', active: false, requires: [], requiredBy: [] },
  {
    id: 'libon',
    title: 'Lib On',
    active: true,
    requires: [],
    requiredBy: ['child', 'bridgeuser', 'foundry-mcp-bridge'],
  },
  { id: 'child', title: 'Child', active: true, requires: [dep('libon')], requiredBy: [] },
  {
    id: 'fancy',
    title: 'Fancy',
    active: false,
    requires: [dep('lib', true, false)],
    requiredBy: [],
  },
  {
    id: 'broken',
    title: 'Broken',
    active: false,
    requires: [dep('ghost', false, false)],
    requiredBy: [],
  },
  {
    id: 'bridgeuser',
    title: 'Bridge user',
    active: true,
    requires: [dep('libon')],
    requiredBy: [],
  },
  {
    id: 'foundry-mcp-bridge',
    title: 'AI Tool',
    active: true,
    requires: [dep('libon')],
    requiredBy: [],
  },
];

function makeTools(): {
  tools: FoundrySetupTools;
  query: Mock;
  createPlan: Mock;
} {
  const query = vi.fn((_method: string, data: any) => {
    if (data.area === 'setting') {
      const rows = [settingRow, secretRow, rangeRow].filter(r => r.id === data.target);
      return { area: 'setting', settings: rows };
    }
    if (data.area === 'module') return { area: 'module', modules: moduleRows };
    if (data.area === 'user') return { area: 'user', users: userRows };
    if (data.area === 'ownership') {
      const kind = String(data.target).split(':')[0];
      return { area: 'ownership', kind, documents: ownershipRows };
    }
    return {
      area: 'pack',
      packs: [packRow],
      folders: [{ id: 'f1', name: 'Hidden' }],
    };
  });
  const createPlan = vi.fn(
    (input: any): Promise<unknown> => Promise.resolve({ planId: 'p1', ...input, diff: [] })
  );
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  const tools = new FoundrySetupTools({
    foundryClient: { query } as any,
    guardedWrites: { createPlan },
    logger,
  });
  return { tools, query, createPlan };
}

const plan = (tools: FoundrySetupTools, args: unknown): Promise<any> =>
  tools.handleToolCall('plan-foundry-setup', args);

describe('plan-foundry-setup: settings', () => {
  it('read mode returns the bridge answer', async () => {
    const { tools, query } = makeTools();
    const out = await plan(tools, {
      mode: 'read',
      area: 'setting',
      target: 'dnd5e.diagonalMovement',
    });
    expect(out.settings[0].value).toBe('555');
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getSetupInfo', {
      area: 'setting',
      target: 'dnd5e.diagonalMovement',
    });
  });

  it('plans an update of GameSetting.<ns>.<key>', async () => {
    const { tools, createPlan } = makeTools();
    const out = await plan(tools, {
      mode: 'plan',
      area: 'setting',
      target: 'dnd5e.diagonalMovement',
      value: '5105',
    });
    expect(createPlan).toHaveBeenCalledTimes(1);
    const input = createPlan.mock.calls[0][0];
    expect(input.feature).toBe('foundry-setup');
    expect(input.ops).toEqual([
      { kind: 'update', uuid: 'GameSetting.dnd5e.diagonalMovement', changes: { value: '5105' } },
    ]);
    expect(out.autoApply).toBe(false);
  });

  it('refuses a secret, a value off the choices, the same value and a value out of range', async () => {
    const { tools, createPlan } = makeTools();
    const base = { mode: 'plan', area: 'setting' };
    await expect(plan(tools, { ...base, target: 'dnd5e.apiKey', value: 'x' })).rejects.toThrow(
      /secret/
    );
    await expect(
      plan(tools, { ...base, target: 'dnd5e.diagonalMovement', value: 'nope' })
    ).rejects.toThrow(/accepts 555, 5105/);
    await expect(
      plan(tools, { ...base, target: 'dnd5e.diagonalMovement', value: '555' })
    ).rejects.toThrow(/Nothing to change/);
    await expect(plan(tools, { ...base, target: 'core.fontSize', value: 99 })).rejects.toThrow(
      /between 10 and 20/
    );
    await expect(plan(tools, { ...base, target: 'core.fontSize', value: '12' })).rejects.toThrow(
      /is a number/
    );
    await expect(plan(tools, { ...base, target: 'nokey', value: 1 })).rejects.toThrow(
      /namespace\.key/
    );
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('read mode takes no value; a hidden setting and a toString choice are refused', async () => {
    const { tools, query } = makeTools();
    await expect(
      plan(tools, { mode: 'read', area: 'setting', target: 'core.fontSize', value: 1 })
    ).rejects.toThrow(/value is for mode plan/);
    await expect(
      plan(tools, {
        mode: 'plan',
        area: 'setting',
        target: 'dnd5e.diagonalMovement',
        value: 'toString',
      })
    ).rejects.toThrow(/accepts 555, 5105/);
    query.mockImplementationOnce(() => ({
      area: 'setting',
      settings: [{ ...settingRow, id: 'dnd5e.hidden', config: false }],
    }));
    await expect(
      plan(tools, { mode: 'plan', area: 'setting', target: 'dnd5e.hidden', value: '5105' })
    ).rejects.toThrow(/hidden setting/);
  });

  it('turns a bridge refusal into a clear error', async () => {
    const { tools, query } = makeTools();
    query.mockImplementationOnce(() => ({ error: 'Access denied', success: false }));
    await expect(plan(tools, { mode: 'read', area: 'setting' })).rejects.toThrow(
      /Setup read refused: Access denied/
    );
  });

  it('refuses to lower the Assistant GM role on a pack', async () => {
    const { tools, createPlan } = makeTools();
    await expect(
      plan(tools, {
        mode: 'plan',
        area: 'pack',
        target: 'dnd5e.monsters',
        value: { ownership: { PLAYER: 'NONE', ASSISTANT: 'NONE' } },
      })
    ).rejects.toThrow(/ASSISTANT must stay OWNER/);
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('notes a reload and a client-scope setting', async () => {
    const { tools } = makeTools();
    const out = await plan(tools, {
      mode: 'plan',
      area: 'setting',
      target: 'core.fontSize',
      value: 12,
    });
    expect(out.notes.join(' ')).toMatch(/reload/);
    expect(out.notes.join(' ')).toMatch(/only the GM Foundry window/);
  });
});

describe('plan-foundry-setup: packs', () => {
  it('hides a pack from players: writes the whole role map and keeps the assistant', async () => {
    const { tools, createPlan } = makeTools();
    await plan(tools, {
      mode: 'plan',
      area: 'pack',
      target: 'dnd5e.monsters',
      value: { ownership: { PLAYER: 'NONE', TRUSTED: 'NONE' } },
    });
    const input = createPlan.mock.calls[0][0];
    expect(input.ops).toEqual([
      {
        kind: 'update',
        uuid: 'PackConfig.dnd5e.monsters',
        changes: { ownership: { PLAYER: 'NONE', TRUSTED: 'NONE', ASSISTANT: 'OWNER' } },
      },
    ]);
    expect(input.summary).toMatch(/PLAYER: OBSERVER to NONE/);
  });

  it('refuses a level a higher role cannot get while a lower role keeps more', async () => {
    const { tools, createPlan } = makeTools();
    await expect(
      plan(tools, {
        mode: 'plan',
        area: 'pack',
        target: 'dnd5e.monsters',
        value: { ownership: { TRUSTED: 'NONE' } },
      })
    ).rejects.toThrow(/TRUSTED would still have OBSERVER/);
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('sets locked and moves the pack to a folder by name or back to the root', async () => {
    const { tools, createPlan } = makeTools();
    await plan(tools, {
      mode: 'plan',
      area: 'pack',
      target: 'dnd5e.monsters',
      value: { locked: true, folder: 'hidden' },
    });
    expect(createPlan.mock.calls[0][0].ops[0].changes).toEqual({ locked: true, folder: 'f1' });
  });

  it('refuses nothing to change, an unknown pack, a bad role or level, an unknown folder', async () => {
    const { tools } = makeTools();
    const base = { mode: 'plan', area: 'pack', target: 'dnd5e.monsters' };
    await expect(plan(tools, { ...base, value: { locked: false } })).rejects.toThrow(
      /Nothing to change/
    );
    await expect(
      plan(tools, { ...base, target: 'dnd5e.nope', value: { locked: true } })
    ).rejects.toThrow(/No compendium pack/);
    await expect(plan(tools, { ...base, value: { ownership: { GM: 'NONE' } } })).rejects.toThrow();
    await expect(
      plan(tools, { ...base, value: { ownership: { PLAYER: 'ALL' } } })
    ).rejects.toThrow();
    await expect(plan(tools, { ...base, value: { folder: 'Elsewhere' } })).rejects.toThrow(
      /No compendium folder/
    );
    await expect(plan(tools, { ...base, value: {} })).rejects.toThrow(/at least one/);
  });
});

describe('plan-foundry-setup: modules', () => {
  it('turns a module off with one flag and a reload note', async () => {
    const { tools, createPlan } = makeTools();
    const out = await plan(tools, { mode: 'plan', area: 'module', target: 'child', value: false });
    const input = createPlan.mock.calls[0][0];
    expect(input.ops).toEqual([
      {
        kind: 'update',
        uuid: 'GameSetting.core.moduleConfiguration',
        changes: { 'value.child': false },
      },
    ]);
    expect(out.notes.join(' ')).toMatch(/reload/i);
    expect(out.autoApply).toBe(false);
  });

  it('turns on the modules a module requires, and names them', async () => {
    const { tools, createPlan } = makeTools();
    const out = await plan(tools, { mode: 'plan', area: 'module', target: 'Fancy', value: true });
    expect(createPlan.mock.calls[0][0].ops[0].changes).toEqual({
      'value.fancy': true,
      'value.lib': true,
    });
    expect(out.notes.join(' ')).toMatch(/Also turned on.*Lib/);
  });

  it('refuses a missing dependency, a no-op, a bad value and an unknown module', async () => {
    const { tools } = makeTools();
    const run = (target: string, value: unknown): Promise<any> =>
      plan(tools, { mode: 'plan', area: 'module', target, value });
    await expect(run('broken', true)).rejects.toThrow(/not installed: ghost/);
    await expect(run('child', true)).rejects.toThrow(/already on/);
    await expect(run('child', 'yes')).rejects.toThrow(/true \(on\) or false/);
    await expect(run('chld', false)).rejects.toThrow(/No installed module/);
  });

  it('never turns off the AI Tool or what it needs', async () => {
    const { tools } = makeTools();
    await expect(
      plan(tools, { mode: 'plan', area: 'module', target: 'foundry-mcp-bridge', value: false })
    ).rejects.toThrow(/AI Tool module cannot be turned off/);
    await expect(
      plan(tools, { mode: 'plan', area: 'module', target: 'libon', value: false })
    ).rejects.toThrow(/AI Tool module needs libon/);
  });
});

describe('plan-foundry-setup: users', () => {
  it('plans a role change as an update of User.<id> path role', async () => {
    const { tools, createPlan } = makeTools();
    await plan(tools, { mode: 'plan', area: 'user', target: 'ask', value: { role: 'TRUSTED' } });
    expect(createPlan.mock.calls[0][0].ops).toEqual([
      { kind: 'update', uuid: 'User.u1', changes: { role: 2 } },
    ]);
  });

  it('refuses a Gamemaster, a Gamemaster role, an unknown user, a no-op and extra fields', async () => {
    const { tools } = makeTools();
    const run = (target: string, value: unknown): Promise<any> =>
      plan(tools, { mode: 'plan', area: 'user', target, value });
    await expect(run('Danni', { role: 'PLAYER' })).rejects.toThrow(/Gamemaster/);
    await expect(run('Ask', { role: 'GAMEMASTER' })).rejects.toThrow();
    await expect(run('Nobody', { role: 'PLAYER' })).rejects.toThrow(/No user/);
    await expect(run('Ask', { role: 'PLAYER' })).rejects.toThrow(/Nothing to change/);
    await expect(run('Ask', { role: 'PLAYER', password: 'x' })).rejects.toThrow();
  });
});

describe('plan-foundry-setup: journal and scene ownership', () => {
  it('plans default and per-user levels on one journal', async () => {
    const { tools, createPlan } = makeTools();
    const out = await plan(tools, {
      mode: 'plan',
      area: 'ownership',
      target: 'journal:Strahd history',
      value: { default: 'LIMITED', users: { ask: 'OBSERVER' } },
    });
    expect(createPlan.mock.calls[0][0].ops).toEqual([
      {
        kind: 'update',
        uuid: 'JournalEntry.j2',
        changes: { 'ownership.default': 1, 'ownership.u1': 2 },
      },
    ]);
    expect(out.notes.join(' ')).toMatch(/spoilers/);
  });

  it('uses Scene.<id> for a scene and skips what already holds', async () => {
    const { tools, createPlan } = makeTools();
    await plan(tools, {
      mode: 'plan',
      area: 'ownership',
      target: 'scene:j1',
      value: { default: 'NONE', users: { Ask: 'OBSERVER', David: 'LIMITED' } },
    });
    expect(createPlan.mock.calls[0][0].ops[0]).toEqual({
      kind: 'update',
      uuid: 'Scene.j1',
      changes: { 'ownership.u3': 1 },
    });
  });

  it('refuses an ambiguous name, a Gamemaster, a bad target and a no-op', async () => {
    const { tools } = makeTools();
    const run = (target: string, value: unknown): Promise<any> =>
      plan(tools, { mode: 'plan', area: 'ownership', target, value });
    await expect(run('journal:Strahd', { default: 'NONE' })).rejects.toThrow(/name one of them/);
    await expect(run('journal:j1', { users: { Danni: 'NONE' } })).rejects.toThrow(/Gamemaster/);
    await expect(run('actor:j1', { default: 'NONE' })).rejects.toThrow(/journal:<name/);
    await expect(run('journal:j1', { default: 'NONE' })).rejects.toThrow(/Nothing to change/);
    await expect(run('journal:j1', {})).rejects.toThrow(/Give a default/);
  });
});

describe('plan-foundry-setup: round-2 lows', () => {
  it('reports a read error and a too-long value instead of "no value yet"', async () => {
    const { tools, query } = makeTools();
    query.mockReturnValueOnce({
      area: 'setting',
      settings: [{ ...settingRow, value: undefined, valueError: 'boom' }],
    });
    await expect(
      plan(tools, { mode: 'plan', area: 'setting', target: settingRow.id, value: '5105' })
    ).rejects.toThrow(/could not be read \(boom\)/);
    query.mockReturnValueOnce({
      area: 'setting',
      settings: [{ ...settingRow, tooLong: true, value: '(5000 characters)' }],
    });
    await expect(
      plan(tools, { mode: 'plan', area: 'setting', target: settingRow.id, value: '5105' })
    ).rejects.toThrow(/too much data/);
  });

  it('puts the Assistant GM back to OWNER when the pack already has it lower', async () => {
    const { tools, createPlan, query } = makeTools();
    query.mockReturnValueOnce({
      area: 'pack',
      packs: [{ ...packRow, ownership: { PLAYER: 'OBSERVER', ASSISTANT: 'OBSERVER' } }],
      folders: [],
    });
    await plan(tools, {
      mode: 'plan',
      area: 'pack',
      target: 'dnd5e.monsters',
      value: { ownership: { PLAYER: 'NONE' } },
    });
    expect(createPlan.mock.calls[0][0].ops[0].changes.ownership).toEqual({
      PLAYER: 'NONE',
      ASSISTANT: 'OWNER',
    });
  });
});
