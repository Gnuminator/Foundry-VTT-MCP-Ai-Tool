/**
 * Tests for the security-relevant defaults of {@link ModuleSettings}.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { ModuleSettings } from './settings.js';
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
