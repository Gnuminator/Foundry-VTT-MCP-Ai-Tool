import { describe, expect, it } from 'vitest';

import { makeTools } from '../test-support/make-tool-harness.js';

import { CombatResolutionTools } from './combat-resolution.js';

/**
 * Tests for CombatResolutionTools: a thin, deterministic layer over
 * FoundryClient.query. Pattern per handler:
 *   validate args (zod) -> dispatch the matching `foundry-mcp-bridge.*` method
 *   with the PARSED args -> on Foundry `{ success: false }` throw
 *   (response.error || fallback) -> on a ZodError throw a `Parameter error: …`
 *   Error -> any other error rethrows.
 *
 * The FoundryClient is mocked so these tests run with no bridge connection.
 */

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('CombatResolutionTools.getToolDefinitions', () => {
  it('exposes the three combat-resolution tools with object input schemas', () => {
    const { tools } = makeTools(CombatResolutionTools);
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
    const { tools } = makeTools(CombatResolutionTools);
    const defs = tools.getToolDefinitions();
    const required = (name: string): unknown =>
      (defs.find(d => d.name === name)!.inputSchema as any).required;
    expect(required('roll-saving-throws')).toEqual(['targets', 'rollType']);
    expect(required('use-npc-activity')).toEqual(['actor', 'itemName']);
    expect(required('manage-rest')).toEqual(['targets', 'restType']);
  });
});

// ---------------------------------------------------------------------------
// handleRollSavingThrows
// ---------------------------------------------------------------------------

describe('CombatResolutionTools.handleRollSavingThrows', () => {
  it('dispatches rollSavingThrows with the parsed args and returns the response', async () => {
    const payload = { success: true, rolls: [{ target: 'Goblin', total: 14, pass: false }] };
    const { tools, query } = makeTools(CombatResolutionTools, () => payload);
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
    const { tools, query } = makeTools(CombatResolutionTools);
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
    const { tools } = makeTools(CombatResolutionTools, () => ({
      success: false,
      error: 'actor has no dex save',
    }));
    await expect(
      tools.handleRollSavingThrows({ targets: ['Goblin'], rollType: 'save' })
    ).rejects.toThrow('actor has no dex save');
  });

  it('throws the fallback message when Foundry fails with no error field', async () => {
    const { tools } = makeTools(CombatResolutionTools, () => ({ success: false }));
    await expect(
      tools.handleRollSavingThrows({ targets: ['Goblin'], rollType: 'save' })
    ).rejects.toThrow('Failed to roll saving throws');
  });

  it('throws a parameter error when rollType is missing', async () => {
    const { tools, query } = makeTools(CombatResolutionTools);
    await expect(tools.handleRollSavingThrows({ targets: ['Goblin'] })).rejects.toThrow(
      /Parameter error/i
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('throws a parameter error when rollType is not in the enum', async () => {
    const { tools, query } = makeTools(CombatResolutionTools);
    await expect(
      tools.handleRollSavingThrows({ targets: ['Goblin'], rollType: 'attack' })
    ).rejects.toThrow(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('throws a parameter error when targets is empty', async () => {
    const { tools, query } = makeTools(CombatResolutionTools);
    await expect(tools.handleRollSavingThrows({ targets: [], rollType: 'save' })).rejects.toThrow(
      /Parameter error/i
    );
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleUseNpcActivity
// ---------------------------------------------------------------------------

describe('CombatResolutionTools.handleUseNpcActivity', () => {
  it('dispatches useNpcActivity with the parsed args and returns the response', async () => {
    const payload = { success: true, attackTotal: 18, hit: true, damage: 7 };
    const { tools, query } = makeTools(CombatResolutionTools, () => payload);
    const result = await tools.handleUseNpcActivity({
      actor: 'Goblin',
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
    const { tools, query } = makeTools(CombatResolutionTools);
    await tools.handleUseNpcActivity({ actor: 'Goblin', itemName: 'Scimitar' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.useNpcActivity', {
      actorName: 'Goblin',
      itemName: 'Scimitar',
    });
  });

  it('says so when an older module ignores the activity it was asked for', async () => {
    const { tools } = makeTools(CombatResolutionTools, () => ({ success: true, attackTotal: 18 }));
    await expect(
      tools.handleUseNpcActivity({ actor: 'Goblin', itemName: 'Cloud', activity: 'Cloud' })
    ).rejects.toThrow(/module is older than this server and ignored the activity "Cloud"/);
  });

  it('accepts a reply that names the activity that ran', async () => {
    const payload = { success: true, activity: 'Cloud' };
    const { tools } = makeTools(CombatResolutionTools, () => payload);
    await expect(
      tools.handleUseNpcActivity({ actor: 'Goblin', itemName: 'Cloud', activity: 'Cloud' })
    ).resolves.toBe(payload);
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(CombatResolutionTools, () => ({
      success: false,
      error: 'item not found',
    }));
    await expect(tools.handleUseNpcActivity({ actor: 'Goblin', itemName: 'Bow' })).rejects.toThrow(
      'item not found'
    );
  });

  it('throws the fallback message when Foundry fails with no error field', async () => {
    const { tools } = makeTools(CombatResolutionTools, () => ({ success: false }));
    await expect(
      tools.handleUseNpcActivity({ actor: 'Goblin', itemName: 'Scimitar' })
    ).rejects.toThrow('Failed to use NPC activity');
  });

  it('throws a parameter error when actor is missing', async () => {
    const { tools, query } = makeTools(CombatResolutionTools);
    await expect(tools.handleUseNpcActivity({ itemName: 'Scimitar' })).rejects.toThrow(
      /Parameter error/i
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('throws a parameter error when itemName is missing', async () => {
    const { tools, query } = makeTools(CombatResolutionTools);
    await expect(tools.handleUseNpcActivity({ actor: 'Goblin' })).rejects.toThrow(
      /Parameter error/i
    );
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleManageRest
// ---------------------------------------------------------------------------

describe('CombatResolutionTools.handleManageRest', () => {
  it('dispatches manageRest with the parsed args and returns the response', async () => {
    const payload = { success: true, rested: ['Aldric'] };
    const { tools, query } = makeTools(CombatResolutionTools, () => payload);
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
    const { tools, query } = makeTools(CombatResolutionTools);
    await tools.handleManageRest({ targets: ['Aldric'], restType: 'short' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.manageRest', {
      targets: ['Aldric'],
      restType: 'short',
    });
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(CombatResolutionTools, () => ({
      success: false,
      error: 'no such character',
    }));
    await expect(tools.handleManageRest({ targets: ['Ghost'], restType: 'long' })).rejects.toThrow(
      'no such character'
    );
  });

  it('throws the fallback message when Foundry fails with no error field', async () => {
    const { tools } = makeTools(CombatResolutionTools, () => ({ success: false }));
    await expect(tools.handleManageRest({ targets: ['Aldric'], restType: 'long' })).rejects.toThrow(
      'Failed to manage rest'
    );
  });

  it('throws a parameter error when restType is missing', async () => {
    const { tools, query } = makeTools(CombatResolutionTools);
    await expect(tools.handleManageRest({ targets: ['Aldric'] })).rejects.toThrow(
      /Parameter error/i
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('throws a parameter error when restType is not in the enum', async () => {
    const { tools, query } = makeTools(CombatResolutionTools);
    await expect(tools.handleManageRest({ targets: ['Aldric'], restType: 'nap' })).rejects.toThrow(
      /Parameter error/i
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('throws a parameter error when targets is empty', async () => {
    const { tools, query } = makeTools(CombatResolutionTools);
    await expect(tools.handleManageRest({ targets: [], restType: 'short' })).rejects.toThrow(
      /Parameter error/i
    );
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// M3: parameter descriptions name the dnd5e 6 keys and the roll visibility
// ---------------------------------------------------------------------------

describe('CombatResolutionTools parameter descriptions (M3)', () => {
  const props = (name: string): Record<string, { description?: string }> => {
    const { tools } = makeTools(CombatResolutionTools);
    const def = tools.getToolDefinitions().find(d => d.name === name)!;
    return (def.inputSchema as any).properties;
  };

  it('roll-saving-throws lists the 18 dnd5e skill keys', () => {
    const keys = props('roll-saving-throws').skill.enum as string[];
    expect(keys).toHaveLength(18);
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
      expect(keys).toContain(key);
    }
  });

  it('roll visibility descriptions match the module defaults (saves: GM whisper; NPC activity: public)', () => {
    expect(props('roll-saving-throws').isPublic.description).toMatch(/GM only \(false or omitted/);
    expect(props('use-npc-activity').isPublic.description).toMatch(/true or omitted/);
  });
});
