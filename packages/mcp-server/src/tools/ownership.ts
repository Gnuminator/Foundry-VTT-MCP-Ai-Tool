import { z } from 'zod';
import {
  OWNERSHIP_ACTIONS,
  OWNERSHIP_FEATURE_ID,
  OWNERSHIP_LEVELS,
  toolRef,
  type GuardedOp,
  type LiveTargetPreview,
  type OwnershipLevelName,
} from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import { Logger } from '../logger.js';

export interface OwnershipToolsOptions {
  foundryClient: FoundryClient;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  logger: Logger;
}

const LEVEL_NAMES = Object.keys(OWNERSHIP_LEVELS) as OwnershipLevelName[];

const planParams = z.object({
  action: z.enum(OWNERSHIP_ACTIONS),
  actorIdentifier: z.string().min(1),
  playerIdentifier: z.string().min(1),
  permissionLevel: z.enum(['NONE', 'LIMITED', 'OBSERVER', 'OWNER']).optional(),
});

/** A level number as its name; no entry means the actor's default applies. */
function levelName(value: unknown, present = true): string {
  if (!present || value === undefined || value === null) return 'default';
  const name = LEVEL_NAMES.find(n => OWNERSHIP_LEVELS[n] === value);
  return name ?? String(value);
}

/** Actor picker for assign/remove: a world actor, or a bulk phrase `resolveActors` expands. */
const actorOrBulkRef = toolRef('actor', 'id', {
  extra: [
    { value: 'all friendly NPCs', label: 'All friendly NPCs (tokens on the active scene)' },
    { value: 'party characters', label: 'Party characters (player-owned characters)' },
  ],
});

/** Player picker for assign/remove: `findPlayers` matches user names, then owned characters. */
const playerOrCharacterRef = toolRef(['user', 'actor'], 'name', {
  filter: { role: 'player', types: ['character'], playerOwned: true },
  extra: [{ value: 'party', label: 'Party (all connected players)' }],
});

/**
 * Actor ownership. `plan-ownership-change` (F5 L3, D-082) plans assigning or
 * removing a player's access as a guarded change (feature "ownership", on by
 * default): an update of `ownership.<userId>` on each actor, applied with
 * apply-planned-change and reverted with undo-change. Actors and players are
 * resolved through read queries, so no module write handler is involved.
 * `list-actor-ownership` reads. Replaces assign-actor-ownership and
 * remove-actor-ownership.
 */
export class OwnershipTools {
  private foundryClient: FoundryClient;
  private guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  private logger: Logger;

  constructor({ foundryClient, guardedWrites, logger }: OwnershipToolsOptions) {
    this.foundryClient = foundryClient;
    this.guardedWrites = guardedWrites;
    this.logger = logger.child({ component: 'OwnershipTools' });
  }

  /**
   * Get tool definitions for ownership management
   */
  getToolDefinitions() {
    return [
      {
        name: 'plan-ownership-change',
        description:
          'Plan who owns which actor; apply it with apply-planned-change, revert it with undo-change. "assign": give the player(s) a level (NONE, LIMITED, OBSERVER, OWNER). "remove": set them to NONE. Bulk phrases work ("all friendly NPCs", "party characters"; player "party"). The plan lists each change ("Wolf: Player OBSERVER, was default").',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [...OWNERSHIP_ACTIONS],
              description: 'assign or remove.',
            },
            actorIdentifier: {
              type: 'string',
              description: 'Actor name or ID, "all friendly NPCs" or "party characters".',
              ...actorOrBulkRef,
            },
            playerIdentifier: {
              type: 'string',
              description: 'Player or character name, or "party" for all connected players.',
              ...playerOrCharacterRef,
            },
            permissionLevel: {
              type: 'string',
              enum: ['NONE', 'LIMITED', 'OBSERVER', 'OWNER'],
              description:
                'assign: NONE, LIMITED, OBSERVER (sees the sheet) or OWNER (controls it).',
            },
          },
          required: ['action', 'actorIdentifier', 'playerIdentifier'],
        },
      },
      {
        name: 'list-actor-ownership',
        description:
          'List current ownership permissions for actors, showing which players have what access levels.',
        inputSchema: {
          type: 'object',
          properties: {
            actorIdentifier: {
              type: 'string',
              description: 'Optional: specific actor name/ID to check, or "all" for all actors',
              ...toolRef('actor', 'id', { extra: [{ value: 'all', label: 'All actors' }] }),
            },
            playerIdentifier: {
              type: 'string',
              description: 'Optional: specific player name to check ownership for',
              ...toolRef('user', 'id', { filter: { role: 'player' } }),
            },
          },
        },
      },
    ];
  }

  /**
   * Handle tool execution
   */
  async handleToolCall(name: string, args: any) {
    try {
      switch (name) {
        case 'plan-ownership-change':
          return await this.planOwnershipChange(args);
        case 'list-actor-ownership':
          return await this.listActorOwnership(args);
        default:
          throw new Error(`Unknown ownership tool: ${name}`);
      }
    } catch (error) {
      this.logger.error(`Error in ownership tool ${name}:`, error);
      throw error;
    }
  }

  /** Plan an ownership change for every actor and player the identifiers resolve to. */
  private async planOwnershipChange(
    args: unknown
  ): Promise<PlanView & { targets: LiveTargetPreview[]; autoApply: false }> {
    const params = planParams.parse(args ?? {});
    const levelKey: OwnershipLevelName =
      params.action === 'remove' ? 'NONE' : (params.permissionLevel ?? 'OBSERVER');
    if (params.action === 'assign' && !params.permissionLevel) {
      throw new Error('Action "assign" needs permissionLevel (NONE, LIMITED, OBSERVER or OWNER)');
    }
    const level = OWNERSHIP_LEVELS[levelKey];
    const actors = await this.resolveActors(params.actorIdentifier);
    if (actors.length === 0) throw new Error(`No actor matches "${params.actorIdentifier}"`);
    const players = await this.resolvePlayers(params.playerIdentifier);
    if (players.length === 0) throw new Error(`No player matches "${params.playerIdentifier}"`);

    const changes: Record<string, unknown> = {};
    const pathLabels: Record<string, string> = {};
    for (const player of players) {
      changes[`ownership.${player.id}`] = level;
      pathLabels[`ownership.${player.id}`] = `ownership for ${player.name}`;
    }
    const ops: GuardedOp[] = actors.map(actor => ({
      kind: 'update',
      uuid: `Actor.${actor.id}`,
      changes: { ...changes },
    }));
    const who = players.map(p => p.name).join(', ');
    const what = actors.length === 1 ? actors[0]?.name : `${actors.length} actors`;
    const summary =
      params.action === 'remove'
        ? `Remove ${who}'s access to ${what} (set to NONE)`
        : `Give ${who} ${levelKey} on ${what}`;
    const plan = await this.guardedWrites.createPlan({
      feature: OWNERSHIP_FEATURE_ID,
      summary,
      ops,
      pathLabels,
    });

    // The preview from the plan's own before values: "Wolf: Player OBSERVER, was default".
    const nameOf = new Map(players.map(p => [`ownership.${p.id}`, p.name]));
    const targets: LiveTargetPreview[] = [];
    for (const line of plan.diff) {
      if (line.kind !== 'update' || !line.path || !line.before || !line.after) continue;
      const actorName = actors.find(a => `Actor.${a.id}` === line.target)?.name ?? line.label;
      const was = levelName(line.before.value, line.before.present);
      const now = levelName(line.after.value);
      const unchanged = line.before.present && line.before.value === line.after.value;
      targets.push({
        target: actorName,
        actorUuid: line.target,
        line: `${actorName}: ${nameOf.get(line.path) ?? line.path} ${now}${unchanged ? ' already' : `, was ${was}`}`,
        ...(unchanged ? { skipped: true } : {}),
      });
    }
    if (targets.length > 0 && targets.every(t => t.skipped)) {
      throw new Error(`Nothing to change: ${targets.map(t => t.line).join('; ')}`);
    }
    return { ...plan, targets, autoApply: false };
  }

  /**
   * List actor ownership permissions
   */
  private async listActorOwnership(args: any) {
    const { actorIdentifier, playerIdentifier } = args;

    this.logger.info(
      `Listing actor ownership for actor: "${actorIdentifier || 'all'}", player: "${playerIdentifier || 'all'}"`
    );

    try {
      const ownershipData = await this.foundryClient.query('foundry-mcp-bridge.getActorOwnership', {
        actorIdentifier,
        playerIdentifier,
      });

      return {
        success: true,
        ownership: ownershipData,
      };
    } catch (error) {
      this.logger.error('Failed to list actor ownership:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Resolve actors from identifier (supports bulk operations)
   */
  private async resolveActors(identifier: string): Promise<Array<{ id: string; name: string }>> {
    this.logger.debug(`Resolving actors for identifier: ${identifier}`);

    try {
      if (identifier.toLowerCase().includes('all friendly npcs')) {
        // Get all tokens in current scene with friendly disposition
        const actors = await this.foundryClient.query('foundry-mcp-bridge.getFriendlyNPCs', {});
        this.logger.debug(`Found ${actors.length} friendly NPCs`);
        return actors;
      } else if (identifier.toLowerCase().includes('party characters')) {
        // Get all player-owned characters
        const actors = await this.foundryClient.query('foundry-mcp-bridge.getPartyCharacters', {});
        this.logger.debug(`Found ${actors.length} party characters`);
        return actors;
      } else {
        // Single actor lookup
        this.logger.debug(`Looking for single actor: ${identifier}`);
        const actor = await this.foundryClient.query('foundry-mcp-bridge.findActor', {
          identifier,
        });
        this.logger.debug(`Single actor lookup result:`, actor);
        return actor ? [actor] : [];
      }
    } catch (error) {
      this.logger.error(`Failed to resolve actors for "${identifier}":`, error);
      return [];
    }
  }

  /**
   * Resolve players from identifier (supports partial matching)
   */
  private async resolvePlayers(identifier: string): Promise<Array<{ id: string; name: string }>> {
    this.logger.debug(`Resolving players for identifier: ${identifier}`);

    try {
      if (identifier.toLowerCase() === 'party') {
        // Get all connected players (excluding GM)
        const players = await this.foundryClient.query(
          'foundry-mcp-bridge.getConnectedPlayers',
          {}
        );
        this.logger.debug(`Found ${players.length} connected players`);
        return players;
      } else {
        // Single player lookup with partial matching
        this.logger.debug(`Looking for single player: ${identifier}`);
        const players = await this.foundryClient.query('foundry-mcp-bridge.findPlayers', {
          identifier,
          allowPartialMatch: true,
          includeCharacterOwners: true, // Also match by character names they own
        });
        this.logger.debug(`Player lookup result:`, players);
        return players;
      }
    } catch (error) {
      this.logger.error(`Failed to resolve players for "${identifier}":`, error);
      return [];
    }
  }
}
