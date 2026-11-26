/**
 * `set-npc-on-stage`: the GM says which NPC they speak as now. The Table TV shows the portrait
 * (and the name once the players know it), and a line in the session log marks the time, so the
 * session notes can tell whose voice the GM's lines are.
 *
 * The log line is written only after the module accepted the change, and it carries the true
 * name (the log is GM-side, never shown to players).
 */
import { randomBytes } from 'crypto';

import { NPCS_ONLY, toolRef, unwrapBridgeReply, type SetNpcOnStageReply } from '@gnuminator/shared';
import { z } from 'zod';

import { localDateKey } from '../event-pump.js';
import type { FoundryClient } from '../foundry-client.js';
import type { Logger } from '../logger.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

export const NPC_ON_STAGE_EVENT = 'npc-on-stage';

interface NpcOnStageToolsOptions {
  foundryClient: FoundryClient;
  worldIds: Pick<WorldIdResolver, 'currentOrLastKnown'>;
  store: VaultStore;
  logger: Logger;
  /** Tests only. */
  now?: () => number;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

type SetNpcOnStageResult = Pick<SetNpcOnStageReply, 'success' | 'onStage'>;

const argsSchema = z
  .object({
    actorId: z.string().min(1).optional(),
    actorName: z.string().min(1).optional(),
    clear: z.boolean().optional(),
    nameKnown: z.boolean().optional(),
  })
  .refine(a => a.clear === true || a.actorId !== undefined || a.actorName !== undefined, {
    message: 'give actorId or actorName, or clear: true',
  });

export class NpcOnStageTools {
  private readonly foundryClient: FoundryClient;
  private readonly worldIds: NpcOnStageToolsOptions['worldIds'];
  private readonly store: VaultStore;
  private readonly logger: Logger;
  private readonly now: () => number;

  constructor(options: NpcOnStageToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.worldIds = options.worldIds;
    this.store = options.store;
    this.logger = options.logger.child({ component: 'NpcOnStageTools' });
    this.now = options.now ?? ((): number => Date.now());
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'set-npc-on-stage',
        description:
          'Direct write. GM ONLY. Put the NPC the GM is speaking as on stage: the Table TV shows its portrait, and its name once the players know it (they see the name on a token, or nameKnown is true; otherwise "?"). Logs the time in the session log so the notes can attribute the GM\'s lines to the NPC. clear: true takes it off. Only one NPC is on stage at a time. Player characters are refused.',
        inputSchema: {
          type: 'object',
          properties: {
            actorId: {
              type: 'string',
              description: 'The NPC actor id.',
              ...toolRef('actor', 'id', { filter: NPCS_ONLY }),
            },
            actorName: {
              type: 'string',
              description: 'The NPC name, when the id is not known (must match one actor).',
              ...toolRef('actor', 'name', { filter: NPCS_ONLY }),
            },
            clear: { type: 'boolean', description: 'Take the NPC off stage.' },
            nameKnown: {
              type: 'boolean',
              description: 'The players already know this NPC by name: show it on the TV.',
            },
          },
        },
      },
    ];
  }

  async handleSetNpcOnStage(args: unknown): Promise<SetNpcOnStageResult> {
    const params = argsSchema.parse(args ?? {});
    const reply = unwrapBridgeReply(
      await this.foundryClient.query('foundry-mcp-bridge.setNpcOnStage', params),
      'Failed to set NPC on stage'
    );
    await this.log(reply.onStage, reply.previous?.actorId ?? null);
    return { success: true, onStage: reply.onStage };
  }

  /** A log failure never undoes the change on the TV; it is reported in the log file of the bridge. */
  private async log(
    onStage: SetNpcOnStageResult['onStage'],
    previousActorId: string | null
  ): Promise<void> {
    try {
      const worldId = await this.worldIds.currentOrLastKnown();
      const atMs = this.now();
      const entry = {
        id: `stage-${atMs.toString(36)}-${randomBytes(4).toString('hex')}`,
        timestamp: new Date(atMs).toISOString(),
        timestampMs: atMs,
        eventType: NPC_ON_STAGE_EVENT,
        actorName: onStage?.name ?? null,
        actorId: onStage?.actorId ?? null,
        description: onStage ? `GM speaks as ${onStage.name}` : 'GM stops speaking as an NPC',
        details: {
          source: 'set-npc-on-stage',
          onStage: onStage !== null,
          nameShown: onStage?.nameShown ?? false,
          previousActorId,
        },
        visibility: { subject: 'npc', tokenVisible: false, playerName: null },
      };
      await this.store.appendLines(worldId, 'sessions', `${localDateKey(atMs)}.jsonl`, [entry]);
    } catch (error) {
      this.logger.error('Could not log the NPC on stage', error);
    }
  }
}
