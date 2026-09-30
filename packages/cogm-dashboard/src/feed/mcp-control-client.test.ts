import * as net from 'net';
import { afterEach, describe, expect, it } from 'vitest';

import { McpControlClient, TimeoutError } from './mcp-control-client.js';

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
