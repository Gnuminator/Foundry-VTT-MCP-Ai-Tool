/**
 * Tests for the security-relevant defaults of {@link ModuleSettings}.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { ModuleSettings, defaultServerPort } from './settings.js';
import { MODULE_ID } from './constants.js';

let world: TestWorld;
let restore: () => void;
let registered: Map<string, Record<string, any>>;
let hookNames: string[];
const g = globalThis as any;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
  registered = new Map();
  hookNames = [];
  g.game.settings.register = (ns: string, key: string, config: Record<string, any>): void => {
    registered.set(`${ns}.${key}`, config);
  };
  g.game.settings.registerMenu = vi.fn();
  g.FormApplication = class {};
  const on = g.Hooks.on;
  g.Hooks.on = (name: string, cb: (...a: any[]) => void): unknown => {
    hookNames.push(name);
    return on(name, cb);
  };
  new ModuleSettings().registerSettings();
});

afterEach(() => {
  restore();
  delete g.FormApplication;
});

describe('ModuleSettings — access defaults', () => {
  it('allowNonGmAccess is a world setting, default OFF, shown in the config UI', () => {
    const config = registered.get(`${MODULE_ID}.allowNonGmAccess`);
    expect(config).toMatchObject({ scope: 'world', config: true, type: Boolean, default: false });
  });

  it('does not lock the allowNonGmAccess checkbox in the settings UI', () => {
    expect(hookNames).not.toContain('renderSettingsConfig');
  });
});

describe('ModuleSettings — bridge port default', () => {
  it('defaults to 31415 without a manifest flag', () => {
    expect(registered.get(`${MODULE_ID}.serverPort`)).toMatchObject({
      scope: 'world',
      default: 31415,
    });
    expect(defaultServerPort()).toBe(31415);
  });

  it('takes a valid defaultServerPort from the module manifest flags (test installs)', () => {
    world.modules.set(MODULE_ID, {
      id: MODULE_ID,
      active: true,
      flags: { [MODULE_ID]: { defaultServerPort: 31515 } },
    });
    expect(defaultServerPort()).toBe(31515);
    for (const bad of [80, 70000, '31515', 31515.5]) {
      world.modules.set(MODULE_ID, {
        id: MODULE_ID,
        flags: { [MODULE_ID]: { defaultServerPort: bad } },
      });
      expect(defaultServerPort()).toBe(31415);
    }
  });
});
