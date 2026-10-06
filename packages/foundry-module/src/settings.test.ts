/**
 * Tests for the security-relevant defaults of {@link ModuleSettings}.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { ModuleSettings, buildModuleHello, defaultServerPort, isBridgeUser } from './settings.js';
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

describe('ModuleSettings — validateSettings', () => {
  const valid = {
    serverHost: 'localhost',
    serverPort: 31415,
    maxActorsPerRequest: 10,
    heartbeatInterval: 30,
  };

  function validate(overrides: Partial<typeof valid> = {}): { valid: boolean; errors: string[] } {
    for (const [key, value] of Object.entries({ ...valid, ...overrides })) {
      world.setSetting(MODULE_ID, key, value);
    }
    return new ModuleSettings().validateSettings();
  }

  it('accepts the default values', () => {
    expect(validate()).toEqual({ valid: true, errors: [] });
  });

  it('accepts every maxActorsPerRequest value the settings slider allows', () => {
    // start() throws on an invalid configuration, so the check must not be tighter than the
    // slider registered in registerSettings (it used to reject anything above 10).
    const range = registered.get(`${MODULE_ID}.maxActorsPerRequest`)?.range as {
      min: number;
      max: number;
    };
    expect(range).toEqual(expect.objectContaining({ min: 1, max: 50 }));
    for (const value of [range.min, 11, 20, range.max]) {
      expect(validate({ maxActorsPerRequest: value })).toEqual({ valid: true, errors: [] });
    }
  });

  it('rejects maxActorsPerRequest outside the slider range', () => {
    for (const value of [0, -1, 51, 500]) {
      const result = validate({ maxActorsPerRequest: value });
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['Max actors per request must be between 1 and 50']);
    }
  });

  it('keeps the port and heartbeat bounds', () => {
    expect(validate({ serverPort: 80 }).errors).toEqual([
      'Server port must be between 1024 and 65535',
    ]);
    expect(validate({ heartbeatInterval: 5 }).errors).toEqual([
      'Heartbeat interval must be between 10 and 120 seconds',
    ]);
    expect(validate({ serverHost: ' ' }).errors).toEqual(['Server host cannot be empty']);
  });
});

describe('ModuleSettings: bridge user (PB-02)', () => {
  it('registers bridgeUserId as a world String setting defaulting to "Any GM"', () => {
    const config = registered.get(`${MODULE_ID}.bridgeUserId`);
    expect(config).toMatchObject({
      scope: 'world',
      config: true,
      type: String,
      default: '',
      choices: { '': 'Any GM (first to connect)' },
    });
  });

  it('isBridgeUser: empty means every user, otherwise only the named one', () => {
    expect(isBridgeUser('', 'gm')).toBe(true);
    expect(isBridgeUser(undefined, 'gm')).toBe(true);
    expect(isBridgeUser('gm', 'gm')).toBe(true);
    expect(isBridgeUser('other', 'gm')).toBe(false);
  });

  it('refreshBridgeUserChoices lists Any GM plus each GM user, not players', () => {
    const entry: Record<string, any> = { choices: { '': 'Any GM (first to connect)' } };
    g.game.settings.settings = new Map([[`${MODULE_ID}.bridgeUserId`, entry]]);
    world.addUser({ id: 'gm2', name: 'Assistant', isGM: true });
    world.addUser({ id: 'p1', name: 'Player One', isGM: false });

    new ModuleSettings().refreshBridgeUserChoices();

    expect(entry.choices).toEqual({
      '': 'Any GM (first to connect)',
      gm2: 'Assistant',
    });
  });

  it('refreshBridgeUserChoices never throws when the setting is not registered', () => {
    g.game.settings.settings = new Map();
    expect(() => new ModuleSettings().refreshBridgeUserChoices()).not.toThrow();
  });

  it('builds the hello payload from the signed-in user, the module and the world', () => {
    world.modules.set(MODULE_ID, { id: MODULE_ID, active: true, version: '0.19.0' });
    expect(buildModuleHello('')).toEqual({
      userId: 'gm',
      userName: 'Gamemaster',
      isBridgeUser: true,
      moduleVersion: '0.19.0',
      worldId: 'test-world',
    });
    expect(buildModuleHello('someone-else').isBridgeUser).toBe(false);
    expect(buildModuleHello('gm').isBridgeUser).toBe(true);
  });

  it('reports the module version as unknown when the manifest has none', () => {
    world.modules.set(MODULE_ID, { id: MODULE_ID, active: true });
    expect(buildModuleHello('').moduleVersion).toBe('unknown');
  });

  it('getBridgeConfig carries a live autoReconnect and a hello builder', () => {
    for (const [key, value] of Object.entries({
      enabled: true,
      serverHost: 'localhost',
      serverPort: 31415,
      autoReconnectEnabled: true,
      bridgeUserId: '',
    })) {
      world.setSetting(MODULE_ID, key, value);
    }
    const config = new ModuleSettings().getBridgeConfig();
    expect(config.autoReconnect?.()).toBe(true);
    world.setSetting(MODULE_ID, 'autoReconnectEnabled', false);
    expect(config.autoReconnect?.()).toBe(false);
    expect(config.getHello?.()).toMatchObject({ userId: 'gm', isBridgeUser: true });
  });

  it('keeps the deprecated state settings registered so old worlds load', () => {
    for (const key of ['lastConnectionState', 'lastActivity', 'lastMCPServerNotification']) {
      expect(registered.get(`${MODULE_ID}.${key}`)).toMatchObject({
        scope: 'world',
        config: false,
      });
    }
  });
});
