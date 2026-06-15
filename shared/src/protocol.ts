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
 *   §3b  Foundry link — JSON frames over a WebSocket (:31415) or a WebRTC
 *        DataChannel (signaled on :31416). Spoken between the backend (server)
 *        and the in-Foundry module (client, dials out). Frames are discriminated
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
export const CONTROL_METHODS = ['ping', 'list_tools', 'call_tool'] as const;
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
  error?: { message: string };
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
  error: z.object({ message: z.string() }).optional(),
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
// §3b — Foundry link (WebSocket :31415 / WebRTC DataChannel)
// ===========================================================================

/**
 * Frame `type` discriminator strings. The query/response/ping/pong values are
 * the frozen `SOCKET_EVENTS` from constants.ts (reused so they cannot drift);
 * `chunked-message` is the WebRTC chunk envelope, which has no SOCKET_EVENTS
 * entry of its own.
 */
export const CHUNKED_MESSAGE_TYPE = 'chunked-message' as const;

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
 * A single slice of a payload too large for a WebRTC SCTP message (64 KB cap).
 * The sender splits the JSON into `totalChunks` ordered pieces sharing a
 * `chunkId`; the receiver reassembles by `chunkIndex` and re-parses the joined
 * string as the original frame of type `originalType`.
 */
export interface ChunkedMessageFrame {
  type: typeof CHUNKED_MESSAGE_TYPE;
  chunkId: string;
  chunkIndex: number;
  totalChunks: number;
  chunk: string;
  originalType?: string;
  originalId?: string;
}

/**
 * The core, stable Foundry-link frames. Auxiliary push frames also travel this
 * link today — `bridge-status`, and the map-generation control/progress/
 * completion messages — but their payload shapes are still loose in the current
 * implementation, so they are intentionally NOT frozen here yet. Tightening and
 * codifying them is tracked as a Phase 4 implementation slice (see
 * docs/PHASE4-TRACKER.md); until then, treat them as `{ type: string; ... }`.
 */
export type FoundryFrame =
  | FoundryQueryFrame
  | FoundryResponseFrame
  | FoundryPingFrame
  | FoundryPongFrame
  | ChunkedMessageFrame;

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

export const ChunkedMessageFrameSchema = z.object({
  type: z.literal(CHUNKED_MESSAGE_TYPE),
  chunkId: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  totalChunks: z.number().int().positive(),
  chunk: z.string(),
  originalType: z.string().optional(),
  originalId: z.string().optional(),
});

/** Discriminated union over the core frame `type`s. */
export const FoundryFrameSchema = z.discriminatedUnion('type', [
  FoundryQueryFrameSchema,
  FoundryResponseFrameSchema,
  FoundryPingFrameSchema,
  FoundryPongFrameSchema,
  ChunkedMessageFrameSchema,
]);

// ===========================================================================
// WebRTC SCTP / chunking limits
// ===========================================================================

/**
 * SCTP message-size limits for the WebRTC DataChannel and the safe threshold at
 * which the sender switches to {@link ChunkedMessageFrame} chunking.
 *
 * This is the single source of truth: the MCP server's reassembly path and the
 * Foundry module's send path must agree, and historically each kept its own
 * copy. Implementations should import these rather than re-declaring them.
 */
export const WEBRTC_LIMITS = {
  /** SCTP hard cap; a single DataChannel send above this fails. */
  MAX_MESSAGE_SIZE: 65536, // 64 KB
  /** Chunk when a frame's JSON exceeds this (headroom under MAX_MESSAGE_SIZE). */
  CHUNK_SIZE: 50 * 1024, // 50 KB
  /** Drop incomplete chunk sets after this long to avoid leaks. */
  CHUNK_TIMEOUT_MS: 30000,
  /** Reject `totalChunks` above this (anti-"chunk bomb" guard). */
  MAX_CHUNKS_PER_MESSAGE: 1000,
  /** Sweep interval for timed-out partial messages. */
  CHUNK_CLEANUP_INTERVAL_MS: 10000,
} as const;
