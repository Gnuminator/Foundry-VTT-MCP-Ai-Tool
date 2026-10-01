/**
 * Tests for the guarded-write feature switches: one world setting per feature,
 * default OFF; unknown features and unreadable settings count as off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import {
  featureSettingKey,
  isFeatureEnabled,
  isKnownFeature,
  listGuardedFeatures,
  registerGuardedFeature,
  resetGuardedFeaturesForTests,
} from './guarded-features.js';

const MODULE_ID = 'foundry-mcp-bridge';
const g = globalThis as any;

let world: TestWorld;
let restore: () => void;
let register: ReturnType<typeof vi.fn>;

const ATTITUDES = {
  id: 'npc-attitudes',
  name: 'AI Tool: NPC attitudes',
  hint: 'Writes attitudes.',
};

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
  register = vi.fn();
  g.game.settings.register = register;
  resetGuardedFeaturesForTests();
});

afterEach(() => {
  restore();
  resetGuardedFeaturesForTests();
});

describe('registerGuardedFeature', () => {
  it('registers a world setting that defaults to off', () => {
    registerGuardedFeature(ATTITUDES);
    expect(featureSettingKey('npc-attitudes')).toBe('feature.npc-attitudes.enabled');
    expect(register).toHaveBeenCalledTimes(1);
    const [scope, key, config] = register.mock.calls[0];
    expect([scope, key]).toEqual([MODULE_ID, 'feature.npc-attitudes.enabled']);
    expect(config).toMatchObject({
      name: 'AI Tool: NPC attitudes',
      scope: 'world',
      config: true,
      type: Boolean,
      default: false,
    });
    expect(config.hint).toMatch(/^Writes attitudes\. Off by default/);
    expect(isKnownFeature('npc-attitudes')).toBe(true);
  });

  it('registers a switch that starts on with defaultEnabled (D-082)', () => {
    registerGuardedFeature({ ...ATTITUDES, id: 'live-play', defaultEnabled: true });
    const [, key, config] = register.mock.calls[0];
    expect(key).toBe('feature.live-play.enabled');
    expect(config).toMatchObject({ default: true });
    expect(config.hint).toMatch(/^Writes attitudes\. On by default/);
  });

  it('ignores a second registration of the same id', () => {
    registerGuardedFeature(ATTITUDES);
    registerGuardedFeature({ ...ATTITUDES, name: 'Other name' });
    expect(register).toHaveBeenCalledTimes(1);
    expect(listGuardedFeatures()[0].name).toBe('AI Tool: NPC attitudes');
  });

  it('rejects invalid ids', () => {
    for (const id of ['', 'A-upper', '1digit', 'x', 'has space', 'dots.no', 'a'.repeat(42)]) {
      expect(() => registerGuardedFeature({ ...ATTITUDES, id })).toThrow(/Invalid feature id/);
    }
    expect(register).not.toHaveBeenCalled();
  });
});

describe('isFeatureEnabled', () => {
  it('is off until the GM switches it on', () => {
    registerGuardedFeature(ATTITUDES);
    expect(isFeatureEnabled('npc-attitudes')).toBe(false);
    world.setSetting(MODULE_ID, 'feature.npc-attitudes.enabled', true);
    expect(isFeatureEnabled('npc-attitudes')).toBe(true);
  });

  it('treats non-boolean setting values as off', () => {
    registerGuardedFeature(ATTITUDES);
    world.setSetting(MODULE_ID, 'feature.npc-attitudes.enabled', 'true');
    expect(isFeatureEnabled('npc-attitudes')).toBe(false);
  });

  it('is off for an unknown feature even when a setting value exists', () => {
    world.setSetting(MODULE_ID, 'feature.ghost.enabled', true);
    expect(isKnownFeature('ghost')).toBe(false);
    expect(isFeatureEnabled('ghost')).toBe(false);
  });

  it('is off when the setting cannot be read', () => {
    registerGuardedFeature(ATTITUDES);
    g.game.settings.get = (): never => {
      throw new Error('not registered');
    };
    expect(isFeatureEnabled('npc-attitudes')).toBe(false);
  });
});

describe('listGuardedFeatures', () => {
  it('lists every registered feature with its state', () => {
    registerGuardedFeature(ATTITUDES);
    registerGuardedFeature({ id: 'tarokka', name: 'AI Tool: Tarokka', hint: 'Deals cards.' });
    world.setSetting(MODULE_ID, 'feature.tarokka.enabled', true);
    expect(listGuardedFeatures()).toEqual([
      { ...ATTITUDES, enabled: false, writesAllowed: false },
      {
        id: 'tarokka',
        name: 'AI Tool: Tarokka',
        hint: 'Deals cards.',
        enabled: true,
        writesAllowed: false,
      },
    ]);
  });

  it('reports "Allow Write Operations" on every feature, for vault-only changes', () => {
    registerGuardedFeature(ATTITUDES);
    world.setSetting(MODULE_ID, 'allowWriteOperations', true);
    expect(listGuardedFeatures()[0].writesAllowed).toBe(true);
    world.setSetting(MODULE_ID, 'allowWriteOperations', 'yes');
    expect(listGuardedFeatures()[0].writesAllowed).toBe(false);
  });
});
