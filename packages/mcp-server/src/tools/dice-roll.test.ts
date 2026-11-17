import { describe, expect, it, vi, type Mock } from 'vitest';

import { DiceRollTools } from './dice-roll.js';

/**
 * Tests for DiceRollTools: a thin, deterministic layer over FoundryClient.query.
 * Pattern: validate args → dispatch correct `foundry-mcp-bridge.*` method →
 * propagate foundry-side failures → return validation errors as strings
 * (all four handlers; ZodError → return string, foundry failure → throw).
 *
 * The FoundryClient is mocked so these tests run with no bridge connection.
 */

function makeTools(queryImpl?: (method: string, data: unknown) => unknown): {
  tools: DiceRollTools;
  query: Mock;
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

  it('request-player-rolls requires rollType, rollTarget, actor and has no visibility gate', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'request-player-rolls')!;
    expect((def.inputSchema as any).required).toEqual(['rollType', 'rollTarget', 'actor']);
    expect((def.inputSchema as any).properties.userConfirmedVisibility).toBeUndefined();
  });

  it('request-ability-check requires actor, ability', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'request-ability-check')!;
    expect((def.inputSchema as any).required).toEqual(['actor', 'ability']);
  });

  it('request-attack-roll requires actor, weaponOrSpellName', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'request-attack-roll')!;
    expect((def.inputSchema as any).required).toEqual(['actor', 'weaponOrSpellName']);
  });

  it('the three request tools default isPublic to true', () => {
    const { tools } = makeTools();
    for (const name of ['request-player-rolls', 'request-ability-check', 'request-attack-roll']) {
      const def = tools.getToolDefinitions().find(d => d.name === name)!;
      expect((def.inputSchema as any).properties.isPublic.default).toBe(true);
    }
  });

  it('roll-npc-check requires actor, rollType, rollTarget, isPublic', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'roll-npc-check')!;
    expect((def.inputSchema as any).required).toEqual([
      'actor',
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
      actor: 'Alice',
      ability: 'dex',
      isPublic: true,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.request-player-rolls', {
      targetPlayer: 'Alice',
      rollType: 'ability',
      rollTarget: 'dex',
      isPublic: true,
      rollModifier: '',
      flavor: '',
    });
    expect(result).toBe('Roll request sent successfully! Roll button posted.');
  });

  it('passes optional dc and reason when provided', async () => {
    const { tools, query } = makeTools(() => ({ success: true, message: 'ok' }));
    await tools.handleRequestAbilityCheck({
      actor: 'Bob',
      ability: 'wis',
      dc: 15,
      isPublic: false,
      reason: 'Perception check',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.request-player-rolls', {
      targetPlayer: 'Bob',
      rollType: 'ability',
      rollTarget: 'wis',
      dc: 15,
      isPublic: false,
      rollModifier: '',
      flavor: 'Perception check, DC 15',
    });
  });

  it('refuses a DC outside 1 to 99 at its own boundary', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestAbilityCheck({
      actor: 'Alice',
      ability: 'str',
      dc: 100,
    });
    expect(result).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps the attack card text when a DC is given', async () => {
    const { tools, query } = makeTools(() => ({ success: true, message: 'ok' }));
    await tools.handleRequestPlayerRolls({
      rollType: 'attack',
      rollTarget: 'Longsword',
      actor: 'Carol',
      dc: 15,
    });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.request-player-rolls',
      expect.objectContaining({ flavor: 'Longsword attack, DC 15' })
    );
  });

  it('returns a parameter-error string (not a throw) when ability is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestAbilityCheck({ actor: 'Alice', isPublic: true });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when ability is not a valid enum value', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestAbilityCheck({
      actor: 'Alice',
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
      tools.handleRequestAbilityCheck({ actor: 'Alice', ability: 'str', isPublic: true })
    ).rejects.toThrow('player not found');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(
      tools.handleRequestAbilityCheck({ actor: 'Alice', ability: 'str', isPublic: true })
    ).rejects.toThrow('Failed to request player rolls');
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
      actor: 'Bob',
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
      actor: 'Bob',
      isPublic: true,
      userConfirmedVisibility: true,
      dc: 15,
    };
    await tools.handleRequestPlayerRolls(base);
    await tools.handleRequestPlayerRolls({ ...base, flavor: 'Fireball' });
    await tools.handleRequestPlayerRolls({ ...base, dc: 1, flavor: 'DC 15' });
    expect(query.mock.calls.map(c => (c[1] as { flavor: string }).flavor)).toEqual([
      'DC 15',
      'Fireball, DC 15',
      'DC 15, DC 1',
    ]);
  });
});

describe('DiceRollTools.handleRequestAttackRoll', () => {
  it('appends an unclear or problem rules check to the reply and stays silent when legal', async () => {
    const { query } = makeTools(() => ({ success: true, message: 'Posted.' }));
    const args = { actor: 'Carol', weaponOrSpellName: 'Longsword', isPublic: true };
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
      'Roll request sent successfully! Posted. Rules check: Carol: no uses left.'
    );
    expect(await run({ verdict: 'legal', summary: 'looks legal.' })).toBe(
      'Roll request sent successfully! Posted.'
    );
    expect(await run(null)).toBe('Roll request sent successfully! Posted.');
  });

  it('request-player-rolls with rollType attack does the same rules check and card text', async () => {
    const { query } = makeTools(() => ({ success: true, message: 'Posted.' }));
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = (): unknown => logger;
    const tryCheck = vi.fn(async () => ({ verdict: 'problem', summary: 'no uses left.' }));
    const t = new DiceRollTools({
      foundryClient: { query } as any,
      logger,
      rulesCheck: { tryCheck } as any,
    });
    const out = await t.handleRequestPlayerRolls({
      rollType: 'attack',
      rollTarget: 'Longsword',
      actor: 'Carol',
    });
    expect(tryCheck).toHaveBeenCalledWith({ actor: 'Carol', item: 'Longsword' });
    expect(out).toBe('Roll request sent successfully! Posted. Rules check: no uses left.');
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.request-player-rolls',
      expect.objectContaining({ flavor: 'Longsword attack' })
    );
  });

  it('dispatches requestAttackRoll with parsed params and returns success string', async () => {
    const { tools, query } = makeTools(() => ({
      success: true,
      message: 'Attack roll button posted.',
    }));
    const result = await tools.handleRequestAttackRoll({
      actor: 'Carol',
      weaponOrSpellName: 'Longsword',
      isPublic: true,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.request-player-rolls', {
      targetPlayer: 'Carol',
      rollType: 'attack',
      rollTarget: 'Longsword',
      isPublic: true,
      rollModifier: '',
      flavor: 'Longsword attack',
    });
    expect(result).toBe('Roll request sent successfully! Attack roll button posted.');
  });

  it('returns a parameter-error string (not a throw) when weaponOrSpellName is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestAttackRoll({
      actor: 'Carol',
      isPublic: true,
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when actor is missing', async () => {
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
        actor: 'Carol',
        weaponOrSpellName: 'Dagger',
        isPublic: false,
      })
    ).rejects.toThrow('character not found');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(
      tools.handleRequestAttackRoll({
        actor: 'Carol',
        weaponOrSpellName: 'Dagger',
        isPublic: false,
      })
    ).rejects.toThrow('Failed to request player rolls');
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
      actor: 'Goblin',
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
      actor: 'Goblin',
      rollType: 'save',
      rollTarget: 'dex',
      isPublic: true,
      advantage: 'advantage',
    });
    expect(query.mock.calls[0][1]).toMatchObject({ advantage: 'advantage' });
    const bad = await tools.handleRollNpcCheck({
      actor: 'Goblin',
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
      actor: 'Alice',
      ability: 'dex',
      isPublic: true,
      advantage: 'disadvantage',
    });
    await tools.handleRequestAttackRoll({
      actor: 'Alice',
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
      actor: 'Orc',
      rollType: 'ability',
      rollTarget: 'str',
      isPublic: true,
    });
    expect(result).toBe(payload);
  });

  it('returns a parameter-error string (not a throw) when rollType enum is invalid', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRollNpcCheck({
      actor: 'Goblin',
      rollType: 'initiative',
      rollTarget: 'str',
      isPublic: true,
    });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when actor is missing', async () => {
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
        actor: 'Ghost',
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
        actor: 'Ghost',
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
      actor: 'Dave',
      isPublic: true,
      userConfirmedVisibility: true,
    });
    // Zod applies defaults: rollModifier = '', flavor = ''
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.request-player-rolls', {
      rollType: 'skill',
      rollTarget: 'perception',
      targetPlayer: 'Dave',
      isPublic: true,
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
      actor: 'Eve',
      isPublic: false,
      rollModifier: '+2',
      flavor: 'Strength check',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.request-player-rolls', {
      rollType: 'ability',
      rollTarget: 'str',
      targetPlayer: 'Eve',
      isPublic: false,
      rollModifier: '+2',
      flavor: 'Strength check',
    });
  });

  it('returns a parameter-error string (not a throw) when rollType is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestPlayerRolls({
      rollTarget: 'perception',
      actor: 'Dave',
      isPublic: true,
      userConfirmedVisibility: true,
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('defaults isPublic to true and ignores the old userConfirmedVisibility argument', async () => {
    const { tools, query } = makeTools(() => ({ success: true, message: 'ok' }));
    await tools.handleRequestPlayerRolls({
      rollType: 'save',
      rollTarget: 'dex',
      actor: 'Frank',
      userConfirmedVisibility: false,
    });
    const sent = query.mock.calls[0][1] as Record<string, unknown>;
    expect(sent.isPublic).toBe(true);
    expect(sent).not.toHaveProperty('userConfirmedVisibility');
  });

  it('defaults isPublic to true for ability checks and attack rolls', async () => {
    const { tools, query } = makeTools(() => ({ success: true, message: 'ok' }));
    await tools.handleRequestAbilityCheck({ actor: 'Alice', ability: 'str' });
    await tools.handleRequestAttackRoll({ actor: 'Carol', weaponOrSpellName: 'Longsword' });
    expect(query.mock.calls.map(c => (c[1] as { isPublic: boolean }).isPublic)).toEqual([
      true,
      true,
    ]);
  });

  it('returns a parameter-error string when rollType is not a valid enum value', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRequestPlayerRolls({
      rollType: 'death',
      rollTarget: 'dex',
      actor: 'Grace',
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
        actor: 'Hank',
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
        actor: 'Iris',
        isPublic: false,
        userConfirmedVisibility: true,
      })
    ).rejects.toThrow('Failed to request player rolls');
  });
});
