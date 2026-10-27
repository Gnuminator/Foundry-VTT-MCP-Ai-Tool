// An old (2025-11-25, SDK v1) client and a new (2026-07-28, SDK v2) client both list and call tools
// on the built stdio wrapper (dist/index.js), against a fake control bridge (I-138). The clients
// are the real SDK clients on their own stdio transports, so this is what Claude Desktop (old) and
// a modern host (new) do on connect. It needs the build (`npm run build`).
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client as ModernClient } from '@modelcontextprotocol/client';
import { StdioClientTransport as ModernStdio } from '@modelcontextprotocol/client/stdio';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport as LegacyStdio } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { FAKE_TOOLS, startFakeBridge } from './test-support/fake-control-bridge.js';

vi.setConfig({ testTimeout: 30_000 });

const distIndex = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'index.js'
);

let bridge: { server: net.Server; port: number } | undefined;
let tmpDir = '';

beforeAll(async () => {
  if (!fs.existsSync(distIndex)) {
    throw new Error(`${distIndex} not found. Run "npm run build" first (npm run green does).`);
  }
  bridge = await startFakeBridge();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-dual-era-'));
});

afterAll(() => {
  bridge?.server.close();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function serverParams(): { command: string; args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return {
    command: process.execPath,
    args: [distIndex],
    env: {
      ...env,
      MCP_CONTROL_HOST: '127.0.0.1',
      MCP_CONTROL_PORT: String(bridge?.port),
      MCP_NO_SPAWN: '1',
      FOUNDRY_AI_TOOL_SETS: '',
      // Keep these runs out of the live connectors' wrapper.log.
      TEMP: tmpDir,
      TMP: tmpDir,
      TMPDIR: tmpDir,
    },
  };
}

describe('old and new MCP clients on the stdio wrapper', () => {
  it('a 2025-11-25 client (SDK v1) lists and calls tools', async () => {
    const client = new LegacyClient({ name: 'legacy-client', version: '0.0.0' });
    await client.connect(new LegacyStdio(serverParams()));
    try {
      expect(client.getServerVersion()?.name).toBe('foundry-mcp-server');
      const { tools } = await client.listTools();
      expect(tools.map(t => t.name)).toEqual(FAKE_TOOLS.map(t => t.name));
      const result = await client.callTool({ name: 'get-world-info', arguments: {} });
      expect(JSON.stringify(result.content)).toContain('fake result');
      const { prompts } = await client.listPrompts();
      expect(prompts.length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  });

  it('a 2026-07-28 client (SDK v2, discover pinned) lists and calls tools', async () => {
    const client = new ModernClient(
      { name: 'modern-client', version: '0.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } }
    );
    await client.connect(new ModernStdio(serverParams()));
    try {
      expect(client.getDiscoverResult()?.supportedVersions).toContain('2026-07-28');
      const { tools } = await client.listTools();
      expect(tools.map(t => t.name)).toEqual(FAKE_TOOLS.map(t => t.name));
      const result = await client.callTool({ name: 'get-world-info', arguments: {} });
      expect(JSON.stringify(result.content)).toContain('fake result');
      const { prompts } = await client.listPrompts();
      expect(prompts.length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  });

  it('a dual-era client (SDK v2, auto) settles on the 2026-07-28 era', async () => {
    const client = new ModernClient(
      { name: 'dual-client', version: '0.0.0' },
      { versionNegotiation: { mode: 'auto' } }
    );
    await client.connect(new ModernStdio(serverParams()));
    try {
      expect(client.getDiscoverResult()).toBeDefined();
      const { tools } = await client.listTools();
      expect(tools.map(t => t.name)).toEqual(FAKE_TOOLS.map(t => t.name));
    } finally {
      await client.close();
    }
  });
});
