import { describe, expect, it, vi } from 'vitest';

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
  ownership: { PLAYER: 'OBSERVER', TRUSTED: 'OBSERVER', ASSISTANT: 'OWNER' },
  configured: {},
  locked: false,
  folder: null,
};

function makeTools() {
  const query = vi.fn((_method: string, data: any) => {
    if (data.area === 'setting') {
      const rows = [settingRow, secretRow, rangeRow].filter(r => r.id === data.target);
      return { area: 'setting', settings: rows };
    }
    return {
      area: 'pack',
      packs: [packRow],
      folders: [{ id: 'f1', name: 'Hidden' }],
    };
  });
  const createPlan = vi.fn((input: any) => Promise.resolve({ planId: 'p1', ...input, diff: [] }));
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = () => logger;
  const tools = new FoundrySetupTools({
    foundryClient: { query } as any,
    guardedWrites: { createPlan } as any,
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
    const input = createPlan.mock.calls[0]![0];
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
    const input = createPlan.mock.calls[0]![0];
    expect(input.ops).toEqual([
      {
        kind: 'update',
        uuid: 'PackConfig.dnd5e.monsters',
        changes: { ownership: { PLAYER: 'NONE', TRUSTED: 'NONE', ASSISTANT: 'OWNER' } },
      },
    ]);
    expect(input.summary).toMatch(/PLAYER: OBSERVER to NONE/);
  });

  it('sets locked and moves the pack to a folder by name or back to the root', async () => {
    const { tools, createPlan } = makeTools();
    await plan(tools, {
      mode: 'plan',
      area: 'pack',
      target: 'dnd5e.monsters',
      value: { locked: true, folder: 'hidden' },
    });
    expect(createPlan.mock.calls[0]![0].ops[0].changes).toEqual({ locked: true, folder: 'f1' });
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
