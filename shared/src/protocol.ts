/**
 * @module protocol
 *
 * The TWO wire contracts that connect the three processes, codified once as
 * types + Zod schemas so every implementation validates against a single source
 * of truth instead of re-declaring the frame shapes inline (as the backend, the
 * stdio wrapper, the dashboard client, the Foundry connector, and the socket
 * bridge currently each do).
 *
 * See ARCHITECTURE.md §3 ("The two wire contracts") for the prose rationale.
 *
 *   §3a  Control channel — newline-delimited JSON over a TCP socket on
 *        127.0.0.1:31414. Spoken between the MCP stdio wrapper / co-GM dashboard
 *        (clients) and the backend (server). Request/response correlated by `id`.
 *
 *   §3b  Foundry link — JSON frames over a WebSocket (:31415). Spoken between
 *        the backend (server) and the in-Foundry module (client, dials out). Frames are discriminated
 *        by a `type` field; queries are correlated by `id`.
 *
 * IMPORTANT — every shape in this file is a FROZEN wire contract. Changing a
 * field, a `type`/`method` string, or an envelope shape breaks compatibility
 * between independently-deployed processes (an old Foundry module talking to a
 * new backend, etc.). Treat changes here as migration-gated. The string
 * constants reuse the frozen values in `constants.ts` so the two cannot drift.
 */

import { z } from 'zod';

import { SOCKET_EVENTS } from './constants.js';
import type { MCPQuery, MCPResponse } from './types.js';
import { MCPQuerySchema, MCPResponseSchema } from './schemas.js';

// ===========================================================================
// §3a — Control channel (JSON-lines TCP, 127.0.0.1:31414)
// ===========================================================================

/**
 * The only three methods the control channel accepts. NOTE: these are the
 * control-channel verbs — distinct from `MCP_METHODS` in constants.ts, which
 * are the Foundry-side query handler names invoked *inside* a `call_tool`.
 */
export const CONTROL_METHODS = ['ping', 'list_tools', 'call_tool', 'record_usage'] as const;
export type ControlMethod = (typeof CONTROL_METHODS)[number];

/**
 * A request frame. One JSON object per line. `id` is caller-generated and echoed
 * back on the matching response. `method` is typed loosely as `string` because
 * the wire tolerates unknown methods — the backend answers an unknown method
 * with an error response rather than dropping the connection.
 */
export interface ControlRequest {
  id: string;
  method: string;
  params?: unknown;
}

/**
 * A response frame. Exactly one of `result` / `error` is meaningful. `id` is the
 * echoed request id; it is omitted only on an uncorrelated protocol-level error
 * (e.g. a malformed request line that had no parseable id).
 */
export interface ControlResponse {
  id?: string;
  result?: unknown;
  /** `code`: a stable refusal reason where the method defines one (`session_notes`). */
  error?: { message: string; code?: string };
}

/** `params` for a `call_tool` request. */
export interface CallToolParams {
  name: string;
  args?: Record<string, unknown>;
}

/**
 * The payload a successful `call_tool` resolves to: the MCP tool-content
 * envelope. A tool-level failure is reported IN-BAND here as `isError: true`
 * with the message in the text block — NOT as a transport-level `error` on the
 * ControlResponse (that is reserved for malformed requests / unknown methods).
 */
export interface ToolResultPayload {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Result of `list_tools`: the tool definitions the backend exposes. */
export interface ListToolsResult {
  tools: unknown[];
}

/** Result of `ping`. */
export interface PingResult {
  ok: boolean;
}

export const ControlRequestSchema = z.object({
  id: z.string(),
  method: z.string(),
  params: z.unknown().optional(),
});

export const ControlResponseSchema = z.object({
  id: z.string().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string(), code: z.string().optional() }).optional(),
});

export const CallToolParamsSchema = z.object({
  name: z.string(),
  args: z.record(z.unknown()).optional(),
});

export const ToolResultPayloadSchema = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  isError: z.boolean().optional(),
});

// ===========================================================================
// §3b — Foundry link (WebSocket :31415)
// ===========================================================================

/**
 * Frame `type` discriminator strings. The query/response/ping/pong values are
 * the frozen `SOCKET_EVENTS` from constants.ts (reused so they cannot drift).
 */
/**
 * Backend → module: invoke a Foundry query handler. The inner `data` is the
 * `{ method, data }` pair (an {@link MCPQuery}); `method` is a fully-qualified
 * `foundry-mcp-bridge.*` handler key registered in `CONFIG.queries`.
 */
export interface FoundryQueryFrame {
  type: typeof SOCKET_EVENTS.MCP_QUERY;
  id: string;
  data: MCPQuery;
}

/**
 * Module → backend: the result of a query, correlated by the query's `id`. The
 * inner `data` is an {@link MCPResponse} (`{ success, data?, error? }`).
 */
export interface FoundryResponseFrame {
  type: typeof SOCKET_EVENTS.MCP_RESPONSE;
  id: string;
  data: MCPResponse;
}

/** Backend → module: liveness probe. */
export interface FoundryPingFrame {
  type: typeof SOCKET_EVENTS.PING;
  id: string;
}

/** Module → backend: liveness acknowledgement. */
export interface FoundryPongFrame {
  type: typeof SOCKET_EVENTS.PONG;
  id: string;
  data?: { timestamp: number; status: string };
}

/**
 * The core, stable Foundry-link frames. An auxiliary push frame also travels this
 * link today, `bridge-status`, but its payload shape is still loose in the current
 * implementation, so it is intentionally NOT frozen here yet. Tightening and
 * codifying it is tracked as a Phase 4 implementation slice (see
 * docs/history/PHASE4-TRACKER.md); until then, treat it as `{ type: string; ... }`.
 */
export type FoundryFrame =
  | FoundryQueryFrame
  | FoundryResponseFrame
  | FoundryPingFrame
  | FoundryPongFrame;

export const FoundryQueryFrameSchema = z.object({
  type: z.literal(SOCKET_EVENTS.MCP_QUERY),
  id: z.string(),
  data: MCPQuerySchema,
});

export const FoundryResponseFrameSchema = z.object({
  type: z.literal(SOCKET_EVENTS.MCP_RESPONSE),
  id: z.string(),
  data: MCPResponseSchema,
});

export const FoundryPingFrameSchema = z.object({
  type: z.literal(SOCKET_EVENTS.PING),
  id: z.string(),
});

export const FoundryPongFrameSchema = z.object({
  type: z.literal(SOCKET_EVENTS.PONG),
  id: z.string(),
  data: z.object({ timestamp: z.number(), status: z.string() }).optional(),
});

/**
 * Module → backend, sent once right after the link opens (lane 1, PB-02). It
 * says which Foundry user's browser holds the link, so the backend can prefer
 * the configured bridge user and report who is connected. Older modules never
 * send it; the backend must keep working without it. Not part of
 * {@link FoundryFrame} (additive, like `bridge-status`).
 */
export const MODULE_HELLO_TYPE = 'module-hello' as const;

export interface ModuleHelloData {
  userId: string;
  userName: string;
  /** True when this user is the world's configured bridge user (or none is set). */
  isBridgeUser: boolean;
  /** The Foundry module version (`game.modules.get(id).version`). */
  moduleVersion: string;
  worldId: string;
  /**
   * What this module build can do beyond the base protocol (e.g.
   * {@link MODULE_CAPABILITY_AI_CHANGES_SIGNAL}). Optional: older modules send none, and the
   * backend then skips the features that need one.
   */
  capabilities?: string[] | undefined;
}

/** The module answers the `foundry-mcp-bridge.aiChangesUpdated` signal query (I-108). */
export const MODULE_CAPABILITY_AI_CHANGES_SIGNAL = 'ai-changes-signal' as const;

export interface ModuleHelloFrame {
  type: typeof MODULE_HELLO_TYPE;
  data: ModuleHelloData;
}

export const ModuleHelloFrameSchema = z.object({
  type: z.literal(MODULE_HELLO_TYPE),
  data: z.object({
    userId: z.string(),
    userName: z.string(),
    isBridgeUser: z.boolean(),
    moduleVersion: z.string(),
    worldId: z.string(),
    capabilities: z.array(z.string().max(100)).max(50).optional(),
  }),
});

/**
 * Module → backend: the bridge-linked browser asks the backend to run one of a
 * short list of tools for a GM's Foundry window (I-108: the "AI changes" window
 * inside Foundry). The backend runs the same in-process tool the dashboard
 * would call and answers with a {@link MODULE_REPLY_TYPE} frame carrying the
 * same `id`. Additive and not part of {@link FoundryFrame}, like `module-hello`.
 */
export const MODULE_REQUEST_TYPE = 'module-request' as const;

/** Backend → module: the answer to one `module-request`. */
export const MODULE_REPLY_TYPE = 'module-reply' as const;

/** The tools a `module-request` may name (later lanes extend this list). */
export const MODULE_REQUEST_TOOLS = [
  'list-recent-changes',
  'undo-change',
  // The Handouts window (I-108 part 2). The planner and the apply are narrowed by the backend
  // (`MODULE_PLANNERS` in mcp-server `module-requests.ts`), not by this list.
  'list-revealed-pages',
  'plan-page-reveal',
  'apply-planned-change',
  // The Tarokka window (I-108 part 3). `plan-tarokka-reveal` is narrowed by `MODULE_PLANNERS`.
  'get-tarokka-reading',
  'plan-tarokka-reveal',
  // The Changes window (I-109 part 4). `plan-undo-changes` is narrowed by `MODULE_PLANNERS`.
  'list-changes',
  'plan-undo-changes',
] as const;

export type ModuleRequestTool = (typeof MODULE_REQUEST_TOOLS)[number];

/** The largest `args` object (as UTF-8 JSON bytes) the backend accepts in a `module-request`. */
export const MODULE_REQUEST_MAX_ARGS_BYTES = 20_000;

/**
 * The tools a bridge that sends only the plain `module-request` capability (the first
 * I-108 build, before per-tool capabilities) answers. A module that sees no
 * {@link BRIDGE_CAPABILITY_MODULE_REQUEST_TOOL_PREFIX} entry allows only these.
 */
export const MODULE_REQUEST_LEGACY_TOOLS = ['list-recent-changes', 'undo-change'] as const;

/**
 * The bridge's reply when a `module-request` arrives on a socket that is not allowed
 * to ask: neither the active link nor a bridge-user tab (a hello with
 * `isBridgeUser: true`; in Any-GM mode every GM tab says so, and each is served).
 * The module treats it like "not connected": it asks the next candidate.
 */
export const MODULE_NOT_ACTIVE_LINK_ERROR = 'Not the active bridge link';

/**
 * Backend → module, sent once when a module socket connects: what this bridge
 * understands. An older bridge sends nothing, so a module that wants a
 * capability fails fast with "update the bridge" instead of waiting for a reply
 * that never comes. An older module ignores the frame.
 */
export const BRIDGE_HELLO_TYPE = 'bridge-hello' as const;

/** The bridge answers `module-request` frames (I-108). */
export const BRIDGE_CAPABILITY_MODULE_REQUEST = 'module-request' as const;

/**
 * Prefix of the per-tool capability: `module-request:<tool>` for every tool in
 * {@link MODULE_REQUEST_TOOLS} the bridge answers. A bridge that sends none (the first
 * I-108 build) answers only {@link MODULE_REQUEST_LEGACY_TOOLS}.
 */
export const BRIDGE_CAPABILITY_MODULE_REQUEST_TOOL_PREFIX = 'module-request:' as const;

export interface BridgeHelloData {
  capabilities: string[];
}

export interface BridgeHelloFrame {
  type: typeof BRIDGE_HELLO_TYPE;
  data: BridgeHelloData;
}

export const BridgeHelloFrameSchema = z.object({
  type: z.literal(BRIDGE_HELLO_TYPE),
  data: z.object({ capabilities: z.array(z.string().max(100)).max(50) }),
});

export interface ModuleRequestData {
  tool: string;
  args: Record<string, unknown>;
  /** The Foundry GM who asked (the browser that holds the link relays for others). */
  requestedBy: { userId: string; userName: string };
}

export interface ModuleRequestFrame {
  type: typeof MODULE_REQUEST_TYPE;
  id: string;
  data: ModuleRequestData;
}

export interface ModuleReplyData {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ModuleReplyFrame {
  type: typeof MODULE_REPLY_TYPE;
  id: string;
  data: ModuleReplyData;
}

export const ModuleRequestFrameSchema = z.object({
  type: z.literal(MODULE_REQUEST_TYPE),
  id: z.string().min(1).max(100),
  data: z.object({
    tool: z.string().min(1).max(100),
    args: z.record(z.string(), z.unknown()),
    requestedBy: z.object({
      userId: z.string().max(100),
      userName: z.string().max(200),
    }),
  }),
});

export const ModuleReplyFrameSchema = z.object({
  type: z.literal(MODULE_REPLY_TYPE),
  id: z.string().min(1).max(100),
  data: z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
});

/** Discriminated union over the core frame `type`s. */
export const FoundryFrameSchema = z.discriminatedUnion('type', [
  FoundryQueryFrameSchema,
  FoundryResponseFrameSchema,
  FoundryPingFrameSchema,
  FoundryPongFrameSchema,
]);
