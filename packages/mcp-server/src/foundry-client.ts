import type {
  BridgeAnswer,
  BridgeMethod,
  BridgeQueryArgs,
  UntypedBridgeMethod,
} from '@gnuminator/shared';
import { Logger } from './logger.js';
import { Config } from './config.js';
import {
  FoundryConnector,
  type ModuleRequestHandler,
  type QueryOptions,
} from './foundry-connector.js';

export interface FoundryQuery {
  method: string;
  data?: unknown;
}

export interface FoundryResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

export class FoundryClient {
  private logger: Logger;
  private config: Config['foundry'];
  private connector: FoundryConnector;

  constructor(config: Config['foundry'], logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'FoundryClient' });

    // Initialize the socket connector
    this.connector = new FoundryConnector({
      config: this.config,
      logger: this.logger,
    });
  }

  async connect(): Promise<void> {
    this.logger.info('Starting Foundry connector socket.io server');

    try {
      // Start the socket.io server that Foundry will connect to
      await this.connector.start();
      this.logger.info('Foundry connector started, waiting for module connection...');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown connection error';
      this.logger.error('Failed to start Foundry connector', { error: errorMessage });
      throw new Error(`Failed to start Foundry connector: ${errorMessage}`);
    }
  }

  disconnect(): void {
    this.logger.info('Stopping Foundry connector...');
    this.connector.stop().catch(error => {
      this.logger.error('Error stopping connector', error);
    });
  }

  getConnectionType(): 'websocket' | null {
    return this.connector.getConnectionType();
  }

  /**
   * Run a bridge query in Foundry. A method of the bridge contract (`shared/src/bridge-queries.ts`)
   * takes its typed request and resolves with its reply or a refusal.
   */
  query<M extends BridgeMethod>(method: M, ...args: BridgeQueryArgs<M>): Promise<BridgeAnswer<M>>;
  /** A method the contract does not type yet (the `src/tools/` queries until the G0 lanes merge). */
  query<M extends string>(
    method: UntypedBridgeMethod<M>,
    data?: unknown,
    options?: QueryOptions // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped until each method joins the contract
  ): Promise<any>;
  async query(method: string, data?: unknown, options?: QueryOptions): Promise<unknown> {
    if (!this.connector.isConnected()) {
      throw new Error(
        'Foundry VTT module not connected. Please ensure Foundry is running and the MCP Bridge module is enabled.'
      );
    }

    this.logger.debug('Sending query to Foundry module', { method, data });

    try {
      const result = await this.connector.query(method, data, options);
      this.logger.debug('Query successful', { method, hasResult: !!result });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown query error';
      this.logger.error('Query failed', { method, error: errorMessage });
      throw new Error(`Query ${method} failed: ${errorMessage}`);
    }
  }

  /** Wire in the dispatcher that answers `module-request` frames from the module. */
  setModuleRequestHandler(handler: ModuleRequestHandler | null): void {
    this.connector.setModuleRequestHandler(handler);
  }

  /** Whether the active module's hello lists `capability` (false for an older module). */
  activeModuleHasCapability(capability: string): boolean {
    return this.connector.activeModuleHasCapability(capability);
  }

  ping(): Promise<any> {
    return this.query('foundry-mcp-bridge.ping');
  }

  getConnectionInfo(): any {
    return this.connector.getConnectionInfo();
  }

  /** Changes on every module (re)connect; use it to scope per-connection caches. */
  getConnectionSerial(): number {
    return this.connector.getConnectionSerial();
  }

  getConnectionState(): string {
    return this.connector.isConnected() ? 'connected' : 'disconnected';
  }

  isReady(): boolean {
    return this.connector.isConnected();
  }

  sendMessage(message: any): void {
    this.logger.debug('Sending message to Foundry', {
      type: message.type,
      requestId: message.requestId,
    });
    this.connector.sendToFoundry(message);
  }

  broadcastMessage(message: any): void {
    this.logger.debug('Broadcasting message to Foundry', { type: message.type });
    this.connector.broadcastMessage(message);
  }

  isConnected(): boolean {
    return this.connector.isConnected();
  }
}
