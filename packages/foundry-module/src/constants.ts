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
 * Frames for module-initiated requests (I-108): the bridge-linked browser asks
 * the backend to run one of `MODULE_REQUEST_TOOLS` for a GM's "AI changes"
 * Handouts or Tarokka window. Local mirrors of `MODULE_REQUEST_TYPE`, `MODULE_REPLY_TYPE` and
 * `MODULE_REQUEST_TOOLS` in `shared/src/protocol.ts`, pinned by a contract test.
 */
export const MODULE_REQUEST_TYPE = 'module-request' as const;
export const MODULE_REPLY_TYPE = 'module-reply' as const;
export const MODULE_REQUEST_TOOLS = [
  'list-recent-changes',
  'undo-change',
  'list-revealed-pages',
  'plan-page-reveal',
  'apply-planned-change',
  'get-tarokka-reading',
  'plan-tarokka-reveal',
] as const;
export type ModuleRequestTool = (typeof MODULE_REQUEST_TOOLS)[number];

/** The backend's reply when a request reaches a socket that is not the active link (mirror of `MODULE_NOT_ACTIVE_LINK_ERROR`). */
export const MODULE_NOT_ACTIVE_LINK_ERROR = 'Not the active bridge link';

/** Backend → module frame listing what the bridge understands (mirrors of the shared constants). */
export const BRIDGE_HELLO_TYPE = 'bridge-hello' as const;
export const BRIDGE_CAPABILITY_MODULE_REQUEST = 'module-request' as const;

/** What a GM sees when the linked bridge is too old to answer module requests. */
export const BRIDGE_TOO_OLD_MESSAGE = 'Update the AI Tool bridge to use this window.';

/** Largest `args` JSON (UTF-8 bytes) a module request may carry (mirror of `MODULE_REQUEST_MAX_ARGS_BYTES`). */
export const MODULE_REQUEST_MAX_ARGS_BYTES = 20_000;

/** Who asked, as the backend logs it (the Foundry user that clicked, not the link holder). */
export interface ModuleRequester {
  userId: string;
  userName: string;
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
