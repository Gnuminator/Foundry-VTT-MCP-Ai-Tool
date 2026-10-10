/**
 * Tests for how `main.ts` runs the link (lane 1, PB-02 and PB-03): one bridge at
 * a time, only the configured bridge user dials, a light heartbeat, and no
 * world-setting writes for connection state.
 *
 * The real SocketBridge is replaced by a recording fake; its own reconnect
 * behaviour is covered in socket-bridge.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';

const fake = vi.hoisted(() => {
  const state = {
    instances: [] as any[],
    connectOk: true,
    lastConfig: null as any,
  };
  class FakeSocketBridge {
    connected = false;
    disconnected = false;
    connect = vi.fn((): Promise<void> => {
      if (!state.connectOk) return Promise.reject(new Error('WebSocket connection failed'));
      this.connected = true;
      return Promise.resolve();
    });
    disconnect = vi.fn(() => {
      this.disconnected = true;
      this.connected = false;
    });
    constructor(config: any) {
      state.lastConfig = config;
      state.instances.push(this);
    }
    isConnected(): boolean {
      return this.connected;
    }
    getConnectionState(): string {
      return this.connected ? 'connected' : 'disconnected';
    }
    getConnectionInfo(): any {
      return { type: 'websocket', state: this.getConnectionState() };
    }
  }
  return { state, FakeSocketBridge };
});

vi.mock('./socket-bridge.js', () => ({ SocketBridge: fake.FakeSocketBridge }));

const MODULE_ID = 'foundry-mcp-bridge';
const g = globalThis as any;

let world: TestWorld;
let restore: () => void;
let bridge: any;
let setSpy: ReturnType<typeof vi.fn>;

/** Instances that were created and never disconnected: the ones still "running". */
const live = (): any[] => fake.state.instances.filter(i => !i.disconnected);

// main.ts touches `window` when it loads (global handle, unload hook, heartbeat timer).
g.window = {
  addEventListener: (): undefined => undefined,
  setInterval: (...a: any[]): unknown => (setInterval as any)(...a),
  foundryMCPBridge: undefined,
};

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  fake.state.instances.length = 0;
  fake.state.connectOk = true;
  for (const [key, value] of Object.entries({
    enabled: true,
    serverHost: 'localhost',
    serverPort: 31415,
    maxActorsPerRequest: 10,
    heartbeatInterval: 30,
    autoReconnectEnabled: true,
    bridgeUserId: '',
    enableNotifications: false,
  })) {
    world.setSetting(MODULE_ID, key, value);
  }
  setSpy = vi.fn((ns: string, key: string, value: unknown) => {
    world.setSetting(ns, key, value);
    return Promise.resolve(value);
  });
  g.game.settings.set = setSpy;
  vi.resetModules();
  g.window.foundryMCPBridge = undefined;
  const main = await import('./main.js');
  bridge = main.foundryMCPBridge;
  bridge.isInitialized = true;
});

afterEach(() => {
  bridge['stopHeartbeat']();
  restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('main: one bridge at a time (PB-03)', () => {
  it('a second start() after a failed one disconnects the first bridge', async () => {
    fake.state.connectOk = false;
    await expect(bridge.start()).rejects.toThrow();
    await expect(bridge.start()).rejects.toThrow();
    await expect(bridge.start()).rejects.toThrow();

    expect(fake.state.instances).toHaveLength(3);
    expect(live()).toHaveLength(1);
  });

  it('start() while connected does not create another bridge', async () => {
    await bridge.start();
    await bridge.start();
    expect(fake.state.instances).toHaveLength(1);
    expect(fake.state.instances[0].connect).toHaveBeenCalledTimes(1);
  });

  it('gives the bridge live auto-reconnect and hello builders', async () => {
    await bridge.start();
    world.setSetting(MODULE_ID, 'autoReconnectEnabled', false);
    expect(fake.state.lastConfig.autoReconnect()).toBe(false);
    world.setSetting(MODULE_ID, 'autoReconnectEnabled', true);
    expect(fake.state.lastConfig.autoReconnect()).toBe(true);
    expect(fake.state.lastConfig.getHello()).toMatchObject({
      userId: 'gm',
      userName: 'Gamemaster',
      isBridgeUser: true,
      worldId: 'test-world',
    });
  });
});

describe('main: no world writes for connection state (PB-03)', () => {
  it('connecting, heartbeats and stopping write no settings', async () => {
    vi.useFakeTimers();
    await bridge.start();
    bridge.performHeartbeat();
    fake.state.instances[0].connected = false;
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    bridge.performHeartbeat();
    await bridge.stop();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('a failed start writes no settings either', async () => {
    fake.state.connectOk = false;
    await expect(bridge.start()).rejects.toThrow();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('the heartbeat never restarts the bridge or turns auto-reconnect off', async () => {
    vi.useFakeTimers();
    await bridge.start();
    const restart = vi.spyOn(bridge, 'restart');
    fake.state.instances[0].connected = false;
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);

    bridge.performHeartbeat();
    bridge.performHeartbeat();

    expect(restart).not.toHaveBeenCalled();
    expect(fake.state.instances).toHaveLength(1);
    expect(fake.state.instances[0].connect).toHaveBeenCalledTimes(1);
    expect(world.settings.get(`${MODULE_ID}.autoReconnectEnabled`)).toBe(true);
  });

  it('keeps the connection state in memory for getStatus()', async () => {
    await bridge.start();
    expect(bridge.getStatus().lastConnectionState).toBe('connected');
    await bridge.stop();
    expect(bridge.getStatus().lastConnectionState).toBe('disconnected');
  });
});

describe('main: bridge user gating (PB-02)', () => {
  it('dials when no bridge user is set', async () => {
    await bridge.start();
    expect(fake.state.instances).toHaveLength(1);
  });

  it('dials when this user is the bridge user', async () => {
    world.setSetting(MODULE_ID, 'bridgeUserId', 'gm');
    await bridge.start();
    expect(fake.state.instances).toHaveLength(1);
  });

  it('stays quiet when another user is the bridge user', async () => {
    world.setSetting(MODULE_ID, 'bridgeUserId', 'someone-else');
    await expect(bridge.start()).resolves.toBeUndefined();
    expect(fake.state.instances).toHaveLength(0);
  });
});

describe('main: "MCP server not found" notice (PB-03)', () => {
  const warnings = (): string[] =>
    world.notifications.filter(n => n.level === 'warn').map(n => n.message);

  it('shows on the first failed start, then stays quiet for 10 minutes', async () => {
    vi.useFakeTimers();
    fake.state.connectOk = false;

    await expect(bridge.start()).rejects.toThrow();
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain('MCP Server not found');

    vi.setSystemTime(Date.now() + 9 * 60 * 1000);
    await expect(bridge.start()).rejects.toThrow();
    expect(warnings()).toHaveLength(1);

    vi.setSystemTime(Date.now() + 2 * 60 * 1000);
    await expect(bridge.start()).rejects.toThrow();
    expect(warnings()).toHaveLength(2);
  });

  it('does not show for a settings error that never reached the network', async () => {
    world.setSetting(MODULE_ID, 'serverPort', 80);
    await expect(bridge.start()).rejects.toThrow('Invalid configuration');
    expect(warnings()).toHaveLength(0);
    expect(fake.state.instances).toHaveLength(0);
  });
});

describe('main: creature index warm-up at ready (#283)', () => {
  let ensure: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    world.setSetting(MODULE_ID, 'enableEnhancedCreatureIndex', true);
    world.setSetting(MODULE_ID, 'bridgeUserId', 'gm');
    ensure = vi.fn().mockResolvedValue({ rebuilt: true, totalCreatures: 3 });
    bridge.queryHandlers.dataAccess.ensureEnhancedCreatureIndex = ensure;
  });

  const setActiveGm = (id: string): void => {
    Object.defineProperty(g.game.users, 'activeGM', { value: { id }, configurable: true });
  };

  it("builds in the bridge user's browser", () => {
    bridge.warmEnhancedIndex();
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it("skips a player's browser", () => {
    g.game.user.isGM = false;
    bridge.warmEnhancedIndex();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('skips when another user is the bridge user', () => {
    world.setSetting(MODULE_ID, 'bridgeUserId', 'someone-else');
    bridge.warmEnhancedIndex();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('with "Any GM" builds only in the active GM\'s browser', () => {
    world.setSetting(MODULE_ID, 'bridgeUserId', '');
    setActiveGm('other-gm');
    bridge.warmEnhancedIndex();
    expect(ensure).not.toHaveBeenCalled();

    setActiveGm('gm');
    bridge.warmEnhancedIndex();
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('skips when the enhanced index is off', () => {
    world.setSetting(MODULE_ID, 'enableEnhancedCreatureIndex', false);
    bridge.warmEnhancedIndex();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('skips a system other than dnd5e', () => {
    g.game.system.id = 'pf2e';
    bridge.warmEnhancedIndex();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('a failed build only logs a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ensure.mockRejectedValue(new Error('upload failed'));
    bridge.warmEnhancedIndex();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to build the enhanced creature index'),
      expect.any(Error)
    );
  });
});
