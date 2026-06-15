/**
 * @module constants
 *
 * Frozen wire-contract identifiers and well-known configuration defaults
 * for the Foundry AI Tool.
 *
 * IMPORTANT — values in this file are load-bearing contracts between three
 * independent processes (the Foundry module, the MCP server backend, and the
 * co-GM dashboard). Do NOT change any value here without a coordinated,
 * migration-gated rename across all three consumers.
 *
 * See ARCHITECTURE.md §3 ("The two wire contracts") for the full rationale.
 */

// ---------------------------------------------------------------------------
// Module identity
// ---------------------------------------------------------------------------

/**
 * Foundry module id. Used as:
 *   - the `id` field in module.json
 *   - the Foundry settings namespace (`game.settings.register(MODULE_ID, …)`)
 *   - the game-socket channel name (`game.socket.on('module.'+MODULE_ID, …)`)
 *   - the query-method prefix (`foundry-mcp-bridge.*`)
 *
 * Frozen. Any rename is a migration-gated breaking change.
 */
export const MODULE_ID = 'foundry-mcp-bridge';

/**
 * Human-readable product name displayed in Foundry's module manager.
 * Not a wire identifier — safe to update for branding purposes.
 */
export const MODULE_TITLE = 'Foundry MCP Bridge';

// ---------------------------------------------------------------------------
// Foundry-link frame types (§3b)
// Values are the string literals that appear in `{type: …}` frames exchanged
// over the WebSocket / WebRTC DataChannel between the backend and the module.
// ---------------------------------------------------------------------------

export const SOCKET_EVENTS = {
  /** Backend → module: invoke a query handler. */
  MCP_QUERY: 'mcp-query',
  /** Module → backend: handler result. */
  MCP_RESPONSE: 'mcp-response',
  /** Module → backend: periodic status broadcast. */
  BRIDGE_STATUS: 'bridge-status',
  /** Backend → module: connectivity check. */
  PING: 'ping',
  /** Module → backend: connectivity acknowledgement. */
  PONG: 'pong',
} as const;

// ---------------------------------------------------------------------------
// Control-channel method names (§3a)
// Values are the `method` strings the MCP server backend registers as query
// handler keys under the `foundry-mcp-bridge.*` namespace in CONFIG.queries.
// ---------------------------------------------------------------------------

export const MCP_METHODS = {
  GET_CHARACTER_INFO: 'getCharacterInfo',
  SEARCH_COMPENDIUM: 'searchCompendium',
  GET_SCENE_INFO: 'getSceneInfo',
  GET_WORLD_INFO: 'getWorldInfo',
  GET_AVAILABLE_PACKS: 'getAvailablePacks',
  PING: 'ping',
} as const;

// ---------------------------------------------------------------------------
// Default configuration (§4c)
// These are the fallback values used when no environment-variable override
// is present. MCP_PORT (31415) is a load-bearing port number — it is the
// WebSocket port the Foundry module dials to reach the backend.
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  MCP_HOST: 'localhost',
  /** WebSocket port the Foundry module connects to. Wire contract — do not change. */
  MCP_PORT: 31415,
  CONNECTION_TIMEOUT: 10,
  RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY: 1000,
  LOG_LEVEL: 'info',
} as const;

// ---------------------------------------------------------------------------
// Compendium pack types
// String values mirror Foundry's DocumentType enum used in CompendiumCollection.
// ---------------------------------------------------------------------------

export const PACK_TYPES = {
  ACTOR: 'Actor',
  ITEM: 'Item',
  SCENE: 'Scene',
  JOURNAL_ENTRY: 'JournalEntry',
  MACRO: 'Macro',
  ROLL_TABLE: 'RollTable',
  PLAYLIST: 'Playlist',
  CARDS: 'Cards',
} as const;

// ---------------------------------------------------------------------------
// Token dispositions
// Numeric values match Foundry's CONST.TOKEN_DISPOSITIONS.
// ---------------------------------------------------------------------------

export const TOKEN_DISPOSITIONS = {
  HOSTILE: -1,
  NEUTRAL: 0,
  FRIENDLY: 1,
} as const;

// ---------------------------------------------------------------------------
// Standardised error messages
// Consumed by query handlers and the MCP server's error formatter.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Log levels
// Values match the pino / winston level strings used by the Logger class.
// ---------------------------------------------------------------------------

export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
} as const;

// ---------------------------------------------------------------------------
// Connection-state machine labels
// Used by the socket bridge and the co-GM dashboard's reachability tracker.
// ---------------------------------------------------------------------------

export const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
} as const;
