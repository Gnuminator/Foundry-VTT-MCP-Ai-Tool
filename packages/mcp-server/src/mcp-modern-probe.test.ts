// What our stdio server does when an MCP 2026-07-28 client talks to it (I-138). The wrapper
// (dist/index.js) runs on the v1 SDK, which has no `server/discover` and expects `initialize`
// first. A dual-era client probes `server/discover`, gets an error and falls back to `initialize`;
// a modern-only client would not. This test starts the real built wrapper against a fake control
// bridge and records what each kind of client sees: nothing may crash or hang, and `tools/list`
// keeps its order across calls. It needs the build (`npm run build`), which `npm run green` does
// before the tests.
import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const distIndex = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'index.js'
);

// Deliberately not alphabetical: the order we serve is the bridge's order, and it must not move.
const FAKE_TOOLS = ['search-journals', 'get-world-info', 'list-characters', 'get-character'].map(
  name => ({
    name,
    description: `Fake ${name}`,
    inputSchema: { type: 'object', properties: {} },
  })
);

const REPLY_TIMEOUT_MS = 10_000;

// Longer than the reply timeout, so a slow start shows "no reply to request N", not a bare timeout.
vi.setConfig({ testTimeout: 20_000 });

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'probe-modern', version: '0.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

type Frame = {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
};

/** Newline-delimited control channel the wrapper dials: answers list_tools and call_tool. */
function startFakeBridge(): Promise<{ server: net.Server; port: number }> {
  return new Promise(resolve => {
    const server = net.createServer(sock => {
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('error', () => {});
      sock.on('data', (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let req: { id: string; method: string };
          try {
            req = JSON.parse(line) as { id: string; method: string };
          } catch {
            continue;
          }
          const result =
            req.method === 'list_tools'
              ? { tools: FAKE_TOOLS }
              : { content: [{ type: 'text', text: 'fake result' }] };
          sock.write(`${JSON.stringify({ id: req.id, result })}\n`);
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as net.AddressInfo).port });
    });
  });
}

/** One wrapper process spoken to in raw JSON-RPC lines, so we control exactly what is sent. */
class Wrapper {
  private buf = '';

  private frames: Frame[] = [];

  private waiters: Array<() => void> = [];

  exited: number | null | undefined;

  stderr = '';

  private nextId = 1;

  constructor(private child: ChildProcess) {
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      this.buf += chunk;
      let idx: number;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx).trim();
        this.buf = this.buf.slice(idx + 1);
        if (!line) continue;
        try {
          this.frames.push(JSON.parse(line) as Frame);
        } catch {
          // a stray non-JSON line is not a frame; the missing reply fails the test with the stderr
        }
      }
      this.waiters.splice(0).forEach(w => w());
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
      this.stderr += chunk;
    });
    child.on('exit', code => {
      this.exited = code;
      this.waiters.splice(0).forEach(w => w());
    });
  }

  send(method: string, params?: unknown, withId = true): number | undefined {
    const id = withId ? this.nextId++ : undefined;
    const msg = { jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params };
    this.child.stdin!.write(`${JSON.stringify(msg)}\n`);
    return id;
  }

  /** The response to request `id`, or a rejection on timeout or when the process exits first. */
  async reply(id: number): Promise<Frame> {
    const deadline = Date.now() + REPLY_TIMEOUT_MS;
    for (;;) {
      const hit = this.frames.find(f => f.id === id);
      if (hit) return hit;
      if (this.exited !== undefined)
        throw new Error(`wrapper exited (${this.exited}) before reply ${id}: ${this.stderr}`);
      const left = deadline - Date.now();
      if (left <= 0)
        throw new Error(`no reply to request ${id} within ${REPLY_TIMEOUT_MS} ms: ${this.stderr}`);
      await new Promise<void>(resolve => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  async request(method: string, params?: unknown): Promise<Frame> {
    return this.reply(this.send(method, params) as number);
  }

  /** The normal 2025-11-25 handshake. */
  async initialize(): Promise<Frame> {
    const res = await this.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'probe-legacy', version: '0.0.0' },
    });
    this.send('notifications/initialized', undefined, false);
    return res;
  }

  async toolNames(params?: unknown): Promise<string[]> {
    const res = await this.request('tools/list', params);
    return ((res.result as { tools: Array<{ name: string }> }).tools ?? []).map(t => t.name);
  }

  kill(): void {
    this.child.kill();
  }
}

describe('MCP 2026-07-28 probe against dist/index.js', () => {
  let bridge: { server: net.Server; port: number } | undefined;
  let tmpDir = '';
  const running: Wrapper[] = [];

  beforeAll(async () => {
    if (!fs.existsSync(distIndex)) {
      throw new Error(`${distIndex} not found. Run "npm run build" first (npm run green does).`);
    }
    bridge = await startFakeBridge();
    // The wrapper logs under os.tmpdir(); keep these runs out of the live connectors' wrapper.log.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-probe-'));
  });

  afterEach(() => {
    running.splice(0).forEach(w => w.kill());
  });

  afterAll(() => {
    bridge?.server.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function start(): Wrapper {
    const child = spawn(process.execPath, [distIndex], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MCP_CONTROL_HOST: '127.0.0.1',
        MCP_CONTROL_PORT: String(bridge?.port),
        TEMP: tmpDir,
        TMP: tmpDir,
        TMPDIR: tmpDir,
        MCP_NO_SPAWN: '1',
        FOUNDRY_AI_TOOL_SETS: '',
      },
    });
    const w = new Wrapper(child);
    running.push(w);
    return w;
  }

  it('answers the normal initialize flow and lists tools in the bridge order, twice the same', async () => {
    const w = start();
    const init = await w.initialize();
    expect((init.result as { serverInfo: unknown }).serverInfo).toBeTruthy();
    const first = await w.toolNames();
    const second = await w.toolNames();
    expect(first).toEqual(FAKE_TOOLS.map(t => t.name));
    expect(second).toEqual(first);
  });

  it('answers server/discover with modern _meta with an error and stays up', async () => {
    const w = start();
    const res = await w.request('server/discover', { _meta: MODERN_META });
    // Today the v1 SDK does not know the method: a JSON-RPC error, not a result. A dual-era client
    // reads that as "legacy server" and falls back to initialize.
    expect(res.error?.code).toBe(-32601);
    expect(res.result).toBeUndefined();
    // The fallback works on the same process.
    await w.initialize();
    expect(await w.toolNames()).toEqual(FAKE_TOOLS.map(t => t.name));
    expect(w.exited).toBeUndefined();
  });

  it('answers tools/list with modern _meta and no initialize, and stays up', async () => {
    const w = start();
    const res = await w.request('tools/list', { _meta: MODERN_META });
    // Pins what v1 does today: no initialize needed, a legacy result with no modern fields. A
    // move to the new protocol changes this on purpose; update it then.
    expect(res.error).toBeUndefined();
    const listed = res.result as { tools: Array<{ name: string }> };
    expect(listed.tools.map(t => t.name)).toEqual(FAKE_TOOLS.map(t => t.name));
    expect(listed).not.toHaveProperty('resultType');
    expect(listed).not.toHaveProperty('ttlMs');
    await w.initialize();
    const first = await w.toolNames({ _meta: MODERN_META });
    const second = await w.toolNames({ _meta: MODERN_META });
    expect(first).toEqual(FAKE_TOOLS.map(t => t.name));
    expect(second).toEqual(first);
    expect(w.exited).toBeUndefined();
  });

  it('answers initialize asking for 2026-07-28 with the newest era the SDK speaks (a tripwire on SDK bumps)', async () => {
    const w = start();
    const res = await w.request('initialize', {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: 'probe-modern', version: '0.0.0' },
    });
    expect((res.result as { protocolVersion: string }).protocolVersion).toBe(
      LATEST_PROTOCOL_VERSION
    );
  });

  it('calls a tool after a modern probe and the legacy handshake', async () => {
    const w = start();
    await w.request('server/discover', { _meta: MODERN_META });
    await w.initialize();
    const res = await w.request('tools/call', { name: 'get-world-info', arguments: {} });
    expect(res.error).toBeUndefined();
    expect(JSON.stringify(res.result)).toContain('fake result');
  });
});
