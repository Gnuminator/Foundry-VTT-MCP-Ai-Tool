import * as net from 'net';
import { EventEmitter } from 'events';
import type {
  ControlResponse,
  RecordUsageResult,
  ToolResultPayload,
  UsageEvent,
} from '@gnuminator/shared';
import type { Logger } from '../logger.js';
import type { SessionNotesAction } from '../session-notes-route.js';

/**
 * Long-lived client for the MCP backend's JSON-lines control channel
 * (127.0.0.1:31414 by default). Speaks the same newline-delimited protocol the
 * mcp-server wrapper uses:
 *
 *   request  → {"id","method":"call_tool","params":{"name","args"}}\n
 *   response ← {"id","result":{...}} | {"id","error":{"message"}}\n
 *
 * A successful `call_tool` wraps the tool output as
 *   { content: [{ type: "text", text: "<json-or-plain>" }], isError?: true }
 * so `callTool` unwraps `content[0].text` and JSON-parses it when possible.
 *
 * The backend cycles and restarts frequently and can go HALF-OPEN (the TCP
 * connection stays ESTABLISHED while the process is dead or wedged). The client
 * is built to detect and recover from that, not just from clean disconnects:
 *
 *   - TCP keepalive + a connect timeout so the OS/handshake can't wedge us.
 *   - An application-level heartbeat (`ping`) that force-reconnects on silence.
 *   - A request timeout that tears the socket down (not just rejects one call),
 *     so a stalled channel reconnects instead of looping 15s timeouts forever.
 *   - A liveness-aware `isConnected` so consumers never trust a stale "up".
 *
 * Read-only and never spawns a backend — it is a pure client and reconnects
 * with backoff whenever the socket drops.
 *
 * Emits: `connected`, `disconnected` (Error).
 */

const MAX_BUFFER_BYTES = 1_000_000;

/** The control channel/transport failed (down, write error, protocol error). */
export class ChannelError extends Error {
  /** A stable refusal reason when the bridge method gives one (`session_notes`). */
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ChannelError';
    this.code = code;
  }
}

/** A request exceeded its timeout — strong evidence the channel is dead/half-open. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** The backend executed the tool but it reported an error (e.g. Foundry not connected). */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly toolName: string
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

// ControlResponse and ToolResultPayload are imported from @gnuminator/shared —
// the single source of truth for the §3a control-channel frame shapes.

export interface McpControlClientOptions {
  host: string;
  port: number;
  logger: Logger;
  /** Per-request reply timeout. A timeout tears the socket down. */
  requestTimeoutMs?: number;
  /** Bound on the TCP handshake so a wedged backend can't hang us at connect. */
  connectTimeoutMs?: number;
  /** Heartbeat ping cadence once connected. */
  heartbeatIntervalMs?: number;
  /** Consecutive heartbeat failures before forcing a reconnect. */
  maxHeartbeatFailures?: number;
  /** TCP keepalive initial delay. */
  keepAliveMs?: number;
  /** Window after the last successful activity before `isConnected` reports stale. */
  stalenessThresholdMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

export class McpControlClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = '';
  private connected = false;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatFailures = 0;
  private lastActivityAt = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly logger: Logger;
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly maxHeartbeatFailures: number;
  private readonly keepAliveMs: number;
  private readonly stalenessThresholdMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;

  constructor(private readonly options: McpControlClientOptions) {
    super();
    this.logger = options.logger.child('control');
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10000;
    this.maxHeartbeatFailures = options.maxHeartbeatFailures ?? 2;
    this.keepAliveMs = options.keepAliveMs ?? 10000;
    this.stalenessThresholdMs = options.stalenessThresholdMs ?? 30000;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 5000;
  }

  /**
   * Liveness-aware: true only while the socket is connected AND we have seen a
   * response within the staleness window. A half-open socket that has gone quiet
   * reports false so consumers stop trusting a dead channel.
   */
  get isConnected(): boolean {
    return this.connected && Date.now() - this.lastActivityAt < this.stalenessThresholdMs;
  }

  /** Begin connecting (and keep reconnecting until `close()`). */
  start(): void {
    this.stopped = false;
    this.openSocket();
  }

  /** Stop the client: cancel reconnects, reject in-flight calls, destroy socket. */
  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.rejectAll(new ChannelError('Control client closed'));
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  /** Health check used by the heartbeat. */
  async ping(): Promise<boolean> {
    const result = (await this.send('ping')) as { ok?: boolean } | undefined;
    return result?.ok === true;
  }

  /** List the tools the backend exposes. */
  async listTools(): Promise<unknown[]> {
    const result = (await this.send('list_tools')) as { tools?: unknown[] } | undefined;
    return result?.tools ?? [];
  }

  /**
   * Hand a batch of usage events (I-084, already sanitized) to the bridge's usage log. An old
   * backend answers "Unknown method" (a ChannelError); callers decide what to do with that.
   */
  async recordUsage(events: UsageEvent[]): Promise<RecordUsageResult> {
    const result = (await this.send('record_usage', { events })) as
      | Partial<RecordUsageResult>
      | undefined;
    return {
      accepted: typeof result?.accepted === 'number' ? result.accepted : 0,
      dropped: typeof result?.dropped === 'number' ? result.dropped : 0,
    };
  }

  /**
   * The live write sweep's helper (I-016): `snapshot` (scene lighting), `combat` (start a
   * combat with `tokenIds`) or `cleanup` (delete the documents named "AI Tool Sweep ..." and
   * the chat messages and combats created since `since`, in ms). The module refuses outside
   * the test world.
   */
  async liveSweep(request: Record<string, unknown>): Promise<unknown> {
    return this.send('live_sweep', request);
  }

  /**
   * Ready for session (D3, PB-17): read (`get`), turn on (`ready`) or turn back off (`end`)
   * the module's session switches. A control method, never an MCP tool. An old backend
   * answers "Unknown method" (a ChannelError).
   */
  async sessionSwitches(action: 'get' | 'ready' | 'end'): Promise<unknown> {
    return this.send('session_switches', { action });
  }

  /**
   * My character (I-096): the sheets of the characters a player owns. A control method, never
   * an MCP tool; the dashboard passes the user id it mapped from the player's link key.
   */
  async characterSheet(userId: string): Promise<unknown> {
    return this.send('character_sheet', { userId });
  }

  /**
   * The feature cards (I-064): every feature switch with its state and "Allow Write
   * Operations". Read-only; a control method, never an MCP tool.
   */
  async featureSwitches(): Promise<unknown> {
    return this.send('feature_switches');
  }

  /**
   * Session notes (recap lane, D-087): `list`, `get`, `put` or `approve`. A control method,
   * never an MCP tool; a refusal is a ChannelError with a `code`. An old backend answers
   * "Unknown method".
   */
  async sessionNotes(
    action: SessionNotesAction,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    return this.send('session_notes', { ...params, action });
  }

  /**
   * A player opened a handout on /player (I-039): the bridge keeps the first
   * open per player. An old backend answers "Unknown method" (a ChannelError).
   */
  async recordHandoutSeen(
    pageId: string,
    userId: string,
    name: string
  ): Promise<{ recorded: boolean }> {
    const result = (await this.send('record_handout_seen', { pageId, userId, name })) as
      | { recorded?: unknown }
      | undefined;
    return { recorded: result?.recorded === true };
  }

  /**
   * Invoke a backend tool and return its (JSON-parsed) result. Throws a typed
   * error: ToolError if the tool reported a failure, TimeoutError on a stalled
   * channel, ChannelError if the channel is down.
   */
  async callTool<T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
    options: { timeoutMs?: number } = {}
  ): Promise<T> {
    const payload = (await this.send('call_tool', { name, args }, options.timeoutMs)) as
      | ToolResultPayload
      | undefined;
    const text = payload?.content?.[0]?.text;

    if (payload?.isError) {
      throw new ToolError(
        typeof text === 'string' ? text : `Tool "${name}" reported an error`,
        name
      );
    }
    if (typeof text !== 'string') {
      return payload as unknown as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      // Some tools return a plain string rather than serialized JSON.
      return text as unknown as T;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * `timeoutMs` above the default is for calls known to be slow (a guarded write
   * waits up to about 4 minutes for Foundry). Such a call timing out does not
   * prove the channel is dead, so it does not tear the socket down; the
   * heartbeat still does that for a truly dead channel.
   */
  private send(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs: number = this.requestTimeoutMs
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new ChannelError('Control channel not connected'));
        return;
      }

      const id = `cogm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const request: { id: string; method: string; params?: Record<string, unknown> } = {
        id,
        method,
      };
      if (params !== undefined) request.params = params;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(`Request "${method}" timed out after ${timeoutMs}ms`));
        // A reply never came on a socket we believe is up — the channel is
        // almost certainly dead/half-open. Tear it down so we reconnect instead
        // of looping per-request timeouts against a corpse.
        if (this.connected && timeoutMs <= this.requestTimeoutMs) {
          this.failConnection(new TimeoutError(`Control channel timeout on "${method}"`));
        }
      }, timeoutMs);
      timer.unref();

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.socket.write(`${JSON.stringify(request)}\n`, 'utf8');
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        const err = error instanceof Error ? error : new Error('Write failed');
        reject(new ChannelError(err.message));
        // A synchronous write throw means the stream is broken — recover the
        // whole channel rather than only this one request.
        if (this.connected) this.failConnection(err);
      }
    });
  }

  private openSocket(): void {
    if (this.stopped || this.socket) return;

    const { host, port } = this.options;
    const socket = net.createConnection({ host, port });
    // Assign eagerly so the re-entrancy guard above and close() both see the
    // in-flight connecting socket (otherwise it leaks / can resurrect a closed
    // client when it finally connects).
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setNoDelay(true);

    // Bound the TCP handshake; cleared on connect so it can't double as an idle
    // timeout afterwards (liveness post-connect is keepalive + heartbeat).
    socket.setTimeout(this.connectTimeoutMs);
    socket.once('timeout', () => {
      socket.destroy(new Error('Control channel connect timeout'));
    });

    socket.on('connect', () => {
      if (this.stopped) {
        socket.destroy();
        return;
      }
      socket.setTimeout(0);
      socket.setKeepAlive(true, this.keepAliveMs);
      this.connected = true;
      this.reconnectAttempt = 0;
      this.buffer = '';
      this.lastActivityAt = Date.now();
      this.heartbeatFailures = 0;
      this.startHeartbeat(socket);
      this.logger.info('Connected to MCP control channel', { host, port });
      this.emit('connected');
    });

    socket.on('data', (chunk: string) => this.onData(chunk));

    socket.on('error', error => {
      // `close` will follow; just record the reason for the reconnect log.
      this.logger.debug('Control socket error', { error: error.message });
    });

    socket.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;
      this.stopHeartbeat();
      socket.removeAllListeners();
      this.rejectAll(new ChannelError('Control channel disconnected'));
      if (wasConnected) {
        this.emit('disconnected', new ChannelError('Control channel disconnected'));
      }
      this.scheduleReconnect();
    });
  }

  /** Idempotent teardown: destroying the socket routes through the close path. */
  private failConnection(reason: Error): void {
    const socket = this.socket;
    if (socket && !socket.destroyed) {
      socket.destroy(reason);
    } else {
      // Nothing live to destroy — make sure a reconnect is armed anyway.
      this.scheduleReconnect();
    }
  }

  private startHeartbeat(socket: net.Socket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // Only probe the socket this heartbeat belongs to.
      if (this.socket !== socket) {
        this.stopHeartbeat();
        return;
      }
      this.ping()
        .then(ok => {
          if (ok) {
            this.heartbeatFailures = 0;
          } else if (++this.heartbeatFailures >= this.maxHeartbeatFailures) {
            this.logger.warn('Control heartbeat failing, forcing reconnect');
            this.failConnection(new ChannelError('Heartbeat failed'));
          }
        })
        .catch(() => {
          if (++this.heartbeatFailures >= this.maxHeartbeatFailures) {
            this.logger.warn('Control heartbeat timed out, forcing reconnect');
            this.failConnection(new ChannelError('Heartbeat timeout'));
          }
        });
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.heartbeatFailures = 0;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(
      this.reconnectBaseMs * Math.pow(1.6, this.reconnectAttempt),
      this.reconnectMaxMs
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
    this.reconnectTimer.unref();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      this.logger.warn('Control buffer overflow, resetting connection');
      this.buffer = '';
      this.failConnection(new ChannelError('Control buffer overflow'));
      return;
    }

    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;

      let message: ControlResponse;
      try {
        message = JSON.parse(line) as ControlResponse;
      } catch (error) {
        this.logger.debug('Failed to parse control line', { error: (error as Error).message });
        continue;
      }

      // Any well-formed frame is proof of life.
      this.lastActivityAt = Date.now();

      if (message.id === undefined) {
        // Protocol-level error with no id to correlate (e.g. bad request).
        this.logger.debug('Uncorrelated control message', { error: message.error?.message });
        continue;
      }

      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);

      if (message.error) {
        pending.reject(
          new ChannelError(message.error.message ?? 'Unknown control error', message.error.code)
        );
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
