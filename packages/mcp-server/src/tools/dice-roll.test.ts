import { describe, expect, it, vi } from 'vitest';

import { DiceRollTools } from './dice-roll.js';

/**
 * Tests for DiceRollTools — a thin, deterministic layer over FoundryClient.query.
 * Pattern: validate args → dispatch correct `foundry-mcp-bridge.*` method →
 * propagate foundry-side failures → return validation errors as strings
 * (all four handlers; ZodError → return string, foundry failure → throw).
 *
 * The FoundryClient is mocked so these tests run with no bridge connection.
 */

function makeTools(queryImpl?: (method: string, data: unknown) => unknown): {
  tools: DiceRollTools;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(queryImpl ?? ((): unknown => ({ success: true })));
  const foundryClient = { query } as any;
  // Minimal Logger stub: `.child()` returns itself; level methods are no-ops.
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = (): unknown => logger;
  return { tools: new DiceRollTools({ foundryClient, logger }), query };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('DiceRollTools.getToolDefinitions', () => {
  it('exposes the four dice-roll tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'request-player-rolls',
      'request-ability-check',
      'request-attack-roll',
      'roll-npc-check',
    ]);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('request-player-rolls requires rollType, rollTarget, targetPlayer, isPublic, userConfirmedVisibility', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'request-player-rolls')!;
    expect((def.inputSchema as any).required).toEqual([
      'rollType',
      'rollTarget',
      'targetPlayer',
      'isPublic',
      'userConfirmedVisibility',
    ]);
  });

  it('request-ability-check requires targetPlayer, ability, isPublic', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'request-ability-check')!;
    expect((def.inputSchema as any).required).toEqual(['targetPlayer', 'ability', 'isPublic']);
  });

  it('request-attack-roll requires targetPlayer, weaponOrSpellName, isPublic', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'request-attack-roll')!;
    expect((def.inputSchema as any).required).toEqual([
      'targetPlayer',
      'weaponOrSpellName',
      'isPublic',
    ]);
  });

  it('roll-npc-check requires actorName, rollType, rollTarget, isPublic', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'roll-npc-check')!;
    expect((def.inputSchema as any).required).toEqual([
      'actorName',
      'rollType',
      'rollTarget',
      'isPublic',
    ]);
  });
});

// ---------------------------------------------------------------------------
// handleRequestAbilityCheck
// ---------------------------------------------------------------------------

describe('DiceRollTools.handleRequestAbilityCheck', () => {
  it('dispatches requestAbilityCheck with parsed params and returns success string', async () => {
    const { tools, query } = makeTools(() => ({
      success: true,
      message: 'Roll button posted.',
    }));
    const result = await tools.handleRequestAbilityCheck({
      targetPlayer: 'Alice',
      ability: 'dex',
      isPublic: true,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.requestAbilityCheck', {
      targetPlayer: 'Alice',
      ability: 'dex',
      isPublic: true,
    });
    expect(result).toBe('Ability check requested. Roll button posted.');
  });

  it('passes optional dc and reason when provided', async () => {
    const { tools, query } = makeTools(() => ({ success: true, message: 'ok' }));
    await tools.handleRequestAbilityCheck({
      targetPlayer: 'Bob',
      ability: 'wis',
      dc: 15,
      isPublic: false,
      reason: 'Perception check',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.requestAbilityCheck', {
      targetPlayer: 'Bob',
      ability: 'wis',
      dc: 15,
      isPublic: false,
      reason: 'Perception check',
    });
  });

  it('returns a parameter-error string (not a throw) when ability is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestAbilityCheck({ targetPlayer: 'Alice', isPublic: true });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when ability is not a valid enum value', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestAbilityCheck({
      targetPlayer: 'Alice',
      ability: 'luck',
      isPublic: true,
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'player not found' }));
    await expect(
      tools.handleRequestAbilityCheck({ targetPlayer: 'Alice', ability: 'str', isPublic: true })
    ).rejects.toThrow('player not found');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(
      tools.handleRequestAbilityCheck({ targetPlayer: 'Alice', ability: 'str', isPublic: true })
    ).rejects.toThrow('Failed to request ability check');
  });
});

// ---------------------------------------------------------------------------
// handleRequestAttackRoll
// ---------------------------------------------------------------------------

describe('DiceRollTools.handleRequestPlayerRolls', () => {
  it('forwards dc and flavor to the bridge', async () => {
    const { tools, query } = makeTools(() => ({ success: true, message: 'ok' }));
    await tools.handleRequestPlayerRolls({
      rollType: 'skill',
      rollTarget: 'prc',
      targetPlayer: 'Bob',
      isPublic: true,
      userConfirmedVisibility: true,
      flavor: 'DC 14',
      dc: 14,
    });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.request-player-rolls',
      expect.objectContaining({ dc: 14, flavor: 'DC 14', targetPlayer: 'Bob' })
    );
  });

  it('puts the DC on the card through the flavor when the caller sent none', async () => {
    const { tools, query } = makeTools(() => ({ success: true, message: 'ok' }));
    const base = {
      rollType: 'save',
      rollTarget: 'dex',
      targetPlayer: 'Bob',
      isPublic: true,
      userConfirmedVisibility: true,
      dc: 15,
    };
    await tools.handleRequestPlayerRolls(base);
    await tools.handleRequestPlayerRolls({ ...base, flavor: 'Fireball' });
    expect(query.mock.calls.map(c => (c[1] as { flavor: string }).flavor)).toEqual([
      'DC 15',
      'Fireball, DC 15',
    ]);
  });
});

describe('DiceRollTools.handleRequestAttackRoll', () => {
  it('appends an unclear or problem rules check to the reply and stays silent when legal', async () => {
    const { query } = makeTools(() => ({ success: true, message: 'Posted.' }));
    const args = { targetPlayer: 'Carol', weaponOrSpellName: 'Longsword', isPublic: true };
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = (): unknown => logger;
    const run = async (check: unknown): Promise<unknown> => {
      const tryCheck = vi.fn(async () => check);
      const t = new DiceRollTools({
        foundryClient: { query } as any,
        logger,
        rulesCheck: { tryCheck } as any,
      });
      return t.handleRequestAttackRoll(args);
    };
    expect(await run({ verdict: 'problem', summary: 'Carol: no uses left.' })).toBe(
      'Attack roll requested. Posted. Rules check: Carol: no uses left.'
    );
    expect(await run({ verdict: 'legal', summary: 'looks legal.' })).toBe(
      'Attack roll requested. Posted.'
    );
    expect(await run(null)).toBe('Attack roll requested. Posted.');
  });

  it('dispatches requestAttackRoll with parsed params and returns success string', async () => {
    const { tools, query } = makeTools(() => ({
      success: true,
      message: 'Attack roll button posted.',
    }));
    const result = await tools.handleRequestAttackRoll({
      targetPlayer: 'Carol',
      weaponOrSpellName: 'Longsword',
      isPublic: true,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.requestAttackRoll', {
      targetPlayer: 'Carol',
      weaponOrSpellName: 'Longsword',
      isPublic: true,
    });
    expect(result).toBe('Attack roll requested. Attack roll button posted.');
  });

  it('returns a parameter-error string (not a throw) when weaponOrSpellName is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestAttackRoll({
      targetPlayer: 'Carol',
      isPublic: true,
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when targetPlayer is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestAttackRoll({
      weaponOrSpellName: 'Fireball',
      isPublic: false,
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when args are null/undefined', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestAttackRoll(undefined);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'character not found' }));
    await expect(
      tools.handleRequestAttackRoll({
        targetPlayer: 'Carol',
        weaponOrSpellName: 'Dagger',
        isPublic: false,
      })
    ).rejects.toThrow('character not found');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(
      tools.handleRequestAttackRoll({
        targetPlayer: 'Carol',
        weaponOrSpellName: 'Dagger',
        isPublic: false,
      })
    ).rejects.toThrow('Failed to request attack roll');
  });
});

// ---------------------------------------------------------------------------
// handleRollNpcCheck
// ---------------------------------------------------------------------------

describe('DiceRollTools.handleRollNpcCheck', () => {
  it('dispatches rollNpcCheck with parsed params and returns the full response', async () => {
    const payload = { success: true, roll: { total: 14 } };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleRollNpcCheck({
      actorName: 'Goblin',
      rollType: 'skill',
      rollTarget: 'stealth',
      isPublic: false,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.rollNpcCheck', {
      actorName: 'Goblin',
      rollType: 'skill',
      rollTarget: 'stealth',
      isPublic: false,
    });
    expect(result).toBe(payload);
  });

  it('forwards an advantage choice to the bridge and rejects an unknown one', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleRollNpcCheck({
      actorName: 'Goblin',
      rollType: 'save',
      rollTarget: 'dex',
      isPublic: true,
      advantage: 'advantage',
    });
    expect(query.mock.calls[0][1]).toMatchObject({ advantage: 'advantage' });
    const bad = await tools.handleRollNpcCheck({
      actorName: 'Goblin',
      rollType: 'save',
      rollTarget: 'dex',
      isPublic: true,
      advantage: 'sideways',
    });
    expect(bad).toEqual(expect.stringContaining('Parameter error'));
  });

  it('forwards advantage on the ability check and attack requests too', async () => {
    const { tools, query } = makeTools(() => ({ success: true, message: 'ok' }));
    await tools.handleRequestAbilityCheck({
      targetPlayer: 'Alice',
      ability: 'dex',
      isPublic: true,
      advantage: 'disadvantage',
    });
    await tools.handleRequestAttackRoll({
      targetPlayer: 'Alice',
      weaponOrSpellName: 'Longsword',
      isPublic: true,
      advantage: 'advantage',
    });
    expect(query.mock.calls[0][1]).toMatchObject({ advantage: 'disadvantage' });
    expect(query.mock.calls[1][1]).toMatchObject({ advantage: 'advantage' });
  });

  it('returns the response when success is true (not just a string)', async () => {
    const payload = { success: true, details: 'roll data' };
    const { tools } = makeTools(() => payload);
    const result = await tools.handleRollNpcCheck({
      actorName: 'Orc',
      rollType: 'ability',
      rollTarget: 'str',
      isPublic: true,
    });
    expect(result).toBe(payload);
  });

  it('returns a parameter-error string (not a throw) when rollType enum is invalid', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRollNpcCheck({
      actorName: 'Goblin',
      rollType: 'initiative',
      rollTarget: 'str',
      isPublic: true,
    });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when actorName is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRollNpcCheck({
      rollType: 'ability',
      rollTarget: 'str',
      isPublic: true,
    });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when args are null/undefined', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRollNpcCheck(undefined);
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when Foundry reports success === false with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'actor not found' }));
    await expect(
      tools.handleRollNpcCheck({
        actorName: 'Ghost',
        rollType: 'save',
        rollTarget: 'con',
        isPublic: true,
      })
    ).rejects.toThrow('actor not found');
  });

  it('throws a generic message when Foundry reports success === false with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(
      tools.handleRollNpcCheck({
        actorName: 'Ghost',
        rollType: 'attack',
        rollTarget: 'Claws',
        isPublic: false,
      })
    ).rejects.toThrow('Failed to roll NPC check');
  });
});

// ---------------------------------------------------------------------------
// handleRequestPlayerRolls
// ---------------------------------------------------------------------------

describe('DiceRollTools.handleRequestPlayerRolls', () => {
  it('dispatches request-player-rolls with parsed params including schema defaults', async () => {
    const { tools, query } = makeTools(() => ({
      success: true,
      message: 'Roll request sent.',
    }));
    const result = await tools.handleRequestPlayerRolls({
      rollType: 'skill',
      rollTarget: 'perception',
      targetPlayer: 'Dave',
      isPublic: true,
      userConfirmedVisibility: true,
    });
    // Zod applies defaults: rollModifier = '', flavor = ''
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.request-player-rolls', {
      rollType: 'skill',
      rollTarget: 'perception',
      targetPlayer: 'Dave',
      isPublic: true,
      userConfirmedVisibility: true,
      rollModifier: '',
      flavor: '',
    });
    expect(result).toBe('Roll request sent successfully! Roll request sent.');
  });

  it('passes explicit rollModifier and flavor values through', async () => {
    const { tools, query } = makeTools(() => ({ success: true, message: 'ok' }));
    await tools.handleRequestPlayerRolls({
      rollType: 'ability',
      rollTarget: 'str',
      targetPlayer: 'Eve',
      isPublic: false,
      userConfirmedVisibility: true,
      rollModifier: '+2',
      flavor: 'Strength check',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.request-player-rolls', {
      rollType: 'ability',
      rollTarget: 'str',
      targetPlayer: 'Eve',
      isPublic: false,
      userConfirmedVisibility: true,
      rollModifier: '+2',
      flavor: 'Strength check',
    });
  });

  it('returns a parameter-error string (not a throw) when rollType is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestPlayerRolls({
      rollTarget: 'perception',
      targetPlayer: 'Dave',
      isPublic: true,
      userConfirmedVisibility: true,
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when userConfirmedVisibility is not literally true', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestPlayerRolls({
      rollType: 'save',
      rollTarget: 'dex',
      targetPlayer: 'Frank',
      isPublic: true,
      userConfirmedVisibility: false,
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when rollType is not a valid enum value', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestPlayerRolls({
      rollType: 'death',
      rollTarget: 'dex',
      targetPlayer: 'Grace',
      isPublic: true,
      userConfirmedVisibility: true,
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when args are null/undefined', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestPlayerRolls(undefined);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'player offline' }));
    await expect(
      tools.handleRequestPlayerRolls({
        rollType: 'initiative',
        rollTarget: 'initiative',
        targetPlayer: 'Hank',
        isPublic: true,
        userConfirmedVisibility: true,
      })
    ).rejects.toThrow('player offline');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(
      tools.handleRequestPlayerRolls({
        rollType: 'custom',
        rollTarget: '1d20+5',
        targetPlayer: 'Iris',
        isPublic: false,
        userConfirmedVisibility: true,
      })
    ).rejects.toThrow('Failed to request player rolls');
  });
});
