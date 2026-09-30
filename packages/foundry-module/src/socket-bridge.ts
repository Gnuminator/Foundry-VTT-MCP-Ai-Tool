import {
  MODULE_ID,
  CONNECTION_STATES,
  MODULE_HELLO_TYPE,
  RECONNECT_BACKOFF,
  type ModuleHelloData,
} from './constants.js';
import { WebRTCConnection, type WebRTCConfig } from './webrtc-connection.js';
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
  connectionType?: 'auto' | 'webrtc' | 'websocket'; // Connection type: auto (HTTPS→WebRTC, HTTP→WebSocket), webrtc, websocket
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

/**
 * Browser-compatible socket bridge that supports both WebSocket and WebRTC
 */
export class SocketBridge {
  private ws: WebSocket | null = null;
  private webrtc: WebRTCConnection | null = null;
  private connectionState: string = CONNECTION_STATES.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  /** Set by `disconnect()`: the owner closed the link on purpose, so nothing reconnects. */
  private stopped = false;
  private activeConnectionType: 'websocket' | 'webrtc' | null = null;

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

    // Determine connection type
    const connectionType = this.determineConnectionType();
    this.log(`Using connection type: ${connectionType}`);

    if (connectionType === 'webrtc') {
      await this.connectWebRTC();
    } else {
      await this.connectWebSocket();
    }
  }

  private determineConnectionType(): 'websocket' | 'webrtc' {
    const configType = this.config.connectionType || 'auto';

    if (configType === 'auto') {
      // Use WebRTC for HTTPS (secure), WebSocket for HTTP (localhost)
      // WebRTC provides P2P encrypted channel without needing SSL certificates
      const isHttps = window.location.protocol === 'https:';
      const type = isHttps ? 'webrtc' : 'websocket';
      this.log(`Auto-detected connection type: ${type} (page is ${window.location.protocol})`);
      return type;
    }

    // Use explicit connection type from config
    return configType as 'websocket' | 'webrtc';
  }

  private async connectWebRTC(): Promise<void> {
    this.activeConnectionType = 'webrtc';

    const webrtcConfig: WebRTCConfig = {
      serverHost: this.config.serverHost,
      serverPort: this.config.serverPort,
      namespace: this.config.namespace,
      stunServers: [], // Empty for localhost - must match server configuration
      connectionTimeout: this.config.connectionTimeout,
      debugLogging: this.config.debugLogging,
    };

    this.webrtc?.disconnect();
    const conn = new WebRTCConnection(webrtcConfig);
    this.webrtc = conn;

    try {
      await conn.connect(this.handleMessage.bind(this), {
        // The hello goes straight to this channel: it does not wait for the state flip below.
        onOpen: () => {
          if (this.webrtc === conn) this.sendHello(message => conn.sendMessage(message));
        },
        onClose: () => {
          if (this.webrtc !== conn || this.stopped) return;
          this.log('WebRTC link lost');
          this.connectionState = CONNECTION_STATES.DISCONNECTED;
          this.scheduleReconnect();
        },
      });
      if (this.webrtc !== conn || this.stopped) return;
      this.connectionState = CONNECTION_STATES.CONNECTED;
      this.reconnectAttempts = 0;
      this.log('Connected via WebRTC');
    } catch (error) {
      this.log(`WebRTC connection failed: ${error}`);
      conn.disconnect();
      if (this.webrtc === conn) {
        this.webrtc = null;
        this.connectionState = CONNECTION_STATES.DISCONNECTED;
        this.scheduleReconnect();
      }
      throw error;
    }
  }

  private async connectWebSocket(): Promise<void> {
    this.activeConnectionType = 'websocket';

    // WebSocket for HTTP localhost connections only
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

    if (this.webrtc) {
      this.webrtc.disconnect();
      this.webrtc = null;
    }

    if (this.ws) {
      const ws = this.ws;
      this.ws = null; // marks the socket stale: its close event must not reconnect
      ws.close(1000, 'Manual disconnect');
    }

    this.activeConnectionType = null;
    this.connectionState = CONNECTION_STATES.DISCONNECTED;
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

  /** The link is down: note it and plan the retry (a pending retry keeps its RECONNECTING state). */
  private linkDown(): void {
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
  private sendHello(
    send: (message: unknown) => void = (message: unknown): void => this.sendMessage(message)
  ): void {
    if (!this.config.getHello) return;
    try {
      send({ type: MODULE_HELLO_TYPE, data: this.config.getHello() });
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
      if (this.activeConnectionType === 'webrtc' && this.webrtc) {
        this.webrtc.sendMessage(message);
      } else if (this.activeConnectionType === 'websocket' && this.ws) {
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
