import {
  MODULE_ID,
  CONNECTION_STATES,
  BRIDGE_CAPABILITY_MODULE_REQUEST,
  BRIDGE_CAPABILITY_MODULE_REQUEST_TOOL_PREFIX,
  BRIDGE_HELLO_TYPE,
  BRIDGE_TOO_OLD_MESSAGE,
  MODULE_HELLO_TYPE,
  MODULE_REPLY_TYPE,
  MODULE_REQUEST_LEGACY_TOOLS,
  MODULE_REQUEST_TYPE,
  RECONNECT_BACKOFF,
  type ModuleHelloData,
  type ModuleRequester,
} from './constants.js';
import { bridgeHandlers } from './bridge-handlers.js';

export interface BridgeConfig {
  enabled: boolean;
  serverHost: string;
  serverPort: number;
  namespace: string;
  /** Unused since lane 1: the bridge reconnects forever. Kept so old configs still type-check. */
  reconnectAttempts: number;
  reconnectDelay: number;
  connectionTimeout: number;
  debugLogging: boolean;
  /**
   * Read live before every reconnect: false means a dropped (or failed) link is
   * not retried until someone calls `connect()` again. Default: on.
   */
  autoReconnect?: () => boolean;
  /** Builds the `module-hello` frame sent right after the link opens (PB-02). */
  getHello?: () => ModuleHelloData;
}

/**
 * Delay before reconnect attempt number `attempt` (0 based): 1 s doubling to a
 * 30 s cap, plus up to 20 % random jitter.
 */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(
    RECONNECT_BACKOFF.BASE_MS * Math.pow(2, Math.min(Math.max(attempt, 0), 16)),
    RECONNECT_BACKOFF.CAP_MS
  );
  // Jitter only shortens the wait, so no retry is ever more than CAP_MS apart.
  return Math.round(base * (1 - random() * RECONNECT_BACKOFF.JITTER));
}

/** How long a module-initiated request waits for the backend's reply. */
export const MODULE_REQUEST_TIMEOUT_MS = 30_000;

/** How long a request waits for the bridge's `bridge-hello` before it calls the bridge too old. */
export const BRIDGE_HELLO_WAIT_MS = 1_500;

interface PendingModuleRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Browser-compatible socket bridge: one WebSocket link to the backend
 */
export class SocketBridge {
  private ws: WebSocket | null = null;
  private connectionState: string = CONNECTION_STATES.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  /** Set by `disconnect()`: the owner closed the link on purpose, so nothing reconnects. */
  private stopped = false;
  private activeConnectionType: 'websocket' | null = null;
  /** Module-initiated requests waiting for their `module-reply` (I-108). */
  private pendingRequests = new Map<string, PendingModuleRequest>();
  private requestSeq = 0;
  /** What the linked bridge says it understands; null until its `bridge-hello` (an old bridge never sends one). */
  private bridgeCapabilities: ReadonlySet<string> | null = null;
  private bridgeHelloWaiters = new Set<() => void>();

  constructor(private config: BridgeConfig) {}

  async connect(): Promise<void> {
    if (
      this.connectionState === CONNECTION_STATES.CONNECTED ||
      this.connectionState === CONNECTION_STATES.CONNECTING
    ) {
      return;
    }

    // An explicit connect (or the reconnect timer firing) replaces any pending timer.
    this.clearReconnectTimer();
    this.stopped = false;
    this.connectionState = CONNECTION_STATES.CONNECTING;
    this.log('Connecting to MCP server...');

    await this.connectWebSocket();
  }

  private async connectWebSocket(): Promise<void> {
    this.activeConnectionType = 'websocket';

    const protocol = 'ws';
    const host = this.config.serverHost;
    this.log(`Using WebSocket (${protocol}://${host}:${this.config.serverPort})`);

    const wsUrl = `${protocol}://${host}:${this.config.serverPort}${this.config.namespace}`;

    return new Promise((resolve, reject) => {
      let ws!: WebSocket;
      // A socket that is no longer this bridge's current one must not touch its state.
      const isCurrent = (): boolean => this.ws === ws;

      const connectTimeout = setTimeout(() => {
        if (!isCurrent()) return;
        this.log('Connection timeout');
        this.ws = null;
        this.rejectPendingRequests('Connection closed');
        try {
          ws.close();
        } catch {
          // Already closed.
        }
        this.connectionState = CONNECTION_STATES.DISCONNECTED;
        this.scheduleReconnect();
        reject(new Error('Connection timeout'));
      }, this.config.connectionTimeout * 1000);

      try {
        ws = new WebSocket(wsUrl);
        this.ws = ws;

        ws.onopen = () => {
          if (!isCurrent()) return;
          clearTimeout(connectTimeout);
          this.connectionState = CONNECTION_STATES.CONNECTED;
          this.reconnectAttempts = 0;
          this.bridgeCapabilities = null;
          this.log('Connected to MCP server via WebSocket');
          this.setupEventHandlers();
          this.sendHello();
          resolve();
        };

        ws.onerror = error => {
          clearTimeout(connectTimeout);
          if (!isCurrent()) return;
          // Use more informative message for connection failures
          const isFirstAttempt = this.reconnectAttempts === 0;
          const errorMsg = isFirstAttempt
            ? "MCP server not available (this is normal if server isn't running)"
            : `Connection error after ${this.reconnectAttempts} attempts: ${error instanceof Error ? error.message : 'connection failed'}`;
          this.log(errorMsg);
          this.linkDown();
          reject(new Error('WebSocket connection failed'));
        };

        ws.onclose = event => {
          clearTimeout(connectTimeout);
          if (!isCurrent()) return;
          this.log(`Disconnected: ${event.reason || 'Connection closed'}`);
          // Error and close both fire for one failed connect: linkDown() keeps to a
          // single timer and a single count. A close we did not start (even a clean
          // one, such as the backend shutting down) is retried.
          this.linkDown();
          // Safety net for a close before open (no-op after the promise settled).
          reject(new Error('WebSocket closed'));
        };
      } catch (error) {
        clearTimeout(connectTimeout);
        this.log(`Failed to create WebSocket: ${error}`);
        this.ws = null;
        this.connectionState = CONNECTION_STATES.DISCONNECTED;
        this.scheduleReconnect();
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.stopped = true;
    this.clearReconnectTimer();

    if (this.ws) {
      const ws = this.ws;
      this.ws = null; // marks the socket stale: its close event must not reconnect
      ws.close(1000, 'Manual disconnect');
    }

    this.activeConnectionType = null;
    this.connectionState = CONNECTION_STATES.DISCONNECTED;
    this.rejectPendingRequests('Connection closed');
    this.bridgeCapabilities = null;
    this.releaseBridgeHelloWaiters();
    this.log('Disconnected from MCP server');
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        void this.handleMessage(message);
      } catch (error) {
        this.log(`Failed to parse message: ${error}`);
      }
    };
  }

  private async handleMessage(message: any): Promise<void> {
    try {
      if (message.type === 'mcp-query') {
        await this.handleMCPQuery(message.data, response => {
          this.sendMessage({
            type: 'mcp-response',
            id: message.id,
            data: response,
          });
        });
      } else if ((message as { type?: unknown }).type === MODULE_REPLY_TYPE) {
        this.handleModuleReply(message);
      } else if ((message as { type?: unknown }).type === BRIDGE_HELLO_TYPE) {
        this.handleBridgeHello(message);
      } else if (message.type === 'ping') {
        this.sendMessage({
          type: 'pong',
          id: message.id,
          data: { timestamp: Date.now(), status: 'ok' },
        });
      }
    } catch (error) {
      console.error(`[foundry-mcp-bridge] ERROR in handleMessage:`, error);
      this.log(`Error handling message: ${error}`);
    }
  }

  private async handleMCPQuery(data: any, callback: (response: any) => void): Promise<void> {
    try {
      this.log(`Handling MCP query: ${data.method}`);

      // Dispatch from the module-private handler table, never from CONFIG.queries
      // (which any player can reach through Foundry's query relay).
      const queryKey = data.method; // Method already includes full path like 'foundry-mcp-bridge.listActors'
      const handler = typeof queryKey === 'string' ? bridgeHandlers.get(queryKey) : undefined;

      if (!handler) {
        throw new Error(`No handler found for query: ${data.method}`);
      }

      // Execute the query handler
      const result = await handler(data.data || {});

      this.log(`Query completed: ${data.method}`);
      callback({ success: true, data: result });
    } catch (error) {
      this.log(
        `Query failed: ${data.method} - ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Ask the backend to run one of the module-request tools for the Foundry user
   * `requestedBy` and resolve with its result (I-108). Rejects with the backend's
   * error text, when the link closes, or after `timeoutMs`.
   */
  async request(
    tool: string,
    args: Record<string, unknown>,
    requestedBy: ModuleRequester,
    timeoutMs: number = MODULE_REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    if (!this.isConnected() || !this.ws) {
      throw new Error('The AI Tool bridge is not connected');
    }
    // An old bridge never answers a module-request (it would sit until the timeout), so ask first.
    if (this.bridgeCapabilities === null) await this.waitForBridgeHello(BRIDGE_HELLO_WAIT_MS);
    if (!this.isConnected() || !this.ws) {
      throw new Error('The AI Tool bridge is not connected');
    }
    if (!this.bridgeSupportsTool(tool)) {
      throw new Error(BRIDGE_TOO_OLD_MESSAGE);
    }
    const id = `module-req-${++this.requestSeq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`The AI Tool backend did not answer in time (${tool})`));
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer });
      this.sendMessage({ type: MODULE_REQUEST_TYPE, id, data: { tool, args, requestedBy } });
      // sendMessage swallows a send failure; the request then waits for its timeout or the close.
    });
  }

  /**
   * Whether the linked bridge answers `tool`. A bridge that lists `module-request:<tool>`
   * entries is taken at its word; one with only the plain `module-request` capability (the
   * first I-108 build) answers just the legacy tools (the AI changes window). Builds from main
   * between #182 and #184 (06b2348 and 010b3ab, never deployed) send only the plain
   * `module-request` and so land here too: "Update the AI Tool bridge" is correct advice for them.
   */
  private bridgeSupportsTool(tool: string): boolean {
    const caps = this.bridgeCapabilities;
    if (!caps?.has(BRIDGE_CAPABILITY_MODULE_REQUEST)) return false;
    let perTool = false;
    for (const cap of caps) {
      if (cap.startsWith(BRIDGE_CAPABILITY_MODULE_REQUEST_TOOL_PREFIX)) {
        perTool = true;
        break;
      }
    }
    if (!perTool) return (MODULE_REQUEST_LEGACY_TOOLS as readonly string[]).includes(tool);
    return caps.has(`${BRIDGE_CAPABILITY_MODULE_REQUEST_TOOL_PREFIX}${tool}`);
  }

  /** The bridge says what it understands; release any request that waited for it. */
  private handleBridgeHello(message: unknown): void {
    const capabilities = (message as { data?: { capabilities?: unknown } }).data?.capabilities;
    this.bridgeCapabilities = new Set(
      Array.isArray(capabilities) ? capabilities.filter(c => typeof c === 'string') : []
    );
    this.releaseBridgeHelloWaiters();
  }

  private waitForBridgeHello(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      const done = (): void => {
        clearTimeout(timer);
        this.bridgeHelloWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.bridgeHelloWaiters.add(done);
    });
  }

  private releaseBridgeHelloWaiters(): void {
    for (const done of [...this.bridgeHelloWaiters]) done();
  }

  private handleModuleReply(message: unknown): void {
    const frame = message as {
      id?: unknown;
      data?: { success?: unknown; data?: unknown; error?: unknown };
    };
    const id = typeof frame.id === 'string' ? frame.id : '';
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRequests.delete(id);
    if (frame.data?.success === true) {
      pending.resolve(frame.data.data);
    } else {
      const error = frame.data?.error;
      pending.reject(new Error(typeof error === 'string' && error ? error : 'Request failed'));
    }
  }

  private rejectPendingRequests(reason: string): void {
    for (const [id, pending] of [...this.pendingRequests]) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingRequests.delete(id);
    }
  }

  /** The link is down: note it and plan the retry (a pending retry keeps its RECONNECTING state). */
  private linkDown(): void {
    this.rejectPendingRequests('Connection closed');
    this.bridgeCapabilities = null;
    this.releaseBridgeHelloWaiters();
    if (!this.reconnectTimer) this.connectionState = CONNECTION_STATES.DISCONNECTED;
    this.scheduleReconnect();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Schedule the next attempt. Never gives up, but at most one timer exists and
   * a second call while one is pending changes nothing (a failed connect fires
   * both `onerror` and `onclose`).
   */
  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    if (this.config.autoReconnect && !this.config.autoReconnect()) {
      this.log('Auto-reconnect is off; not reconnecting');
      this.connectionState = CONNECTION_STATES.DISCONNECTED;
      return;
    }

    const delay = reconnectDelayMs(this.reconnectAttempts);
    this.reconnectAttempts++;

    this.log(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);
    this.connectionState = CONNECTION_STATES.RECONNECTING;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        // Connection failed, scheduleReconnect will be called again from connect()
      });
    }, delay);
  }

  /** Tell the backend who this browser is (PB-02). Never lets a hello problem break the link. */
  private sendHello(): void {
    if (!this.config.getHello) return;
    try {
      this.sendMessage({ type: MODULE_HELLO_TYPE, data: this.config.getHello() });
    } catch (error) {
      this.log(`Failed to send hello: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private sendMessage(message: any): void {
    if (this.connectionState !== CONNECTION_STATES.CONNECTED) {
      this.log(`Cannot send message - not connected`);
      return;
    }

    try {
      if (this.activeConnectionType === 'websocket' && this.ws) {
        this.ws.send(JSON.stringify(message));
      } else {
        this.log('No active connection to send message');
        return;
      }
      this.log(`Sent message via ${this.activeConnectionType}: ${message.type}`);
    } catch (error) {
      this.log(`Failed to send message: ${error}`);
    }
  }

  emitToServer(event: string, data?: any): void {
    this.sendMessage({
      type: event,
      data,
      timestamp: Date.now(),
    });
  }

  isConnected(): boolean {
    return this.connectionState === CONNECTION_STATES.CONNECTED;
  }

  getConnectionState(): string {
    return this.connectionState;
  }

  getConnectionInfo(): any {
    return {
      type: this.activeConnectionType,
      state: this.connectionState,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: null, // no limit since lane 1 (PB-03)
      config: {
        host: this.config.serverHost,
        port: this.config.serverPort,
        namespace: this.config.namespace,
      },
    };
  }

  private log(message: string): void {
    if (this.config.debugLogging) {
      console.log(`[${MODULE_ID}] Socket Bridge: ${message}`);
    }
  }
}
