/**
 * `onLinkChange`: the socket bridge tells its owner when an open link opens and
 * when it is lost, but not for failed retries or a deliberate `disconnect()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { SocketBridge, type BridgeConfig } from './socket-bridge.js';

let world: TestWorld;
let restore: () => void;
const sockets: any[] = [];

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

async function open(bridge: SocketBridge): Promise<any> {
  const p = bridge.connect();
  const ws = sockets[sockets.length - 1];
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
  class FakeWebSocket {
    onopen: any;
    onerror: any;
    onclose: any;
    onmessage: any;
    send = vi.fn();
    close = vi.fn();
    constructor(public url: string) {
      sockets.push(this);
    }
  }
  (globalThis as any).WebSocket = FakeWebSocket;
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
  sockets.length = 0;
  delete (globalThis as any).WebSocket;
});

describe('onLinkChange', () => {
  it('reports up, then one down for an error plus close', async () => {
    const calls: boolean[] = [];
    const bridge = new SocketBridge(makeConfig({ onLinkChange: up => calls.push(up) }));
    const ws = await open(bridge);
    expect(calls).toEqual([true]);
    ws.onerror(new Error('x'));
    ws.onclose({ wasClean: false, reason: '' });
    expect(calls).toEqual([true, false]);
    bridge.disconnect();
  });

  it('writes one console line per link change even with debug logging off', async () => {
    const log = vi.mocked(globalThis.console['log']);
    const bridge = new SocketBridge(makeConfig({ debugLogging: false }));
    const ws = await open(bridge);
    ws.onerror(new Error('x'));
    ws.onclose({ wasClean: false, reason: 'gone' });
    ws.onclose({ wasClean: false, reason: 'gone' });
    const lines = log.mock.calls.map(c => String(c[0]));
    expect(lines.filter(l => l.includes('Connected to the MCP server'))).toHaveLength(1);
    expect(lines.filter(l => l.includes('Lost the MCP server link: gone'))).toHaveLength(1);
    bridge.disconnect();
  });

  it('writes the connected line again after a deliberate disconnect and reconnect', async () => {
    const log = vi.mocked(globalThis.console['log']);
    const bridge = new SocketBridge(makeConfig());
    await open(bridge);
    bridge.disconnect();
    await open(bridge);
    const lines = log.mock.calls.map(c => String(c[0]));
    expect(lines.filter(l => l.includes('Connected to the MCP server'))).toHaveLength(2);
    bridge.disconnect();
  });

  it('logs no lost-link line for a connect that never opened', async () => {
    const log = vi.mocked(globalThis.console['log']);
    const bridge = new SocketBridge(makeConfig());
    const p = bridge.connect();
    sockets[0].onerror(new Error('refused'));
    sockets[0].onclose({ wasClean: false, reason: '' });
    await expect(p).rejects.toThrow();
    expect(
      log.mock.calls.map(c => String(c[0])).some(l => l.includes('Lost the MCP server link'))
    ).toBe(false);
    bridge.disconnect();
  });

  it('says nothing for a deliberate disconnect', async () => {
    const calls: boolean[] = [];
    const bridge = new SocketBridge(makeConfig({ onLinkChange: up => calls.push(up) }));
    const ws = await open(bridge);
    bridge.disconnect();
    ws.onclose({ wasClean: true, reason: '' });
    expect(calls).toEqual([true]);
  });

  it('says nothing for a connect that never opened', async () => {
    const calls: boolean[] = [];
    const bridge = new SocketBridge(makeConfig({ onLinkChange: up => calls.push(up) }));
    const p = bridge.connect();
    sockets[0].onerror(new Error('refused'));
    await expect(p).rejects.toThrow();
    expect(calls).toEqual([]);
    bridge.disconnect();
  });
});
