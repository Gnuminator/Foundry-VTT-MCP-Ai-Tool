/**
 * Tests for how `main.ts` runs the link (lane 1, PB-02 and PB-03): one bridge at
 * a time, only the configured bridge user dials, a light heartbeat, and no
 * world-setting writes for connection state (the one exception: a `linkState` write per confirmed
 * lost, back or quiet notice, never per retry or start).
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
  g.game.user.can = (permission: string): boolean => permission === 'SETTINGS_MODIFY';
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

  it('with connection messages on, repeated failed starts write the link state once', async () => {
    world.setSetting(MODULE_ID, 'enableNotifications', true);
    world.setSetting(MODULE_ID, 'bridgeUserId', 'gm');
    fake.state.connectOk = false;
    await expect(bridge.start()).rejects.toThrow();
    await expect(bridge.start()).rejects.toThrow();
    await expect(bridge.start()).rejects.toThrow();
    const linkWrites = setSpy.mock.calls.filter(c => c[1] === 'linkState');
    expect(linkWrites.map(c => (c[2] as { state: string }).state)).toEqual(['lost']);
  });

  it('in Any GM mode (no bridge user chosen) the holder writes no link state', async () => {
    world.setSetting(MODULE_ID, 'enableNotifications', true);
    fake.state.connectOk = false;
    await expect(bridge.start()).rejects.toThrow();
    expect(setSpy.mock.calls.filter(c => c[1] === 'linkState')).toHaveLength(0);
  });

  it('a user who cannot change world settings writes no link state', async () => {
    world.setSetting(MODULE_ID, 'enableNotifications', true);
    world.setSetting(MODULE_ID, 'bridgeUserId', 'gm');
    g.game.user.can = (): boolean => false;
    fake.state.connectOk = false;
    await expect(bridge.start()).rejects.toThrow();
    expect(setSpy.mock.calls.filter(c => c[1] === 'linkState')).toHaveLength(0);
  });

  it('a failed link state write is not remembered as published, so the next start tries again', async () => {
    world.setSetting(MODULE_ID, 'enableNotifications', true);
    world.setSetting(MODULE_ID, 'bridgeUserId', 'gm');
    setSpy.mockImplementation(() => Promise.reject(new Error('denied')));
    fake.state.connectOk = false;
    await expect(bridge.start()).rejects.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0));
    await expect(bridge.start()).rejects.toThrow();
    expect(setSpy.mock.calls.filter(c => c[1] === 'linkState')).toHaveLength(2);
  });

  it('a stored link state change reaches the hook and applyStoredLinkState', async () => {
    const hooks = (globalThis as any).Hooks;
    const handlers: Array<() => void> = [];
    const onSpy = vi.spyOn(hooks, 'on').mockImplementation((name: string, cb: () => void) => {
      if (name === 'foundry-mcp-bridge.linkStateChanged') handlers.push(cb);
      return 1;
    });
    const apply = vi.spyOn(bridge, 'applyStoredLinkState').mockImplementation(() => undefined);
    bridge.watchLinkState();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(handlers).toHaveLength(1);
    handlers[0]();
    expect(apply).toHaveBeenCalledTimes(2);
    onSpy.mockRestore();
  });

  it('with connection messages on, a start that connects after a lost one writes up', async () => {
    world.setSetting(MODULE_ID, 'enableNotifications', true);
    world.setSetting(MODULE_ID, 'bridgeUserId', 'gm');
    fake.state.connectOk = false;
    await expect(bridge.start()).rejects.toThrow();
    fake.state.connectOk = true;
    await bridge.start();
    const states = setSpy.mock.calls
      .filter(c => c[1] === 'linkState')
      .map(c => (c[2] as { state: string }).state);
    expect(states).toEqual(['lost', 'up']);
  });

  it('with connection messages on, a stop after a lost link writes one quiet', async () => {
    world.setSetting(MODULE_ID, 'enableNotifications', true);
    world.setSetting(MODULE_ID, 'bridgeUserId', 'gm');
    fake.state.connectOk = false;
    await expect(bridge.start()).rejects.toThrow();
    await bridge.stop();
    const states = setSpy.mock.calls
      .filter(c => c[1] === 'linkState')
      .map(c => (c[2] as { state: string }).state);
    expect(states).toEqual(['lost', 'quiet']);
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
    expect(warnings()[0]).toContain('Cannot reach the AI Tool server. Is it started?');

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

describe('main: link toasts', () => {
  const messages = (): string[] => world.notifications.map(n => n.message);
  const linkToasts = (): string[] =>
    messages().filter(m => m.includes('link to the AI Tool') || m.includes('link is back'));

  beforeEach(() => {
    world.setSetting(MODULE_ID, 'enableNotifications', true);
    world.setSetting(MODULE_ID, 'bridgeUserId', 'gm');
  });

  it('wires onLinkChange in start(): a lasting drop shows lost, then back', async () => {
    vi.useFakeTimers();
    await bridge.start();
    const { onLinkChange } = fake.state.lastConfig;
    onLinkChange(false);
    vi.advanceTimersByTime(11_000);
    expect(linkToasts()).toEqual([expect.stringContaining('Lost the link')]);
    onLinkChange(true);
    expect(linkToasts()).toHaveLength(2);
    expect(linkToasts()[1]).toContain('link is back');
  });

  it('stopNow() resets the notifier: a pending lost toast never shows', async () => {
    vi.useFakeTimers();
    await bridge.start();
    fake.state.lastConfig.onLinkChange(false);
    await bridge.stop();
    vi.advanceTimersByTime(60_000);
    expect(linkToasts()).toEqual([]);
  });

  it('stopNow() forgets a shown lost toast: a later up() says nothing', async () => {
    vi.useFakeTimers();
    await bridge.start();
    const { onLinkChange } = fake.state.lastConfig;
    onLinkChange(false);
    vi.advanceTimersByTime(11_000);
    await bridge.stop();
    onLinkChange(true);
    expect(linkToasts()).toHaveLength(1);
  });

  it('"Show connection messages" off silences both toasts', async () => {
    vi.useFakeTimers();
    world.setSetting(MODULE_ID, 'enableNotifications', false);
    await bridge.start();
    const { onLinkChange } = fake.state.lastConfig;
    onLinkChange(false);
    vi.advanceTimersByTime(11_000);
    onLinkChange(true);
    expect(linkToasts()).toEqual([]);
  });

  it('shows no toast for a player', async () => {
    vi.useFakeTimers();
    await bridge.start();
    g.game.user.isGM = false;
    const { onLinkChange } = fake.state.lastConfig;
    onLinkChange(false);
    vi.advanceTimersByTime(11_000);
    onLinkChange(true);
    expect(linkToasts()).toEqual([]);
  });

  it('a start that could not connect still owes the back toast once the link opens', async () => {
    vi.useFakeTimers();
    world.setSetting(MODULE_ID, 'enableNotifications', true);
    world.setSetting(MODULE_ID, 'bridgeUserId', 'gm');
    fake.state.connectOk = false;
    await expect(bridge.start()).rejects.toThrow();
    expect(messages().some(m => m.includes('Cannot reach the AI Tool server'))).toBe(true);
    vi.advanceTimersByTime(60_000); // no extra "lost" toast on top of the warning
    expect(linkToasts()).toEqual([]);
    fake.state.lastConfig.onLinkChange(true); // a background retry got through
    expect(linkToasts()).toEqual([expect.stringContaining('link is back')]);
  });

  it('a new start() forgets the old bridge: a link coming back says only "connected"', async () => {
    vi.useFakeTimers();
    await bridge.start();
    fake.state.lastConfig.onLinkChange(false);
    vi.advanceTimersByTime(11_000); // the old bridge's drop was shown
    bridge['socketBridge'].connected = false; // the canvas reloads and start() runs again
    await bridge.start();
    expect(messages().filter(m => m.includes('AI Tool connected'))).toHaveLength(2);
    fake.state.lastConfig.onLinkChange(true);
    expect(linkToasts()).toEqual([expect.stringContaining('Lost the link')]);
  });

  it('a failed start for a non-GM shows no warning and owes no back toast', async () => {
    vi.useFakeTimers();
    world.setSetting(MODULE_ID, 'allowNonGmAccess', true);
    g.game.user.isGM = false;
    fake.state.connectOk = false;
    await expect(bridge.start()).rejects.toThrow();
    expect(messages().some(m => m.includes('Cannot reach the AI Tool server'))).toBe(false);
    fake.state.lastConfig.onLinkChange(true);
    expect(linkToasts()).toEqual([]);
  });

  it('a failed start with connection messages off owes no back toast', async () => {
    vi.useFakeTimers();
    world.setSetting(MODULE_ID, 'enableNotifications', false);
    fake.state.connectOk = false;
    await expect(bridge.start()).rejects.toThrow();
    fake.state.lastConfig.onLinkChange(true);
    expect(linkToasts()).toEqual([]);
  });

  it('a failed start, then stop, then the link coming up says nothing', async () => {
    vi.useFakeTimers();
    fake.state.connectOk = false;
    await expect(bridge.start()).rejects.toThrow();
    const { onLinkChange } = fake.state.lastConfig;
    await bridge.stop();
    onLinkChange(true);
    expect(linkToasts()).toEqual([]);
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
