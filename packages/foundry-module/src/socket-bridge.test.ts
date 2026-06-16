/**
 * Tests for {@link SocketBridge} — the browser-side wire contract between the
 * Foundry module and the MCP backend.
 *
 * This is a live contract with zero prior coverage, so the focus is the parts a
 * regression would break silently: inbound message routing, the MCP-query
 * dispatch into `CONFIG.queries`, connection-type selection, the send gate, and
 * reconnect backoff. The transport itself (real WebSocket / WebRTC) is stubbed —
 * we drive the bridge's own handlers and assert what it sends / how its state
 * moves. Globals come from the Foundry-mock harness (for `ui`/`CONFIG`/`Scene`/
 * `Folder`/`game`); `window` and `WebSocket` are installed per-test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { SocketBridge, type BridgeConfig } from './socket-bridge.js';
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
    connectionType: 'websocket',
    ...overrides,
  };
}

/** A bridge pre-set to CONNECTED over a fake websocket, so `sendMessage` fires. */
function connectedBridge(overrides: Partial<BridgeConfig> = {}) {
  const bridge = new SocketBridge(makeConfig(overrides)) as any;
  const ws = { send: vi.fn(), close: vi.fn() };
  bridge.connectionState = CONNECTION_STATES.CONNECTED;
  bridge.activeConnectionType = 'websocket';
  bridge.ws = ws;
  return { bridge, ws };
}

/** Install a fake global WebSocket whose instances expose the assigned handlers. */
function installFakeWebSocket() {
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
  return { last: () => instances[instances.length - 1] };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  (globalThis as any).CONFIG.queries = {};
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (globalThis as any).window;
  delete (globalThis as any).WebSocket;
});

// ---------------------------------------------------------------------------
// determineConnectionType
// ---------------------------------------------------------------------------

describe('SocketBridge — connection-type selection', () => {
  it('honors an explicit websocket connection type', () => {
    const bridge = new SocketBridge(makeConfig({ connectionType: 'websocket' })) as any;
    expect(bridge.determineConnectionType()).toBe('websocket');
  });

  it('honors an explicit webrtc connection type', () => {
    const bridge = new SocketBridge(makeConfig({ connectionType: 'webrtc' })) as any;
    expect(bridge.determineConnectionType()).toBe('webrtc');
  });

  it('auto → webrtc on an https page', () => {
    (globalThis as any).window = { location: { protocol: 'https:' } };
    const bridge = new SocketBridge(makeConfig({ connectionType: 'auto' })) as any;
    expect(bridge.determineConnectionType()).toBe('webrtc');
  });

  it('auto → websocket on an http page', () => {
    (globalThis as any).window = { location: { protocol: 'http:' } };
    const bridge = new SocketBridge(makeConfig({ connectionType: 'auto' })) as any;
    expect(bridge.determineConnectionType()).toBe('websocket');
  });

  it('defaults to auto when connectionType is unset (http → websocket)', () => {
    (globalThis as any).window = { location: { protocol: 'http:' } };
    const cfg = makeConfig();
    delete (cfg as any).connectionType;
    const bridge = new SocketBridge(cfg) as any;
    expect(bridge.determineConnectionType()).toBe('websocket');
  });
});

// ---------------------------------------------------------------------------
// handleMCPQuery — the CONFIG.queries dispatch
// ---------------------------------------------------------------------------

describe('SocketBridge — MCP query dispatch', () => {
  it('routes to the registered CONFIG.queries handler and wraps a success envelope', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: 1 });
    (globalThis as any).CONFIG.queries['foundry-mcp-bridge.listActors'] = handler;
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
    (globalThis as any).CONFIG.queries['foundry-mcp-bridge.ping'] = handler;
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
    (globalThis as any).CONFIG.queries['foundry-mcp-bridge.boom'] = async () => {
      throw new Error('kaboom');
    };
    const bridge = new SocketBridge(makeConfig()) as any;
    const cb = vi.fn();

    await bridge.handleMCPQuery({ method: 'foundry-mcp-bridge.boom' }, cb);

    expect(cb).toHaveBeenCalledWith({ success: false, error: 'kaboom' });
  });
});

// ---------------------------------------------------------------------------
// handleMessage — inbound routing
// ---------------------------------------------------------------------------

describe('SocketBridge — inbound message routing', () => {
  it('mcp-query → sends an mcp-response carrying the query result', async () => {
    (globalThis as any).CONFIG.queries['foundry-mcp-bridge.listActors'] = async () => ['a'];
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

  it('job-completed → delegates to handleJobCompleted', async () => {
    const { bridge } = connectedBridge();
    const spy = vi.spyOn(bridge, 'handleJobCompleted').mockResolvedValue(undefined);

    await bridge.handleMessage({ type: 'job-completed', data: { foo: 1 } });

    expect(spy).toHaveBeenCalledWith({ foo: 1 });
  });

  it('map-generation-progress → surfaces a progress notification', async () => {
    const { bridge } = connectedBridge();

    await bridge.handleMessage({ type: 'map-generation-progress', data: { progress: 42 } });

    expect(world.notifications.some(n => n.level === 'info' && n.message.includes('42%'))).toBe(
      true
    );
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

  it('routes to webrtc.sendMessage when the active transport is webrtc', () => {
    const bridge = new SocketBridge(makeConfig()) as any;
    const webrtc = { sendMessage: vi.fn() };
    bridge.connectionState = CONNECTION_STATES.CONNECTED;
    bridge.activeConnectionType = 'webrtc';
    bridge.webrtc = webrtc;

    bridge.sendMessage({ type: 'x' });

    expect(webrtc.sendMessage).toHaveBeenCalledWith({ type: 'x' });
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
    const spy = vi.spyOn(bridge, 'determineConnectionType');
    await bridge.connect();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns immediately when a connect is already in flight', async () => {
    const bridge = new SocketBridge(makeConfig()) as any;
    bridge.connectionState = CONNECTION_STATES.CONNECTING;
    const spy = vi.spyOn(bridge, 'determineConnectionType');
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

  it('disconnect closes the socket, tears down webrtc, and resets state', () => {
    vi.useFakeTimers();
    const bridge = new SocketBridge(makeConfig()) as any;
    const ws = { close: vi.fn() };
    const webrtc = { disconnect: vi.fn() };
    bridge.ws = ws;
    bridge.webrtc = webrtc;
    bridge.connectionState = CONNECTION_STATES.CONNECTED;
    bridge.activeConnectionType = 'websocket';
    bridge.reconnectTimer = setTimeout(() => {}, 1000);

    bridge.disconnect();

    expect(ws.close).toHaveBeenCalledWith(1000, 'Manual disconnect');
    expect(webrtc.disconnect).toHaveBeenCalled();
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

  it('stops scheduling once the max attempts are exhausted', () => {
    vi.useFakeTimers();
    const bridge = new SocketBridge(makeConfig({ reconnectAttempts: 2 })) as any;
    bridge.reconnectAttempts = 2; // already at the cap

    bridge.scheduleReconnect();

    expect(bridge.reconnectTimer).toBeNull();
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
      maxReconnectAttempts: 5,
      config: { host: 'h', port: 99, namespace: '/n' },
    });
  });
});

// ---------------------------------------------------------------------------
// progress + job-completion notifications
// ---------------------------------------------------------------------------

describe('SocketBridge — map progress + job completion', () => {
  it('builds a full progress message (percent, step, remaining, status)', () => {
    const bridge = new SocketBridge(makeConfig()) as any;

    bridge.handleProgressUpdate({
      progress: 50,
      status: 'rendering',
      queueInfo: { currentStep: 2, totalSteps: 4, estimatedTimeRemaining: 90 },
    });

    const msg = world.notifications.at(-1)!.message;
    expect(msg).toContain('50%');
    expect(msg).toContain('(Step 2/4)');
    expect(msg).toContain('1m 30s remaining');
    expect(msg).toContain('rendering');
  });

  it('ignores an empty progress payload', () => {
    const bridge = new SocketBridge(makeConfig()) as any;
    bridge.handleProgressUpdate(null);
    expect(world.notifications).toHaveLength(0);
  });

  it('job completion with no result data surfaces an error notification', async () => {
    const bridge = new SocketBridge(makeConfig()) as any;
    await bridge.handleJobCompleted({ image_path: '/x.png' });
    expect(
      world.notifications.some(
        n => n.level === 'error' && n.message.includes('No scene result data provided')
      )
    ).toBe(true);
  });

  it('job completion with no image path surfaces an error notification', async () => {
    const bridge = new SocketBridge(makeConfig()) as any;
    await bridge.handleJobCompleted({ result: { name: 'X' } });
    expect(
      world.notifications.some(
        n => n.level === 'error' && n.message.includes('No image path provided')
      )
    ).toBe(true);
  });
});
