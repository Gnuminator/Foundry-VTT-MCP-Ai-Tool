import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatLogTools } from './chat-log.js';

/**
 * Tests for ChatLogTools — a thin, deterministic layer over FoundryClient.query.
 * Pattern: validate args → dispatch correct `foundry-mcp-bridge.*` method →
 * propagate foundry-side failures → return validation errors as strings
 * (handleSendChatMessage only; the other two handlers throw on any error).
 *
 * The FoundryClient is mocked so these tests run with no bridge connection.
 */

function makeTools(queryImpl?: (method: string, data: unknown) => unknown) {
  const query = vi.fn(queryImpl ?? (() => ({ success: true })));
  const foundryClient = { query } as any;
  // Minimal Logger stub: `.child()` returns itself; level methods are no-ops.
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = () => logger;
  return { tools: new ChatLogTools({ foundryClient, logger }), query };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('ChatLogTools.getToolDefinitions', () => {
  it('exposes the three chat-log tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'get-chat-log',
      'get-combat-play-by-play',
      'send-chat-message',
    ]);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('get-chat-log has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-chat-log')!;
    expect((def.inputSchema as any).required).toBeUndefined();
  });

  it('get-combat-play-by-play has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-combat-play-by-play')!;
    expect((def.inputSchema as any).required).toBeUndefined();
  });

  it('send-chat-message requires message', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'send-chat-message')!;
    expect((def.inputSchema as any).required).toEqual(['message']);
  });
});

// ---------------------------------------------------------------------------
// handleGetChatLog
// ---------------------------------------------------------------------------

describe('ChatLogTools.handleGetChatLog', () => {
  it('dispatches the correct query method and returns the response', async () => {
    const payload = { success: true, messages: [] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleGetChatLog({ limit: 10 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getChatLog', { limit: 10 });
    expect(result).toBe(payload);
  });

  it('dispatches with empty params when args are omitted', async () => {
    const { tools, query } = makeTools();
    await tools.handleGetChatLog(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getChatLog', {});
  });

  it('dispatches with all optional params when provided', async () => {
    const { tools, query } = makeTools();
    await tools.handleGetChatLog({
      limit: 100,
      speakerName: 'Gandalf',
      messageType: 'roll',
      sinceTimestamp: '2024-01-01T00:00:00Z',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getChatLog', {
      limit: 100,
      speakerName: 'Gandalf',
      messageType: 'roll',
      sinceTimestamp: '2024-01-01T00:00:00Z',
    });
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'chat log unavailable' }));
    await expect(tools.handleGetChatLog({})).rejects.toThrow('chat log unavailable');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleGetChatLog({})).rejects.toThrow('Failed to get chat log');
  });

  it('throws (not returns string) when limit is out of range', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleGetChatLog({ limit: 0 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws (not returns string) when messageType is an invalid enum value', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleGetChatLog({ messageType: 'invalid' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleGetCombatPlayByPlay
// ---------------------------------------------------------------------------

describe('ChatLogTools.handleGetCombatPlayByPlay', () => {
  it('dispatches the correct query method with empty params', async () => {
    const payload = { success: true, rounds: [] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleGetCombatPlayByPlay({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getCombatPlayByPlay', {});
    expect(result).toBe(payload);
  });

  it('ignores extra args and dispatches empty params', async () => {
    const { tools, query } = makeTools();
    await tools.handleGetCombatPlayByPlay({ unexpected: 'arg' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getCombatPlayByPlay', {});
  });

  it('dispatches with empty params when args are undefined', async () => {
    const { tools, query } = makeTools();
    await tools.handleGetCombatPlayByPlay(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getCombatPlayByPlay', {});
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'no combat history' }));
    await expect(tools.handleGetCombatPlayByPlay({})).rejects.toThrow('no combat history');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleGetCombatPlayByPlay({})).rejects.toThrow(
      'Failed to get combat play-by-play'
    );
  });
});

// ---------------------------------------------------------------------------
// handleSendChatMessage
// ---------------------------------------------------------------------------

describe('ChatLogTools.handleSendChatMessage', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('dispatches the correct query method and returns the response', async () => {
    const payload = { success: true };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleSendChatMessage({ message: 'Hello world' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.sendChatMessage', {
      message: 'Hello world',
    });
    expect(result).toBe(payload);
    consoleErr.mockRestore();
  });

  it('dispatches with all optional params when provided', async () => {
    const { tools, query } = makeTools();
    await tools.handleSendChatMessage({
      message: 'I strike!',
      speakerActorId: 'actor-123',
      speakerActorName: 'Aragorn',
      messageType: 'ic',
      whisperTargets: ['GM'],
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.sendChatMessage', {
      message: 'I strike!',
      speakerActorId: 'actor-123',
      speakerActorName: 'Aragorn',
      messageType: 'ic',
      whisperTargets: ['GM'],
    });
    consoleErr.mockRestore();
  });

  it('dispatches with whisper messageType and targets', async () => {
    const { tools, query } = makeTools();
    await tools.handleSendChatMessage({
      message: 'Secret plan',
      messageType: 'whisper',
      whisperTargets: ['Alice', 'Bob'],
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.sendChatMessage', {
      message: 'Secret plan',
      messageType: 'whisper',
      whisperTargets: ['Alice', 'Bob'],
    });
    consoleErr.mockRestore();
  });

  it('returns a parameter-error string (not a throw) when message is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleSendChatMessage({});
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('returns a parameter-error string (not a throw) when args are null/undefined', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleSendChatMessage(undefined);
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('returns a parameter-error string (not a throw) when message is an empty string', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleSendChatMessage({ message: '' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('returns a parameter-error string (not a throw) when messageType is invalid', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleSendChatMessage({
      message: 'hi',
      messageType: 'shout',
    });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'actor not found' }));
    await expect(
      tools.handleSendChatMessage({ message: 'Hello', speakerActorId: 'bad-id' })
    ).rejects.toThrow('actor not found');
    consoleErr.mockRestore();
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleSendChatMessage({ message: 'Hello' })).rejects.toThrow(
      'Failed to send chat message'
    );
    consoleErr.mockRestore();
  });
});
