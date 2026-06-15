/**
 * @module types
 *
 * Domain types for the Foundry AI Tool wire protocol.
 *
 * Organised around the four domains described in ARCHITECTURE.md:
 *   1. Wire-protocol  — MCP query / response envelopes
 *   2. Actor / Character — actors, their items, and active effects
 *   3. Compendium — search results and pack descriptors
 *   4. Scene / Token — scene layout, tokens, notes, and mutation requests
 *   5. Config — module-side and server-side configuration shapes
 *   6. World / Status — world metadata, users, and bridge health
 *   7. Campaign — multipart campaign structure and progress tracking
 *
 * TYPE CONTRACT: every interface here is part of the public surface of
 * @gnuminator/shared. Field names, optionality, literal types, and `extends`
 * relationships must remain byte-identical across reimplementations.
 */

// ---------------------------------------------------------------------------
// 1. Wire-protocol types
// ---------------------------------------------------------------------------

/**
 * A query dispatched from the backend to the Foundry module over the
 * Foundry link (WebSocket or WebRTC DataChannel). Corresponds to the
 * `data` payload inside a `{type:"mcp-query"}` frame.
 */
export interface MCPQuery {
  method: string;
  data?: unknown;
}

/**
 * The module's response to an MCPQuery. Returned inside an
 * `{type:"mcp-response"}` frame. Either `data` or `error` is present.
 */
export interface MCPResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// 2. Actor / Character types
// ---------------------------------------------------------------------------

/**
 * A Foundry item document summarised for transport.
 * Mirrors the subset of `Item#toObject()` the bridge exposes.
 */
export interface CharacterItem {
  id: string;
  name: string;
  type: string;
  img?: string;
  system: Record<string, unknown>;
}

/**
 * A Foundry active-effect document summarised for transport.
 * The optional `duration` block is only populated for effects that carry
 * explicit duration data (timed conditions, spells, etc.).
 */
export interface CharacterEffect {
  id: string;
  name: string;
  icon?: string;
  disabled: boolean;
  duration?: {
    type: string;
    duration?: number;
    remaining?: number;
  };
}

/**
 * Full character / actor snapshot returned by `getCharacterInfo`.
 * `system` carries the raw system-specific data blob (e.g. dnd5e attributes).
 */
export interface CharacterInfo {
  id: string;
  name: string;
  type: string;
  img?: string;
  system: Record<string, unknown>;
  items: CharacterItem[];
  effects: CharacterEffect[];
}

// ---------------------------------------------------------------------------
// 3. Compendium types
// ---------------------------------------------------------------------------

/**
 * A single entry returned from a compendium search.
 * `pack` is the compendium's dot-notation id (e.g. `dnd5e.monsters`);
 * `packLabel` is its human-readable name.
 */
export interface CompendiumSearchResult {
  id: string;
  name: string;
  type: string;
  img?: string;
  pack: string;
  packLabel: string;
  system?: Record<string, unknown>;
}

/**
 * Descriptor for a Foundry compendium pack, as surfaced by `getAvailablePacks`.
 */
export interface CompendiumPack {
  id: string;
  label: string;
  type: string;
  system: string;
  private: boolean;
}

// ---------------------------------------------------------------------------
// 4. Scene / Token types
// ---------------------------------------------------------------------------

/**
 * Lightweight token summary embedded inside a SceneInfo response.
 * `disposition` uses Foundry's CONST values: -1 hostile, 0 neutral, 1 friendly.
 */
export interface SceneToken {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  actorId?: string;
  img: string;
  hidden: boolean;
  disposition: number;
}

/**
 * A map-note pin embedded in a scene's notes array.
 */
export interface SceneNote {
  id: string;
  text: string;
  x: number;
  y: number;
}

/**
 * Full scene snapshot returned by `getSceneInfo`.
 * Counts (`walls`, `lights`, `sounds`) are numeric summaries, not arrays.
 */
export interface SceneInfo {
  id: string;
  name: string;
  img?: string;
  background?: string;
  width: number;
  height: number;
  padding: number;
  active: boolean;
  navigation: boolean;
  tokens: SceneToken[];
  walls: number;
  lights: number;
  sounds: number;
  notes: SceneNote[];
}

/**
 * A single token mutation request within a batch update operation.
 * The `disposition` literal union mirrors Foundry's three valid values.
 */
export interface TokenUpdate {
  tokenId: string;
  updates: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    hidden?: boolean;
    disposition?: -1 | 0 | 1; // hostile, neutral, friendly
    name?: string;
    elevation?: number;
    lockRotation?: boolean;
  };
}

/**
 * Request payload for the `move-token` tool.
 * `animate` defaults to false (instant move) when omitted.
 */
export interface TokenMoveRequest {
  tokenId: string;
  x: number;
  y: number;
  animate?: boolean;
}

/** Result record for a single token update operation. */
export interface TokenUpdateResult {
  success: boolean;
  tokenId: string;
  updated: boolean;
  error?: string;
}

/** Result record for a batch token-delete operation. */
export interface TokenDeleteResult {
  success: boolean;
  deletedCount: number;
  tokenIds: string[];
  errors?: string[];
}

/**
 * Extended token record returned by `getTokenDetails`, carrying all fields
 * from SceneToken plus the additional state fields the detail view exposes.
 * `actorData` is populated when the token is linked to an actor document.
 */
export interface TokenDetails extends SceneToken {
  rotation: number;
  elevation: number;
  lockRotation: boolean;
  scale: number;
  alpha: number;
  actorLink: boolean;
  actorData?: {
    name: string;
    type: string;
    img?: string;
  };
}

// ---------------------------------------------------------------------------
// 5. Configuration types
// ---------------------------------------------------------------------------

/**
 * Runtime configuration stored in Foundry's settings namespace
 * (`foundry-mcp-bridge`). Validated by FoundryMCPConfigSchema.
 */
export interface FoundryMCPConfig {
  enabled: boolean;
  mcpHost: string;
  mcpPort: number;
  connectionTimeout: number;
  debugLogging: boolean;
}

/**
 * Configuration for the MCP server process (loaded from env vars by
 * `packages/mcp-server/src/config.ts`). Validated by MCPServerConfigSchema.
 */
export interface MCPServerConfig {
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  foundry: {
    host: string;
    port: number;
    namespace: string;
    reconnectAttempts: number;
    reconnectDelay: number;
  };
}

// ---------------------------------------------------------------------------
// 6. World / Status types
// ---------------------------------------------------------------------------

/** A Foundry user record as reported by `getWorldInfo`. */
export interface WorldUser {
  id: string;
  name: string;
  active: boolean;
  isGM: boolean;
}

/**
 * World-level metadata returned by `getWorldInfo`.
 * `system` is the Foundry system id (e.g. `dnd5e`).
 */
export interface WorldInfo {
  id: string;
  title: string;
  system: string;
  systemVersion: string;
  foundryVersion: string;
  users: WorldUser[];
}

/**
 * Heartbeat/status payload broadcast by the module on the Foundry game socket
 * via `SOCKET_EVENTS.BRIDGE_STATUS`.
 */
export interface BridgeStatus {
  isRunning: boolean;
  config: FoundryMCPConfig;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// 7. Campaign types
// ---------------------------------------------------------------------------

/**
 * Progress state for a campaign part or sub-part.
 * Values are string literals consumed by the journal renderer.
 */
export type CampaignPartStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';

/**
 * Structural classification of a campaign part.
 * Used to drive rendering and navigation in the dashboard journal.
 */
export type CampaignPartType = 'main_part' | 'sub_part' | 'chapter' | 'session' | 'optional';

/**
 * D&D 5e character level range for a campaign part's pacing recommendation.
 * Both `start` and `end` must be in [1, 20].
 */
export interface LevelRecommendation {
  start: number;
  end: number;
}

/**
 * A reference to an NPC that acts as a quest giver or point of contact.
 * `actorId` links to the live Foundry actor document if one was created.
 */
export interface NPCReference {
  id: string;
  name: string;
  actorId?: string;
}

/**
 * Encounter-scaling knobs attached to a campaign part.
 * The backend reads these when building encounter suggestions for the part.
 */
export interface ScalingOptions {
  adjustForPartySize: boolean;
  adjustForLevel: boolean;
  /** Value in [-2, 2]: negative = easier, positive = harder. */
  difficultyModifier: number;
}

/**
 * A leaf-level campaign unit nested inside a CampaignPart.
 * Sub-parts do not have further nesting (no `subParts` field).
 */
export interface CampaignSubPart {
  id: string;
  title: string;
  description: string;
  type: CampaignPartType;
  status: CampaignPartStatus;
  journalId?: string;
  createdAt?: number;
  completedAt?: number;
}

/**
 * A top-level structural unit in a campaign (act, chapter, session, etc.).
 * `dependencies` lists the ids of parts that must be completed first.
 */
export interface CampaignPart {
  id: string;
  title: string;
  description: string;
  type: CampaignPartType;
  status: CampaignPartStatus;
  dependencies: string[];
  subParts?: CampaignSubPart[];
  questGiver?: NPCReference;
  levelRecommendation: LevelRecommendation;
  gmNotes: string;
  playerContent: string;
  scaling: ScalingOptions;
  journalId?: string;
  createdAt?: number;
  completedAt?: number;
}

/**
 * Campaign-wide metadata that applies across all parts.
 * All fields are optional; `tags` has a default of `[]` at the schema level.
 */
export interface CampaignMetadata {
  defaultQuestGiver?: NPCReference;
  defaultLocation?: string;
  theme?: string;
  estimatedSessions?: number;
  targetLevelRange?: LevelRecommendation;
  tags: string[];
}

/**
 * The root document for a multipart campaign stored as a Foundry journal.
 * Persisted via the `create-campaign-dashboard` / `update-quest-journal` tools.
 */
export interface CampaignStructure {
  id: string;
  title: string;
  description: string;
  parts: CampaignPart[];
  metadata: CampaignMetadata;
  dashboardJournalId?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * A blueprint used to pre-populate a new campaign with a standard part
 * layout. `parts[].dependencies` use array indices as placeholder ids,
 * resolved when the real campaign is created.
 * `metadata` is partial — callers fill in the remainder.
 */
export interface CampaignTemplate {
  id: string;
  name: string;
  description: string;
  parts: Array<{
    title: string;
    description: string;
    type: CampaignPartType;
    dependencies: string[];
    subParts?: Array<{
      title: string;
      description: string;
      type: CampaignPartType;
    }>;
    levelRecommendation: LevelRecommendation;
  }>;
  metadata: Partial<CampaignMetadata>;
}
