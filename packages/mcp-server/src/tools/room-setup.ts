import { z } from 'zod';
import {
  ROOM_DARKNESS_MODES,
  ROOM_HAZARD_KINDS,
  ROOM_SETUP_ACTIONS,
  ROOM_SETUP_FEATURE_ID,
  ROOM_SETUP_QUERY,
  ROOM_TELEPORT_PLACEMENTS,
  freeText,
  unwrapBridgeReply,
  type RoomRegionSummary,
  type RoomSetupPlan,
  type RoomSetupRequest,
} from '@gnuminator/shared';
import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';

export interface RoomSetupToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  logger: Logger;
}

const area = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1).max(100),
  height: z.number().int().min(1).max(100),
  scene: z.string().min(1).optional(),
  level: z.string().min(1).optional(),
});

const planParams = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('teleport'),
    name: z.string().min(1).optional(),
    from: area,
    to: area,
    twoWay: z.boolean().optional(),
    choice: z.boolean().optional(),
    placement: z.enum(ROOM_TELEPORT_PLACEMENTS).optional(),
  }),
  z.object({
    action: z.literal('spawn'),
    name: z.string().min(1),
    area,
    creatures: z
      .array(
        z.object({
          actor: z.string().min(1),
          count: z.number().int().min(1).max(20).optional(),
        })
      )
      .min(1),
    hidden: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('levels'),
    scene: z.string().min(1).optional(),
    levels: z
      .array(
        z.object({
          name: z.string().min(1),
          bottom: z.number(),
          top: z.number().nullable().optional(),
          background: z.string().min(1).optional(),
        })
      )
      .min(1)
      .max(10),
  }),
  z.object({
    action: z.literal('stairs'),
    name: z.string().min(1),
    area,
    levels: z.array(z.string().min(1)).min(2).optional(),
    movementActions: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    action: z.literal('hazard'),
    name: z.string().min(1),
    area,
    kind: z.enum(ROOM_HAZARD_KINDS),
    magical: z.boolean().optional(),
    darknessMode: z.enum(ROOM_DARKNESS_MODES).optional(),
    modifier: z.number().min(0).max(1).optional(),
    effectUuid: z.string().min(1).optional(),
  }),
]);

/** What `plan-room-setup` returns beside the guarded plan. */
export interface RoomSetupPlanResult extends PlanView {
  regions: RoomRegionSummary[];
  levels?: RoomSetupPlan['levels'];
  tokens?: RoomSetupPlan['tokens'];
  skipped?: RoomSetupPlan['skipped'];
  warnings: string[];
  autoApply: false;
}

/** A rectangle in grid squares; `scene` is an id or name (default: the viewed scene). */
const areaSchema = (what: string): Record<string, unknown> => ({
  type: 'object',
  description: `${what}: grid squares, x/y top-left from 0; scene id or name (default viewed).`,
  properties: {
    x: { type: 'integer' },
    y: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    scene: { type: 'string' },
    level: { type: 'string' },
  },
  required: ['x', 'y', 'width', 'height'],
});

/**
 * Room setup (I-133). `plan-room-setup` plans scene parts built from Foundry 14 Regions as one
 * guarded change (feature `room-setup`, off by default): a teleport between two rectangles, or a
 * room filled with tokens. Apply it with apply-planned-change, revert it with undo-change.
 */
export class RoomSetupTools {
  private readonly foundryClient: Pick<FoundryClient, 'query'>;
  private readonly guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  private readonly logger: Logger;

  constructor(options: RoomSetupToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.guardedWrites = options.guardedWrites;
    this.logger = options.logger.child({ component: 'RoomSetupTools' });
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'plan-room-setup',
        description:
          'Plan Region-based scene parts: "teleport" moves tokens entering one rectangle to another (same or other scene); "spawn" makes a room rectangle plus tokens from actors on free squares in it; "levels" adds Scene Levels; "stairs" joins levels; "hazard" makes difficult terrain, darkness or an existing effect. Apply with apply-planned-change, undo with undo-change. Needs the module switch "Room setup" (off by default).',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: [...ROOM_SETUP_ACTIONS] },
            name: {
              type: 'string',
              description: 'teleport: entry name (arrival "<name> (arrival)"). spawn: room name.',
              ...freeText('A new region name chosen by the user'),
            },
            from: areaSchema('teleport: the entry'),
            to: areaSchema('teleport: the arrival'),
            twoWay: { type: 'boolean', description: 'teleport: also back from the arrival.' },
            choice: { type: 'boolean', description: 'teleport: player confirms each teleport.' },
            placement: {
              type: 'string',
              enum: [...ROOM_TELEPORT_PLACEMENTS],
              description: 'teleport: landing spot (default center).',
            },
            area: areaSchema('spawn: the room'),
            creatures: {
              type: 'array',
              description: 'spawn: actors (id or name) and count, 40 tokens at most.',
              items: {
                type: 'object',
                properties: { actor: { type: 'string' }, count: { type: 'integer' } },
                required: ['actor'],
              },
            },
            hidden: {
              type: 'boolean',
              description: 'spawn: tokens hidden from players (default true).',
            },
            scene: { type: 'string', description: 'levels: scene.' },
            levels: {
              type: 'array',
              description: 'levels: [{name, bottom, top?, background?}]. stairs: level names.',
              items: {},
            },
            movementActions: { type: 'array', items: { type: 'string' } },
            kind: { type: 'string', enum: [...ROOM_HAZARD_KINDS] },
            magical: { type: 'boolean', description: 'difficult: magical terrain.' },
            darknessMode: { type: 'string', enum: [...ROOM_DARKNESS_MODES] },
            modifier: { type: 'number', description: 'darkness: 0 to 1.' },
            effectUuid: { type: 'string', ...freeText('An existing ActiveEffect uuid') },
          },
          required: ['action'],
        },
      },
    ];
  }

  async handleToolCall(name: string, args: unknown): Promise<RoomSetupPlanResult> {
    try {
      switch (name) {
        case 'plan-room-setup':
          return await this.planRoomSetup(args);
        default:
          throw new Error(`Unknown room setup tool: ${name}`);
      }
    } catch (error) {
      this.logger.error(`Error in room setup tool ${name}:`, error);
      throw error;
    }
  }

  private async planRoomSetup(args: unknown): Promise<RoomSetupPlanResult> {
    const parsed = planParams.parse(args ?? {});
    // zod drops keys it does not know: a misplaced `level` would silently plan on the wrong level.
    const unknown = Object.keys((args ?? {}) as Record<string, unknown>).filter(
      k => !(k in parsed)
    );
    if (unknown.length > 0) {
      throw new Error(
        `Unknown parameter(s) for this action: ${unknown.join(', ')} (level belongs inside area)`
      );
    }
    const params = parsed as RoomSetupRequest;

    // Fail early and plainly while the switch is off (the module would refuse the apply anyway).
    const features = unwrapBridgeReply(
      await this.foundryClient.query('foundry-mcp-bridge.listGuardedFeatures'),
      'Feature list refused'
    );
    const feature = features.find(f => f.id === ROOM_SETUP_FEATURE_ID);
    if (!feature?.enabled) {
      throw new Error(
        'Room setup is switched off. In Foundry, open the Settings tab, Game Settings, AI Tool and turn on "AI Tool: Room setup (writes)".'
      );
    }

    const built: RoomSetupPlan = unwrapBridgeReply(
      await this.foundryClient.query(`foundry-mcp-bridge.${ROOM_SETUP_QUERY}`, params),
      'Could not plan the room setup'
    );
    const plan = await this.guardedWrites.createPlan({
      feature: ROOM_SETUP_FEATURE_ID,
      summary: built.summary,
      ops: built.ops,
    });
    return {
      ...plan,
      regions: built.regions,
      ...(built.levels ? { levels: built.levels } : {}),
      ...(built.tokens ? { tokens: built.tokens } : {}),
      ...(built.skipped ? { skipped: built.skipped } : {}),
      warnings: built.warnings,
      autoApply: false,
    };
  }
}
