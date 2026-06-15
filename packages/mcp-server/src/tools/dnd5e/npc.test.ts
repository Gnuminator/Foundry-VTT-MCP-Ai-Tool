import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DnD5eNpcTools } from './npc.js';
import { clearSystemCache } from '../../utils/system-detection.js';

/**
 * Tests for DnD5eNpcTools — a thin, deterministic layer over FoundryClient.query.
 * Pattern: validate args (Zod — throws on failure) → detect game system via
 * foundry-mcp-bridge.getWorldInfo → dispatch foundry-mcp-bridge.createNpcActor
 * → propagate errors through ErrorHandler (always throws).
 *
 * The FoundryClient is mocked so these tests run with no bridge connection.
 * We clear the module-level system cache before each test so detectGameSystem
 * always issues a fresh getWorldInfo query.
 */

// ---------------------------------------------------------------------------
// Minimal valid args for handleCreateNpc — override fields per test as needed.
// ---------------------------------------------------------------------------
const VALID_ARGS = {
  name: 'Test Goblin',
  creatureType: 'humanoid',
  size: 'small',
  cr: '1/4',
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  hpAverage: 7,
  hpFormula: '2d6',
  acMode: 'default',
} as const;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Build a query mock that returns `dnd5e` for getWorldInfo and `successResult`
 * for createNpcActor.
 */
function makeQueryForDnd5e(
  successResult: unknown = { actor: { id: 'abc', name: 'Test Goblin', cr: '1/4' } }
) {
  return vi.fn((method: string) => {
    if (method === 'foundry-mcp-bridge.getWorldInfo') {
      return { system: 'dnd5e' };
    }
    if (method === 'foundry-mcp-bridge.createNpcActor') {
      return successResult;
    }
    return { success: true };
  });
}

function makeTools(queryImpl?: (method: string, data: unknown) => unknown) {
  const query = vi.fn(queryImpl ?? makeQueryForDnd5e());
  const foundryClient = { query } as any;
  // Minimal Logger stub: `.child()` returns itself; level methods are no-ops.
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = () => logger;
  return { tools: new DnD5eNpcTools({ foundryClient, logger }), query };
}

// ---------------------------------------------------------------------------
// Reset module-level detectGameSystem cache between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  clearSystemCache();
});

afterEach(() => {
  clearSystemCache();
});

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('DnD5eNpcTools.getToolDefinitions', () => {
  it('exposes exactly one tool: dnd5e-create-npc', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['dnd5e-create-npc']);
  });

  it('dnd5e-create-npc has an object input schema', () => {
    const { tools } = makeTools();
    const [def] = tools.getToolDefinitions();
    expect((def.inputSchema as any).type).toBe('object');
  });

  it('dnd5e-create-npc lists the expected required fields', () => {
    const { tools } = makeTools();
    const [def] = tools.getToolDefinitions();
    expect((def.inputSchema as any).required).toEqual([
      'name',
      'creatureType',
      'size',
      'cr',
      'abilities',
      'hpAverage',
      'hpFormula',
      'acMode',
    ]);
  });

  it('abilities sub-schema requires all six scores', () => {
    const { tools } = makeTools();
    const [def] = tools.getToolDefinitions();
    const abilitiesProp = (def.inputSchema as any).properties.abilities;
    expect(abilitiesProp.required).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
  });

  it('cr field uses oneOf (string pattern + number)', () => {
    const { tools } = makeTools();
    const [def] = tools.getToolDefinitions();
    const crProp = (def.inputSchema as any).properties.cr;
    expect(crProp).toHaveProperty('oneOf');
    expect(crProp.oneOf).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// handleCreateNpc — happy path dispatch
// ---------------------------------------------------------------------------

describe('DnD5eNpcTools.handleCreateNpc — happy path', () => {
  it('calls getWorldInfo then createNpcActor with parsed args', async () => {
    const actorResult = { actor: { id: 'npc-1', name: 'Test Goblin', cr: '1/4' } };
    const query = makeQueryForDnd5e(actorResult);
    const foundryClient = { query } as any;
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = () => logger;
    const tools = new DnD5eNpcTools({ foundryClient, logger });

    await tools.handleCreateNpc({ ...VALID_ARGS });

    // detectGameSystem calls query with only one arg — no second param
    const worldInfoCall = query.mock.calls.find(
      ([m]: [string]) => m === 'foundry-mcp-bridge.getWorldInfo'
    );
    expect(worldInfoCall).toBeDefined();

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.createNpcActor',
      expect.objectContaining({
        name: 'Test Goblin',
        creatureType: 'humanoid',
        size: 'small',
        cr: '1/4',
        hpAverage: 7,
        hpFormula: '2d6',
        acMode: 'default',
      })
    );
  });

  it('returns success:true with actor info and no warnings for canonical args', async () => {
    const actorResult = { actor: { id: 'npc-1', name: 'Test Goblin', cr: '1/4' } };
    const { tools } = makeTools(makeQueryForDnd5e(actorResult));

    const result = await tools.handleCreateNpc({ ...VALID_ARGS });

    expect(result.success).toBe(true);
    expect(result.actor).toEqual(actorResult.actor);
    expect(result.warnings).toEqual([]);
  });

  it('passes default movement speeds when omitted', async () => {
    const query = makeQueryForDnd5e();
    const foundryClient = { query } as any;
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = () => logger;
    const tools = new DnD5eNpcTools({ foundryClient, logger });

    await tools.handleCreateNpc({ ...VALID_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.createNpcActor',
      expect.objectContaining({
        walkSpeed: 30,
        flySpeed: 0,
        swimSpeed: 0,
        climbSpeed: 0,
        burrowSpeed: 0,
        hover: false,
      })
    );
  });

  it('supports numeric CR (0.25)', async () => {
    const { tools, query } = makeTools(makeQueryForDnd5e());

    await tools.handleCreateNpc({ ...VALID_ARGS, cr: 0.25 });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.createNpcActor',
      expect.objectContaining({ cr: 0.25 })
    );
  });

  it('supports string CR fraction "1/2"', async () => {
    const { tools, query } = makeTools(makeQueryForDnd5e());

    await tools.handleCreateNpc({ ...VALID_ARGS, cr: '1/2' });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.createNpcActor',
      expect.objectContaining({ cr: '1/2' })
    );
  });

  it('passes acValue through when acMode is flat', async () => {
    const { tools, query } = makeTools(makeQueryForDnd5e());

    await tools.handleCreateNpc({ ...VALID_ARGS, acMode: 'flat', acValue: 15 });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.createNpcActor',
      expect.objectContaining({ acMode: 'flat', acValue: 15 })
    );
  });

  it('includes savingThrows and skills in the dispatched payload', async () => {
    const { tools, query } = makeTools(makeQueryForDnd5e());

    await tools.handleCreateNpc({
      ...VALID_ARGS,
      savingThrows: ['str', 'con'],
      skills: [{ skill: 'Stealth', proficiency: 'expert' }],
    });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.createNpcActor',
      expect.objectContaining({
        savingThrows: ['str', 'con'],
        skills: [{ skill: 'Stealth', proficiency: 'expert' }],
      })
    );
  });
});

// ---------------------------------------------------------------------------
// handleCreateNpc — warnings (soft validation — does NOT block creation)
// ---------------------------------------------------------------------------

describe('DnD5eNpcTools.handleCreateNpc — soft validation warnings', () => {
  it('returns warnings for non-canonical damage types but still succeeds', async () => {
    const actorResult = { actor: { id: 'npc-2', name: 'Test Goblin', cr: '1/4' } };
    const { tools } = makeTools(makeQueryForDnd5e(actorResult));

    const result = await tools.handleCreateNpc({
      ...VALID_ARGS,
      damageImmunities: ['poison', 'silver'], // "silver" is non-canonical
    });

    expect(result.success).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w: string) => w.includes('silver'))).toBe(true);
  });

  it('returns warnings for non-canonical condition immunities but still succeeds', async () => {
    const actorResult = { actor: { id: 'npc-3', name: 'Test Goblin', cr: '1/4' } };
    const { tools } = makeTools(makeQueryForDnd5e(actorResult));

    const result = await tools.handleCreateNpc({
      ...VALID_ARGS,
      conditionImmunities: ['charmed', 'cursed'], // "cursed" is non-canonical
    });

    expect(result.success).toBe(true);
    expect(result.warnings.some((w: string) => w.includes('cursed'))).toBe(true);
  });

  it('no warnings when all damage/condition types are canonical', async () => {
    const actorResult = { actor: { id: 'npc-4', name: 'Test Goblin', cr: '1/4' } };
    const { tools } = makeTools(makeQueryForDnd5e(actorResult));

    const result = await tools.handleCreateNpc({
      ...VALID_ARGS,
      damageImmunities: ['fire', 'poison'],
      conditionImmunities: ['charmed', 'frightened'],
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// handleCreateNpc — validation errors (Zod throws — query NOT called)
// ---------------------------------------------------------------------------

describe('DnD5eNpcTools.handleCreateNpc — Zod validation throws', () => {
  it('throws (ZodError) when name is missing', async () => {
    const { tools, query } = makeTools();
    const { name: _name, ...noName } = VALID_ARGS as any;

    await expect(tools.handleCreateNpc(noName)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when name is an empty string', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleCreateNpc({ ...VALID_ARGS, name: '' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when creatureType is invalid', async () => {
    const { tools, query } = makeTools();

    await expect(
      tools.handleCreateNpc({ ...VALID_ARGS, creatureType: 'dragon-turtle' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when size is invalid', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleCreateNpc({ ...VALID_ARGS, size: 'colossal' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when cr string is an invalid fraction', async () => {
    const { tools, query } = makeTools();

    await expect(
      tools.handleCreateNpc({ ...VALID_ARGS, cr: '3/5' }) // invalid fraction
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when hpAverage is zero (minimum 1)', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleCreateNpc({ ...VALID_ARGS, hpAverage: 0 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when hpFormula is empty string', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleCreateNpc({ ...VALID_ARGS, hpFormula: '' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when acMode is "flat" but acValue is not provided', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleCreateNpc({ ...VALID_ARGS, acMode: 'flat' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when an ability score is missing', async () => {
    const { tools, query } = makeTools();
    const { cha: _cha, ...noChA } = VALID_ARGS.abilities as any;

    await expect(tools.handleCreateNpc({ ...VALID_ARGS, abilities: noChA })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (ZodError) when an ability score is out of range (> 30)', async () => {
    const { tools, query } = makeTools();

    await expect(
      tools.handleCreateNpc({ ...VALID_ARGS, abilities: { ...VALID_ARGS.abilities, str: 31 } })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleCreateNpc — system check failure
// ---------------------------------------------------------------------------

describe('DnD5eNpcTools.handleCreateNpc — system check', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    clearSystemCache();
  });

  afterEach(() => {
    consoleErr.mockRestore();
    clearSystemCache();
  });

  it('throws when the active system is not dnd5e', async () => {
    const query = vi.fn((method: string) => {
      if (method === 'foundry-mcp-bridge.getWorldInfo') {
        return { system: 'pf2e' };
      }
      return { success: true };
    });
    const foundryClient = { query } as any;
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = () => logger;
    const tools = new DnD5eNpcTools({ foundryClient, logger });

    await expect(tools.handleCreateNpc({ ...VALID_ARGS })).rejects.toThrow();
    // createNpcActor must NOT have been called
    expect(query).not.toHaveBeenCalledWith('foundry-mcp-bridge.createNpcActor', expect.anything());
  });

  it('throws when getWorldInfo call itself fails', async () => {
    const query = vi.fn((method: string) => {
      if (method === 'foundry-mcp-bridge.getWorldInfo') {
        throw new Error('connection timeout');
      }
      return { success: true };
    });
    const foundryClient = { query } as any;
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = () => logger;
    const tools = new DnD5eNpcTools({ foundryClient, logger });

    // detectGameSystem catches the error and caches 'other', which then triggers
    // the "not dnd5e" branch — so we still expect a throw
    await expect(tools.handleCreateNpc({ ...VALID_ARGS })).rejects.toThrow();
    expect(query).not.toHaveBeenCalledWith('foundry-mcp-bridge.createNpcActor', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// handleCreateNpc — Foundry-side failure
// ---------------------------------------------------------------------------

describe('DnD5eNpcTools.handleCreateNpc — Foundry-side failure', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    clearSystemCache();
  });

  afterEach(() => {
    consoleErr.mockRestore();
    clearSystemCache();
  });

  it('throws (via ErrorHandler) when createNpcActor throws an error', async () => {
    const query = vi.fn((method: string) => {
      if (method === 'foundry-mcp-bridge.getWorldInfo') {
        return { system: 'dnd5e' };
      }
      if (method === 'foundry-mcp-bridge.createNpcActor') {
        throw new Error('actor creation failed: folder not found');
      }
      return { success: true };
    });
    const foundryClient = { query } as any;
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = () => logger;
    const tools = new DnD5eNpcTools({ foundryClient, logger });

    await expect(tools.handleCreateNpc({ ...VALID_ARGS })).rejects.toThrow();
  });

  it('the thrown error from ErrorHandler is an Error instance', async () => {
    const query = vi.fn((method: string) => {
      if (method === 'foundry-mcp-bridge.getWorldInfo') {
        return { system: 'dnd5e' };
      }
      if (method === 'foundry-mcp-bridge.createNpcActor') {
        throw new Error('permission denied for NPC creation');
      }
      return { success: true };
    });
    const foundryClient = { query } as any;
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = () => logger;
    const tools = new DnD5eNpcTools({ foundryClient, logger });

    try {
      await tools.handleCreateNpc({ ...VALID_ARGS });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});

// ---------------------------------------------------------------------------
// handleCreateNpc — formatResponse shape
// ---------------------------------------------------------------------------

describe('DnD5eNpcTools.handleCreateNpc — response shape', () => {
  it('response has summary, success, actor, warnings, message keys', async () => {
    const actorResult = {
      actor: { id: 'npc-5', name: 'Test Goblin', cr: '1/4', folder: 'Foundry MCP Creatures' },
    };
    const { tools } = makeTools(makeQueryForDnd5e(actorResult));

    const result = await tools.handleCreateNpc({ ...VALID_ARGS });

    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('actor');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('message');
  });

  it('summary includes the actor name and CR', async () => {
    const actorResult = { actor: { id: 'npc-6', name: 'Test Goblin', cr: '1/4' } };
    const { tools } = makeTools(makeQueryForDnd5e(actorResult));

    const result = await tools.handleCreateNpc({ ...VALID_ARGS });

    expect(result.summary).toContain('Test Goblin');
    expect(result.summary).toContain('1/4');
  });

  it('message includes folder line when actor.folder is set', async () => {
    const actorResult = {
      actor: { id: 'npc-7', name: 'Test Goblin', cr: '1/4', folder: 'Foundry MCP Creatures' },
    };
    const { tools } = makeTools(makeQueryForDnd5e(actorResult));

    const result = await tools.handleCreateNpc({ ...VALID_ARGS });

    expect(result.message).toContain('Foundry MCP Creatures');
  });

  it('message contains warning section when warnings are present', async () => {
    const actorResult = { actor: { id: 'npc-8', name: 'Test Goblin', cr: '1/4' } };
    const { tools } = makeTools(makeQueryForDnd5e(actorResult));

    const result = await tools.handleCreateNpc({
      ...VALID_ARGS,
      damageResistances: ['silver'], // non-canonical → warning
    });

    expect(result.message).toContain('Warnings');
  });
});
