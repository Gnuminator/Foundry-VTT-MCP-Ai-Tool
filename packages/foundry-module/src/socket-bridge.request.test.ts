/**
 * Tests for the module-initiated request frame (I-108): `SocketBridge.request`
 * sends `module-request` and resolves on the matching `module-reply`. The
 * transport is stubbed; we drive the handlers the bridge assigns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { SocketBridge, MODULE_REQUEST_TIMEOUT_MS, type BridgeConfig } from './socket-bridge.js';
import { MODULE_REPLY_TYPE, MODULE_REQUEST_TOOLS, MODULE_REQUEST_TYPE } from './constants.js';
import {
  MODULE_REPLY_TYPE as SHARED_REPLY_TYPE,
  MODULE_REQUEST_TOOLS as SHARED_TOOLS,
  MODULE_REQUEST_TYPE as SHARED_REQUEST_TYPE,
} from '../../../shared/src/protocol.js';

let world: TestWorld;
let restore: () => void;

const config: BridgeConfig = {
  enabled: true,
  serverHost: 'localhost',
  serverPort: 31415,
  namespace: '/mcp',
  reconnectAttempts: 5,
  reconnectDelay: 1000,
  connectionTimeout: 10,
  debugLogging: false,
};

const gm = { userId: 'danni', userName: 'Danni' };

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

async function openBridge(): Promise<{ bridge: SocketBridge; ws: any }> {
  const fake = installFakeWebSocket();
  const bridge = new SocketBridge(config);
  const p = bridge.connect();
  const ws = fake.last();
  ws.onopen();
  await p;
  ws.send.mockClear();
  return { bridge, ws };
}

function sentFrame(ws: any, index = 0): any {
  return JSON.parse(ws.send.mock.calls[index][0]);
}

function reply(ws: any, id: string, data: unknown): void {
  ws.onmessage({ data: JSON.stringify({ type: MODULE_REPLY_TYPE, id, data }) });
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

describe('module request contract copy', () => {
  it('the module and shared agree on the frame types and the tool list', () => {
    expect(MODULE_REQUEST_TYPE).toBe(SHARED_REQUEST_TYPE);
    expect(MODULE_REPLY_TYPE).toBe(SHARED_REPLY_TYPE);
    expect([...MODULE_REQUEST_TOOLS]).toEqual([...SHARED_TOOLS]);
  });
});

describe('SocketBridge.request (I-108)', () => {
  it('sends a module-request frame and resolves with the reply data', async () => {
    const { bridge, ws } = await openBridge();
    const result = bridge.request('list-recent-changes', { limit: 20 }, gm);
    const frame = sentFrame(ws);
    expect(frame).toEqual({
      type: 'module-request',
      id: expect.any(String),
      data: { tool: 'list-recent-changes', args: { limit: 20 }, requestedBy: gm },
    });
    reply(ws, frame.id, { success: true, data: { changes: [] } });
    await expect(result).resolves.toEqual({ changes: [] });
  });

  it('gives every request its own id and matches replies by id', async () => {
    const { bridge, ws } = await openBridge();
    const a = bridge.request('list-recent-changes', {}, gm);
    const b = bridge.request('undo-change', { changeId: 'c1', confirm: true }, gm);
    const idA = sentFrame(ws, 0).id;
    const idB = sentFrame(ws, 1).id;
    expect(idA).not.toBe(idB);
    reply(ws, idB, { success: true, data: 'b' });
    reply(ws, idA, { success: true, data: 'a' });
    await expect(a).resolves.toBe('a');
    await expect(b).resolves.toBe('b');
  });

  it('rejects with the backend error text', async () => {
    const { bridge, ws } = await openBridge();
    const result = bridge.request('undo-change', { changeId: 'c1', confirm: true }, gm);
    reply(ws, sentFrame(ws).id, {
      success: false,
      error: 'Documents were edited since the change',
    });
    await expect(result).rejects.toThrow('Documents were edited since the change');
  });

  it('rejects after 30 s without a reply, and ignores a late reply', async () => {
    vi.useFakeTimers();
    const { bridge, ws } = await openBridge();
    const result = bridge.request('list-recent-changes', {}, gm);
    const rejected = expect(result).rejects.toThrow(/did not answer in time/);
    await vi.advanceTimersByTimeAsync(MODULE_REQUEST_TIMEOUT_MS + 1);
    await rejected;
    expect(() => reply(ws, sentFrame(ws).id, { success: true })).not.toThrow();
  });

  it('takes a longer timeout from the caller', async () => {
    vi.useFakeTimers();
    const { bridge } = await openBridge();
    const settled = vi.fn();
    bridge.request('undo-change', {}, gm, 120_000).then(settled, settled);
    await vi.advanceTimersByTimeAsync(MODULE_REQUEST_TIMEOUT_MS + 1);
    expect(settled).not.toHaveBeenCalled();
  });

  it('rejects the pending requests when the link closes', async () => {
    vi.useFakeTimers();
    const { bridge, ws } = await openBridge();
    const result = bridge.request('list-recent-changes', {}, gm);
    const rejected = expect(result).rejects.toThrow('Connection closed');
    ws.onclose({ wasClean: false, reason: '' });
    await rejected;
  });

  it('rejects the pending requests on a manual disconnect', async () => {
    const { bridge } = await openBridge();
    const result = bridge.request('list-recent-changes', {}, gm);
    const rejected = expect(result).rejects.toThrow('Connection closed');
    bridge.disconnect();
    await rejected;
  });

  it('rejects at once when the link is not open', async () => {
    installFakeWebSocket();
    const bridge = new SocketBridge(config);
    await expect(bridge.request('list-recent-changes', {}, gm)).rejects.toThrow(/not connected/);
  });

  it('ignores a reply nobody is waiting for', async () => {
    const { ws } = await openBridge();
    expect(() => reply(ws, 'module-req-999', { success: true })).not.toThrow();
  });
});
