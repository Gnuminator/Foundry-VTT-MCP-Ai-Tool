/* eslint-disable @typescript-eslint/require-await -- fakes that mimic async module calls */
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { FoundryConnector, LINK_DOWN_WARN_MS } from './foundry-connector.js';

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  sent: any[] = [];
  send = vi.fn((raw: string) => {
    this.sent.push(JSON.parse(raw));
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

  hello(userName: string, isBridgeUser: boolean, moduleVersion = '0.19.0'): void {
    this.say({
      type: 'module-hello',
      data: { userId: `id-${userName}`, userName, isBridgeUser, moduleVersion, worldId: 'w' },
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
