/**
 * Tests for {@link SocketBridge} — the browser-side wire contract between the
 * Foundry module and the MCP backend.
 *
 * This is a live contract with zero prior coverage, so the focus is the parts a
 * regression would break silently: inbound message routing, the MCP-query
 * dispatch into `CONFIG.queries`, the send gate, and
 * reconnect backoff. The transport itself (the real WebSocket) is stubbed —
 * we drive the bridge's own handlers and assert what it sends / how its state
 * moves. Globals come from the Foundry-mock harness (for `ui`/`CONFIG`/`Scene`/
 * `Folder`/`game`); `window` and `WebSocket` are installed per-test.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { SocketBridge, type BridgeConfig } from './socket-bridge.js';
import { bridgeHandlers } from './bridge-handlers.js';
import { CONNECTION_STATES } from './constants.js';

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
    ...overrides,
  };
}

/** A bridge pre-set to CONNECTED over a fake websocket, so `sendMessage` fires. */
function connectedBridge(overrides: Partial<BridgeConfig> = {}): {
  bridge: Record<string, any>;
  ws: { send: Mock; close: Mock };
} {
  const bridge = new SocketBridge(makeConfig(overrides)) as any;
  const ws = { send: vi.fn(), close: vi.fn() };
  bridge.connectionState = CONNECTION_STATES.CONNECTED;
  bridge.activeConnectionType = 'websocket';
  bridge.ws = ws;
  return { bridge, ws };
}

/** Install a fake global WebSocket whose instances expose the assigned handlers. */
function installFakeWebSocket(): { last: () => Record<string, any> } {
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
  return { last: (): Record<string, any> => instances[instances.length - 1] };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  (globalThis as any).CONFIG.queries = {};
  bridgeHandlers.deleteByPrefix('');
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (globalThis as any).window;
  delete (globalThis as any).WebSocket;
});

// ---------------------------------------------------------------------------
// handleMCPQuery — dispatch from the private handler table
// ---------------------------------------------------------------------------

describe('SocketBridge — MCP query dispatch', () => {
  it('routes to the registered bridge handler and wraps a success envelope', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: 1 });
    bridgeHandlers.set('foundry-mcp-bridge.listActors', handler);
    const bridge = new SocketBridge(makeConfig()) as any;
    const cb = vi.fn();

    await bridge.handleMCPQuery(
      { method: 'foundry-mcp-bridge.listActors', data: { type: 'npc' } },
      cb
    );

    expect(handler).toHaveBeenCalledWith({ type: 'npc' });
    expect(cb).toHaveBeenCalledWith({ success: true, data: { ok: 1 } });
  });

  it('passes {} to the handler when no data is supplied', async () => {
    const handler = vi.fn().mockResolvedValue(null);
    bridgeHandlers.set('foundry-mcp-bridge.ping', handler);
    const bridge = new SocketBridge(makeConfig()) as any;

    await bridge.handleMCPQuery({ method: 'foundry-mcp-bridge.ping' }, vi.fn());

    expect(handler).toHaveBeenCalledWith({});
  });

  it('returns a failure envelope when no handler is registered', async () => {
    const bridge = new SocketBridge(makeConfig()) as any;
    const cb = vi.fn();

    await bridge.handleMCPQuery({ method: 'foundry-mcp-bridge.nope' }, cb);

    expect(cb).toHaveBeenCalledWith({
      success: false,
      error: 'No handler found for query: foundry-mcp-bridge.nope',
    });
  });

  it('returns a failure envelope (with the message) when the handler throws', async () => {
    bridgeHandlers.set('foundry-mcp-bridge.boom', async () => {
      throw new Error('kaboom');
    });
    const bridge = new SocketBridge(makeConfig()) as any;
    const cb = vi.fn();

    await bridge.handleMCPQuery({ method: 'foundry-mcp-bridge.boom' }, cb);

    expect(cb).toHaveBeenCalledWith({ success: false, error: 'kaboom' });
  });
});

describe('SocketBridge — query lockdown', () => {
  it('never dispatches a handler that only exists in CONFIG.queries', async () => {
    const handler = vi.fn().mockResolvedValue({ leaked: true });
    (globalThis as any).CONFIG.queries['foundry-mcp-bridge.listActors'] = handler;
    const bridge = new SocketBridge(makeConfig()) as any;
    const cb = vi.fn();

    await bridge.handleMCPQuery({ method: 'foundry-mcp-bridge.listActors' }, cb);

    expect(handler).not.toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith({
      success: false,
      error: 'No handler found for query: foundry-mcp-bridge.listActors',
    });
  });

  it('rejects a non-string method without touching the table', async () => {
    const bridge = new SocketBridge(makeConfig()) as any;
    const cb = vi.fn();

    await bridge.handleMCPQuery({ method: { toString: () => 'x' } }, cb);

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ---------------------------------------------------------------------------
// handleMessage — inbound routing
// ---------------------------------------------------------------------------

describe('SocketBridge — inbound message routing', () => {
  it('mcp-query → sends an mcp-response carrying the query result', async () => {
    bridgeHandlers.set('foundry-mcp-bridge.listActors', async () => ['a']);
    const { bridge, ws } = connectedBridge();

    await bridge.handleMessage({
      type: 'mcp-query',
      id: 'q1',
      data: { method: 'foundry-mcp-bridge.listActors' },
    });

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent).toMatchObject({
      type: 'mcp-response',
      id: 'q1',
      data: { success: true, data: ['a'] },
    });
  });

  it('ping → replies with a pong (status ok)', async () => {
    const { bridge, ws } = connectedBridge();

    await bridge.handleMessage({ type: 'ping', id: 'p1' });

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent).toMatchObject({ type: 'pong', id: 'p1', data: { status: 'ok' } });
  });

  it('an unknown message type is ignored (no send, no throw)', async () => {
    const { bridge, ws } = connectedBridge();
    await expect(bridge.handleMessage({ type: 'whatever' })).resolves.toBeUndefined();
    expect(ws.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendMessage — the connection gate + transport routing
// ---------------------------------------------------------------------------

describe('SocketBridge — send gate', () => {
  it('drops the message when not connected', () => {
    const bridge = new SocketBridge(makeConfig()) as any;
    const ws = { send: vi.fn() };
    bridge.ws = ws;
    bridge.activeConnectionType = 'websocket'; // but still DISCONNECTED

    bridge.sendMessage({ type: 'x' });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('serializes to JSON over the websocket when connected', () => {
    const { bridge, ws } = connectedBridge();
    bridge.sendMessage({ type: 'x', n: 1 });
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'x', n: 1 }));
  });

  it('emitToServer wraps the event as { type, data, timestamp } and sends it', () => {
    const { bridge, ws } = connectedBridge();
    bridge.emitToServer('bridge-status', { online: true });
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent).toMatchObject({ type: 'bridge-status', data: { online: true } });
    expect(typeof sent.timestamp).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// connect / disconnect lifecycle
// ---------------------------------------------------------------------------

describe('SocketBridge — connect lifecycle', () => {
  it('returns immediately when already connected', async () => {
    const bridge = new SocketBridge(makeConfig()) as any;
    bridge.connectionState = CONNECTION_STATES.CONNECTED;
    const spy = vi.spyOn(bridge, 'connectWebSocket');
    await bridge.connect();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns immediately when a connect is already in flight', async () => {
    const bridge = new SocketBridge(makeConfig()) as any;
    bridge.connectionState = CONNECTION_STATES.CONNECTING;
    const spy = vi.spyOn(bridge, 'connectWebSocket');
    await bridge.connect();
    expect(spy).not.toHaveBeenCalled();
  });

  it('connects via websocket and transitions to CONNECTED on open', async () => {
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig()) as any;

    const p = bridge.connect();
    fake.last().onopen();
    await p;

    expect(bridge.isConnected()).toBe(true);
    expect(bridge.getConnectionState()).toBe(CONNECTION_STATES.CONNECTED);
  });

  it('builds a ws:// URL even when the page is served over https', async () => {
    (globalThis as any).window = { location: { protocol: 'https:' } };
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig()) as any;

    const p = bridge.connect();
    fake.last().onopen();
    await p;

    expect(fake.last().url).toBe('ws://localhost:31415/mcp');
  });

  it('rejects and schedules a reconnect when the websocket errors', async () => {
    vi.useFakeTimers();
    const fake = installFakeWebSocket();
    const bridge = new SocketBridge(makeConfig()) as any;

    const p = bridge.connect();
    fake.last().onerror(new Error('refused'));

    await expect(p).rejects.toThrow('WebSocket connection failed');
    expect(bridge.getConnectionState()).toBe(CONNECTION_STATES.RECONNECTING);
    expect(bridge.getConnectionInfo().reconnectAttempts).toBe(1);
    vi.clearAllTimers();
  });

  it('disconnect closes the socket and resets state', () => {
    vi.useFakeTimers();
    const bridge = new SocketBridge(makeConfig()) as any;
    const ws = { close: vi.fn() };
    bridge.ws = ws;
    bridge.connectionState = CONNECTION_STATES.CONNECTED;
    bridge.activeConnectionType = 'websocket';
    bridge.reconnectTimer = setTimeout(() => {}, 1000);

    bridge.disconnect();

    expect(ws.close).toHaveBeenCalledWith(1000, 'Manual disconnect');
    expect(bridge.getConnectionState()).toBe(CONNECTION_STATES.DISCONNECTED);
    expect(bridge.activeConnectionType).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// scheduleReconnect — backoff + cap
// ---------------------------------------------------------------------------

describe('SocketBridge — reconnect backoff', () => {
  it('increments the attempt counter and enters RECONNECTING', () => {
    vi.useFakeTimers();
    const bridge = new SocketBridge(makeConfig()) as any;

    bridge.scheduleReconnect();

    expect(bridge.reconnectAttempts).toBe(1);
    expect(bridge.getConnectionState()).toBe(CONNECTION_STATES.RECONNECTING);
    expect(bridge.reconnectTimer).not.toBeNull();
    vi.clearAllTimers();
  });

  it('never gives up: attempt 500 still schedules a retry', () => {
    vi.useFakeTimers();
    const bridge = new SocketBridge(makeConfig({ reconnectAttempts: 2 })) as any;
    bridge.reconnectAttempts = 500;

    bridge.scheduleReconnect();

    expect(bridge.reconnectTimer).not.toBeNull();
    expect(bridge.reconnectAttempts).toBe(501);
    vi.clearAllTimers();
  });
});

// ---------------------------------------------------------------------------
// state getters
// ---------------------------------------------------------------------------

describe('SocketBridge — state accessors', () => {
  it('starts disconnected', () => {
    const bridge = new SocketBridge(makeConfig());
    expect(bridge.isConnected()).toBe(false);
    expect(bridge.getConnectionState()).toBe(CONNECTION_STATES.DISCONNECTED);
  });

  it('getConnectionInfo reflects config, state, and attempt counters', () => {
    const bridge = new SocketBridge(
      makeConfig({ serverHost: 'h', serverPort: 99, namespace: '/n', reconnectAttempts: 5 })
    );
    expect(bridge.getConnectionInfo()).toMatchObject({
      type: null,
      state: CONNECTION_STATES.DISCONNECTED,
      reconnectAttempts: 0,
      maxReconnectAttempts: null,
      config: { host: 'h', port: 99, namespace: '/n' },
    });
  });
});
