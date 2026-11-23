import { unwrapBridgeReply } from '@gnuminator/shared';
import { z } from 'zod';

import {
  CAMPAIGN_FEATURE_ID,
  CAMPAIGN_FOLDER,
  CAMPAIGN_KINDS,
  journalId,
  type CampaignKind,
} from '../campaign/model.js';
import {
  planCampaignMerge,
  planMarkSeen,
  type CampaignEntry,
  type CampaignReader,
  type HeldEntry,
} from '../campaign/plan.js';
import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';

interface CampaignMergeToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan' | 'autoApplyEnabled'>;
  logger: Logger;
}

const bilingual = { da: z.string().max(4000).optional(), en: z.string().max(4000).optional() };

const entrySchema = z.object({
  kind: z.enum(CAMPAIGN_KINDS),
  name: z.string().min(1).max(200),
  nameConfirmed: z.boolean().optional(),
  summary: z.object(bilingual).optional(),
  statBlock: z
    .object({ uuid: z.string().min(1).max(300), name: z.string().min(1).max(200) })
    .optional(),
  relations: z
    .array(z.object({ to: z.string().min(1).max(200), ...bilingual }))
    .max(60)
    .optional(),
  timeline: z
    .array(
      z.object({
        session: z.string().min(1).max(100),
        ref: z.string().max(300).optional(),
        time: z.string().max(20).optional(),
        ...bilingual,
      })
    )
    .max(200)
    .optional(),
  replaceSummary: z.boolean().optional(),
});

const planParams = z.object({
  entries: z.array(entrySchema).max(100).optional(),
  setup: z.boolean().optional(),
  markSeen: z.boolean().optional(),
});

interface CampaignMergeResult {
  /** New pages and lines. `autoApply: true` means apply it at once (the GM's switch is on). */
  additions: (PlanView & { autoApply: boolean }) | null;
  /** Anything that rewrites text; always waits for the GM's confirm. */
  changes: PlanView | null;
  held: HeldEntry[];
  warnings: string[];
  additionLines: string[];
  changeLines: string[];
}

/**
 * `plan-campaign-merge` (D-151): merge facts into the GM-only Campaign journals (The Brothers,
 * NPCs, Creatures, Locations, Lore, Threads, Sessions, Table). Two guarded plans under the feature
 * "campaign-merge": additions (new pages, timeline lines, relations, first summaries, stat block
 * links; marked *new*; apply at once when the GM's "apply additions without confirming" switch is
 * on) and changes (replaced summaries, "seen"; always confirmed). Both undo through Recent Changes.
 */
export class CampaignMergeTools {
  private readonly options: CampaignMergeToolsOptions;
  private readonly logger: Logger;

  constructor(options: CampaignMergeToolsOptions) {
    this.options = options;
    this.logger = options.logger.child({ component: 'CampaignMergeTools' });
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  }> {
    const lang = { type: 'string', description: 'Danish (da) and English (en) text.' };
    const bi = { type: 'object', properties: { da: lang, en: lang } };
    return [
      {
        name: 'plan-campaign-merge',
        description:
          'Plan adding facts to the GM-only Campaign journals (kind: brothers, npcs, creatures, locations, lore, threads, sessions, table). Each entry is one page; give Danish and English. Returns additions (new pages and lines, marked new; apply at once when autoApply is true) and changes (rewrites; need confirm). Names not confirmed yet: nameConfirmed false holds the entry back. setup creates the eight journals; markSeen clears the new marks.',
        inputSchema: {
          type: 'object',
          properties: {
            entries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: [...CAMPAIGN_KINDS] },
                  name: { type: 'string', description: 'The page: an NPC, place, session.' },
                  nameConfirmed: { type: 'boolean' },
                  summary: bi,
                  replaceSummary: { type: 'boolean', description: 'Replace an existing summary.' },
                  statBlock: {
                    type: 'object',
                    properties: { uuid: { type: 'string' }, name: { type: 'string' } },
                  },
                  relations: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { to: { type: 'string' }, da: lang, en: lang },
                    },
                  },
                  timeline: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        session: { type: 'string', description: 'e.g. "Session 00".' },
                        ref: { type: 'string', description: 'e.g. transcript.en#^u000556.' },
                        time: { type: 'string' },
                        da: lang,
                        en: lang,
                      },
                      required: ['session'],
                    },
                  },
                },
                required: ['kind', 'name'],
              },
            },
            setup: { type: 'boolean' },
            markSeen: { type: 'boolean' },
          },
        },
      },
    ];
  }

  private reader(): CampaignReader {
    const q = this.options.foundryClient.query.bind(this.options.foundryClient);
    return {
      pages: async (kind: CampaignKind): Promise<Array<{ id: string; name: string }> | null> => {
        const reply = unwrapBridgeReply<unknown>(
          await q('foundry-mcp-bridge.getJournalContent', { journalId: journalId(kind) }).catch(
            (error: unknown) => {
              if (/not found|no journal|unknown journal/i.test(String(error))) return null;
              throw error;
            }
          ),
          'Could not read the campaign journal'
        ) as { allPages?: Array<{ id: string; name: string }> } | null;
        return reply?.allPages ?? (reply ? [] : null);
      },
      content: async (kind: CampaignKind, pageId: string): Promise<string> => {
        const reply = unwrapBridgeReply<unknown>(
          await q('foundry-mcp-bridge.getJournalPageContent', {
            journalId: journalId(kind),
            pageId,
          }),
          'Could not read the campaign page'
        ) as { content?: string } | null;
        if (typeof reply?.content !== 'string') throw new Error('The campaign page has no text');
        return reply.content;
      },
    };
  }

  async handlePlanCampaignMerge(args: unknown): Promise<CampaignMergeResult> {
    const params = planParams.parse(args ?? {});
    const entries = (params.entries ?? []) as CampaignEntry[];
    if (entries.length === 0 && !params.setup && !params.markSeen) {
      throw new Error('Nothing to plan: give entries, setup or markSeen');
    }
    const reader = this.reader();
    const parts = await planCampaignMerge(entries, reader, {
      setup: params.setup === true,
      folderId: async () => {
        const folder = unwrapBridgeReply<unknown>(
          await this.options.foundryClient.query('foundry-mcp-bridge.ensureJournalFolder', {
            name: CAMPAIGN_FOLDER,
          }),
          'Journal folder refused'
        ) as { folderId?: unknown } | null;
        if (typeof folder?.folderId !== 'string') {
          throw new Error(`Foundry did not give the "${CAMPAIGN_FOLDER}" folder`);
        }
        return folder.folderId;
      },
    });
    if (params.markSeen) {
      const seen = await planMarkSeen(reader);
      parts.changes.push(...seen.ops);
      parts.changeLines.push(...seen.lines);
    }

    let additions: CampaignMergeResult['additions'] = null;
    if (parts.additions.length > 0) {
      const plan = await this.options.guardedWrites.createPlan({
        feature: CAMPAIGN_FEATURE_ID,
        summary: `Campaign pages: ${parts.additionLines.slice(0, 6).join('; ')}${parts.additionLines.length > 6 ? `; and ${parts.additionLines.length - 6} more` : ''}`,
        ops: parts.additions,
      });
      const autoApply =
        plan.risk === 'write' && (await this.options.guardedWrites.autoApplyEnabled(plan.feature));
      additions = { ...plan, autoApply };
    }
    let changes: PlanView | null = null;
    if (parts.changes.length > 0) {
      changes = await this.options.guardedWrites.createPlan({
        feature: CAMPAIGN_FEATURE_ID,
        summary: `Campaign pages, changes to existing text: ${parts.changeLines.slice(0, 6).join('; ')}`,
        ops: parts.changes,
      });
    }
    this.logger.info('Campaign merge planned', {
      additions: parts.additions.length,
      changes: parts.changes.length,
      held: parts.held.length,
    });
    return {
      additions,
      changes,
      held: parts.held,
      warnings: parts.warnings,
      additionLines: parts.additionLines,
      changeLines: parts.changeLines,
    };
  }
}
