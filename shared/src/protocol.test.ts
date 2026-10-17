/**
 * @gnuminator/shared — wire-protocol contract tests
 *
 * Guards the frozen strings and the two frame schemas the code really parses (module-hello and
 * module-request); the other frame shapes are TypeScript types only (ARCHITECTURE.md §3).
 *
 * If any of these fail, an implementation built against this contract is no
 * longer wire-compatible with the others.
 */

import { describe, expect, it } from 'vitest';

import { SOCKET_EVENTS } from './constants.js';
import {
  CONTROL_METHODS,
  BRIDGE_CAPABILITY_MODULE_REQUEST,
  BRIDGE_CAPABILITY_MODULE_REQUEST_TOOL_PREFIX,
  MODULE_CAPABILITY_AI_CHANGES_SIGNAL,
  MODULE_REQUEST_LEGACY_TOOLS,
  ModuleHelloFrameSchema,
  BRIDGE_HELLO_TYPE,
  MODULE_NOT_ACTIVE_LINK_ERROR,
  MODULE_REPLY_TYPE,
  MODULE_REQUEST_MAX_ARGS_BYTES,
  MODULE_REQUEST_TOOLS,
  MODULE_REQUEST_TYPE,
  ModuleRequestFrameSchema,
} from './protocol.js';

describe('control-channel contract (§3a)', () => {
  it('exposes exactly the control verbs', () => {
    expect(CONTROL_METHODS).toEqual(['ping', 'list_tools', 'call_tool', 'record_usage']);
  });
});

describe('Foundry-link contract (§3b)', () => {
  it('frame type strings are the frozen SOCKET_EVENTS values', () => {
    expect(SOCKET_EVENTS.MCP_QUERY).toBe('mcp-query');
    expect(SOCKET_EVENTS.MCP_RESPONSE).toBe('mcp-response');
    expect(SOCKET_EVENTS.PING).toBe('ping');
    expect(SOCKET_EVENTS.PONG).toBe('pong');
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
      'list-changes',
      'plan-undo-changes',
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
});
