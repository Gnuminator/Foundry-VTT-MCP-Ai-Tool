/**
 * @gnuminator/shared — wire-protocol contract tests
 *
 * Guards the frozen frame shapes for both wire layers (ARCHITECTURE.md §3):
 *   - §3a control channel: request / response / call_tool / tool-result
 *   - §3b Foundry link: query / response / ping / pong
 *
 * If any of these fail, an implementation built against this contract is no
 * longer wire-compatible with the others.
 */

import { describe, expect, it } from 'vitest';

import { SOCKET_EVENTS } from './constants.js';
import {
  CONTROL_METHODS,
  CallToolParamsSchema,
  ControlRequestSchema,
  ControlResponseSchema,
  FoundryFrameSchema,
  FoundryQueryFrameSchema,
  FoundryResponseFrameSchema,
  BRIDGE_CAPABILITY_MODULE_REQUEST,
  BRIDGE_CAPABILITY_MODULE_REQUEST_TOOL_PREFIX,
  MODULE_CAPABILITY_AI_CHANGES_SIGNAL,
  MODULE_REQUEST_LEGACY_TOOLS,
  ModuleHelloFrameSchema,
  BRIDGE_HELLO_TYPE,
  BridgeHelloFrameSchema,
  MODULE_NOT_ACTIVE_LINK_ERROR,
  MODULE_REPLY_TYPE,
  MODULE_REQUEST_MAX_ARGS_BYTES,
  MODULE_REQUEST_TOOLS,
  MODULE_REQUEST_TYPE,
  ModuleReplyFrameSchema,
  ModuleRequestFrameSchema,
  ToolResultPayloadSchema,
} from './protocol.js';

// ---------------------------------------------------------------------------
// §3a control channel
// ---------------------------------------------------------------------------

describe('control-channel contract (§3a)', () => {
  it('exposes exactly the three control verbs', () => {
    expect(CONTROL_METHODS).toEqual(['ping', 'list_tools', 'call_tool', 'record_usage']);
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
    expect(() =>
      CallToolParamsSchema.parse({ name: 'plan-token-change', args: { action: 'move' } })
    ).not.toThrow();
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

  it('rejects an unknown frame type at the union boundary', () => {
    expect(() => FoundryFrameSchema.parse({ type: 'totally-made-up', id: 'x' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// module-request / module-reply (I-108: the AI changes window inside Foundry)
// ---------------------------------------------------------------------------

describe('module-request / module-reply contract', () => {
  const request = {
    type: 'module-request',
    id: 'req-1',
    data: {
      tool: 'list-recent-changes',
      args: { limit: 20 },
      requestedBy: { userId: 'abc123', userName: 'Danni' },
    },
  };

  it('pins the frame types, the tools and the size cap', () => {
    expect(MODULE_REQUEST_TYPE).toBe('module-request');
    expect(MODULE_REPLY_TYPE).toBe('module-reply');
    expect([...MODULE_REQUEST_TOOLS]).toEqual([
      'list-recent-changes',
      'undo-change',
      'list-revealed-pages',
      'plan-page-reveal',
      'apply-planned-change',
      'get-tarokka-reading',
      'plan-tarokka-reveal',
    ]);
    expect(MODULE_REQUEST_MAX_ARGS_BYTES).toBe(20_000);
  });

  it('round-trips a request frame', () => {
    expect(ModuleRequestFrameSchema.parse(request)).toEqual(request);
  });

  it('rejects a request without requestedBy, with non-object args or an empty id', () => {
    expect(
      ModuleRequestFrameSchema.safeParse({ ...request, data: { tool: 'x', args: {} } }).success
    ).toBe(false);
    expect(
      ModuleRequestFrameSchema.safeParse({ ...request, data: { ...request.data, args: [1] } })
        .success
    ).toBe(false);
    expect(ModuleRequestFrameSchema.safeParse({ ...request, id: '' }).success).toBe(false);
  });

  it('is not part of the core frame union (additive, like module-hello)', () => {
    expect(() => FoundryFrameSchema.parse(request)).toThrow();
  });

  it('round-trips a success and an error reply', () => {
    const ok = {
      type: 'module-reply',
      id: 'req-1',
      data: { success: true, data: { changes: [] } },
    };
    const bad = { type: 'module-reply', id: 'req-1', data: { success: false, error: 'nope' } };
    expect(ModuleReplyFrameSchema.parse(ok)).toEqual(ok);
    expect(ModuleReplyFrameSchema.parse(bad)).toEqual(bad);
    expect(
      ModuleReplyFrameSchema.safeParse({ type: 'module-reply', id: 'r', data: {} }).success
    ).toBe(false);
  });
});

describe('bridge-hello (what the bridge supports)', () => {
  it('pins the type, the capability and the not-active-link reply', () => {
    expect(BRIDGE_HELLO_TYPE).toBe('bridge-hello');
    expect(BRIDGE_CAPABILITY_MODULE_REQUEST).toBe('module-request');
    expect(MODULE_NOT_ACTIVE_LINK_ERROR).toBe('Not the active bridge link');
  });

  it('pins the per-tool prefix, the legacy tool list and the module capability', () => {
    expect(BRIDGE_CAPABILITY_MODULE_REQUEST_TOOL_PREFIX).toBe('module-request:');
    expect([...MODULE_REQUEST_LEGACY_TOOLS]).toEqual(['list-recent-changes', 'undo-change']);
    for (const tool of MODULE_REQUEST_LEGACY_TOOLS) {
      expect((MODULE_REQUEST_TOOLS as readonly string[]).includes(tool)).toBe(true);
    }
    expect(MODULE_CAPABILITY_AI_CHANGES_SIGNAL).toBe('ai-changes-signal');
  });

  it('a hello with module-request plus one entry per tool fits the schema', () => {
    const capabilities = [
      BRIDGE_CAPABILITY_MODULE_REQUEST,
      ...MODULE_REQUEST_TOOLS.map(t => `${BRIDGE_CAPABILITY_MODULE_REQUEST_TOOL_PREFIX}${t}`),
    ];
    expect(capabilities.length).toBeLessThanOrEqual(50);
    expect(
      BridgeHelloFrameSchema.safeParse({ type: 'bridge-hello', data: { capabilities } }).success
    ).toBe(true);
  });

  it('round-trips a module-hello with and without capabilities, and bounds them', () => {
    const base = {
      userId: 'u',
      userName: 'n',
      isBridgeUser: true,
      moduleVersion: '1',
      worldId: 'w',
    };
    const without = { type: 'module-hello', data: base };
    expect(ModuleHelloFrameSchema.parse(without)).toEqual(without);
    const withCaps = {
      type: 'module-hello',
      data: { ...base, capabilities: [MODULE_CAPABILITY_AI_CHANGES_SIGNAL] },
    };
    expect(ModuleHelloFrameSchema.parse(withCaps)).toEqual(withCaps);
    // A bad list costs only the capabilities: the hello still parses, as if none were sent.
    for (const capabilities of [
      'x',
      [1],
      Array.from({ length: 51 }, () => 'a'),
      ['a'.repeat(101)],
    ]) {
      const parsed = ModuleHelloFrameSchema.safeParse({
        type: 'module-hello',
        data: { ...base, capabilities },
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.data.capabilities).toBeUndefined();
      expect(parsed.success && parsed.data.data.worldId).toBe('w');
    }
  });

  it('round-trips a hello and rejects a malformed one', () => {
    const hello = { type: 'bridge-hello', data: { capabilities: ['module-request'] } };
    expect(BridgeHelloFrameSchema.parse(hello)).toEqual(hello);
    expect(BridgeHelloFrameSchema.safeParse({ type: 'bridge-hello', data: {} }).success).toBe(
      false
    );
    expect(() => FoundryFrameSchema.parse(hello)).toThrow();
  });
});
