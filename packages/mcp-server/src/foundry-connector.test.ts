/* eslint-disable @typescript-eslint/require-await -- fakes that mimic async module calls */
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import {
  BridgeHelloFrameSchema,
  MODULE_CAPABILITY_AI_CHANGES_SIGNAL,
  MODULE_NOT_ACTIVE_LINK_ERROR,
  MODULE_REQUEST_MAX_ARGS_BYTES,
  MODULE_REQUEST_TOOLS,
} from '@gnuminator/shared';

import { FoundryConnector, LINK_DOWN_WARN_MS } from './foundry-connector.js';

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  /** Frames the backend sent, apart from the `bridge-hello` it sends on connect. */
  sent: any[] = [];
  bridgeHellos: any[] = [];
  send = vi.fn((raw: string) => {
    const frame = JSON.parse(raw);
    if (frame.type === 'bridge-hello') this.bridgeHellos.push(frame);
    else this.sent.push(frame);
  });
  close = vi.fn(() => this.drop());

  /** The browser went away. */
  drop(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }

  say(message: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }

  hello(
    userName: string,
    isBridgeUser: boolean,
    moduleVersion = '0.19.0',
    capabilities?: string[],
    worldId = 'w'
  ): void {
    this.say({
      type: 'module-hello',
      data: {
        userId: `id-${userName}`,
        userName,
        isBridgeUser,
        moduleVersion,
        worldId,
        ...(capabilities ? { capabilities } : {}),
      },
    });
  }
}

let logger: any;
let connector: FoundryConnector;

function makeConnector(): FoundryConnector {
  const c = new FoundryConnector({
    config: { port: 0, namespace: '/' } as any,
    logger,
  });
  (c as any).isStarted = true; // no ports are bound in these tests
  return c;
}

function connect(): FakeSocket {
  const ws = new FakeSocket();
  connector.attachSocket(ws as unknown as WebSocket);
  return ws;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-30T10:00:00.000Z'));
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  connector = makeConnector();
});

afterEach(async () => {
  await connector.stop();
  vi.useRealTimers();
});

describe('module sockets (PB-02)', () => {
  it('works with old modules that never send a hello: newest open socket is active', async () => {
    const a = connect();
    expect(connector.isConnected()).toBe(true);
    const serialA = connector.getConnectionSerial();
    void connector.query('m1').catch(() => undefined);
    expect(a.sent).toHaveLength(1);

    const b = connect();
    expect(connector.getConnectionSerial()).toBeGreaterThan(serialA);
    void connector.query('m2').catch(() => undefined);
    expect(b.sent).toHaveLength(1);
    expect(a.sent).toHaveLength(1);
    expect(connector.getConnectionInfo()).toMatchObject({
      connected: true,
      sockets: 2,
      userName: null,
      moduleVersion: null,
    });
  });

  it('promotes the remaining socket when the active one closes', async () => {
    const a = connect();
    const b = connect();
    const serial = connector.getConnectionSerial();
    b.drop();
    expect(connector.isConnected()).toBe(true);
    expect(connector.getConnectionSerial()).toBeGreaterThan(serial);
    void connector.query('after').catch(() => undefined);
    expect(a.sent.at(-1)).toMatchObject({ type: 'mcp-query', data: { method: 'after' } });
    expect(connector.getConnectionInfo().sockets).toBe(1);
  });

  it('rejects the queries pending on a closed socket, not those on another', async () => {
    const a = connect();
    const b = connect();
    const pendingOnB = connector.query('on-b');
    const settledA = vi.fn();
    a.drop();
    pendingOnB.catch(settledA);
    await Promise.resolve();
    expect(settledA).not.toHaveBeenCalled(); // a was not active; b's query is still pending
    const rejected = expect(pendingOnB).rejects.toThrow('Connection closed');
    b.drop();
    await rejected;
    expect(connector.isConnected()).toBe(false);
    expect(connector.getConnectionInfo().sockets).toBe(0);
  });

  it('prefers the socket whose hello says isBridgeUser, even if another is newer', () => {
    const bridge = connect();
    bridge.hello('Claude', true);
    const other = connect(); // newer, no hello yet: must not displace the confirmed bridge user
    void connector.query('x').catch(() => undefined);
    expect(bridge.sent).toHaveLength(1);
    expect(other.sent).toHaveLength(0);

    other.hello('Gamemaster', false);
    void connector.query('y').catch(() => undefined);
    expect(bridge.sent).toHaveLength(2);
    expect(other.sent).toHaveLength(0);
    expect(connector.getConnectionInfo()).toMatchObject({
      userName: 'Claude',
      moduleVersion: '0.19.0',
      sockets: 2,
    });
  });

  it('a later bridge-user socket takes over from a non-bridge-user active socket', () => {
    const first = connect();
    first.hello('Gamemaster', false);
    const serial = connector.getConnectionSerial();
    const second = connect();
    second.hello('Claude', true, '0.20.0');
    expect(connector.getConnectionSerial()).toBeGreaterThan(serial);
    void connector.query('z').catch(() => undefined);
    expect(second.sent).toHaveLength(1);
    expect(first.sent).toHaveLength(0);
    expect(connector.getConnectionInfo()).toMatchObject({
      userName: 'Claude',
      moduleVersion: '0.20.0',
    });
  });

  it('falls back to a non-bridge socket when the bridge user leaves', () => {
    const other = connect();
    other.hello('Gamemaster', false);
    const bridge = connect();
    bridge.hello('Claude', true);
    bridge.drop();
    expect(connector.isConnected()).toBe(true);
    expect(connector.getConnectionInfo().userName).toBe('Gamemaster');
  });

  it('ignores invalid hello frames', () => {
    const a = connect();
    a.say({ type: 'module-hello', data: { userName: 'x' } });
    a.say({ type: 'module-hello', data: { userId: 1, userName: 'x', isBridgeUser: 'yes' } });
    expect(connector.getConnectionInfo()).toMatchObject({ userName: null, connected: true });
  });

  it('delivers a response from a non-active socket to the pending query', async () => {
    const a = connect();
    const b = connect();
    const result = connector.query('ping');
    const id = b.sent[0].id;
    a.say({ type: 'mcp-response', id, data: { success: true, data: { ok: 1 } } });
    await expect(result).resolves.toEqual({ ok: 1 });
  });

  it('closes every socket on stop', async () => {
    const a = connect();
    const b = connect();
    await connector.stop();
    expect(a.close).toHaveBeenCalled();
    expect(b.close).toHaveBeenCalled();
  });
});

describe('query timeout (PB-04)', () => {
  it('defaults to 10 s', async () => {
    connect();
    const result = connector.query('slow');
    const rejected = expect(result).rejects.toThrow('Query timeout: slow');
    await vi.advanceTimersByTimeAsync(9_999);
    await vi.advanceTimersByTimeAsync(2);
    await rejected;
  });

  it('takes a longer timeout from the caller', async () => {
    connect();
    const settled = vi.fn();
    const result = connector.query('write', {}, { timeoutMs: 120_000 });
    result.then(settled, settled);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).not.toHaveBeenCalled();
    const rejected = expect(result).rejects.toThrow('Query timeout: write');
    await vi.advanceTimersByTimeAsync(60_001);
    await rejected;
  });

  it('takes a shorter timeout too', async () => {
    connect();
    const result = connector.query('quick', {}, { timeoutMs: 50 });
    const rejected = expect(result).rejects.toThrow('Query timeout: quick');
    await vi.advanceTimersByTimeAsync(51);
    await rejected;
  });
});

describe('link state (PB-03)', () => {
  it('is null while connected', () => {
    connect();
    expect(connector.getConnectionInfo().linkDownSince).toBeNull();
  });

  it('starts as down since construction', () => {
    expect(connector.getConnectionInfo().linkDownSince).toBe('2026-09-30T10:00:00.000Z');
  });

  it('tracks the time the last socket went away and logs link-down once after 5 minutes', async () => {
    const a = connect();
    const b = connect();
    await vi.advanceTimersByTimeAsync(60_000);
    a.drop();
    expect(connector.getConnectionInfo().linkDownSince).toBeNull(); // b carries on
    b.drop();
    expect(connector.getConnectionInfo().linkDownSince).toBe('2026-09-30T10:01:00.000Z');

    await vi.advanceTimersByTimeAsync(LINK_DOWN_WARN_MS - 1000);
    expect(logger.warn).not.toHaveBeenCalledWith('link-down', expect.anything());
    await vi.advanceTimersByTimeAsync(2000);
    const downLogs = (): unknown[] =>
      logger.warn.mock.calls.filter((c: any[]) => c[0] === 'link-down');
    expect(downLogs()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(downLogs()).toHaveLength(1);
  });

  it('logs link-up only after a link-down was logged', async () => {
    const upLogs = (): unknown[] => logger.info.mock.calls.filter((c: any[]) => c[0] === 'link-up');

    const a = connect();
    a.drop();
    await vi.advanceTimersByTimeAsync(30_000);
    connect(); // back within 5 minutes: no link-down, so no link-up
    expect(upLogs()).toHaveLength(0);
    expect(connector.getConnectionInfo().linkDownSince).toBeNull();

    const c = connect();
    // a fresh outage of more than 5 minutes
    for (const ws of [...(connector as any).sockets.keys()]) (ws as FakeSocket).drop();
    await vi.advanceTimersByTimeAsync(LINK_DOWN_WARN_MS + 1000);
    expect(logger.warn).toHaveBeenCalledWith('link-down', expect.anything());
    connect();
    expect(upLogs()).toHaveLength(1);
    expect(connector.getConnectionInfo().linkDownSince).toBeNull();
    void c;
  });

  it('does not keep the process alive (timers are unref-ed)', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    connect().drop();
    const handle = spy.mock.results.at(-1)?.value as { hasRef?: () => boolean } | undefined;
    if (handle?.hasRef) expect(handle.hasRef()).toBe(false);
    spy.mockRestore();
  });
});

describe('module capabilities (I-108 follow-ups)', () => {
  it('reports a capability only when the active socket hello lists it', () => {
    expect(connector.activeModuleHasCapability(MODULE_CAPABILITY_AI_CHANGES_SIGNAL)).toBe(false);
    const old = connect();
    expect(connector.activeModuleHasCapability(MODULE_CAPABILITY_AI_CHANGES_SIGNAL)).toBe(false);
    old.hello('Claude', true);
    expect(connector.activeModuleHasCapability(MODULE_CAPABILITY_AI_CHANGES_SIGNAL)).toBe(false);
    const fresh = connect();
    fresh.hello('Claude', true, '0.20.0', [MODULE_CAPABILITY_AI_CHANGES_SIGNAL]);
    expect(connector.activeModuleHasCapability(MODULE_CAPABILITY_AI_CHANGES_SIGNAL)).toBe(true);
    expect(connector.activeModuleHasCapability('other')).toBe(false);
    fresh.drop();
    expect(connector.activeModuleHasCapability(MODULE_CAPABILITY_AI_CHANGES_SIGNAL)).toBe(false);
  });

  it('still accepts a hello without capabilities', () => {
    const a = connect();
    a.hello('Claude', true);
    expect(connector.getConnectionInfo().userName).toBe('Claude');
  });

  it('a malformed capabilities list costs only the capabilities, not the hello', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `c${i}`);
    for (const capabilities of ['nope', [1], tooMany, ['a'.repeat(101)]]) {
      const b = connect();
      b.say({
        type: 'module-hello',
        data: {
          userId: 'x',
          userName: 'Bad',
          isBridgeUser: true,
          moduleVersion: '1',
          worldId: 'w',
          capabilities,
        },
      });
      expect(connector.getConnectionInfo().userName).toBe('Bad');
      expect(connector.activeModuleHasCapability(MODULE_CAPABILITY_AI_CHANGES_SIGNAL)).toBe(false);
      b.drop();
    }
  });
});

describe('module requests (I-108)', () => {
  const requestFrame = (
    tool: string,
    args: Record<string, unknown> = {},
    id = 'req-1'
  ): Record<string, unknown> => ({
    type: 'module-request',
    id,
    data: { tool, args, requestedBy: { userId: 'u1', userName: 'Danni' } },
  });
  const flush = (): Promise<void> => vi.advanceTimersByTimeAsync(0);

  it('runs an allowed tool through the dispatcher and replies on the same socket', async () => {
    const handler = vi.fn(async () => ({ changes: [] }));
    connector.setModuleRequestHandler(handler);
    const a = connect();
    a.say(requestFrame('list-recent-changes', { limit: 20 }));
    await flush();
    expect(handler).toHaveBeenCalledWith(
      'list-recent-changes',
      { limit: 20 },
      { userId: 'u1', userName: 'Danni' }
    );
    expect(a.sent).toEqual([
      { type: 'module-reply', id: 'req-1', data: { success: true, data: { changes: [] } } },
    ]);
    expect(logger.info).toHaveBeenCalledWith('Module request', {
      tool: 'list-recent-changes',
      requestedBy: 'Danni',
    });
  });

  it('replies with the error message when the tool throws', async () => {
    connector.setModuleRequestHandler(async () => {
      throw new Error('Documents changed since the change was made');
    });
    const a = connect();
    a.say(requestFrame('undo-change', { changeId: 'c1', confirm: true }));
    await flush();
    expect(a.sent[0].data).toEqual({
      success: false,
      error: 'Documents changed since the change was made',
    });
  });

  it('refuses a request from a socket that is not the active bridge link', async () => {
    const handler = vi.fn(async () => ({}));
    connector.setModuleRequestHandler(handler);
    const bridge = connect();
    bridge.hello('Claude', true);
    const other = connect();
    other.hello('Gamemaster', false);
    other.say(requestFrame('list-recent-changes'));
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(other.sent[0].data).toEqual({ success: false, error: MODULE_NOT_ACTIVE_LINK_ERROR });
    expect(bridge.sent).toEqual([]);
  });

  it('serves a non-active socket whose hello says isBridgeUser (Any-GM, two tabs of one user)', async () => {
    const handler = vi.fn(async () => ({ changes: [] }));
    connector.setModuleRequestHandler(handler);
    const older = connect();
    older.hello('Danni', true);
    const newer = connect();
    newer.hello('Danni', true);
    // The newer tab is the active link; the older one is not, yet is still answered.
    older.say(requestFrame('list-recent-changes'));
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(older.sent).toEqual([
      { type: 'module-reply', id: 'req-1', data: { success: true, data: { changes: [] } } },
    ]);
    expect(newer.sent).toEqual([]);
  });

  it('refuses a non-active bridge-user socket from another world, serves the same world', async () => {
    const handler = vi.fn(async () => ({ changes: [] }));
    connector.setModuleRequestHandler(handler);
    const elsewhere = connect();
    elsewhere.hello('Danni', true, '0.19.0', undefined, 'other-world');
    const sameWorld = connect();
    sameWorld.hello('Danni', true, '0.19.0', undefined, 'w');
    const active = connect();
    active.hello('Danni', true, '0.19.0', undefined, 'w');
    elsewhere.say(requestFrame('list-recent-changes', {}, 'r1'));
    sameWorld.say(requestFrame('list-recent-changes', {}, 'r2'));
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(elsewhere.sent[0].data).toEqual({ success: false, error: MODULE_NOT_ACTIVE_LINK_ERROR });
    expect(sameWorld.sent[0].data).toEqual({ success: true, data: { changes: [] } });
    expect(active.sent).toEqual([]);
  });

  it('still refuses a non-active socket with no hello (an older module)', async () => {
    const handler = vi.fn(async () => ({}));
    connector.setModuleRequestHandler(handler);
    const older = connect();
    connect().hello('Claude', true);
    older.say(requestFrame('list-recent-changes'));
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(older.sent[0].data).toEqual({ success: false, error: MODULE_NOT_ACTIVE_LINK_ERROR });
  });

  it('a served non-active socket still goes through the tool allowlist and the size cap', async () => {
    const handler = vi.fn(async () => ({}));
    connector.setModuleRequestHandler(handler);
    const older = connect();
    older.hello('Danni', true);
    connect().hello('Danni', true);
    older.say(requestFrame('plan-tarokka-links', {}, 'r1'));
    older.say(requestFrame('list-recent-changes', { pad: 'x'.repeat(20_001) }, 'r2'));
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(older.sent.map(m => m.data.error)).toEqual([
      'Tool not allowed for module requests: plan-tarokka-links',
      'Request arguments are too large',
    ]);
  });

  it('refuses a tool that is not on the module-request list', async () => {
    const handler = vi.fn(async () => ({}));
    connector.setModuleRequestHandler(handler);
    const a = connect();
    a.say(requestFrame('plan-tarokka-links', { position: 'p', text: 't' }));
    a.say(requestFrame('toString', {}, 'req-2'));
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(a.sent.map(m => m.data.success)).toEqual([false, false]);
    expect(a.sent[0].data.error).toMatch(/not allowed/);
  });

  it('refuses arguments over 20 kB', async () => {
    const handler = vi.fn(async () => ({}));
    connector.setModuleRequestHandler(handler);
    const a = connect();
    a.say(requestFrame('list-recent-changes', { pad: 'x'.repeat(20_001) }));
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(a.sent[0].data).toEqual({ success: false, error: 'Request arguments are too large' });
  });

  it('counts real UTF-8 bytes, not characters, against the cap', async () => {
    const handler = vi.fn(async () => ({}));
    connector.setModuleRequestHandler(handler);
    const a = connect();
    // 8,000 three-byte characters: 8,000 characters, 24,000 bytes of JSON.
    a.say(requestFrame('list-recent-changes', { pad: '€'.repeat(8_000) }));
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(a.sent[0].data).toEqual({ success: false, error: 'Request arguments are too large' });
    // Just under the cap in bytes is accepted.
    const room = MODULE_REQUEST_MAX_ARGS_BYTES - JSON.stringify({ pad: '' }).length - 2;
    a.say(requestFrame('list-recent-changes', { pad: 'x'.repeat(room) }, 'req-ok'));
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('tells every module socket what it supports, right after it connects', () => {
    const a = connect();
    expect(a.bridgeHellos).toEqual([
      {
        type: 'bridge-hello',
        data: {
          capabilities: ['module-request', ...MODULE_REQUEST_TOOLS.map(t => `module-request:${t}`)],
        },
      },
    ]);
    expect(a.sent).toEqual([]);
  });

  it('keeps the bridge-hello within the schema limits as tools are added', () => {
    const a = connect();
    expect(BridgeHelloFrameSchema.safeParse(a.bridgeHellos[0]).success).toBe(true);
  });

  it('answers an invalid frame that still has an id, and ignores one without', async () => {
    connector.setModuleRequestHandler(async () => ({}));
    const a = connect();
    a.say({ type: 'module-request', id: 'bad-1', data: { tool: 'list-recent-changes' } });
    a.say({ type: 'module-request', data: {} });
    await flush();
    expect(a.sent).toHaveLength(1);
    expect(a.sent[0]).toMatchObject({ id: 'bad-1', data: { success: false } });
  });

  it('says so when no dispatcher is wired in', async () => {
    const a = connect();
    a.say(requestFrame('list-recent-changes'));
    await flush();
    expect(a.sent[0].data).toEqual({ success: false, error: 'Module requests are not available' });
  });
});
