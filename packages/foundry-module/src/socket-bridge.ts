import { MODULE_ID, CONNECTION_STATES } from './constants.js';
import { WebRTCConnection, type WebRTCConfig } from './webrtc-connection.js';
import { bridgeHandlers } from './bridge-handlers.js';

export interface BridgeConfig {
  enabled: boolean;
  serverHost: string;
  serverPort: number;
  namespace: string;
  reconnectAttempts: number;
  reconnectDelay: number;
  connectionTimeout: number;
  debugLogging: boolean;
  connectionType?: 'auto' | 'webrtc' | 'websocket'; // Connection type: auto (HTTPS→WebRTC, HTTP→WebSocket), webrtc, websocket
}

/**
 * Browser-compatible socket bridge that supports both WebSocket and WebRTC
 */
export class SocketBridge {
  private ws: WebSocket | null = null;
  private webrtc: WebRTCConnection | null = null;
  private connectionState: string = CONNECTION_STATES.DISCONNECTED;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: any = null;
  private activeConnectionType: 'websocket' | 'webrtc' | null = null;

  constructor(private config: BridgeConfig) {
    this.maxReconnectAttempts = config.reconnectAttempts;
  }

  async connect(): Promise<void> {
    if (
      this.connectionState === CONNECTION_STATES.CONNECTED ||
      this.connectionState === CONNECTION_STATES.CONNECTING
    ) {
      return;
    }

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

    this.webrtc = new WebRTCConnection(webrtcConfig);

    try {
      await this.webrtc.connect(this.handleMessage.bind(this));
      this.connectionState = CONNECTION_STATES.CONNECTED;
      this.reconnectAttempts = 0;
      this.log('Connected via WebRTC');
    } catch (error) {
      this.log(`WebRTC connection failed: ${error}`);
      this.connectionState = CONNECTION_STATES.DISCONNECTED;
      this.scheduleReconnect();
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
      const connectTimeout = setTimeout(() => {
        this.log('Connection timeout');
        this.connectionState = CONNECTION_STATES.DISCONNECTED;
        reject(new Error('Connection timeout'));
      }, this.config.connectionTimeout * 1000);

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          clearTimeout(connectTimeout);
          this.connectionState = CONNECTION_STATES.CONNECTED;
          this.reconnectAttempts = 0;
          this.log('Connected to MCP server via WebSocket');
          this.setupEventHandlers();
          resolve();
        };

        this.ws.onerror = error => {
          clearTimeout(connectTimeout);
          // Use more informative message for connection failures
          const isFirstAttempt = this.reconnectAttempts === 0;
          const errorMsg = isFirstAttempt
            ? "MCP server not available (this is normal if server isn't running)"
            : `Connection error after ${this.reconnectAttempts} attempts: ${error instanceof Error ? error.message : 'connection failed'}`;
          this.log(errorMsg);
          this.connectionState = CONNECTION_STATES.DISCONNECTED;
          this.scheduleReconnect();
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = event => {
          this.log(`Disconnected: ${event.reason || 'Connection closed'}`);
          this.connectionState = CONNECTION_STATES.DISCONNECTED;

          if (event.wasClean) {
            // Clean disconnect, don't reconnect
            return;
          }

          this.scheduleReconnect();
        };
      } catch (error) {
        clearTimeout(connectTimeout);
        this.log(`Failed to create WebSocket: ${error}`);
        this.connectionState = CONNECTION_STATES.DISCONNECTED;
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.webrtc) {
      this.webrtc.disconnect();
      this.webrtc = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Manual disconnect');
      this.ws = null;
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

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log(`Max reconnection attempts reached (${this.maxReconnectAttempts})`);
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Exponential backoff, max 30s
    this.reconnectAttempts++;

    this.log(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);
    this.connectionState = CONNECTION_STATES.RECONNECTING;

    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch(() => {
        // Connection failed, scheduleReconnect will be called again from connect()
      });
    }, delay);
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
      maxReconnectAttempts: this.maxReconnectAttempts,
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
