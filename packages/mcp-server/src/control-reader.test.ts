/**
 * Control channel reader (control-reader.ts): a web page that POSTs to the control port must not
 * run the JSON body line, and every real JSON-lines client must keep working (review of PR #344, M1).
 *
 * The server below is wired the way backend.ts wires it (createControlReader per socket, one
 * dispatch per parsed request); `call_tool` only counts calls, so "no tool ran" is observable.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import net from 'net';
import { readFileSync } from 'fs';
import { createControlReader, looksLikeHttp } from './control-reader.js';

let server: net.Server;
let port = 0;
let toolCalls: unknown[] = [];
const warnings: string[] = [];

beforeAll(async () => {
  server = net.createServer(socket => {
    socket.setEncoding('utf8');
    const reader = createControlReader(socket, { warn: message => warnings.push(message) });
    socket.on('data', (chunk: string) => {
      for (const msg of reader.read(chunk)) {
        if (msg.method === 'ping') {
          socket.write(`${JSON.stringify({ id: msg.id, result: { ok: true } })}\n`);
        } else if (msg.method === 'call_tool') {
          toolCalls.push(msg.params);
          socket.write(`${JSON.stringify({ id: msg.id, result: { ran: true } })}\n`);
        } else {
          socket.write(`${JSON.stringify({ id: msg.id, error: { message: 'Unknown method' } })}\n`);
        }
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as net.AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  toolCalls = [];
  warnings.length = 0;
});

interface Outcome {
  received: string;
  closedByServer: boolean;
}

/** Send raw bytes, wait for the server to answer or close, and report what came back. */
function exchange(payload: string, { endAfterSend = false } = {}): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setEncoding('utf8');
    let received = '';
    let closed = false;
    const finish = (): void => {
      socket.destroy();
      resolve({ received, closedByServer: closed });
    };
    socket.on('data', (chunk: string) => (received += chunk));
    socket.on('close', () => {
      closed = true;
      finish();
    });
    socket.on('error', err => {
      // The server destroys the socket; a reset is a close for this purpose.
      if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
        closed = true;
        finish();
      } else {
        reject(err);
      }
    });
    socket.on('connect', () => {
      socket.write(payload);
      if (endAfterSend) socket.end();
    });
    // A server that keeps the socket open is a failure; give it a moment, then report that.
    setTimeout(finish, 1500);
  });
}

const CALL_TOOL = JSON.stringify({
  id: 1,
  method: 'call_tool',
  params: { name: 'apply-planned-change', args: { planId: 'x' } },
});

describe('control channel reader', () => {
  it('closes an HTTP POST that carries a call_tool body line and runs no tool', async () => {
    const body = `\n${CALL_TOOL}\n`;
    const request =
      `POST / HTTP/1.1\r\n` +
      `Host: 127.0.0.1:31414\r\n` +
      `Content-Type: text/plain;charset=UTF-8\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `\r\n${body}`;
    const out = await exchange(request);
    expect(out.closedByServer).toBe(true);
    expect(out.received).toBe('');
    expect(toolCalls).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('closes an HTTP request that arrives in pieces', () => {
    let destroyed = false;
    const socket = { destroy: () => (destroyed = true), write() {} } as unknown as net.Socket;
    const reader = createControlReader(socket);
    expect(reader.read('GET / HT')).toEqual([]);
    expect(destroyed).toBe(false);
    expect(reader.read(`TP/1.1\r\n\r\n${CALL_TOOL}\n`)).toEqual([]);
    expect(destroyed).toBe(true);
    // Nothing more is read from a rejected connection.
    expect(reader.read(`${CALL_TOOL}\n`)).toEqual([]);
  });

  it('closes when the first line is not JSON', async () => {
    const out = await exchange(`hello there\n${CALL_TOOL}\n`);
    expect(out.closedByServer).toBe(true);
    expect(out.received).toBe('');
    expect(toolCalls).toEqual([]);
  });

  it('closes when the first line is JSON but not an object', async () => {
    const out = await exchange(`42\n${CALL_TOOL}\n`);
    expect(out.closedByServer).toBe(true);
    expect(toolCalls).toEqual([]);
  });

  it('closes on an HTTP-looking line after valid requests and drops the rest of that chunk', async () => {
    const ping = JSON.stringify({ id: 'a', method: 'ping' });
    const out = await exchange(`${ping}\nPOST /x HTTP/1.1\n${CALL_TOOL}\n`);
    expect(out.closedByServer).toBe(true);
    expect(toolCalls).toEqual([]);
  });

  it('keeps serving a normal JSON-lines client, several requests per connection', async () => {
    const ping = JSON.stringify({ id: 'a', method: 'ping' });
    const out = await exchange(`${ping}\n${CALL_TOOL}\n`, { endAfterSend: true });
    const replies = out.received
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));
    expect(replies).toEqual([
      { id: 'a', result: { ok: true } },
      { id: 1, result: { ran: true } },
    ]);
    expect(toolCalls).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('accepts a first line split over two writes and blank lines before it', async () => {
    const reader = createControlReader({ destroy() {}, write() {} } as unknown as net.Socket);
    const ping = JSON.stringify({ id: 'a', method: 'ping' });
    expect(reader.read(`\n\n${ping.slice(0, 5)}`)).toEqual([]);
    expect(reader.read(`${ping.slice(5)}\n`)).toEqual([{ id: 'a', method: 'ping' }]);
  });

  it('does not treat a JSON line that mentions HTTP in a string as an HTTP request', () => {
    const written: string[] = [];
    let destroyed = false;
    const socket = {
      destroy: () => (destroyed = true),
      write: (s: string) => written.push(s),
    } as unknown as net.Socket;
    const reader = createControlReader(socket);
    const line = JSON.stringify({
      id: 1,
      method: 'call_tool',
      params: { name: 'x', args: { text: 'GET / HTTP/1.1 and POST are verbs' } },
    });
    expect(reader.read(`${line}\n`)).toHaveLength(1);
    expect(destroyed).toBe(false);
  });

  it('answers a non-JSON line after a valid request with "Bad request" and keeps the socket', () => {
    const written: string[] = [];
    let destroyed = false;
    const socket = {
      destroy: () => (destroyed = true),
      write: (s: string) => written.push(s),
    } as unknown as net.Socket;
    const reader = createControlReader(socket);
    const ping = JSON.stringify({ id: 'a', method: 'ping' });
    const requests = reader.read(`${ping}\nnot json at all\n${ping}\n`);
    expect(requests).toHaveLength(2);
    expect(destroyed).toBe(false);
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]).error.message).toBeTruthy();
  });

  it('closes a line that grows past the cap without a newline', () => {
    let destroyed = false;
    const socket = { destroy: () => (destroyed = true), write() {} } as unknown as net.Socket;
    const reader = createControlReader(socket);
    const piece = 'x'.repeat(1024 * 1024);
    for (let i = 0; i < 8; i++) expect(reader.read(piece)).toEqual([]);
    expect(destroyed).toBe(false);
    expect(reader.read(piece)).toEqual([]);
    expect(destroyed).toBe(true);
  });
});

describe('looksLikeHttp', () => {
  it.each([
    'POST / HTTP/1.1',
    'GET /favicon.ico HTTP/1.1',
    'OPTIONS * HTTP/1.1',
    'PUT /x',
    'DELETE /x',
    'PATCH /x',
    'HEAD /x',
    'GET / HTTP/2',
    'PRI * HTTP/2.0',
  ])('flags %s', line => expect(looksLikeHttp(line)).toBe(true));

  it.each(['{"id":1,"method":"ping"}', 'Host: 127.0.0.1', 'hello', ''])('passes %s', line =>
    expect(looksLikeHttp(line)).toBe(false)
  );
});

describe('backend.ts wiring', () => {
  it('reads the control channel only through createControlReader', () => {
    const source = readFileSync(new URL('./backend.ts', import.meta.url), 'utf8');
    expect(source).toContain('createControlReader(socket');
    expect(source).not.toMatch(/JSON\.parse\(line\)/);
  });
});
