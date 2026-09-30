// Constants for Foundry MCP Bridge Module

/**
 * Module constants
 */
export const MODULE_ID = 'foundry-mcp-bridge';

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  MCP_HOST: 'localhost',
  MCP_PORT: 31415,
  CONNECTION_TIMEOUT: 10,
  RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY: 1000,
  LOG_LEVEL: 'info',
} as const;

/**
 * Frame the module sends right after the link opens (lane 1, PB-02). Local
 * mirror of `MODULE_HELLO_TYPE` / `ModuleHelloData` in `shared/src/protocol.ts`
 * (the module does not import the shared package).
 */
export const MODULE_HELLO_TYPE = 'module-hello' as const;

export interface ModuleHelloData {
  userId: string;
  userName: string;
  /** True when this user is the world's configured bridge user (or none is set). */
  isBridgeUser: boolean;
  moduleVersion: string;
  worldId: string;
}

/**
 * Reconnect backoff (lane 1, PB-03): 1 s, doubling, capped at 30 s, plus up to
 * 20 % random jitter. There is no attempt limit.
 */
export const RECONNECT_BACKOFF = {
  BASE_MS: 1000,
  CAP_MS: 30000,
  JITTER: 0.2,
} as const;

/**
 * Connection states
 */
export const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
} as const;

/**
 * Token dispositions
 */
export const TOKEN_DISPOSITIONS = {
  HOSTILE: -1,
  NEUTRAL: 0,
  FRIENDLY: 1,
} as const;

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  NOT_INITIALIZED: 'Data provider not initialized',
  NOT_CONNECTED: 'Not connected to Foundry VTT',
  CHARACTER_NOT_FOUND: 'Character not found',
  SCENE_NOT_FOUND: 'Scene not found',
  ACCESS_DENIED: 'Access denied - feature is disabled',
  QUERY_TIMEOUT: 'Query timeout',
  UNKNOWN_METHOD: 'Unknown method',
  BRIDGE_NOT_RUNNING: 'MCP Bridge is not running',
} as const;
