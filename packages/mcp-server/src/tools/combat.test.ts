import { describe, expect, it } from 'vitest';

import { makeTools } from '../test-support/make-tool-harness.js';

import { CombatTools, SET_INITIATIVE_NOTE } from './combat.js';

/**
 * Tests for CombatTools: a thin, deterministic layer over FoundryClient.query.
 * Pattern: validate args → dispatch correct `foundry-mcp-bridge.*` method →
 * propagate foundry-side failures → throw `Parameter error: …` on validation
 * failures.
 *
 * The FoundryClient is mocked so these tests run with no bridge connection.
 */

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('CombatTools.getToolDefinitions', () => {
  it('exposes the four combat tools with object input schemas', () => {
    const { tools } = makeTools(CombatTools);
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'get-combat-state',
      'advance-combat-turn',
      'set-initiative',
      'roll-initiative-for-npcs',
    ]);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('set-initiative requires combatantName and initiative', () => {
    const { tools } = makeTools(CombatTools);
    const defs = tools.getToolDefinitions();
    const setInit = defs.find(d => d.name === 'set-initiative')!;
    expect((setInit.inputSchema as any).required).toEqual(['combatantName', 'initiative']);
  });

  it('get-combat-state has no required fields', () => {
    const { tools } = makeTools(CombatTools);
    const defs = tools.getToolDefinitions();
    const getCombat = defs.find(d => d.name === 'get-combat-state')!;
    expect((getCombat.inputSchema as any).required).toBeUndefined();
  });

  it('advance-combat-turn has no required fields', () => {
    const { tools } = makeTools(CombatTools);
    const defs = tools.getToolDefinitions();
    const advance = defs.find(d => d.name === 'advance-combat-turn')!;
    expect((advance.inputSchema as any).required).toBeUndefined();
  });

  it('roll-initiative-for-npcs has no required fields', () => {
    const { tools } = makeTools(CombatTools);
    const defs = tools.getToolDefinitions();
    const rollInit = defs.find(d => d.name === 'roll-initiative-for-npcs')!;
    expect((rollInit.inputSchema as any).required).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleGetCombatState
// ---------------------------------------------------------------------------

describe('CombatTools.handleGetCombatState', () => {
  it('dispatches the correct query method and returns the response', async () => {
    const payload = { success: true, active: true, round: 2 };
    const { tools, query } = makeTools(CombatTools, () => payload);
    const result = await tools.handleGetCombatState(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getCombatState', {});
    expect(result).toBe(payload);
  });

  it('always passes an empty object as params regardless of args', async () => {
    const { tools, query } = makeTools(CombatTools);
    await tools.handleGetCombatState({ unexpected: 'arg' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getCombatState', {});
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(CombatTools, () => ({ success: false, error: 'no active combat' }));
    await expect(tools.handleGetCombatState({})).rejects.toThrow('no active combat');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(CombatTools, () => ({ success: false }));
    await expect(tools.handleGetCombatState({})).rejects.toThrow('Failed to get combat state');
  });
});

// ---------------------------------------------------------------------------
// handleAdvanceCombatTurn
// ---------------------------------------------------------------------------

describe('CombatTools.handleAdvanceCombatTurn', () => {
  it('dispatches with no params when called with no args', async () => {
    const payload = { success: true };
    const { tools, query } = makeTools(CombatTools, () => payload);
    const result = await tools.handleAdvanceCombatTurn(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.advanceCombatTurn', {});
    expect(result).toBe(payload);
  });

  it('dispatches with skipTo when provided', async () => {
    const { tools, query } = makeTools(CombatTools, () => ({ success: true }));
    await tools.handleAdvanceCombatTurn({ skipTo: 'Goblin' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.advanceCombatTurn', {
      skipTo: 'Goblin',
    });
  });

  it('dispatches with empty params when called with empty object', async () => {
    const { tools, query } = makeTools(CombatTools, () => ({ success: true }));
    await tools.handleAdvanceCombatTurn({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.advanceCombatTurn', {});
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(CombatTools, () => ({
      success: false,
      error: 'combat not active',
    }));
    await expect(tools.handleAdvanceCombatTurn({})).rejects.toThrow('combat not active');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(CombatTools, () => ({ success: false }));
    await expect(tools.handleAdvanceCombatTurn({})).rejects.toThrow(
      'Failed to advance combat turn'
    );
  });
});

// ---------------------------------------------------------------------------
// handleSetInitiative
// ---------------------------------------------------------------------------

describe('CombatTools.handleSetInitiative', () => {
  it('dispatches with combatantName and initiative', async () => {
    const payload = { success: true };
    const { tools, query } = makeTools(CombatTools, () => payload);
    const result = await tools.handleSetInitiative({ combatantName: 'Goblin', initiative: 15 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.setInitiative', {
      combatantName: 'Goblin',
      initiative: 15,
    });
    expect(result).toEqual({ ...payload, note: SET_INITIATIVE_NOTE });
    expect(SET_INITIATIVE_NOTE).toMatch(/turn did not move/);
  });

  it('throws a parameter error when combatantName is missing', async () => {
    const { tools, query } = makeTools(CombatTools);
    await expect(tools.handleSetInitiative({ initiative: 10 })).rejects.toThrow(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('throws a parameter error when initiative is missing', async () => {
    const { tools, query } = makeTools(CombatTools);
    await expect(tools.handleSetInitiative({ combatantName: 'Goblin' })).rejects.toThrow(
      /Parameter error/i
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('throws a parameter error when args are null/undefined', async () => {
    const { tools, query } = makeTools(CombatTools);
    await expect(tools.handleSetInitiative(undefined)).rejects.toThrow(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('throws a parameter error when initiative is a non-number string', async () => {
    const { tools, query } = makeTools(CombatTools);
    await expect(
      tools.handleSetInitiative({
        combatantName: 'Goblin',
        initiative: 'high',
      })
    ).rejects.toThrow(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(CombatTools, () => ({
      success: false,
      error: 'combatant not found',
    }));
    await expect(
      tools.handleSetInitiative({ combatantName: 'Ghost', initiative: 20 })
    ).rejects.toThrow('combatant not found');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(CombatTools, () => ({ success: false }));
    await expect(
      tools.handleSetInitiative({ combatantName: 'Ghost', initiative: 20 })
    ).rejects.toThrow('Failed to set initiative');
  });
});

// ---------------------------------------------------------------------------
// handleRollInitiativeForNpcs
// ---------------------------------------------------------------------------

describe('CombatTools.handleRollInitiativeForNpcs', () => {
  it('dispatches with no scope when called with no args', async () => {
    const payload = { success: true };
    const { tools, query } = makeTools(CombatTools, () => payload);
    const result = await tools.handleRollInitiativeForNpcs(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.rollInitiativeForNpcs', {});
    expect(result).toBe(payload);
  });

  it('dispatches with scope "npcs"', async () => {
    const { tools, query } = makeTools(CombatTools, () => ({ success: true }));
    await tools.handleRollInitiativeForNpcs({ scope: 'npcs' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.rollInitiativeForNpcs', {
      scope: 'npcs',
    });
  });

  it('dispatches with scope "all"', async () => {
    const { tools, query } = makeTools(CombatTools, () => ({ success: true }));
    await tools.handleRollInitiativeForNpcs({ scope: 'all' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.rollInitiativeForNpcs', {
      scope: 'all',
    });
  });

  it('dispatches with scope "missing"', async () => {
    const { tools, query } = makeTools(CombatTools, () => ({ success: true }));
    await tools.handleRollInitiativeForNpcs({ scope: 'missing' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.rollInitiativeForNpcs', {
      scope: 'missing',
    });
  });

  it('throws (not returns string) when scope is an invalid enum value', async () => {
    const { tools, query } = makeTools(CombatTools);
    await expect(tools.handleRollInitiativeForNpcs({ scope: 'players' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(CombatTools, () => ({ success: false, error: 'no combatants' }));
    await expect(tools.handleRollInitiativeForNpcs({})).rejects.toThrow('no combatants');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(CombatTools, () => ({ success: false }));
    await expect(tools.handleRollInitiativeForNpcs({})).rejects.toThrow(
      'Failed to roll initiative'
    );
  });
});
