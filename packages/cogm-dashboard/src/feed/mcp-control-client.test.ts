import * as net from 'net';
import { afterEach, describe, expect, it } from 'vitest';

import { ChannelError, McpControlClient, TimeoutError } from './mcp-control-client.js';

const silentLogger = {
  child: () => silentLogger,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as never;

/** A control-channel stand-in: answers pings, never answers call_tool. */
async function startServer(): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer(socket => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const req = JSON.parse(line) as { id: string; method: string };
        if (req.method === 'ping')
          socket.write(`${JSON.stringify({ id: req.id, result: { ok: true } })}\n`);
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as net.AddressInfo).port };
}

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

async function connectedClient(port: number, requestTimeoutMs: number): Promise<McpControlClient> {
  const client = new McpControlClient({
    host: '127.0.0.1',
    port,
    logger: silentLogger,
    requestTimeoutMs,
    heartbeatIntervalMs: 60_000,
  });
  cleanup.push(() => client.close());
  await new Promise<void>(resolve => {
    client.once('connected', () => resolve());
    client.start();
  });
  return client;
}

describe('McpControlClient per-call timeout (lane 1, PB-04)', () => {
  it('a slow call with its own timeout fails alone and keeps the channel up', async () => {
    const { server, port } = await startServer();
    cleanup.push(() => server.close());
    const client = await connectedClient(port, 1_000);

    await expect(
      client.callTool('apply-planned-change', {}, { timeoutMs: 1_500 })
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(await client.ping()).toBe(true);
  });

  it('a call at the default timeout still tears a silent channel down', async () => {
    const { server, port } = await startServer();
    cleanup.push(() => server.close());
    const client = await connectedClient(port, 100);
    const disconnected = new Promise<void>(resolve => client.once('disconnected', () => resolve()));

    await expect(client.callTool('get-world-info')).rejects.toBeInstanceOf(TimeoutError);
    await disconnected;
  });
});

describe('McpControlClient.recordUsage (I-084)', () => {
  const events = [
    {
      v: 1,
      key: 'abc:0',
      t: 1,
      seq: 0,
      clientId: 'abc',
      surface: 'dashboard',
      kind: 'action',
      name: 'dash.tools.open',
      who: { role: 'gm', userId: null, name: null },
    },
  ] as never;

  /** Answers record_usage like a new backend, or "Unknown method" like an old one. */
  async function usageServer(
    known: boolean
  ): Promise<{ server: net.Server; port: number; frames: Array<Record<string, unknown>> }> {
    const frames: Array<Record<string, unknown>> = [];
    const server = net.createServer(socket => {
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const req = JSON.parse(buffer.slice(0, idx)) as {
            id: string;
            method: string;
            params?: Record<string, unknown>;
          };
          buffer = buffer.slice(idx + 1);
          if (req.method === 'ping') {
            socket.write(`${JSON.stringify({ id: req.id, result: { ok: true } })}\n`);
          } else if (req.method === 'record_usage') {
            frames.push(req as unknown as Record<string, unknown>);
            const reply = known
              ? { id: req.id, result: { accepted: 1, dropped: 0 } }
              : { id: req.id, error: { message: `Unknown method: ${req.method}` } };
            socket.write(`${JSON.stringify(reply)}\n`);
          }
        }
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, port: (server.address() as net.AddressInfo).port, frames };
  }

  it('sends a record_usage frame with the events and returns the counts', async () => {
    const { server, port, frames } = await usageServer(true);
    cleanup.push(() => server.close());
    const client = await connectedClient(port, 1_000);

    await expect(client.recordUsage(events)).resolves.toEqual({ accepted: 1, dropped: 0 });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ method: 'record_usage', params: { events } });
  });

  it('rejects with a ChannelError "Unknown method" from an old backend', async () => {
    const { server, port } = await usageServer(false);
    cleanup.push(() => server.close());
    const client = await connectedClient(port, 1_000);

    const error = await client.recordUsage(events).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChannelError);
    expect((error as Error).message).toMatch(/unknown method/i);
  });
});

describe('McpControlClient reply size (large worlds)', () => {
  /** Answers ping itself and hands each call_tool to `onCall`, which writes raw bytes. */
  async function replyServer(
    onCall: (socket: net.Socket, id: string) => void | Promise<void>
  ): Promise<number> {
    const server = net.createServer(socket => {
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('error', () => undefined);
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const req = JSON.parse(buffer.slice(0, idx)) as { id: string; method: string };
          buffer = buffer.slice(idx + 1);
          if (req.method === 'ping') {
            socket.write(`${JSON.stringify({ id: req.id, result: { ok: true } })}\n`);
          } else if (req.method === 'call_tool') {
            void onCall(socket, req.id);
          }
        }
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => server.close());
    return (server.address() as net.AddressInfo).port;
  }

  const toolReply = (id: string, text: string): string =>
    `${JSON.stringify({ id, result: { content: [{ type: 'text', text }] } })}\n`;

  it('a 2 MB reply delivered in many chunks resolves and keeps the channel up', async () => {
    const big = JSON.stringify({ rows: 'x'.repeat(2_000_000) });
    const port = await replyServer(async (socket, id) => {
      const frame = toolReply(id, big);
      for (let i = 0; i < frame.length; i += 64 * 1024) {
        socket.write(frame.slice(i, i + 64 * 1024));
        await new Promise(resolve => setImmediate(resolve));
      }
    });
    const client = await connectedClient(port, 5_000);
    let dropped = false;
    client.on('disconnected', () => {
      dropped = true;
    });

    const result = await client.callTool<{ rows: string }>('get-play-stats');
    expect(result.rows).toHaveLength(2_000_000);
    expect(await client.ping()).toBe(true);
    expect(dropped).toBe(false);
  });

  it('a reply with no newline until its very last chunk still resolves', async () => {
    const big = JSON.stringify({ rows: 'z'.repeat(3_000_000) });
    const port = await replyServer(async (socket, id) => {
      const body = toolReply(id, big).trimEnd();
      for (let i = 0; i < body.length; i += 16 * 1024) {
        socket.write(body.slice(i, i + 16 * 1024));
        await new Promise(resolve => setImmediate(resolve));
      }
      socket.write('\n');
    });
    const client = await connectedClient(port, 10_000);

    const result = await client.callTool<{ rows: string }>('get-play-stats');
    expect(result.rows).toHaveLength(3_000_000);
    expect(await client.ping()).toBe(true);
  });

  it('two replies in one chunk both resolve', async () => {
    const ids: string[] = [];
    const port = await replyServer((socket, id) => {
      ids.push(id);
      if (ids.length === 2) {
        socket.write(toolReply(ids[0], '"first"') + toolReply(ids[1], '"second"'));
      }
    });
    const client = await connectedClient(port, 5_000);

    const [a, b] = await Promise.all([client.callTool('a'), client.callTool('b')]);
    expect(a).toBe('first');
    expect(b).toBe('second');
  });

  it('a line that never ends past the cap fails the connection and the pending call', async () => {
    const port = await replyServer(async socket => {
      const piece = 'y'.repeat(8 * 1024 * 1024);
      for (let i = 0; i < 5; i += 1) {
        if (socket.destroyed) return;
        socket.write(piece);
        await new Promise(resolve => setImmediate(resolve));
      }
    });
    const client = await connectedClient(port, 10_000);
    const disconnected = new Promise<void>(resolve => client.once('disconnected', () => resolve()));

    await expect(client.callTool('get-play-stats')).rejects.toBeInstanceOf(ChannelError);
    await disconnected;
  });
});
