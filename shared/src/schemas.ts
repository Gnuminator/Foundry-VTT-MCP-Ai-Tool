/**
 * @module schemas
 *
 * Zod validation schemas for every domain type defined in `types.ts`.
 *
 * Design rules:
 *   - Schemas and TypeScript interfaces are kept as parallel explicit
 *     definitions rather than using `z.infer<>`. This is intentional:
 *     schemas with `.default(…)` change the inferred input/output type,
 *     which would silently break callers that depend on the hand-written
 *     interface shapes.
 *   - Validation bounds and default values are part of the public contract.
 *     Do not change them without updating the corresponding interface and
 *     the test suite in `shared.test.ts`.
 *   - `.default(…)` on scalar fields means the field is optional at parse
 *     time and the default is filled in on the output. This matches
 *     behaviour callers already rely on (e.g. `scaling: ScalingOptionsSchema
 *     .default({})` inside CampaignPartSchema).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// 1. Wire-protocol schemas
// ---------------------------------------------------------------------------

export const MCPQuerySchema = z.object({
  method: z.string(),
  data: z.unknown().optional(),
});

export const MCPResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

// ---------------------------------------------------------------------------
// 2. Actor / Character schemas
// ---------------------------------------------------------------------------

export const CharacterItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  img: z.string().optional(),
  system: z.record(z.unknown()),
});

export const CharacterEffectSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
  disabled: z.boolean(),
  duration: z
    .object({
      type: z.string(),
      duration: z.number().optional(),
      remaining: z.number().optional(),
    })
    .optional(),
});

export const CharacterInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  img: z.string().optional(),
  system: z.record(z.unknown()),
  items: z.array(CharacterItemSchema),
  effects: z.array(CharacterEffectSchema),
});

// ---------------------------------------------------------------------------
// 3. Compendium schemas
// ---------------------------------------------------------------------------

export const CompendiumSearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  img: z.string().optional(),
  pack: z.string(),
  packLabel: z.string(),
  system: z.record(z.unknown()).optional(),
});

export const CompendiumPackSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.string(),
  system: z.string(),
  private: z.boolean(),
});

// ---------------------------------------------------------------------------
// 4. Scene / Token schemas
// ---------------------------------------------------------------------------

export const SceneTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  actorId: z.string().optional(),
  img: z.string(),
  hidden: z.boolean(),
  disposition: z.number(),
});

export const SceneNoteSchema = z.object({
  id: z.string(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
});

export const SceneInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  img: z.string().optional(),
  background: z.string().optional(),
  width: z.number(),
  height: z.number(),
  padding: z.number(),
  active: z.boolean(),
  navigation: z.boolean(),
  tokens: z.array(SceneTokenSchema),
  walls: z.number(),
  lights: z.number(),
  sounds: z.number(),
  notes: z.array(SceneNoteSchema),
});

/**
 * Token mutation request for a batch-update operation.
 * Bounds on `width`, `height`, and `rotation` are enforced here to catch
 * bad input early rather than letting Foundry silently clamp it.
 */
export const TokenUpdateSchema = z.object({
  tokenId: z.string(),
  updates: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    rotation: z.number().min(0).max(360).optional(),
    hidden: z.boolean().optional(),
    disposition: z.union([z.literal(-1), z.literal(0), z.literal(1)]).optional(),
    name: z.string().optional(),
    elevation: z.number().optional(),
    lockRotation: z.boolean().optional(),
  }),
});

/**
 * `animate` defaults to false so callers can omit it for instant moves.
 */
export const TokenMoveRequestSchema = z.object({
  tokenId: z.string(),
  x: z.number(),
  y: z.number(),
  animate: z.boolean().optional().default(false),
});

export const TokenUpdateResultSchema = z.object({
  success: z.boolean(),
  tokenId: z.string(),
  updated: z.boolean(),
  error: z.string().optional(),
});

export const TokenDeleteResultSchema = z.object({
  success: z.boolean(),
  deletedCount: z.number(),
  tokenIds: z.array(z.string()),
  errors: z.array(z.string()).optional(),
});

/**
 * Extends SceneTokenSchema with the extra fields the detail view exposes.
 * Using `.extend` keeps the base token validation intact.
 */
export const TokenDetailsSchema = SceneTokenSchema.extend({
  rotation: z.number(),
  elevation: z.number(),
  lockRotation: z.boolean(),
  scale: z.number(),
  alpha: z.number(),
  actorLink: z.boolean(),
  actorData: z
    .object({
      name: z.string(),
      type: z.string(),
      img: z.string().optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// 5. Configuration schemas
// ---------------------------------------------------------------------------

/**
 * `mcpPort` must be a user-assignable port (1024–65535).
 * `connectionTimeout` is clamped to a practical 5–60 second range.
 */
export const FoundryMCPConfigSchema = z.object({
  enabled: z.boolean(),
  mcpHost: z.string(),
  mcpPort: z.number().min(1024).max(65535),
  connectionTimeout: z.number().min(5).max(60),
  debugLogging: z.boolean(),
});

export const MCPServerConfigSchema = z.object({
  logLevel: z.enum(['error', 'warn', 'info', 'debug']),
  foundry: z.object({
    host: z.string(),
    port: z.number().min(1024).max(65535),
    namespace: z.string(),
    reconnectAttempts: z.number().min(1).max(10),
    reconnectDelay: z.number().min(100).max(10000),
  }),
});

// ---------------------------------------------------------------------------
// 6. World / Status schemas
// ---------------------------------------------------------------------------

export const WorldUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  isGM: z.boolean(),
});

export const WorldInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  system: z.string(),
  systemVersion: z.string(),
  foundryVersion: z.string(),
  users: z.array(WorldUserSchema),
});

export const BridgeStatusSchema = z.object({
  isRunning: z.boolean(),
  config: FoundryMCPConfigSchema,
  timestamp: z.number(),
});

// ---------------------------------------------------------------------------
// 7. Campaign schemas
// ---------------------------------------------------------------------------

/**
 * Valid lifecycle states for a campaign part.
 * Used by the journal renderer to drive progress indicators.
 */
export const CampaignPartStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'completed',
  'skipped',
]);

/**
 * Structural classification of a campaign part.
 * Drives rendering and navigation depth in the dashboard journal.
 */
export const CampaignPartTypeSchema = z.enum([
  'main_part',
  'sub_part',
  'chapter',
  'session',
  'optional',
]);

/**
 * D&D 5e character level range [1, 20] for pacing guidance.
 */
export const LevelRecommendationSchema = z.object({
  start: z.number().min(1).max(20),
  end: z.number().min(1).max(20),
});

export const NPCReferenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  actorId: z.string().optional(),
});

/**
 * Encounter-scaling parameters.
 * `difficultyModifier` is clamped to [-2, 2]; boolean flags default to true
 * so a bare `{}` input yields fully-enabled adaptive scaling.
 */
export const ScalingOptionsSchema = z.object({
  adjustForPartySize: z.boolean().default(true),
  adjustForLevel: z.boolean().default(true),
  difficultyModifier: z.number().min(-2).max(2).default(0),
});

/**
 * Leaf-level campaign unit. No further nesting.
 * `status` defaults to `'not_started'` when the field is omitted.
 */
export const CampaignSubPartSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  type: CampaignPartTypeSchema,
  status: CampaignPartStatusSchema.default('not_started'),
  journalId: z.string().optional(),
  createdAt: z.number().optional(),
  completedAt: z.number().optional(),
});

/**
 * Top-level structural unit in a campaign.
 *
 * Notable defaults (verified by the test suite):
 *   - `status` → `'not_started'`
 *   - `dependencies` → `[]`
 *   - `gmNotes` → `''`
 *   - `playerContent` → `''`
 *   - `scaling` → `{ adjustForPartySize: true, adjustForLevel: true, difficultyModifier: 0 }`
 */
export const CampaignPartSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  type: CampaignPartTypeSchema,
  status: CampaignPartStatusSchema.default('not_started'),
  dependencies: z.array(z.string()).default([]),
  subParts: z.array(CampaignSubPartSchema).optional(),
  questGiver: NPCReferenceSchema.optional(),
  levelRecommendation: LevelRecommendationSchema,
  gmNotes: z.string().default(''),
  playerContent: z.string().default(''),
  scaling: ScalingOptionsSchema.default({}),
  journalId: z.string().optional(),
  createdAt: z.number().optional(),
  completedAt: z.number().optional(),
});

/**
 * Campaign-wide metadata.
 * `tags` defaults to `[]` when the field is omitted.
 */
export const CampaignMetadataSchema = z.object({
  defaultQuestGiver: NPCReferenceSchema.optional(),
  defaultLocation: z.string().optional(),
  theme: z.string().optional(),
  estimatedSessions: z.number().optional(),
  targetLevelRange: LevelRecommendationSchema.optional(),
  tags: z.array(z.string()).default([]),
});

/**
 * Root campaign document. `title` must be non-empty (`.min(1)`).
 * `createdAt` and `updatedAt` are required epoch-ms timestamps.
 */
export const CampaignStructureSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  parts: z.array(CampaignPartSchema),
  metadata: CampaignMetadataSchema,
  dashboardJournalId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/**
 * Blueprint for pre-populating a new campaign with a standard part layout.
 * `metadata` is `.partial()` — callers supply only the fields they know.
 * The inline part schema deliberately omits fields that are filled in at
 * campaign-creation time (id, status, gmNotes, etc.).
 */
export const CampaignTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  parts: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      type: CampaignPartTypeSchema,
      dependencies: z.array(z.string()).default([]),
      subParts: z
        .array(
          z.object({
            title: z.string(),
            description: z.string(),
            type: CampaignPartTypeSchema,
          })
        )
        .optional(),
      levelRecommendation: LevelRecommendationSchema,
    })
  ),
  metadata: CampaignMetadataSchema.partial(),
});
