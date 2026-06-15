import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DnD5eAddFeatureTool } from './add-feature.js';
import { clearSystemCache } from '../../utils/system-detection.js';

/**
 * Characterization tests for DnD5eAddFeatureTool.
 *
 * Pattern: mock FoundryClient.query (+ detectGameSystem via getWorldInfo) and
 * assert the tool layer behaves exactly as the source defines — arg parsing,
 * dispatch method, result shaping, system guard, and error propagation.
 *
 * One tool definition (`dnd5e-add-feature`) with featureType discriminator,
 * dispatching to seven internal handlers:
 *   passive        → foundry-mcp-bridge.addPassiveFeatureToActor
 *   save           → foundry-mcp-bridge.addSaveFeatureToActor
 *   attack         → foundry-mcp-bridge.addAttackToActor
 *   attack-with-save → foundry-mcp-bridge.addAttackWithSaveToActor
 *   aura           → foundry-mcp-bridge.addAuraToActor
 *   spellcasting   → foundry-mcp-bridge.setActorSpellcasting
 *   spells         → foundry-mcp-bridge.addSpellsToActor
 */

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const ACTOR_RESULT = { id: 'actor-1', name: 'Flame Drake' };
const ITEM_RESULT = { id: 'item-1', name: 'Fire Breath' };
const BASE_RESULT = { actor: ACTOR_RESULT, item: ITEM_RESULT };

// Minimal damage part used across handlers that require damageParts.
const FIRE_DAMAGE = { number: 3, denomination: 6, type: 'fire' };
const PIERCE_DAMAGE = { number: 1, denomination: 6, type: 'piercing' };
const POISON_DAMAGE = { number: 2, denomination: 8, type: 'poison' };

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a query mock that returns `dnd5e` from getWorldInfo, plus a custom
 * handler map for specific bridge methods. Unknown methods default to
 * `{ actor: ACTOR_RESULT, item: ITEM_RESULT }`.
 */
function makeQueryForDnd5e(overrides: Record<string, unknown> = {}) {
  return vi.fn((method: string) => {
    if (method === 'foundry-mcp-bridge.getWorldInfo') {
      return { system: 'dnd5e' };
    }
    if (method in overrides) {
      const val = overrides[method];
      if (val instanceof Error) throw val;
      return val;
    }
    return BASE_RESULT;
  });
}

function makeTools(queryImpl?: (method: string, data: unknown) => unknown) {
  const query = vi.fn(queryImpl ?? makeQueryForDnd5e());
  const foundryClient = { query } as any;
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = () => logger;
  return { tools: new DnD5eAddFeatureTool({ foundryClient, logger }), query, logger };
}

// ---------------------------------------------------------------------------
// Cache lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearSystemCache();
});

afterEach(() => {
  clearSystemCache();
});

// ===========================================================================
// getToolDefinitions
// ===========================================================================

describe('DnD5eAddFeatureTool.getToolDefinitions', () => {
  it('exposes exactly one tool: dnd5e-add-feature', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['dnd5e-add-feature']);
  });

  it('tool has an object inputSchema', () => {
    const { tools } = makeTools();
    const [def] = tools.getToolDefinitions();
    expect((def.inputSchema as any).type).toBe('object');
  });

  it('required fields are featureType and actorIdentifier', () => {
    const { tools } = makeTools();
    const [def] = tools.getToolDefinitions();
    expect((def.inputSchema as any).required).toEqual(['featureType', 'actorIdentifier']);
  });

  it('featureType enum contains all seven modes', () => {
    const { tools } = makeTools();
    const [def] = tools.getToolDefinitions();
    const featureTypeProp = (def.inputSchema as any).properties.featureType;
    expect(featureTypeProp.enum).toEqual([
      'passive',
      'save',
      'attack',
      'attack-with-save',
      'aura',
      'spellcasting',
      'spells',
    ]);
  });

  it('description is a non-empty string', () => {
    const { tools } = makeTools();
    const [def] = tools.getToolDefinitions();
    expect(typeof def.description).toBe('string');
    expect(def.description.length).toBeGreaterThan(0);
  });

  it('damageParts items schema has required number, denomination, type', () => {
    const { tools } = makeTools();
    const [def] = tools.getToolDefinitions();
    const dp = (def.inputSchema as any).properties.damageParts;
    expect(dp.items.required).toEqual(['number', 'denomination', 'type']);
  });

  it('attackType enum is ["melee", "ranged"]', () => {
    const { tools } = makeTools();
    const [def] = tools.getToolDefinitions();
    expect((def.inputSchema as any).properties.attackType.enum).toEqual(['melee', 'ranged']);
  });

  it('saveAbility enum contains all six abilities', () => {
    const { tools } = makeTools();
    const [def] = tools.getToolDefinitions();
    const sa = (def.inputSchema as any).properties.saveAbility;
    expect(sa.enum).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
  });

  it('spellcastingClass enum lists nine classes', () => {
    const { tools } = makeTools();
    const [def] = tools.getToolDefinitions();
    const sc = (def.inputSchema as any).properties.spellcastingClass;
    expect(sc.enum).toHaveLength(9);
    expect(sc.enum).toContain('wizard');
    expect(sc.enum).toContain('warlock');
  });
});

// ===========================================================================
// handleAddFeature dispatcher
// ===========================================================================

describe('DnD5eAddFeatureTool.handleAddFeature — dispatcher', () => {
  it('throws ZodError for an unknown featureType', async () => {
    const { tools } = makeTools();
    await expect(
      tools.handleAddFeature({ featureType: 'unknown', actorIdentifier: 'Goblin' })
    ).rejects.toThrow();
  });

  it('throws ZodError when featureType is missing', async () => {
    const { tools } = makeTools();
    await expect(tools.handleAddFeature({ actorIdentifier: 'Goblin' })).rejects.toThrow();
  });
});

// ===========================================================================
// passive handler
// ===========================================================================

describe('DnD5eAddFeatureTool — passive', () => {
  const BASE_ARGS = {
    featureType: 'passive' as const,
    actorIdentifier: 'Flame Drake',
    featureName: 'Magic Resistance',
  };

  it('calls addPassiveFeatureToActor with parsed args', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addPassiveFeatureToActor',
      expect.objectContaining({
        featureType: 'passive',
        actorIdentifier: 'Flame Drake',
        featureName: 'Magic Resistance',
      })
    );
  });

  it('issues getWorldInfo before addPassiveFeatureToActor', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    const methods = query.mock.calls.map(([m]: [string]) => m);
    const worldIdx = methods.indexOf('foundry-mcp-bridge.getWorldInfo');
    const addIdx = methods.indexOf('foundry-mcp-bridge.addPassiveFeatureToActor');
    expect(worldIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThan(worldIdx);
  });

  it('returns success:true with item and actor from the bridge', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.success).toBe(true);
    expect(result.item).toEqual(ITEM_RESULT);
    expect(result.actor).toEqual(ACTOR_RESULT);
  });

  it('response shape has summary, success, item, actor, message', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('item');
    expect(result).toHaveProperty('actor');
    expect(result).toHaveProperty('message');
  });

  it('summary contains item name and actor name', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.summary).toContain(ITEM_RESULT.name);
    expect(result.summary).toContain(ACTOR_RESULT.name);
  });

  it('message contains "passive / descriptive" type line', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).toContain('passive / descriptive');
  });

  it('passes default sourceRules "2014" when omitted', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addPassiveFeatureToActor',
      expect.objectContaining({ sourceRules: '2014' })
    );
  });

  it('passes sourceBook through when provided', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS, sourceBook: "MM'14", sourcePage: '312' });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addPassiveFeatureToActor',
      expect.objectContaining({ sourceBook: "MM'14", sourcePage: '312' })
    );
  });

  it('sourceBook appears in message when provided', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS, sourceBook: "MM'14" });

    expect(result.message).toContain("MM'14");
  });

  it('throws ZodError when actorIdentifier is empty string', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleAddFeature({ ...BASE_ARGS, actorIdentifier: '' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when featureName is empty string', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleAddFeature({ ...BASE_ARGS, featureName: '' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  describe('passive — system guard', () => {
    let consoleErr: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
      clearSystemCache();
    });
    afterEach(() => {
      consoleErr.mockRestore();
      clearSystemCache();
    });

    it('throws when active system is not dnd5e', async () => {
      const query = vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'pf2e' };
        return BASE_RESULT;
      });
      const { tools } = makeTools(query);

      await expect(tools.handleAddFeature({ ...BASE_ARGS })).rejects.toThrow();
      expect(query).not.toHaveBeenCalledWith(
        'foundry-mcp-bridge.addPassiveFeatureToActor',
        expect.anything()
      );
    });

    it('throws (via ErrorHandler) when addPassiveFeatureToActor throws', async () => {
      const query = vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'dnd5e' };
        throw new Error('actor not found');
      });
      const { tools } = makeTools(query);

      await expect(tools.handleAddFeature({ ...BASE_ARGS })).rejects.toThrow();
    });
  });
});

// ===========================================================================
// save handler
// ===========================================================================

describe('DnD5eAddFeatureTool — save', () => {
  const BASE_ARGS = {
    featureType: 'save' as const,
    actorIdentifier: 'Flame Drake',
    featureName: 'Fire Breath',
    saveAbility: 'dex' as const,
    saveDC: 15,
    damageParts: [FIRE_DAMAGE],
  };

  it('calls addSaveFeatureToActor with parsed args', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addSaveFeatureToActor',
      expect.objectContaining({
        featureType: 'save',
        actorIdentifier: 'Flame Drake',
        featureName: 'Fire Breath',
        saveAbility: 'dex',
        saveDC: 15,
        damageParts: [FIRE_DAMAGE],
      })
    );
  });

  it('returns success:true with item and actor', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.success).toBe(true);
    expect(result.actor).toEqual(ACTOR_RESULT);
    expect(result.item).toEqual(ITEM_RESULT);
  });

  it('response has summary, success, item, actor, message', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('item');
    expect(result).toHaveProperty('actor');
    expect(result).toHaveProperty('message');
  });

  it('message contains save description with DC and ability', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).toContain('DC 15');
    expect(result.message).toContain('DEX');
  });

  it('message contains damage description', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    // "3d6 fire"
    expect(result.message).toContain('3d6 fire');
  });

  it('message says "half damage on save" when halfOnSave defaults to true', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).toContain('half damage on save');
  });

  it('message says "no damage on save" when halfOnSave is false', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS, halfOnSave: false });

    expect(result.message).toContain('no damage on save');
  });

  it('passes halfOnSave default true when omitted', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addSaveFeatureToActor',
      expect.objectContaining({ halfOnSave: true })
    );
  });

  it('passes areaSize and areaType when provided', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS, areaType: 'cone', areaSize: 30 });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addSaveFeatureToActor',
      expect.objectContaining({ areaType: 'cone', areaSize: 30 })
    );
  });

  it('message contains area description when areaType is set', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS, areaType: 'cone', areaSize: 30 });

    expect(result.message).toContain('30ft cone');
  });

  it('throws ZodError when saveDC > 30', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleAddFeature({ ...BASE_ARGS, saveDC: 31 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when damageParts is empty array', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleAddFeature({ ...BASE_ARGS, damageParts: [] })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when denomination is not in valid set', async () => {
    const { tools, query } = makeTools();

    await expect(
      tools.handleAddFeature({
        ...BASE_ARGS,
        damageParts: [{ number: 3, denomination: 7, type: 'fire' }],
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when areaType is set but areaSize is missing (superRefine)', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleAddFeature({ ...BASE_ARGS, areaType: 'cone' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  describe('save — system guard', () => {
    let consoleErr: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
      clearSystemCache();
    });
    afterEach(() => {
      consoleErr.mockRestore();
      clearSystemCache();
    });

    it('throws when active system is not dnd5e', async () => {
      const query = vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'other' };
        return BASE_RESULT;
      });
      const { tools } = makeTools(query);

      await expect(tools.handleAddFeature({ ...BASE_ARGS })).rejects.toThrow();
      expect(query).not.toHaveBeenCalledWith(
        'foundry-mcp-bridge.addSaveFeatureToActor',
        expect.anything()
      );
    });

    it('throws (via ErrorHandler) when addSaveFeatureToActor throws', async () => {
      const query = vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'dnd5e' };
        throw new Error('save feature creation failed');
      });
      const { tools } = makeTools(query);

      await expect(tools.handleAddFeature({ ...BASE_ARGS })).rejects.toThrow();
    });
  });
});

// ===========================================================================
// attack handler
// ===========================================================================

describe('DnD5eAddFeatureTool — attack', () => {
  const BASE_ARGS = {
    featureType: 'attack' as const,
    actorIdentifier: 'Flame Drake',
    featureName: 'Claw',
    attackType: 'melee' as const,
    damageParts: [PIERCE_DAMAGE],
  };

  const BASE_ARGS_RANGED = {
    featureType: 'attack' as const,
    actorIdentifier: 'Archer',
    featureName: 'Longbow',
    attackType: 'ranged' as const,
    damageParts: [{ number: 1, denomination: 8, type: 'piercing' }],
    rangeFt: 150,
  };

  it('calls addAttackToActor with parsed args including effectiveAbility', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addAttackToActor',
      expect.objectContaining({
        featureType: 'attack',
        actorIdentifier: 'Flame Drake',
        featureName: 'Claw',
        attackType: 'melee',
        effectiveAbility: 'str', // default for melee
      })
    );
  });

  it('effectiveAbility is dex for ranged attacks when abilityModifier is omitted', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS_RANGED });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addAttackToActor',
      expect.objectContaining({ effectiveAbility: 'dex' })
    );
  });

  it('effectiveAbility reflects explicit abilityModifier override', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS, abilityModifier: 'cha' });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addAttackToActor',
      expect.objectContaining({ effectiveAbility: 'cha' })
    );
  });

  it('returns success:true with item and actor', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.success).toBe(true);
    expect(result.actor).toEqual(ACTOR_RESULT);
    expect(result.item).toEqual(ITEM_RESULT);
  });

  it('response shape has summary, success, item, actor, warnings, message', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('item');
    expect(result).toHaveProperty('actor');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('message');
  });

  it('warnings is empty array for canonical damage types', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.warnings).toEqual([]);
  });

  it('warnings contains entry for non-canonical damage type', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({
      ...BASE_ARGS,
      damageParts: [{ number: 1, denomination: 6, type: 'silver' }],
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('silver');
  });

  it('warnings contains entry for non-canonical weapon property', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({
      ...BASE_ARGS,
      properties: ['foobar'],
    });

    expect(result.warnings.some((w: string) => w.includes('foobar'))).toBe(true);
  });

  it('warning section appears in message when warnings exist', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({
      ...BASE_ARGS,
      damageParts: [{ number: 1, denomination: 6, type: 'silver' }],
    });

    expect(result.message).toContain('Warnings');
  });

  it('message contains reach description for melee', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).toContain('reach 5 ft.');
  });

  it('message contains range description for ranged attack', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS_RANGED });

    expect(result.message).toContain('range 150');
  });

  it('message contains long range when longRangeFt provided', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({
      ...BASE_ARGS_RANGED,
      longRangeFt: 600,
    });

    expect(result.message).toContain('150/600');
  });

  it('message contains STR modifier for melee default', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).toContain('STR');
  });

  it('message contains bonus to hit when attackBonus > 0', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS, attackBonus: 2 });

    expect(result.message).toContain('+2 to hit');
  });

  it('no bonus string in message when attackBonus is 0', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).not.toContain('to hit');
  });

  it('passes default proficient:true and equipped:true when omitted', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addAttackToActor',
      expect.objectContaining({ proficient: true, equipped: true })
    );
  });

  it('throws ZodError for ranged attack without rangeFt (superRefine)', async () => {
    const { tools, query } = makeTools();

    await expect(
      tools.handleAddFeature({
        featureType: 'attack',
        actorIdentifier: 'Archer',
        featureName: 'Arrow',
        attackType: 'ranged',
        damageParts: [PIERCE_DAMAGE],
        // no rangeFt
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when longRangeFt <= rangeFt (superRefine)', async () => {
    const { tools, query } = makeTools();

    await expect(
      tools.handleAddFeature({
        ...BASE_ARGS_RANGED,
        longRangeFt: 100, // not > rangeFt (150)
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when featureName is empty', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleAddFeature({ ...BASE_ARGS, featureName: '' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  describe('attack — system guard', () => {
    let consoleErr: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
      clearSystemCache();
    });
    afterEach(() => {
      consoleErr.mockRestore();
      clearSystemCache();
    });

    it('throws when active system is not dnd5e', async () => {
      const query = vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'pf2e' };
        return BASE_RESULT;
      });
      const { tools } = makeTools(query);

      await expect(tools.handleAddFeature({ ...BASE_ARGS })).rejects.toThrow();
      expect(query).not.toHaveBeenCalledWith(
        'foundry-mcp-bridge.addAttackToActor',
        expect.anything()
      );
    });

    it('throws (via ErrorHandler) when addAttackToActor throws', async () => {
      const query = vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'dnd5e' };
        throw new Error('attack creation failed');
      });
      const { tools } = makeTools(query);

      await expect(tools.handleAddFeature({ ...BASE_ARGS })).rejects.toThrow();
    });
  });
});

// ===========================================================================
// attack-with-save handler
// ===========================================================================

describe('DnD5eAddFeatureTool — attack-with-save', () => {
  const BASE_ARGS = {
    featureType: 'attack-with-save' as const,
    actorIdentifier: 'Stinger Scorpion',
    featureName: 'Stinger',
    attackType: 'melee' as const,
    damageParts: [PIERCE_DAMAGE],
    saveAbility: 'con' as const,
    saveDC: 12,
    saveDamageParts: [POISON_DAMAGE],
  };

  it('calls addAttackWithSaveToActor with correct args', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addAttackWithSaveToActor',
      expect.objectContaining({
        featureType: 'attack-with-save',
        actorIdentifier: 'Stinger Scorpion',
        featureName: 'Stinger',
        attackType: 'melee',
        saveAbility: 'con',
        saveDC: 12,
      })
    );
  });

  it('includes effectiveAbility in query payload (str for melee default)', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addAttackWithSaveToActor',
      expect.objectContaining({ effectiveAbility: 'str' })
    );
  });

  it('returns success:true with item, actor, warnings', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.success).toBe(true);
    expect(result.actor).toEqual(ACTOR_RESULT);
    expect(result.item).toEqual(ITEM_RESULT);
    expect(result).toHaveProperty('warnings');
  });

  it('response shape has summary, success, item, actor, warnings, message', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('item');
    expect(result).toHaveProperty('actor');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('message');
  });

  it('summary starts with "✅ Attack+Save"', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.summary).toContain('Attack+Save');
  });

  it('message contains save DC and ability', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).toContain('DC 12');
    expect(result.message).toContain('CON');
  });

  it('message contains attack damage and save damage', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).toContain('1d6 piercing');
    expect(result.message).toContain('2d8 poison');
  });

  it('saveOnSave defaults to "none" — message says "no damage on save"', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).toContain('no damage on save');
  });

  it('saveOnSave "half" — message says "half on save"', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS, saveOnSave: 'half' });

    expect(result.message).toContain('half on save');
  });

  it('deduplicates warnings across damageParts and saveDamageParts', async () => {
    const { tools } = makeTools();
    // Use the same non-canonical type in both arrays
    const result = await tools.handleAddFeature({
      ...BASE_ARGS,
      damageParts: [{ number: 1, denomination: 6, type: 'silver' }],
      saveDamageParts: [{ number: 2, denomination: 8, type: 'silver' }],
    });

    // Source deduplicates: warnings.includes(msg) check
    const silverWarnings = result.warnings.filter((w: string) => w.includes('silver'));
    expect(silverWarnings).toHaveLength(1);
  });

  it('throws ZodError for ranged attack-with-save without rangeFt', async () => {
    const { tools, query } = makeTools();

    await expect(
      tools.handleAddFeature({
        ...BASE_ARGS,
        attackType: 'ranged',
        // no rangeFt
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when saveDamageParts is empty array', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleAddFeature({ ...BASE_ARGS, saveDamageParts: [] })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  describe('attack-with-save — system guard', () => {
    let consoleErr: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
      clearSystemCache();
    });
    afterEach(() => {
      consoleErr.mockRestore();
      clearSystemCache();
    });

    it('throws when active system is not dnd5e', async () => {
      const query = vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'other' };
        return BASE_RESULT;
      });
      const { tools } = makeTools(query);

      await expect(tools.handleAddFeature({ ...BASE_ARGS })).rejects.toThrow();
      expect(query).not.toHaveBeenCalledWith(
        'foundry-mcp-bridge.addAttackWithSaveToActor',
        expect.anything()
      );
    });
  });
});

// ===========================================================================
// aura handler
// ===========================================================================

describe('DnD5eAddFeatureTool — aura', () => {
  const BASE_ARGS = {
    featureType: 'aura' as const,
    actorIdentifier: 'Flame Drake',
    featureName: 'Fire Aura',
    damageParts: [FIRE_DAMAGE],
    areaType: 'emanation' as const,
    areaSize: 10,
  };

  it('calls addAuraToActor with parsed args', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addAuraToActor',
      expect.objectContaining({
        featureType: 'aura',
        actorIdentifier: 'Flame Drake',
        featureName: 'Fire Aura',
        areaType: 'emanation',
        areaSize: 10,
      })
    );
  });

  it('returns success:true with item and actor', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.success).toBe(true);
    expect(result.actor).toEqual(ACTOR_RESULT);
    expect(result.item).toEqual(ITEM_RESULT);
  });

  it('response shape has summary, success, item, actor, warnings, message', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('item');
    expect(result).toHaveProperty('actor');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('message');
  });

  it('message contains area description: size + units + type', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    // "10ft emanation" from formatAuraResponse
    expect(result.message).toContain('10ft emanation');
  });

  it('message contains "(automatic — no attack roll, no saving throw)"', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).toContain('automatic');
    expect(result.message).toContain('no attack roll');
    expect(result.message).toContain('no saving throw');
  });

  it('warnings is empty for canonical damage type', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.warnings).toEqual([]);
  });

  it('warnings contains entry for non-canonical damage type', async () => {
    const { tools } = makeTools();
    const result = await tools.handleAddFeature({
      ...BASE_ARGS,
      damageParts: [{ number: 1, denomination: 6, type: 'necrotic-shadow' }],
    });

    expect(result.warnings.some((w: string) => w.includes('necrotic-shadow'))).toBe(true);
  });

  it('passes default affectsType "creature" when omitted', async () => {
    const { tools, query } = makeTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addAuraToActor',
      expect.objectContaining({ affectsType: 'creature' })
    );
  });

  it('throws ZodError when areaType is empty string (required for aura)', async () => {
    const { tools, query } = makeTools();

    // The aura schema requires areaType without the '' option
    await expect(tools.handleAddFeature({ ...BASE_ARGS, areaType: '' as any })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when areaSize is zero (must be positive)', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleAddFeature({ ...BASE_ARGS, areaSize: 0 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws ZodError when damageParts is empty', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleAddFeature({ ...BASE_ARGS, damageParts: [] })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  describe('aura — system guard', () => {
    let consoleErr: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
      clearSystemCache();
    });
    afterEach(() => {
      consoleErr.mockRestore();
      clearSystemCache();
    });

    it('throws when active system is not dnd5e', async () => {
      const query = vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'pf2e' };
        return BASE_RESULT;
      });
      const { tools } = makeTools(query);

      await expect(tools.handleAddFeature({ ...BASE_ARGS })).rejects.toThrow();
      expect(query).not.toHaveBeenCalledWith(
        'foundry-mcp-bridge.addAuraToActor',
        expect.anything()
      );
    });

    it('throws (via ErrorHandler) when addAuraToActor throws', async () => {
      const query = vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'dnd5e' };
        throw new Error('aura creation failed');
      });
      const { tools } = makeTools(query);

      await expect(tools.handleAddFeature({ ...BASE_ARGS })).rejects.toThrow();
    });
  });
});

// ===========================================================================
// spellcasting handler
// ===========================================================================

describe('DnD5eAddFeatureTool — spellcasting', () => {
  const BASE_ARGS = {
    featureType: 'spellcasting' as const,
    actorIdentifier: 'Wizard NPC',
    spellcastingClass: 'wizard' as const,
    spellcastingLevel: 5,
  };

  // Fixture result for spellcasting (no `item` property)
  const SPELLCASTING_RESULT = {
    actor: ACTOR_RESULT,
    spellcasting: {
      slots: { spell1: 4, spell2: 3, spell3: 2, pact: { max: 0, level: 0 } },
    },
    warnings: [],
  };

  function makeSpellcastingTools() {
    return makeTools(
      vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'dnd5e' };
        if (method === 'foundry-mcp-bridge.setActorSpellcasting') return SPELLCASTING_RESULT;
        return BASE_RESULT;
      })
    );
  }

  it('calls setActorSpellcasting with correct args', async () => {
    const { tools, query } = makeSpellcastingTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.setActorSpellcasting',
      expect.objectContaining({
        featureType: 'spellcasting',
        actorIdentifier: 'Wizard NPC',
        spellcastingClass: 'wizard',
        spellcastingLevel: 5,
      })
    );
  });

  it('effectiveAbility defaults to "int" for wizard', async () => {
    const { tools, query } = makeSpellcastingTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.setActorSpellcasting',
      expect.objectContaining({ effectiveAbility: 'int' })
    );
  });

  it('effectiveAbility defaults to "wis" for cleric', async () => {
    const { tools, query } = makeSpellcastingTools();

    await tools.handleAddFeature({ ...BASE_ARGS, spellcastingClass: 'cleric' });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.setActorSpellcasting',
      expect.objectContaining({ effectiveAbility: 'wis' })
    );
  });

  it('effectiveAbility defaults to "cha" for warlock', async () => {
    const { tools, query } = makeSpellcastingTools();

    await tools.handleAddFeature({ ...BASE_ARGS, spellcastingClass: 'warlock' });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.setActorSpellcasting',
      expect.objectContaining({ effectiveAbility: 'cha' })
    );
  });

  it('explicit spellcastingAbility overrides class default', async () => {
    const { tools, query } = makeSpellcastingTools();

    await tools.handleAddFeature({ ...BASE_ARGS, spellcastingAbility: 'cha' });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.setActorSpellcasting',
      expect.objectContaining({ effectiveAbility: 'cha' })
    );
  });

  it('returns success:true with actor and spellcasting', async () => {
    const { tools } = makeSpellcastingTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.success).toBe(true);
    expect(result.actor).toEqual(ACTOR_RESULT);
    expect(result).toHaveProperty('spellcasting');
  });

  it('response shape has summary, success, actor, spellcasting, warnings, message', async () => {
    const { tools } = makeSpellcastingTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('actor');
    expect(result).toHaveProperty('spellcasting');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('message');
  });

  it('summary contains class and level', async () => {
    const { tools } = makeSpellcastingTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.summary).toContain('wizard');
    expect(result.summary).toContain('5');
  });

  it('message contains ability in uppercase', async () => {
    const { tools } = makeSpellcastingTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).toContain('INT');
  });

  it('message contains slot summary for non-warlock', async () => {
    const { tools } = makeSpellcastingTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    // formatSpellcastingResponse produces e.g. "L1: 4, L2: 3, L3: 2"
    expect(result.message).toContain('L1:');
  });

  it('message contains Pact Magic for warlock when slots.pact.max > 0', async () => {
    const warlockResult = {
      actor: ACTOR_RESULT,
      spellcasting: {
        slots: { pact: { max: 2, level: 3 } },
      },
      warnings: [],
    };
    const tools_query = makeTools(
      vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'dnd5e' };
        if (method === 'foundry-mcp-bridge.setActorSpellcasting') return warlockResult;
        return BASE_RESULT;
      })
    );

    const result = await tools_query.tools.handleAddFeature({
      ...BASE_ARGS,
      spellcastingClass: 'warlock',
    });

    expect(result.message).toContain('Pact Magic');
  });

  it('throws ZodError when spellcastingLevel > 20', async () => {
    const { tools, query } = makeSpellcastingTools();

    await expect(tools.handleAddFeature({ ...BASE_ARGS, spellcastingLevel: 21 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalledWith(
      'foundry-mcp-bridge.setActorSpellcasting',
      expect.anything()
    );
  });

  it('throws ZodError when spellcastingLevel < 1', async () => {
    const { tools, query } = makeSpellcastingTools();

    await expect(tools.handleAddFeature({ ...BASE_ARGS, spellcastingLevel: 0 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalledWith(
      'foundry-mcp-bridge.setActorSpellcasting',
      expect.anything()
    );
  });

  describe('spellcasting — system guard', () => {
    let consoleErr: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
      clearSystemCache();
    });
    afterEach(() => {
      consoleErr.mockRestore();
      clearSystemCache();
    });

    it('throws when active system is not dnd5e', async () => {
      const query = vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'dsa5' };
        return SPELLCASTING_RESULT;
      });
      const { tools } = makeTools(query);

      await expect(tools.handleAddFeature({ ...BASE_ARGS })).rejects.toThrow();
      expect(query).not.toHaveBeenCalledWith(
        'foundry-mcp-bridge.setActorSpellcasting',
        expect.anything()
      );
    });
  });
});

// ===========================================================================
// spells handler
// ===========================================================================

describe('DnD5eAddFeatureTool — spells', () => {
  const BASE_ARGS = {
    featureType: 'spells' as const,
    actorIdentifier: 'Wizard NPC',
    spellNames: ['Fireball', 'Counterspell', 'Shield'],
  };

  const SPELLS_RESULT = {
    actor: ACTOR_RESULT,
    added: [{ name: 'Fireball', packId: 'dnd5e.spells', packLabel: 'SRD Spells', itemId: 's-1' }],
    skipped: [{ name: 'Shield', reason: 'already on actor' }],
    notFound: [] as string[],
    failed: [] as Array<{ name: string; error: string }>,
    warnings: [] as string[],
  };

  function makeSpellsTools(overrideResult?: typeof SPELLS_RESULT) {
    return makeTools(
      vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'dnd5e' };
        if (method === 'foundry-mcp-bridge.addSpellsToActor')
          return overrideResult ?? SPELLS_RESULT;
        return BASE_RESULT;
      })
    );
  }

  it('calls addSpellsToActor with spell names and compendium packs', async () => {
    const { tools, query } = makeSpellsTools();

    await tools.handleAddFeature({ ...BASE_ARGS });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addSpellsToActor',
      expect.objectContaining({
        actorIdentifier: 'Wizard NPC',
        spellNames: ['Fireball', 'Counterspell', 'Shield'],
        compendiumPacks: ['dnd5e.spells'], // default
      })
    );
  });

  it('passes custom compendiumPacks when provided', async () => {
    const { tools, query } = makeSpellsTools();

    await tools.handleAddFeature({
      ...BASE_ARGS,
      compendiumPacks: ['dnd5e.spells24'],
    });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addSpellsToActor',
      expect.objectContaining({ compendiumPacks: ['dnd5e.spells24'] })
    );
  });

  it('returns success:true when at least one spell was added', async () => {
    const { tools } = makeSpellsTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.success).toBe(true);
  });

  it('response shape has summary, success, actor, added, skipped, notFound, failed, warnings, message', async () => {
    const { tools } = makeSpellsTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('actor');
    expect(result).toHaveProperty('added');
    expect(result).toHaveProperty('skipped');
    expect(result).toHaveProperty('notFound');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('message');
  });

  it('actor matches the bridge return value', async () => {
    const { tools } = makeSpellsTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.actor).toEqual(ACTOR_RESULT);
  });

  it('added/skipped/notFound/failed/warnings arrays pass through from bridge result', async () => {
    const { tools } = makeSpellsTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.added).toEqual(SPELLS_RESULT.added);
    expect(result.skipped).toEqual(SPELLS_RESULT.skipped);
    expect(result.notFound).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('summary contains "1 added, 1 skipped" for the fixture result', async () => {
    const { tools } = makeSpellsTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.summary).toContain('1 added');
    expect(result.summary).toContain('1 skipped');
  });

  it('message contains actor name', async () => {
    const { tools } = makeSpellsTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).toContain(ACTOR_RESULT.name);
  });

  it('message lists added spell name', async () => {
    const { tools } = makeSpellsTools();
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).toContain('Fireball');
  });

  it('success is false when notFound is non-empty and added is empty', async () => {
    const noSpellsResult = {
      actor: ACTOR_RESULT,
      added: [],
      skipped: [],
      notFound: ['AncientSpell'],
      failed: [],
      warnings: [],
    };
    const { tools } = makeSpellsTools(noSpellsResult);
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    // success = added.length > 0 || (notFound.length === 0 && failed.length === 0)
    // here: added=0, notFound=1 → false
    expect(result.success).toBe(false);
  });

  it('success is false when failed array is non-empty', async () => {
    const failedResult = {
      actor: ACTOR_RESULT,
      added: [],
      skipped: [],
      notFound: [],
      failed: [{ name: 'Fireball', error: 'import error' }],
      warnings: [],
    };
    const { tools } = makeSpellsTools(failedResult);
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.success).toBe(false);
  });

  it('message contains "Not found in compendium" section when notFound non-empty', async () => {
    const notFoundResult = {
      actor: ACTOR_RESULT,
      added: [],
      skipped: [],
      notFound: ['AncientSpell'],
      failed: [],
      warnings: [],
    };
    const { tools } = makeSpellsTools(notFoundResult);
    const result = await tools.handleAddFeature({ ...BASE_ARGS });

    expect(result.message).toContain('Not found in compendium');
    expect(result.message).toContain('AncientSpell');
  });

  it('throws ZodError when spellNames is empty array', async () => {
    const { tools, query } = makeSpellsTools();

    await expect(tools.handleAddFeature({ ...BASE_ARGS, spellNames: [] })).rejects.toThrow();
    expect(query).not.toHaveBeenCalledWith(
      'foundry-mcp-bridge.addSpellsToActor',
      expect.anything()
    );
  });

  it('throws ZodError when a spell name is empty string', async () => {
    const { tools, query } = makeSpellsTools();

    await expect(
      tools.handleAddFeature({ ...BASE_ARGS, spellNames: ['Fireball', ''] })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalledWith(
      'foundry-mcp-bridge.addSpellsToActor',
      expect.anything()
    );
  });

  describe('spells — system guard', () => {
    let consoleErr: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
      clearSystemCache();
    });
    afterEach(() => {
      consoleErr.mockRestore();
      clearSystemCache();
    });

    it('throws when active system is not dnd5e', async () => {
      const query = vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'pf2e' };
        return SPELLS_RESULT;
      });
      const { tools } = makeTools(query);

      await expect(tools.handleAddFeature({ ...BASE_ARGS })).rejects.toThrow();
      expect(query).not.toHaveBeenCalledWith(
        'foundry-mcp-bridge.addSpellsToActor',
        expect.anything()
      );
    });

    it('throws (via ErrorHandler) when addSpellsToActor throws', async () => {
      const query = vi.fn((method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') return { system: 'dnd5e' };
        throw new Error('spell import failed');
      });
      const { tools } = makeTools(query);

      await expect(tools.handleAddFeature({ ...BASE_ARGS })).rejects.toThrow();
    });
  });
});
