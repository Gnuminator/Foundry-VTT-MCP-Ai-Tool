/**
 * `get-play-stats` (docs/design/OBSIDIAN-PLAN.md section 8, O3): the same derived
 * numbers as the `AI Tool/Stats/` Obsidian notes (`stats/build.ts`), read
 * straight from the bridge vault's own session and play logs of the
 * connected world. GM-only and read-only: it never returns raw play records,
 * only the built totals (campaign, one session, one or every PC).
 */
import { toolRef } from '@gnuminator/shared';
import { z } from 'zod';

import type { Logger } from '../logger.js';
import { buildStats } from '../stats/build.js';
import { loadPlayRecords, loadSessionEvents } from '../stats/load.js';
import type { DiceStats, PcStats, SessionStats, StatsModel } from '../stats/types.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface PlayStatsToolsOptions {
  worldIds: Pick<WorldIdResolver, 'current'>;
  store: VaultStore;
  logger: Logger;
}

export interface GetPlayStatsResult {
  success: true;
  worldId: string;
  campaign: StatsModel['campaign'];
  dice: DiceStats;
  sessionCount: number;
  /** The requested session's stats, or `null` when none match (no sessions yet). */
  session: SessionStats | null;
  /** One PC when `pcName` matched, every PC otherwise. */
  pcs: PcStats[];
}

/** `get-play-stats`: campaign totals, one play session (default the latest)
 * and one or every PC, built fresh with `stats/build.ts` on every call. */
export class PlayStatsTools {
  private readonly worldIds: PlayStatsToolsOptions['worldIds'];
  private readonly store: VaultStore;
  private readonly logger: Logger;

  constructor(options: PlayStatsToolsOptions) {
    this.worldIds = options.worldIds;
    this.store = options.store;
    this.logger = options.logger.child({ component: 'PlayStatsTools' });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get-play-stats',
        description:
          'GM ONLY. Derived play statistics for the connected world (the same numbers as the ' +
          "AI Tool/Stats/ Obsidian notes): campaign totals, dice, one play session's stats " +
          "(default the latest) and one PC's or every PC's totals (damage, healing, downs, " +
          'kills, rolls, spells, resources, loot, currency, XP). Built fresh from the bridge ' +
          "vault's session and play logs; never returns raw play records.",
        inputSchema: {
          type: 'object',
          properties: {
            session: {
              description:
                'Which play session to return stats for: a 1-based session number (same numbering ' +
                'as the Obsidian session notes), or "latest" (default).',
              oneOf: [
                { type: 'integer', minimum: 1 },
                { type: 'string', enum: ['latest'] },
              ],
            },
            pcName: {
              type: 'string',
              description:
                "Only this PC's stats (partial, case-insensitive match on the name). Omit for every PC.",
              ...toolRef('actor', 'name', { filter: { types: ['character'] } }),
            },
          },
        },
      },
    ];
  }

  async handleGetPlayStats(args: unknown): Promise<GetPlayStatsResult> {
    try {
      const params = z
        .object({
          session: z.union([z.number().int().min(1), z.literal('latest')]).optional(),
          pcName: z.string().trim().min(1).optional(),
        })
        .parse(args ?? {});

      const worldId = await this.worldIds.current();
      const [logEvents, playRecords] = await Promise.all([
        loadSessionEvents(this.store, worldId),
        loadPlayRecords(this.store, worldId),
      ]);
      const model = buildStats({ worldId, logEvents, playRecords });

      const session = this.pickSession(model.sessions, params.session);
      const wantedName = params.pcName?.toLowerCase();
      const pcs = wantedName
        ? model.pcs.filter(pc => pc.name.toLowerCase().includes(wantedName))
        : model.pcs;

      return {
        success: true,
        worldId,
        campaign: model.campaign,
        dice: model.dice,
        sessionCount: model.sessions.length,
        session,
        pcs,
      };
    } catch (error) {
      this.logger.error('Error getting play stats', error);
      throw error;
    }
  }

  private pickSession(
    sessions: SessionStats[],
    which: number | 'latest' | undefined
  ): SessionStats | null {
    if (sessions.length === 0) return null;
    if (which === undefined || which === 'latest') return sessions[sessions.length - 1] ?? null;
    return sessions.find(s => s.number === which) ?? null;
  }
}
