/**
 * The prompts through the real MCP protocol (SDK client and server on linked
 * in-memory transports), so `prompts/list` and `prompts/get` are checked as a
 * client such as Claude Desktop sends them. No process, no port, no network.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PROMPTS, getPrompt } from './index.js';
import { PROMPTS_CAPABILITY, registerPromptHandlers } from './register.js';

let client: Client;
let server: Server;

beforeAll(async () => {
  // The same capabilities index.ts declares: tools (answered elsewhere) plus prompts.
  server = new Server(
    { name: 'prompts-test', version: '0.0.0' },
    { capabilities: { tools: {}, ...PROMPTS_CAPABILITY } }
  );
  registerPromptHandlers(server);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

describe('prompts over MCP', () => {
  it('advertises the prompts capability', () => {
    expect(client.getServerCapabilities()?.prompts).toBeDefined();
  });

  it('lists the six prompts with titles, descriptions and arguments', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map(p => p.name)).toEqual(PROMPTS.map(p => p.name));
    const rules = prompts.find(p => p.name === 'rules-question');
    expect(rules?.title).toBe('Rules question');
    expect(rules?.arguments).toEqual([
      expect.objectContaining({ name: 'question', required: true }),
    ]);
    const recap = prompts.find(p => p.name === 'session-recap');
    expect(recap?.arguments?.map(a => [a.name, a.required])).toEqual([
      ['audience', false],
      ['session', false],
    ]);
  });

  it('gets a prompt as one user message', async () => {
    const result = await client.getPrompt({
      name: 'rules-question',
      arguments: { question: 'How does the Help action work?' },
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe('user');
    const content = result.messages[0]?.content;
    expect(content?.type).toBe('text');
    expect(content?.type === 'text' ? content.text : '').toBe(
      getPrompt('rules-question', { question: 'How does the Help action work?' }).messages[0]
        .content.text
    );
  });

  it('gets a prompt with no arguments when none are required', async () => {
    const result = await client.getPrompt({ name: 'prep-next-session' });
    expect(result.messages).toHaveLength(1);
  });

  it('answers a missing required argument with an invalid-params error', async () => {
    const error = await client.getPrompt({ name: 'reveal-handout' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((error as McpError).message).toContain('Missing required argument "page"');
  });

  it('answers an unknown prompt or argument with an invalid-params error', async () => {
    const unknown = await client.getPrompt({ name: 'nope' }).catch((e: unknown) => e);
    expect((unknown as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((unknown as McpError).message).toContain('Unknown prompt "nope"');

    const badArg = await client
      .getPrompt({ name: 'encounter-check', arguments: { room: 'x' } })
      .catch((e: unknown) => e);
    expect((badArg as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((badArg as McpError).message).toContain('Unknown argument "room"');
  });
});

describe('prompts over MCP for one tool set', () => {
  it('lists only the prompts of the chosen sets', async () => {
    const setServer = new Server(
      { name: 'prompts-set-test', version: '0.0.0' },
      { capabilities: { tools: {}, ...PROMPTS_CAPABILITY } }
    );
    registerPromptHandlers(setServer, ['core']);
    const setClient = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([setServer.connect(serverSide), setClient.connect(clientSide)]);
    try {
      const { prompts } = await setClient.listPrompts();
      expect(prompts.map(p => p.name)).toEqual(
        PROMPTS.filter(p => p.set === 'core').map(p => p.name)
      );
      expect(prompts.map(p => p.name)).toEqual(['rules-question', 'npc-improv']);
    } finally {
      await setClient.close();
      await setServer.close();
    }
  });
});

describe('the stdio wrapper', () => {
  // index.ts starts the whole wrapper (and a backend on 31414) when imported, so it cannot be
  // loaded in a test. Check the wiring in its source instead.
  const source = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');

  it('declares the prompts capability and registers the handlers', () => {
    expect(source).toContain('...PROMPTS_CAPABILITY');
    expect(source).toContain('registerPromptHandlers(mcp, ');
  });
});
