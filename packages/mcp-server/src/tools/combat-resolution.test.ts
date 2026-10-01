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
  it('exposes the three combat-resolution tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
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
    expect(required('roll-saving-throws')).toEqual(['targets', 'rollType']);
    expect(required('use-npc-activity')).toEqual(['actorName', 'itemName']);
    expect(required('manage-rest')).toEqual(['targets', 'restType']);
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

// ---------------------------------------------------------------------------
// M3: parameter descriptions name the dnd5e 6 keys and the roll visibility
// ---------------------------------------------------------------------------

describe('CombatResolutionTools parameter descriptions (M3)', () => {
  const props = (name: string): Record<string, { description?: string }> => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions().find(d => d.name === name)!;
    return (def.inputSchema as any).properties;
  };

  it('roll-saving-throws lists the 18 dnd5e skill keys', () => {
    const desc = props('roll-saving-throws').skill.description as string;
    for (const key of [
      'acr',
      'ani',
      'arc',
      'ath',
      'dec',
      'his',
      'ins',
      'itm',
      'inv',
      'med',
      'nat',
      'prc',
      'prf',
      'per',
      'rel',
      'slt',
      'ste',
      'sur',
    ]) {
      expect(desc).toMatch(new RegExp(`\\b${key}\\b`));
    }
  });

  it('roll visibility descriptions match the module defaults (saves: GM whisper; NPC activity: public)', () => {
    expect(props('roll-saving-throws').isPublic.description).toMatch(/GM only \(false or omitted/);
    expect(props('use-npc-activity').isPublic.description).toMatch(/true or omitted/);
  });
});
