// What our stdio server does for a 2025-11-25 client and for an MCP 2026-07-28 client (I-138).
// The wrapper (dist/index.js) serves both from one factory through the v2 SDK's `serveStdio`: an
// `initialize` opens a 2025-era connection, `server/discover` or a request with the modern `_meta`
// opens a 2026-era one. This test starts the real built wrapper against a fake control bridge and
// checks nothing crashes or hangs, `tools/list` keeps its order across calls, 2025-era results
// stay free of the new fields and 2026-era list results carry `ttlMs` and `cacheScope`. It needs
// the build (`npm run build`), which `npm run green` does before the tests.
import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FAKE_TOOLS, startFakeBridge } from './test-support/fake-control-bridge.js';

const distIndex = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'index.js'
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

  it('keeps the 2025-11-25 results free of 2026-07-28 fields', async () => {
    const w = start();
    await w.initialize();
    const res = await w.request('tools/list');
    expect(res.result).not.toHaveProperty('resultType');
    expect(res.result).not.toHaveProperty('ttlMs');
    expect(res.result).not.toHaveProperty('cacheScope');
    const call = await w.request('tools/call', { name: 'get-world-info', arguments: {} });
    expect(call.error).toBeUndefined();
    expect(JSON.stringify(call.result)).toContain('fake result');
  });

  it('answers server/discover with modern _meta with the 2026-07-28 era and stays up', async () => {
    const w = start();
    const res = await w.request('server/discover', { _meta: MODERN_META });
    expect(res.error).toBeUndefined();
    const found = res.result as { supportedVersions: string[]; capabilities: object };
    expect(found.supportedVersions).toContain('2026-07-28');
    expect(found.capabilities).toEqual({ tools: {}, prompts: {} });
    // The connection is modern from here on: lists carry the cache fields.
    const listed = (await w.request('tools/list', { _meta: MODERN_META })).result as {
      tools: Array<{ name: string }>;
    };
    expect(listed.tools.map(t => t.name)).toEqual(FAKE_TOOLS.map(t => t.name));
    expect(w.exited).toBeUndefined();
  });

  it('answers tools/list with modern _meta and no initialize with ttlMs and cacheScope', async () => {
    const w = start();
    const res = await w.request('tools/list', { _meta: MODERN_META });
    expect(res.error).toBeUndefined();
    const listed = res.result as { tools: Array<{ name: string }> };
    expect(listed.tools.map(t => t.name)).toEqual(FAKE_TOOLS.map(t => t.name));
    expect(listed).toMatchObject({ resultType: 'complete', ttlMs: 60_000, cacheScope: 'private' });
    const second = await w.toolNames({ _meta: MODERN_META });
    expect(second).toEqual(FAKE_TOOLS.map(t => t.name));
    expect(w.exited).toBeUndefined();
  });

  it('answers prompts/list with modern _meta with its own ttlMs', async () => {
    const w = start();
    const res = await w.request('prompts/list', { _meta: MODERN_META });
    expect(res.error).toBeUndefined();
    expect(res.result).toMatchObject({ resultType: 'complete', ttlMs: 3_600_000 });
  });

  it('calls a tool with modern _meta and no initialize', async () => {
    const w = start();
    const res = await w.request('tools/call', {
      name: 'get-world-info',
      arguments: {},
      _meta: MODERN_META,
    });
    expect(res.error).toBeUndefined();
    expect(JSON.stringify(res.result)).toContain('fake result');
    expect(res.result).toMatchObject({ resultType: 'complete' });
  });

  it('answers initialize asking for 2026-07-28 in the 2025-11-25 era (legacy is served)', async () => {
    const w = start();
    const res = await w.request('initialize', {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: 'probe-modern', version: '0.0.0' },
    });
    // serveStdio's default `legacy: 'serve'`: an initialize opens a 2025-era connection.
    expect((res.result as { protocolVersion: string }).protocolVersion).toBe('2025-11-25');
  });
});
