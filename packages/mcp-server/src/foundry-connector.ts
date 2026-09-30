import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { ModuleHelloFrameSchema, type ModuleHelloData } from '@gnuminator/shared';
import { Logger } from './logger.js';
import { Config } from './config.js';
import { WebRTCPeer } from './webrtc-peer.js';

export interface FoundryConnectorOptions {
  config: Config['foundry'];
  logger: Logger;
}

/**
 * Interface the Foundry link listens on (WebSocket 31415, WebRTC signaling
 * 31416). Loopback by default: the module runs in the GM's browser on the same
 * machine. Set `FOUNDRY_LINK_HOST` (e.g. `0.0.0.0`) only to let a browser on
 * another machine connect; anything that reaches these ports can drive Foundry.
 */
/** WebRTC signaling port: `FOUNDRY_WEBRTC_PORT`, default 31416 (test setups use another). */
export function foundryWebrtcPort(env: NodeJS.ProcessEnv = process.env): number {
  const port = Number.parseInt(env.FOUNDRY_WEBRTC_PORT ?? '', 10);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 31416;
}

export function foundryLinkBindHost(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.FOUNDRY_LINK_HOST?.trim();
  return host ? host : '127.0.0.1';
}

interface PendingQuery {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  /** The WebSocket the query was sent on (absent for WebRTC). */
  socket?: WebSocket;
}

/** One open module WebSocket and what it told us about itself. */
interface SocketEntry {
  /** Connection order; a higher number is a newer socket. */
  seq: number;
  /** From the `module-hello` frame; null until (or unless) one arrives (older modules). */
  hello: ModuleHelloData | null;
  /** The socket was used for WebRTC signaling only; it never carries queries. */
  signaling: boolean;
}

/** Default query timeout in ms. Writers pass a longer one. */
export const DEFAULT_QUERY_TIMEOUT_MS = 10000;
/** How long the link may stay down before one `link-down` warning is logged. */
export const LINK_DOWN_WARN_MS = 5 * 60 * 1000;
/** How often the link state is re-checked (catches WebRTC drops, which raise no event here). */
const LINK_WATCH_INTERVAL_MS = 5000;

export interface QueryOptions {
  timeoutMs?: number;
}

export class FoundryConnector {
  private wss: WebSocketServer | null = null;
  private httpServer: any;
  private webrtcSignalingServer: any; // Separate HTTP server for WebRTC signaling
  private logger: Logger;
  private config: Config['foundry'];
  private isStarted = false;
  /** The active module socket (the one queries go to); null when none. */
  private foundrySocket: WebSocket | null = null;
  /** Every open module socket (PB-02: several GM browsers may dial the bridge). */
  private sockets = new Map<WebSocket, SocketEntry>();
  private socketSeq = 0;
  private webrtcHello: ModuleHelloData | null = null;
  private webrtcPeer: WebRTCPeer | null = null;
  private activeConnectionType: 'websocket' | 'webrtc' | null = null;
  private pendingQueries = new Map<string, PendingQuery>();
  private queryIdCounter = 0;
  /** Bumped on every new module connection (caches keyed per connection use it). */
  private connectionSerial = 0;
  /** Epoch ms since when no module is connected; null while connected (PB-03). */
  private linkDownSince: number | null = Date.now();
  private linkDownLogged = false;
  private linkDownTimer: NodeJS.Timeout | null = null;
  private linkWatchTimer: NodeJS.Timeout | null = null;

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

    // Create SEPARATE HTTP server for WebRTC signaling (port 31416 unless FOUNDRY_WEBRTC_PORT)
    const WEBRTC_PORT = foundryWebrtcPort();
    this.webrtcSignalingServer = createServer((req, res) => {
      // Set CORS headers for all requests
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      // Handle OPTIONS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Only handle POST to /webrtc-offer
      if (req.method === 'POST' && req.url === '/webrtc-offer') {
        void this.handleWebRTCOfferHTTP(req, res).catch(error => {
          this.logger.error('WebRTC offer handling failed', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        });
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    const bindHost = foundryLinkBindHost();

    // Start WebRTC signaling server
    await new Promise<void>((resolve, reject) => {
      this.webrtcSignalingServer.listen(WEBRTC_PORT, bindHost, () => {
        this.logger.info(`WebRTC signaling server listening on ${bindHost}:${WEBRTC_PORT}`);
        console.error(`[WebRTC] Server started on ${bindHost}:${WEBRTC_PORT}`);
        resolve();
      });
      this.webrtcSignalingServer.on('error', (error: Error) => {
        this.logger.error('Failed to start WebRTC signaling server', error);
        console.error(`[WebRTC] Server error:`, error);
        reject(error);
      });
    });

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

    // Handle WebSocket connections (both signaling and direct WebSocket)
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
    this.sockets.set(ws, { seq: ++this.socketSeq, hello: null, signaling: false });
    this.selectActiveSocket();
    this.syncLinkState();

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
          offer?: unknown;
        };

        // Check if this is WebRTC signaling
        if (message.type === 'webrtc-offer') {
          const entry = this.sockets.get(ws);
          if (entry) entry.signaling = true;
          this.selectActiveSocket();
          await this.handleWebRTCOffer(message.offer, ws);
        } else if (message.type === 'module-hello') {
          this.handleHello(message, ws);
        } else {
          // Regular WebSocket message - process it directly
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

  private handleHello(message: unknown, ws?: WebSocket): void {
    const parsed = ModuleHelloFrameSchema.safeParse(message);
    if (!parsed.success) {
      this.logger.debug('Ignoring invalid module-hello frame');
      return;
    }
    if (!ws) {
      this.webrtcHello = parsed.data.data;
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
   * Active socket: the newest open socket whose hello says `isBridgeUser: true`,
   * else the newest open socket (older modules never send a hello). While a
   * WebRTC connection is established it stays the active transport.
   */
  private selectActiveSocket(): void {
    if (this.activeConnectionType === 'webrtc') return;
    let best: WebSocket | null = null;
    let bestIsBridgeUser = false;
    let bestSeq = -1;
    for (const [ws, entry] of this.sockets) {
      if (ws.readyState !== WebSocket.OPEN || entry.signaling) continue;
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
    for (const [ws, entry] of this.sockets) {
      if (ws.readyState === WebSocket.OPEN && !entry.signaling) n += 1;
    }
    return n;
  }

  private activeHello(): ModuleHelloData | null {
    if (this.activeConnectionType === 'webrtc') return this.webrtcHello;
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

  /** True when a module socket (or the WebRTC peer) can carry queries. */
  private isLinkUp(): boolean {
    if (this.activeConnectionType === 'webrtc') {
      return this.webrtcPeer !== null && this.webrtcPeer.getIsConnected();
    }
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
    if (message.type === 'module-hello') {
      // Only WebRTC reaches here (WebSocket hellos are handled per socket).
      this.handleHello(message);
      return Promise.resolve();
    }

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

  private async handleWebRTCOffer(offer: any, signalingWs: WebSocket): Promise<void> {
    try {
      this.logger.info('Handling WebRTC offer for signaling');

      // Create WebRTC peer
      this.webrtcPeer = new WebRTCPeer({
        config: this.config.webrtc,
        logger: this.logger,
        onMessage: this.handleMessage.bind(this),
      });

      // Handle offer and get answer
      const answer = await this.webrtcPeer.handleOffer(offer);

      // Send answer back via signaling WebSocket
      signalingWs.send(
        JSON.stringify({
          type: 'webrtc-answer',
          answer,
        })
      );

      this.activeConnectionType = 'webrtc';
      this.webrtcHello = null;
      this.connectionSerial += 1;
      this.syncLinkState();
      this.logger.info('WebRTC connection established');

      // Close signaling WebSocket after handshake
      setTimeout(() => {
        signalingWs.close();
      }, 1000);
    } catch (error) {
      this.logger.error('Failed to handle WebRTC offer', error);
      signalingWs.send(
        JSON.stringify({
          type: 'webrtc-error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      );
    }
  }

  private async handleWebRTCOfferHTTP(req: any, res: any): Promise<void> {
    // CRITICAL: Call resume() to enable stream data flow
    req.resume();

    try {
      // Read body using promise wrapper around classic events
      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];

        req.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        req.on('end', () => {
          resolve(Buffer.concat(chunks).toString());
        });

        req.on('error', reject);
      });

      const { offer } = JSON.parse(body);

      if (!offer) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing offer in request body' }));
        return;
      }

      // Create WebRTC peer
      this.webrtcPeer = new WebRTCPeer({
        config: this.config.webrtc,
        logger: this.logger,
        onMessage: this.handleMessage.bind(this),
      });

      // Handle offer and get answer
      const answer = await this.webrtcPeer.handleOffer(offer);

      this.activeConnectionType = 'webrtc';
      this.webrtcHello = null;
      this.connectionSerial += 1;
      this.syncLinkState();
      this.logger.info('WebRTC connection established via HTTP signaling');

      // Send answer back via HTTP response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ answer }));
    } catch (error) {
      this.logger.error('Failed to handle WebRTC offer via HTTP', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      );
    }
  }

  async query(method: string, data?: any, options: QueryOptions = {}): Promise<any> {
    // Check connection based on active connection type
    const isConnected =
      this.activeConnectionType === 'webrtc'
        ? this.webrtcPeer && this.webrtcPeer.getIsConnected()
        : this.foundrySocket && this.foundrySocket.readyState === WebSocket.OPEN;

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

      // Use sendToFoundry to support both WebSocket and WebRTC
      this.sendToFoundry(message);
    });
  }

  sendToFoundry(message: any): void {
    if (this.activeConnectionType === 'webrtc' && this.webrtcPeer) {
      this.webrtcPeer.sendMessage(message);
    } else if (
      this.activeConnectionType === 'websocket' &&
      this.foundrySocket &&
      this.foundrySocket.readyState === WebSocket.OPEN
    ) {
      this.foundrySocket.send(JSON.stringify(message));
    } else {
      throw new Error('Not connected to Foundry VTT module');
    }
  }

  isConnected(): boolean {
    if (!this.isStarted) return false;

    if (this.activeConnectionType === 'webrtc') {
      return this.webrtcPeer !== null && this.webrtcPeer.getIsConnected();
    } else if (this.activeConnectionType === 'websocket') {
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

  getConnectionType(): 'websocket' | 'webrtc' | null {
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
