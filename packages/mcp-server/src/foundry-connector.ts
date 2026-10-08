import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import {
  BRIDGE_CAPABILITY_MODULE_REQUEST,
  BRIDGE_CAPABILITY_MODULE_REQUEST_TOOL_PREFIX,
  BRIDGE_HELLO_TYPE,
  MODULE_NOT_ACTIVE_LINK_ERROR,
  MODULE_REPLY_TYPE,
  MODULE_REQUEST_MAX_ARGS_BYTES,
  MODULE_REQUEST_TOOLS,
  MODULE_REQUEST_TYPE,
  ModuleHelloFrameSchema,
  ModuleRequestFrameSchema,
  type BridgeHelloData,
  type ModuleHelloData,
  type ModuleReplyData,
  type ModuleRequestData,
} from '@gnuminator/shared';
import { Logger } from './logger.js';
import { Config } from './config.js';

export interface FoundryConnectorOptions {
  config: Config['foundry'];
  logger: Logger;
}

/**
 * Interface the Foundry link (WebSocket 31415) listens on. Loopback by default:
 * the module runs in the GM's browser on the same machine. Set
 * `FOUNDRY_LINK_HOST` (e.g. `0.0.0.0`) only to let a browser on another machine
 * connect; anything that reaches this port can drive Foundry.
 */
export function foundryLinkBindHost(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.FOUNDRY_LINK_HOST?.trim();
  return host ? host : '127.0.0.1';
}

interface PendingQuery {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  /** The WebSocket the query was sent on. */
  socket?: WebSocket;
}

/** One open module WebSocket and what it told us about itself. */
interface SocketEntry {
  /** Connection order; a higher number is a newer socket. */
  seq: number;
  /** From the `module-hello` frame; null until (or unless) one arrives (older modules). */
  hello: ModuleHelloData | null;
}

/** Default query timeout in ms. Writers pass a longer one. */
export const DEFAULT_QUERY_TIMEOUT_MS = 10000;
/** How long the link may stay down before one `link-down` warning is logged. */
export const LINK_DOWN_WARN_MS = 5 * 60 * 1000;
/** How often the link state is re-checked. */
const LINK_WATCH_INTERVAL_MS = 5000;

export interface QueryOptions {
  timeoutMs?: number;
}

/**
 * Runs one tool for a `module-request` frame (the backend wires in the same
 * in-process dispatch the control channel's `call_tool` uses, so the connector
 * never imports the tool router). A throw becomes the reply's `error`.
 */
export type ModuleRequestHandler = (
  tool: string,
  args: Record<string, unknown>,
  requestedBy: ModuleRequestData['requestedBy']
) => Promise<unknown>;

export class FoundryConnector {
  private wss: WebSocketServer | null = null;
  private httpServer: any;
  private logger: Logger;
  private config: Config['foundry'];
  private isStarted = false;
  /** The active module socket (the one queries go to); null when none. */
  private foundrySocket: WebSocket | null = null;
  /** Every open module socket (PB-02: several GM browsers may dial the bridge). */
  private sockets = new Map<WebSocket, SocketEntry>();
  private socketSeq = 0;
  private activeConnectionType: 'websocket' | null = null;
  private pendingQueries = new Map<string, PendingQuery>();
  private queryIdCounter = 0;
  /** Bumped on every new module connection (caches keyed per connection use it). */
  private connectionSerial = 0;
  /** Epoch ms since when no module is connected; null while connected (PB-03). */
  private linkDownSince: number | null = Date.now();
  private linkDownLogged = false;
  private linkDownTimer: NodeJS.Timeout | null = null;
  private linkWatchTimer: NodeJS.Timeout | null = null;
  private moduleRequestHandler: ModuleRequestHandler | null = null;

  constructor({ config, logger }: FoundryConnectorOptions) {
    this.config = config;
    this.logger = logger.child({ component: 'FoundryConnector' });
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.debug('Foundry connector already started');
      return;
    }

    this.logger.info('Starting Foundry connector WebSocket server', {
      port: this.config.port,
      protocol: this.config.protocol || 'ws',
      remoteMode: this.config.remoteMode || false,
    });

    // Create HTTP server for WebSocket connections
    this.httpServer = createServer((req, res) => {
      res.writeHead(404);
      res.end();
    });

    const bindHost = foundryLinkBindHost();

    // Create WebSocket server in noServer mode to avoid request consumption
    this.wss = new WebSocketServer({ noServer: true });

    // Manually handle upgrade for WebSocket connections
    this.httpServer.on('upgrade', (req: any, socket: any, head: any) => {
      const pathname = req.url || '/';

      // Only upgrade if path matches WebSocket namespace
      if (pathname === (this.config.namespace || '/')) {
        this.wss?.handleUpgrade(req, socket, head, ws => {
          this.wss?.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    // Handle WebSocket connections
    this.wss.on('connection', ws => this.attachSocket(ws));

    // Start the HTTP server
    await new Promise<void>((resolve, reject) => {
      this.httpServer.listen(this.config.port, bindHost, () => {
        this.isStarted = true;
        this.startLinkWatch();
        this.logger.info('Foundry connector listening', { host: bindHost, port: this.config.port });
        resolve();
      });

      this.httpServer.on('error', (error: Error) => {
        this.logger.error('Failed to start Foundry connector', error);
        reject(error);
      });
    });
  }

  /**
   * Register a module WebSocket (called for every connection). Every open
   * socket is kept; `selectActiveSocket` picks the one queries go to.
   */
  attachSocket(ws: WebSocket): void {
    this.logger.info('Client connected via WebSocket');

    // Register the connection immediately on connect, not on first message
    // This fixes Issue #19: WebSocket handshake deadlock where both sides
    // waited for the other to send a message first
    this.sockets.set(ws, { seq: ++this.socketSeq, hello: null });
    this.selectActiveSocket();
    this.syncLinkState();
    this.sendBridgeHello(ws);

    ws.on('close', () => {
      this.logger.info('Client disconnected');
      this.sockets.delete(ws);
      // Queries sent on this socket can never be answered.
      this.rejectPending('Connection closed', p => p.socket === ws);
      this.selectActiveSocket();
      this.syncLinkState();
    });

    const onWsMessage = async (data: unknown): Promise<void> => {
      try {
        const message = JSON.parse((data as Buffer).toString()) as {
          type?: string;
        };

        if (message.type === 'module-hello') {
          this.handleHello(message, ws);
        } else if (message.type === MODULE_REQUEST_TYPE) {
          await this.handleModuleRequest(message, ws);
        } else {
          await this.handleMessage(message);
        }
      } catch (error) {
        this.logger.error('Failed to parse message', error);
      }
    };
    ws.on('message', data => void onWsMessage(data));

    ws.on('error', error => {
      this.logger.error('WebSocket error', error);
    });
  }

  private handleHello(message: unknown, ws: WebSocket): void {
    const parsed = ModuleHelloFrameSchema.safeParse(message);
    if (!parsed.success) {
      this.logger.debug('Ignoring invalid module-hello frame');
      return;
    }
    const entry = this.sockets.get(ws);
    if (!entry) return;
    entry.hello = parsed.data.data;
    this.logger.info('Foundry module hello', {
      userName: entry.hello.userName,
      isBridgeUser: entry.hello.isBridgeUser,
      moduleVersion: entry.hello.moduleVersion,
    });
    this.selectActiveSocket();
  }

  /**
   * Tell a module socket what this bridge understands, so a new module can fail
   * fast against an older bridge (which never sends this). Older modules ignore it.
   */
  private sendBridgeHello(ws: WebSocket): void {
    // `module-request` plus one `module-request:<tool>` per tool this bridge answers, so a module
    // can tell "tool not served by this (older) bridge" from "tool not allowed".
    const data: BridgeHelloData = {
      capabilities: [
        BRIDGE_CAPABILITY_MODULE_REQUEST,
        ...MODULE_REQUEST_TOOLS.map(
          tool => `${BRIDGE_CAPABILITY_MODULE_REQUEST_TOOL_PREFIX}${tool}`
        ),
      ],
    };
    try {
      ws.send(JSON.stringify({ type: BRIDGE_HELLO_TYPE, data }));
    } catch (error) {
      this.logger.debug('Could not send bridge-hello', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Set the dispatcher for `module-request` frames (see {@link ModuleRequestHandler}). */
  setModuleRequestHandler(handler: ModuleRequestHandler | null): void {
    this.moduleRequestHandler = handler;
  }

  /**
   * A `module-request` frame: the bridge-linked browser asks for one of a short
   * list of tools on behalf of a GM's Foundry window. The active socket may ask, and so
   * may any other socket whose hello says `isBridgeUser: true` and names the active socket's
   * world (in Any-GM mode every GM tab does, and Foundry may hand the request to any tab of
   * the same user). A socket without a hello (an older module), with `isBridgeUser: false`
   * or from another world is refused with
   * MODULE_NOT_ACTIVE_LINK_ERROR. The answer goes back on the same socket as a
   * `module-reply`; the tools still run through the active socket.
   */
  private async handleModuleRequest(message: unknown, ws: WebSocket): Promise<void> {
    const parsed = ModuleRequestFrameSchema.safeParse(message);
    if (!parsed.success) {
      const id = (message as { id?: unknown }).id;
      if (typeof id === 'string' && id.length > 0 && id.length <= 100) {
        this.replyToModule(ws, id, { success: false, error: 'Invalid module request' });
      } else {
        this.logger.debug('Ignoring invalid module-request frame');
      }
      return;
    }
    const { id, data } = parsed.data;
    const requestedBy = data.requestedBy.userName || data.requestedBy.userId;
    this.logger.info('Module request', { tool: data.tool, requestedBy });

    // A non-active socket is served only when its hello says it is a bridge user of the same
    // world as the active link.
    const hello = this.sockets.get(ws)?.hello;
    const servedNonActive =
      hello?.isBridgeUser === true && hello.worldId === this.activeHello()?.worldId;
    if (ws !== this.foundrySocket && !servedNonActive) {
      this.replyToModule(ws, id, { success: false, error: MODULE_NOT_ACTIVE_LINK_ERROR });
      return;
    }
    if (!(MODULE_REQUEST_TOOLS as readonly string[]).includes(data.tool)) {
      this.replyToModule(ws, id, {
        success: false,
        error: `Tool not allowed for module requests: ${data.tool}`,
      });
      return;
    }
    if (Buffer.byteLength(JSON.stringify(data.args), 'utf8') > MODULE_REQUEST_MAX_ARGS_BYTES) {
      this.replyToModule(ws, id, { success: false, error: 'Request arguments are too large' });
      return;
    }
    if (!this.moduleRequestHandler) {
      this.replyToModule(ws, id, { success: false, error: 'Module requests are not available' });
      return;
    }
    try {
      const result = await this.moduleRequestHandler(data.tool, data.args, data.requestedBy);
      this.replyToModule(ws, id, { success: true, data: result });
    } catch (error) {
      this.replyToModule(ws, id, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  }

  private replyToModule(ws: WebSocket, id: string, data: ModuleReplyData): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: MODULE_REPLY_TYPE, id, data }));
    } catch (error) {
      this.logger.warn('Could not send module-reply', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Active socket: the newest open socket whose hello says `isBridgeUser: true`,
   * else the newest open socket (older modules never send a hello).
   */
  private selectActiveSocket(): void {
    let best: WebSocket | null = null;
    let bestIsBridgeUser = false;
    let bestSeq = -1;
    for (const [ws, entry] of this.sockets) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const isBridgeUser = entry.hello?.isBridgeUser === true;
      if (
        best === null ||
        (isBridgeUser && !bestIsBridgeUser) ||
        (isBridgeUser === bestIsBridgeUser && entry.seq > bestSeq)
      ) {
        best = ws;
        bestIsBridgeUser = isBridgeUser;
        bestSeq = entry.seq;
      }
    }
    if (best === this.foundrySocket) {
      if (!best && this.activeConnectionType === 'websocket') this.activeConnectionType = null;
      return;
    }
    this.foundrySocket = best;
    if (best) {
      this.activeConnectionType = 'websocket';
      this.connectionSerial += 1;
      this.logger.info('Foundry module registered via WebSocket', {
        sockets: this.openSocketCount(),
      });
    } else if (this.activeConnectionType === 'websocket') {
      this.activeConnectionType = null;
    }
  }

  private openSocketCount(): number {
    let n = 0;
    for (const ws of this.sockets.keys()) {
      if (ws.readyState === WebSocket.OPEN) n += 1;
    }
    return n;
  }

  /**
   * Whether the active socket's `module-hello` lists `capability`. False with no active
   * socket, no hello (an older module) or a hello without capabilities.
   */
  activeModuleHasCapability(capability: string): boolean {
    return this.activeHello()?.capabilities?.includes(capability) === true;
  }

  private activeHello(): ModuleHelloData | null {
    return this.foundrySocket ? (this.sockets.get(this.foundrySocket)?.hello ?? null) : null;
  }

  private rejectPending(reason: string, filter?: (p: PendingQuery) => boolean): void {
    for (const [id, pending] of [...this.pendingQueries]) {
      if (filter && !filter(pending)) continue;
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
      this.pendingQueries.delete(id);
    }
  }

  // -------------------------------------------------------------------------
  // Link state (PB-03): linkDownSince plus one link-down / link-up log line
  // -------------------------------------------------------------------------

  private startLinkWatch(): void {
    if (this.linkWatchTimer) return;
    if (this.linkDownSince !== null) this.linkDownSince = Date.now();
    this.linkWatchTimer = setInterval(() => this.syncLinkState(), LINK_WATCH_INTERVAL_MS);
    this.linkWatchTimer.unref?.();
    this.syncLinkState();
  }

  private syncLinkState(): void {
    if (this.isLinkUp()) {
      if (this.linkDownSince === null) return;
      const downMs = Date.now() - this.linkDownSince;
      this.linkDownSince = null;
      this.clearLinkDownTimer();
      if (this.linkDownLogged) {
        this.linkDownLogged = false;
        this.logger.info('link-up', { event: 'link-up', downMs });
      }
      return;
    }
    if (this.linkDownSince === null) this.linkDownSince = Date.now();
    if (!this.linkDownLogged && !this.linkDownTimer) {
      const remaining = Math.max(0, LINK_DOWN_WARN_MS - (Date.now() - this.linkDownSince));
      this.linkDownTimer = setTimeout(() => {
        this.linkDownTimer = null;
        this.warnIfStillDown();
      }, remaining);
      this.linkDownTimer.unref?.();
    }
  }

  private warnIfStillDown(): void {
    if (this.isLinkUp() || this.linkDownSince === null || this.linkDownLogged) return;
    this.linkDownLogged = true;
    this.logger.warn('link-down', {
      event: 'link-down',
      since: new Date(this.linkDownSince).toISOString(),
    });
  }

  private clearLinkDownTimer(): void {
    if (this.linkDownTimer) clearTimeout(this.linkDownTimer);
    this.linkDownTimer = null;
  }

  /** True when a module socket can carry queries. */
  private isLinkUp(): boolean {
    if (this.activeConnectionType === 'websocket') {
      return this.foundrySocket !== null && this.foundrySocket.readyState === WebSocket.OPEN;
    }
    return false;
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    this.logger.info('Stopping Foundry connector...');

    // Reject all pending queries
    this.rejectPending('Server shutting down');

    if (this.linkWatchTimer) clearInterval(this.linkWatchTimer);
    this.linkWatchTimer = null;
    this.clearLinkDownTimer();

    for (const ws of this.sockets.keys()) {
      try {
        ws.close();
      } catch {
        // already closing
      }
    }
    this.sockets.clear();
    this.foundrySocket = null;

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (this.httpServer) {
      await new Promise<void>(resolve => {
        this.httpServer.close(() => {
          resolve();
        });
      });
      this.httpServer = null;
    }

    this.isStarted = false;
    this.logger.info('Foundry connector stopped');
  }

  private handleMessage(message: any): Promise<void> {
    if (message.type === 'mcp-response' && message.id) {
      const pending = this.pendingQueries.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingQueries.delete(message.id);

        if (message.data.success) {
          this.logger.debug('Query response received', {
            id: message.id,
            hasData: !!message.data.data,
          });
          pending.resolve(message.data.data);
        } else {
          this.logger.error('Query failed', { id: message.id, error: message.data.error });
          pending.reject(new Error(message.data.error || 'Query failed'));
        }
      }
      return Promise.resolve();
    }

    if (message.type === 'pong') {
      const pending = this.pendingQueries.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingQueries.delete(message.id);
        pending.resolve(message.data);
      }
      return Promise.resolve();
    }

    this.logger.debug('Received unknown message type', { type: message.type });
    return Promise.resolve();
  }

  async query(method: string, data?: any, options: QueryOptions = {}): Promise<any> {
    const isConnected = this.foundrySocket?.readyState === WebSocket.OPEN;

    if (!isConnected) {
      throw new Error('Not connected to Foundry VTT module');
    }

    const queryId = `query-${++this.queryIdCounter}`;
    this.logger.debug('Sending query to Foundry', {
      method,
      data,
      queryId,
      connectionType: this.activeConnectionType,
    });

    const timeoutMs =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_QUERY_TIMEOUT_MS;
    const socket =
      this.activeConnectionType === 'websocket' && this.foundrySocket
        ? this.foundrySocket
        : undefined;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingQueries.delete(queryId);
        reject(new Error(`Query timeout: ${method}`));
      }, timeoutMs);

      this.pendingQueries.set(queryId, {
        resolve,
        reject,
        timeout,
        ...(socket ? { socket } : {}),
      });

      const message = {
        type: 'mcp-query',
        id: queryId,
        data: { method, data },
      };

      this.sendToFoundry(message);
    });
  }

  sendToFoundry(message: any): void {
    if (
      this.activeConnectionType === 'websocket' &&
      this.foundrySocket?.readyState === WebSocket.OPEN
    ) {
      this.foundrySocket.send(JSON.stringify(message));
    } else {
      throw new Error('Not connected to Foundry VTT module');
    }
  }

  isConnected(): boolean {
    if (!this.isStarted) return false;

    if (this.activeConnectionType === 'websocket') {
      return this.foundrySocket !== null && this.foundrySocket.readyState === WebSocket.OPEN;
    }

    return false;
  }

  /** Identifies the current module connection; changes on every reconnect. */
  getConnectionSerial(): number {
    return this.connectionSerial;
  }

  getConnectionInfo(): any {
    return {
      started: this.isStarted,
      connected: this.isConnected(),
      connectionType: this.activeConnectionType,
      readyState: this.foundrySocket?.readyState ?? 'CLOSED',
      userName: this.activeHello()?.userName ?? null,
      moduleVersion: this.activeHello()?.moduleVersion ?? null,
      sockets: this.openSocketCount(),
      linkDownSince:
        this.linkDownSince === null ? null : new Date(this.linkDownSince).toISOString(),
      config: {
        port: this.config.port,
        namespace: this.config.namespace,
      },
    };
  }

  getConnectionType(): 'websocket' | null {
    return this.activeConnectionType;
  }

  /**
   * Send a message to the connected Foundry module
   */
  sendMessage(message: any): void {
    if (!this.isConnected()) {
      throw new Error('Not connected to Foundry VTT module');
    }

    try {
      this.sendToFoundry(message);
      this.logger.debug('Sent message to Foundry module', {
        type: message.type,
        connectionType: this.activeConnectionType,
      });
    } catch (error) {
      this.logger.error('Failed to send message to Foundry module', error);
      throw error;
    }
  }

  /**
   * Broadcast a message to all connected Foundry clients (alias for sendMessage for single connection)
   */
  broadcastMessage(message: any): void {
    this.sendMessage(message);
  }
}
