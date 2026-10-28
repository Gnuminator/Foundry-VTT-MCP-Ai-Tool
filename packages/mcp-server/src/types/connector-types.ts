import type { Config } from '../config.js';

/** A frame sent to the Foundry module; only `type` and `requestId` are read for logging. */
export interface BridgeMessage {
  type?: string;
  requestId?: string;
  [key: string]: unknown;
}

/** The `data` of an inbound `mcp-response` (or `pong`) frame. */
export interface InboundFrameData {
  success?: boolean;
  data?: unknown;
  error?: string;
}

/** A parsed inbound frame from the module (shape not validated; same as before the typing pass). */
export interface InboundFrame {
  type?: string;
  id?: string;
  data: InboundFrameData;
}

/** What `FoundryConnector.getConnectionInfo()` returns. */
export interface ConnectionInfo {
  started: boolean;
  connected: boolean;
  connectionType: 'websocket' | null;
  readyState: number | 'CLOSED';
  userName: string | null;
  moduleVersion: string | null;
  sockets: number;
  linkDownSince: string | null;
  config: {
    port: Config['foundry']['port'];
    namespace: Config['foundry']['namespace'];
  };
}
