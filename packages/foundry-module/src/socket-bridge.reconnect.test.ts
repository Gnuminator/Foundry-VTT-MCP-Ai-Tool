/**
 * Lane 1 tests for {@link SocketBridge}: reconnect forever with backoff and a
 * single timer (PB-03), and the `module-hello` frame sent when the link opens
 * (PB-02). The transport is stubbed; we drive the handlers the bridge assigns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { SocketBridge, reconnectDelayMs, type BridgeConfig } from './socket-bridge.js';
import { WebRTCConnection } from './webrtc-connection.js';
import { CONNECTION_STATES, MODULE_HELLO_TYPE } from './constants.js';
import { MODULE_HELLO_TYPE as SHARED_HELLO_TYPE } from '../../../shared/src/protocol.js';

let world: TestWorld;
let restore: () => void;

function makeConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    enabled: true,
    serverHost: 'localhost',
    serverPort: 31415,
    namespace: '/mcp',
    reconnectAttempts: 5,
    reconnectDelay: 1000,
    connectionTimeout: 10,
    debugLogging: false,
    connectionType: 'websocket',
    ...overrides,
  };
}

const closed = { wasClean: false, reason: '' };

function installFakeWebSocket(): { all: any[]; last: () => any } {
  const instances: any[] = [];
  class FakeWebSocket {
    onopen: any;
    onerror: any;
    onclose: any;
    onmessage: any;
    send = vi.fn();
    close = vi.fn();
    constructor(public url: string) {
      instances.push(this);
    }
  }
  (globalThis as any).WebSocket = FakeWebSocket;
  return { all: instances, last: (): any => instances[instances.length - 1] };
}

/** Connect a bridge over the fake websocket and open it. */
async function openBridge(
  bridge: any,
  fake: ReturnType<typeof installFakeWebSocket>
): Promise<any> {
  const p = bridge.connect();
  const ws = fake.last();
  ws.onopen();
  await p;
  return ws;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (globalThis as any).WebSocket;
});

describe('hello type copy', () => {
  it('the module and shared agree on the hello frame type', () => {
    expect(MODULE_HELLO_TYPE).toBe(SHARED_HELLO_TYPE);
  });
});

describe('reconnect backoff delays (PB-03)', () => {
  it('doubles from 1 s and caps at 30 s (no jitter)', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 50].map(n => reconnectDelayMs(n, () => 0));
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it('jitter shortens the wait by up to 20 %, so the cap of 30 s always holds', () => {
    expect(reconnectDelayMs(0, () => 0.5)).toBe(900);
    expect(reconnectDelayMs(10, () => 1)).toBe(24000);
    for (let i = 0; i < 50; i++) {
      const d = reconnectDelayMs(3);
      expect(d).toBeGreaterThanOrEqual(6400);
      expect(d).toBeLessThanOrEqual(8000);
      expect(reconnectDelayMs(20)).toBeLessThanOrEqual(30000);
    }
  });
});

describe('reconnect forever, one timer (PB-03)', () => {
  it('keeps retrying a dead server far beyond the old 5 attempt limit', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig()) as any;

    const first = bridge.connect().catch(() => undefined);
    fake.last().onerror(new Error('refused'));
    fake.last().onclose(closed);
    await first;

    for (let i = 0; i < 25; i++) {
      await vi.advanceTimersByTimeAsync(30000);
      fake.last().onerror(new Error('refused'));
      fake.last().onclose(closed);
    }

    // Early sockets that were never failed also hit the 10 s connect timeout and retry.
    expect(fake.all.length).toBeGreaterThanOrEqual(26);
    expect(bridge.getConnectionState()).toBe(CONNECTION_STATES.RECONNECTING);
    expect(bridge.getConnectionInfo().reconnectAttempts).toBe(fake.all.length);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('error plus close for one failed connect arm one timer and count one attempt', async () => {
    vi.useFakeTimers();
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig()) as any;

    const p = bridge.connect().catch(() => undefined);
    fake.last().onerror(new Error('refused'));
    fake.last().onclose(closed);
    await p;

    expect(bridge.getConnectionInfo().reconnectAttempts).toBe(1);
    expect(bridge.getConnectionState()).toBe(CONNECTION_STATES.RECONNECTING);
    expect(vi.getTimerCount()).toBe(1); // the retry timer; the connect timeout is cleared
  });

  it('a second scheduleReconnect while one is pending changes nothing', () => {
    vi.useFakeTimers();
    const bridge = new SocketBridge(makeConfig()) as any;
    bridge.scheduleReconnect();
    bridge.scheduleReconnect();
    bridge.scheduleReconnect();
    expect(bridge.getConnectionInfo().reconnectAttempts).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('reconnects after a dropped link, even a clean close from the server', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig()) as any;
    const before = await openBridge(bridge, fake);

    before.onclose({ wasClean: true, reason: 'server stopping' });
    expect(bridge.getConnectionState()).toBe(CONNECTION_STATES.RECONNECTING);
    await vi.advanceTimersByTimeAsync(1000);

    expect(fake.last()).not.toBe(before);
  });

  it('resets the backoff after a successful connect', async () => {
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig()) as any;
    bridge.reconnectAttempts = 7;
    await openBridge(bridge, fake);
    expect(bridge.getConnectionInfo().reconnectAttempts).toBe(0);
  });

  it('a connect timeout closes the socket and schedules a retry', async () => {
    vi.useFakeTimers();
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig({ connectionTimeout: 10 })) as any;
    const p = bridge.connect().catch((e: Error) => e);
    const ws = fake.last();

    await vi.advanceTimersByTimeAsync(10000);

    expect(await p).toEqual(new Error('Connection timeout'));
    expect(ws.close).toHaveBeenCalled();
    expect(bridge.getConnectionState()).toBe(CONNECTION_STATES.RECONNECTING);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('disconnect() stops retrying and ignores the old socket closing later', async () => {
    vi.useFakeTimers();
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig()) as any;
    const ws = await openBridge(bridge, fake);

    bridge.disconnect();
    ws.onclose(closed);

    expect(vi.getTimerCount()).toBe(0);
    expect(bridge.getConnectionState()).toBe(CONNECTION_STATES.DISCONNECTED);
  });

  it('a stale socket closing late does not disturb a newer connection', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig()) as any;
    const old = await openBridge(bridge, fake);
    old.onclose(closed);
    await vi.advanceTimersByTimeAsync(1000);
    fake.last().onopen();

    old.onclose(closed);

    expect(bridge.isConnected()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('autoReconnect off: a drop and a failed connect are not retried', async () => {
    vi.useFakeTimers();
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig({ autoReconnect: () => false })) as any;
    await openBridge(bridge, fake);

    fake.last().onclose(closed);
    expect(vi.getTimerCount()).toBe(0);
    expect(bridge.getConnectionState()).toBe(CONNECTION_STATES.DISCONNECTED);

    const p2 = bridge.connect().catch(() => undefined);
    fake.last().onerror(new Error('refused'));
    await p2;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('autoReconnect is read live at the moment of the drop', async () => {
    vi.useFakeTimers();
    let on = true;
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig({ autoReconnect: () => on })) as any;
    await openBridge(bridge, fake);

    on = false;
    fake.last().onclose(closed);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an explicit connect() replaces a pending reconnect timer', async () => {
    vi.useFakeTimers();
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig()) as any;
    bridge.scheduleReconnect();
    expect(vi.getTimerCount()).toBe(1);

    await openBridge(bridge, fake);

    expect(vi.getTimerCount()).toBe(0);
    expect(bridge.isConnected()).toBe(true);
  });
});

describe('hello frame (PB-02)', () => {
  const hello = {
    userId: 'u1',
    userName: 'Gamemaster',
    isBridgeUser: true,
    moduleVersion: '0.15.0',
    worldId: 'w1',
  };

  it('sends module-hello right after the websocket opens', async () => {
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig({ getHello: () => hello })) as any;
    const ws = await openBridge(bridge, fake);

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({ type: MODULE_HELLO_TYPE, data: hello });
  });

  it('sends a fresh hello on every reconnect', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig({ getHello: () => hello })) as any;
    const first = await openBridge(bridge, fake);
    first.onclose(closed);
    await vi.advanceTimersByTimeAsync(1000);
    const second = fake.last();
    second.onopen();

    expect(second).not.toBe(first);
    expect(second.send).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when no hello builder is configured', async () => {
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig()) as any;
    const ws = await openBridge(bridge, fake);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('a throwing hello builder never breaks the link', async () => {
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(
      makeConfig({
        getHello: () => {
          throw new Error('no game yet');
        },
      })
    ) as any;
    await openBridge(bridge, fake);
    expect(bridge.isConnected()).toBe(true);
  });
});

describe('WebRTC path', () => {
  it('sends the hello over the channel when it opens', async () => {
    const hello = {
      userId: 'u1',
      userName: 'GM',
      isBridgeUser: false,
      moduleVersion: 'unknown',
      worldId: 'w1',
    };
    const sent: any[] = [];
    vi.spyOn(WebRTCConnection.prototype, 'connect').mockImplementation((_m, events) => {
      events?.onOpen?.();
      return Promise.resolve();
    });
    vi.spyOn(WebRTCConnection.prototype, 'sendMessage').mockImplementation(message => {
      sent.push(message);
    });
    const bridge = new SocketBridge(
      makeConfig({ connectionType: 'webrtc', getHello: () => hello })
    ) as any;

    await bridge.connect();

    expect(sent).toEqual([{ type: MODULE_HELLO_TYPE, data: hello }]);
    expect(bridge.isConnected()).toBe(true);
  });

  it('a lost channel reconnects with one timer, and a failed retry retries again', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const events: any[] = [];
    let failNext = false;
    vi.spyOn(WebRTCConnection.prototype, 'connect').mockImplementation((_m, ev) => {
      if (failNext) return Promise.reject(new Error('ICE gathering timeout'));
      events.push(ev);
      return Promise.resolve();
    });
    vi.spyOn(WebRTCConnection.prototype, 'disconnect').mockImplementation(() => undefined);
    const bridge = new SocketBridge(makeConfig({ connectionType: 'webrtc' })) as any;

    await bridge.connect();
    expect(bridge.isConnected()).toBe(true);
    events[0].onClose();
    expect(bridge.getConnectionState()).toBe(CONNECTION_STATES.RECONNECTING);
    events[0].onClose(); // the same loss reported twice
    expect(vi.getTimerCount()).toBe(1);

    failNext = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(bridge.getConnectionState()).toBe(CONNECTION_STATES.RECONNECTING);
    expect(vi.getTimerCount()).toBe(1);
    expect(bridge.getConnectionInfo().reconnectAttempts).toBe(2);
  });
});
