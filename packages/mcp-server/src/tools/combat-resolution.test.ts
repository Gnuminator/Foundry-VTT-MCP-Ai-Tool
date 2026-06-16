import { describe, expect, it, vi } from 'vitest';

import { CombatResolutionTools } from './combat-resolution.js';

/**
 * Tests for CombatResolutionTools — a thin, deterministic layer over
 * FoundryClient.query. Pattern per handler:
 *   validate args (zod) -> dispatch the matching `foundry-mcp-bridge.*` method
 *   with the PARSED args -> on Foundry `{ success: false }` throw
 *   (response.error || fallback) -> on a ZodError return a `Parameter error: …`
 *   STRING (never throw) -> any other error rethrows.
 *
 * The FoundryClient is mocked so these tests run with no bridge connection.
 */

function makeTools(queryImpl?: (method: string, data: unknown) => unknown) {
  const query = vi.fn(queryImpl ?? (() => ({ success: true })));
  const foundryClient = { query } as any;
  // Minimal Logger stub: `.child()` returns itself; level methods are no-ops.
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = () => logger;
  return { tools: new CombatResolutionTools({ foundryClient, logger }), query };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('CombatResolutionTools.getToolDefinitions', () => {
  it('exposes the four combat-resolution tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'apply-damage-and-healing',
      'roll-saving-throws',
      'use-npc-activity',
      'manage-rest',
    ]);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('declares the required fields for each tool', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const required = (name: string) =>
      (defs.find(d => d.name === name)!.inputSchema as any).required;
    expect(required('apply-damage-and-healing')).toEqual(['targets', 'amount']);
    expect(required('roll-saving-throws')).toEqual(['targets', 'rollType']);
    expect(required('use-npc-activity')).toEqual(['actorName', 'itemName']);
    expect(required('manage-rest')).toEqual(['targets', 'restType']);
  });
});

// ---------------------------------------------------------------------------
// handleApplyDamageAndHealing
// ---------------------------------------------------------------------------

describe('CombatResolutionTools.handleApplyDamageAndHealing', () => {
  it('dispatches applyDamageAndHealing with the parsed args and returns the response', async () => {
    const payload = { success: true, applied: [{ target: 'Goblin', newHp: 3 }] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleApplyDamageAndHealing({ targets: ['Goblin'], amount: 5 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.applyDamageAndHealing', {
      targets: ['Goblin'],
      amount: 5,
    });
    expect(result).toBe(payload);
  });

  it('forwards all optional fields when provided', async () => {
    const { tools, query } = makeTools();
    await tools.handleApplyDamageAndHealing({
      targets: ['Goblin', 'Orc'],
      amount: 12,
      kind: 'damage',
      type: 'fire',
      multiplier: 2,
      ignoreResistance: true,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.applyDamageAndHealing', {
      targets: ['Goblin', 'Orc'],
      amount: 12,
      kind: 'damage',
      type: 'fire',
      multiplier: 2,
      ignoreResistance: true,
    });
  });

  it('strips unknown fields before dispatching', async () => {
    const { tools, query } = makeTools();
    await tools.handleApplyDamageAndHealing({ targets: ['Goblin'], amount: 5, bogus: 'x' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.applyDamageAndHealing', {
      targets: ['Goblin'],
      amount: 5,
    });
  });

  it('accepts amount of 0 (min boundary)', async () => {
    const { tools, query } = makeTools();
    await tools.handleApplyDamageAndHealing({ targets: ['Goblin'], amount: 0 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.applyDamageAndHealing', {
      targets: ['Goblin'],
      amount: 0,
    });
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'no such token' }));
    await expect(
      tools.handleApplyDamageAndHealing({ targets: ['Ghost'], amount: 5 })
    ).rejects.toThrow('no such token');
  });

  it('throws the fallback message when Foundry fails with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(
      tools.handleApplyDamageAndHealing({ targets: ['Goblin'], amount: 5 })
    ).rejects.toThrow('Failed to apply damage/healing');
  });

  it('returns a parameter-error string (not a throw) when targets is empty', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleApplyDamageAndHealing({ targets: [], amount: 5 });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when amount is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleApplyDamageAndHealing({ targets: ['Goblin'] });
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when amount is negative', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleApplyDamageAndHealing({ targets: ['Goblin'], amount: -3 });
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when amount is non-integer', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleApplyDamageAndHealing({ targets: ['Goblin'], amount: 2.5 });
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when kind is not in the enum', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleApplyDamageAndHealing({
      targets: ['Goblin'],
      amount: 5,
      kind: 'vampiric',
    });
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when args are undefined', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleApplyDamageAndHealing(undefined);
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleRollSavingThrows
// ---------------------------------------------------------------------------

describe('CombatResolutionTools.handleRollSavingThrows', () => {
  it('dispatches rollSavingThrows with the parsed args and returns the response', async () => {
    const payload = { success: true, rolls: [{ target: 'Goblin', total: 14, pass: false }] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleRollSavingThrows({
      targets: ['Goblin'],
      rollType: 'save',
      ability: 'dex',
      dc: 15,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.rollSavingThrows', {
      targets: ['Goblin'],
      rollType: 'save',
      ability: 'dex',
      dc: 15,
    });
    expect(result).toBe(payload);
  });

  it('forwards skill and isPublic when provided', async () => {
    const { tools, query } = makeTools();
    await tools.handleRollSavingThrows({
      targets: ['Goblin'],
      rollType: 'skill',
      skill: 'ste',
      isPublic: true,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.rollSavingThrows', {
      targets: ['Goblin'],
      rollType: 'skill',
      skill: 'ste',
      isPublic: true,
    });
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'actor has no dex save' }));
    await expect(
      tools.handleRollSavingThrows({ targets: ['Goblin'], rollType: 'save' })
    ).rejects.toThrow('actor has no dex save');
  });

  it('throws the fallback message when Foundry fails with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(
      tools.handleRollSavingThrows({ targets: ['Goblin'], rollType: 'save' })
    ).rejects.toThrow('Failed to roll saving throws');
  });

  it('returns a parameter-error string when rollType is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRollSavingThrows({ targets: ['Goblin'] });
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when rollType is not in the enum', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRollSavingThrows({ targets: ['Goblin'], rollType: 'attack' });
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when targets is empty', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRollSavingThrows({ targets: [], rollType: 'save' });
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleUseNpcActivity
// ---------------------------------------------------------------------------

describe('CombatResolutionTools.handleUseNpcActivity', () => {
  it('dispatches useNpcActivity with the parsed args and returns the response', async () => {
    const payload = { success: true, attackTotal: 18, hit: true, damage: 7 };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleUseNpcActivity({
      actorName: 'Goblin',
      itemName: 'Scimitar',
      targetAC: 15,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.useNpcActivity', {
      actorName: 'Goblin',
      itemName: 'Scimitar',
      targetAC: 15,
    });
    expect(result).toBe(payload);
  });

  it('dispatches without optional fields when only required ones are given', async () => {
    const { tools, query } = makeTools();
    await tools.handleUseNpcActivity({ actorName: 'Goblin', itemName: 'Scimitar' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.useNpcActivity', {
      actorName: 'Goblin',
      itemName: 'Scimitar',
    });
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'item not found' }));
    await expect(
      tools.handleUseNpcActivity({ actorName: 'Goblin', itemName: 'Bow' })
    ).rejects.toThrow('item not found');
  });

  it('throws the fallback message when Foundry fails with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(
      tools.handleUseNpcActivity({ actorName: 'Goblin', itemName: 'Scimitar' })
    ).rejects.toThrow('Failed to use NPC activity');
  });

  it('returns a parameter-error string when actorName is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleUseNpcActivity({ itemName: 'Scimitar' });
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when itemName is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleUseNpcActivity({ actorName: 'Goblin' });
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleManageRest
// ---------------------------------------------------------------------------

describe('CombatResolutionTools.handleManageRest', () => {
  it('dispatches manageRest with the parsed args and returns the response', async () => {
    const payload = { success: true, rested: ['Aldric'] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleManageRest({
      targets: ['Aldric'],
      restType: 'long',
      newDay: true,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.manageRest', {
      targets: ['Aldric'],
      restType: 'long',
      newDay: true,
    });
    expect(result).toBe(payload);
  });

  it('dispatches a short rest without newDay when omitted', async () => {
    const { tools, query } = makeTools();
    await tools.handleManageRest({ targets: ['Aldric'], restType: 'short' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.manageRest', {
      targets: ['Aldric'],
      restType: 'short',
    });
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'no such character' }));
    await expect(tools.handleManageRest({ targets: ['Ghost'], restType: 'long' })).rejects.toThrow(
      'no such character'
    );
  });

  it('throws the fallback message when Foundry fails with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleManageRest({ targets: ['Aldric'], restType: 'long' })).rejects.toThrow(
      'Failed to manage rest'
    );
  });

  it('returns a parameter-error string when restType is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleManageRest({ targets: ['Aldric'] });
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when restType is not in the enum', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleManageRest({ targets: ['Aldric'], restType: 'nap' });
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when targets is empty', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleManageRest({ targets: [], restType: 'short' });
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });
});
