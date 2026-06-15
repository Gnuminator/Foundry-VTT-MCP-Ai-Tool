/**
 * @gnuminator/shared — wire-protocol contract tests
 *
 * Guards the frozen frame shapes for both wire layers (ARCHITECTURE.md §3):
 *   - §3a control channel: request / response / call_tool / tool-result
 *   - §3b Foundry link: query / response / ping / pong / chunked-message
 *
 * If any of these fail, an implementation built against this contract is no
 * longer wire-compatible with the others.
 */

import { describe, expect, it } from 'vitest';

import { SOCKET_EVENTS } from './constants.js';
import {
  CONTROL_METHODS,
  CallToolParamsSchema,
  ChunkedMessageFrameSchema,
  CHUNKED_MESSAGE_TYPE,
  ControlRequestSchema,
  ControlResponseSchema,
  FoundryFrameSchema,
  FoundryQueryFrameSchema,
  FoundryResponseFrameSchema,
  ToolResultPayloadSchema,
} from './protocol.js';

// ---------------------------------------------------------------------------
// §3a control channel
// ---------------------------------------------------------------------------

describe('control-channel contract (§3a)', () => {
  it('exposes exactly the three control verbs', () => {
    expect(CONTROL_METHODS).toEqual(['ping', 'list_tools', 'call_tool']);
  });

  it('accepts a well-formed call_tool request', () => {
    const frame = { id: 'cogm-abc', method: 'call_tool', params: { name: 'get-world-info' } };
    expect(() => ControlRequestSchema.parse(frame)).not.toThrow();
  });

  it('accepts a request with no params (ping / list_tools)', () => {
    expect(() => ControlRequestSchema.parse({ id: '1', method: 'ping' })).not.toThrow();
  });

  it('rejects a request missing its correlation id', () => {
    expect(() => ControlRequestSchema.parse({ method: 'ping' })).toThrow();
  });

  it('allows a response with a result and no id-less error frame', () => {
    expect(() => ControlResponseSchema.parse({ id: '1', result: { ok: true } })).not.toThrow();
  });

  it('allows an uncorrelated protocol error (no id)', () => {
    expect(() => ControlResponseSchema.parse({ error: { message: 'Bad request' } })).not.toThrow();
  });

  it('validates call_tool params shape', () => {
    expect(() => CallToolParamsSchema.parse({ name: 'move-token', args: { x: 1 } })).not.toThrow();
    expect(() => CallToolParamsSchema.parse({ args: {} })).toThrow(); // name required
  });

  it('models a tool result as MCP text content with optional isError', () => {
    expect(() =>
      ToolResultPayloadSchema.parse({ content: [{ type: 'text', text: '{}' }] })
    ).not.toThrow();
    expect(() =>
      ToolResultPayloadSchema.parse({
        content: [{ type: 'text', text: 'Error: nope' }],
        isError: true,
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §3b Foundry link
// ---------------------------------------------------------------------------

describe('Foundry-link contract (§3b)', () => {
  it('frame type strings are the frozen SOCKET_EVENTS values', () => {
    expect(SOCKET_EVENTS.MCP_QUERY).toBe('mcp-query');
    expect(SOCKET_EVENTS.MCP_RESPONSE).toBe('mcp-response');
    expect(CHUNKED_MESSAGE_TYPE).toBe('chunked-message');
  });

  it('round-trips a query frame (backend → module)', () => {
    const frame = {
      type: 'mcp-query',
      id: 'query-7',
      data: { method: 'foundry-mcp-bridge.getWorldInfo', data: {} },
    };
    const parsed = FoundryQueryFrameSchema.parse(frame);
    expect(parsed.data.method).toBe('foundry-mcp-bridge.getWorldInfo');
    // also resolves through the discriminated union
    expect(() => FoundryFrameSchema.parse(frame)).not.toThrow();
  });

  it('round-trips a success response frame (module → backend)', () => {
    const frame = {
      type: 'mcp-response',
      id: 'query-7',
      data: { success: true, data: { hp: 10 } },
    };
    expect(() => FoundryResponseFrameSchema.parse(frame)).not.toThrow();
    expect(() => FoundryFrameSchema.parse(frame)).not.toThrow();
  });

  it('round-trips an error response frame', () => {
    const frame = {
      type: 'mcp-response',
      id: 'query-7',
      data: { success: false, error: 'module not connected' },
    };
    expect(() => FoundryResponseFrameSchema.parse(frame)).not.toThrow();
  });

  it('round-trips ping / pong via the union', () => {
    expect(() => FoundryFrameSchema.parse({ type: 'ping', id: 'p1' })).not.toThrow();
    expect(() =>
      FoundryFrameSchema.parse({ type: 'pong', id: 'p1', data: { timestamp: 1, status: 'ok' } })
    ).not.toThrow();
  });

  it('validates a chunked-message frame and rejects a zero-chunk count', () => {
    const chunk = {
      type: 'chunked-message',
      chunkId: 'chunk-1',
      chunkIndex: 0,
      totalChunks: 3,
      chunk: '{"part":1}',
      originalType: 'mcp-response',
      originalId: 'query-7',
    };
    expect(() => ChunkedMessageFrameSchema.parse(chunk)).not.toThrow();
    expect(() => ChunkedMessageFrameSchema.parse({ ...chunk, totalChunks: 0 })).toThrow();
  });

  it('rejects an unknown frame type at the union boundary', () => {
    expect(() => FoundryFrameSchema.parse({ type: 'totally-made-up', id: 'x' })).toThrow();
  });
});
