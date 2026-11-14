/**
 * Tests for the module side of `main.ts` around the link: it hands start, stop, restart and the
 * link status over to the bridge link lifecycle, a failed first connect does not fail `ready`,
 * and the creature index warm-up runs in the right browser.
 *
 * How the link itself runs (one bridge at a time, the bridge user, the heartbeat, the link
 * toasts and their `linkState` writes) is in bridge-link-lifecycle.test.ts. The real
 * SocketBridge is replaced by a recording fake; its own reconnect behaviour is covered in
 * socket-bridge.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
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
      // Like the real SocketBridge: the link-up callback fires from onopen, before connect() resolves.
      this.config.onLinkChange?.(true);
      return Promise.resolve();
    });
    disconnect = vi.fn(() => {
      this.disconnected = true;
      this.connected = false;
    });
    constructor(public config: any) {
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
  g.game.settings.set = vi.fn((ns: string, key: string, value: unknown) => {
    world.setSetting(ns, key, value);
    return Promise.resolve(value);
  });
  vi.resetModules();
  g.window.foundryMCPBridge = undefined;
  const main = await import('./main.js');
  bridge = main.foundryMCPBridge;
  bridge.isInitialized = true;
});

afterEach(async () => {
  await bridge.stop();
  restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('main: hands the link over to the bridge link lifecycle (R9)', () => {
  it('start() and stop() run the link and getStatus() reports it', async () => {
    vi.useFakeTimers();
    await bridge.start();
    expect(fake.state.instances).toHaveLength(1);
    expect(bridge.getStatus()).toMatchObject({
      initialized: true,
      enabled: true,
      connected: true,
      connectionState: 'connected',
      connectionInfo: { type: 'websocket', state: 'connected' },
      lastConnectionState: 'connected',
      heartbeatActive: true,
    });
    expect(Array.isArray(bridge.getStatus().registeredMethods)).toBe(true);
    expect(typeof bridge.getStatus().lastActivity).toBe('string');

    await bridge.stop();
    expect(fake.state.instances[0].disconnected).toBe(true);
    expect(bridge.getStatus()).toMatchObject({
      connected: false,
      connectionState: 'disconnected',
      lastConnectionState: 'disconnected',
      heartbeatActive: false,
    });
  });

  it('start() refuses before init finished', async () => {
    bridge.isInitialized = false;
    await expect(bridge.start()).rejects.toThrow('Module not initialized');
    expect(fake.state.instances).toHaveLength(0);
  });

  it('restart() stops, waits a second and starts a new bridge', async () => {
    vi.useFakeTimers();
    await bridge.start();
    const restarting = bridge.restart();
    await vi.advanceTimersByTimeAsync(1000);
    await restarting;
    expect(fake.state.instances).toHaveLength(2);
    expect(fake.state.instances[0].disconnected).toBe(true);
    expect(bridge.getStatus().connected).toBe(true);
  });

  it('restart() with the bridge switched off stops the link and creates no second bridge', async () => {
    vi.useFakeTimers();
    await bridge.start();
    world.setSetting(MODULE_ID, 'enabled', false);
    const restarting = bridge.restart();
    await vi.advanceTimersByTimeAsync(1000);
    await restarting;
    expect(fake.state.instances).toHaveLength(1);
    expect(fake.state.instances[0].disconnected).toBe(true);
    expect(bridge.getStatus().connected).toBe(false);
  });

  it('the global handle the settings menu calls is the module instance', () => {
    expect(g.window.foundryMCPBridge).toBe(bridge);
    expect(typeof g.window.foundryMCPBridge.start).toBe('function');
    expect(typeof g.window.foundryMCPBridge.stop).toBe('function');
    expect(typeof g.window.foundryMCPBridge.restart).toBe('function');
  });
});

describe('main: onReady with the backend not answering', () => {
  it('a failed first connect is a warning, not a failed ready, and the index warm-ups still run', async () => {
    fake.state.connectOk = false;
    const warmCreatures = vi.fn();
    const warmPlayers = vi.fn();
    bridge['warmEnhancedIndex'] = warmCreatures;
    bridge['warmPlayerIndexes'] = warmPlayers;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(bridge.onReady()).resolves.toBeUndefined();

    expect(fake.state.instances).toHaveLength(1);
    expect(warmCreatures).toHaveBeenCalledTimes(1);
    expect(warmPlayers).toHaveBeenCalledTimes(1);
    const failedReady = errorSpy.mock.calls.some(c => String(c[0]).includes('Failed during ready'));
    expect(failedReady).toBe(false);
  });
});

describe('main: creature index warm-up at ready (#283)', () => {
  let ensure: Mock;

  beforeEach(() => {
    world.setSetting(MODULE_ID, 'enableEnhancedCreatureIndex', true);
    world.setSetting(MODULE_ID, 'bridgeUserId', 'gm');
    ensure = vi.fn().mockResolvedValue({ rebuilt: true, totalCreatures: 3 });
    bridge.queryHandlers.dataAccess.ensureEnhancedCreatureIndex = ensure;
  });

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

  it('with "Any GM" builds in every GM browser, active GM or not', () => {
    world.setSetting(MODULE_ID, 'bridgeUserId', '');
    Object.defineProperty(g.game.users, 'activeGM', {
      value: { id: 'other-gm' },
      configurable: true,
    });
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
