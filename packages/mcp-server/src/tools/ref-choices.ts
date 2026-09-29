import {
  BACKEND_REF_KINDS,
  REF_KINDS,
  type RefChoice,
  type RefChoicesResult,
  type RefKind,
} from '@gnuminator/shared';
import { z } from 'zod';

import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';
import {
  COMMON_CARD_IDS,
  HIGH_CARD_IDS,
  POSITION_DECK,
  POSITION_LABELS,
  defaultCardName,
  isTarokkaPosition,
} from '../tarokka/deck.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface RefChoiceToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'listPlans' | 'listRecentChanges'>;
  logger: Logger;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const requestSchema = z.object({
  kind: z.enum(REF_KINDS as [RefKind, ...RefKind[]]),
  filter: z
    .object({
      types: z.array(z.string().max(60)).max(30).optional(),
      playerOwned: z.boolean().optional(),
      role: z.enum(['gm', 'player']).optional(),
      documentName: z.string().max(60).optional(),
      undoable: z.boolean().optional(),
      includeSystem: z.boolean().optional(),
    })
    .optional(),
  parent: z.string().max(300).optional(),
  query: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
});

type ChoicesRequest = z.infer<typeof requestSchema>;

/**
 * `list-ref-choices`: the candidates for a tool parameter that names something
 * (see `shared/src/tool-refs.ts`). The dashboard's tool runner calls it to fill
 * its pickers; the AI may use it too. Read-only.
 *
 * Plans, recorded changes and Tarokka cards are listed here; every
 * other kind (tokens, actors, journals, packs, ...) comes from the Foundry
 * module (`foundry-mcp-bridge.listRefChoices`).
 */
export class RefChoiceTools {
  private readonly foundryClient: RefChoiceToolsOptions['foundryClient'];
  private readonly guardedWrites: RefChoiceToolsOptions['guardedWrites'];
  private readonly logger: Logger;

  constructor(options: RefChoiceToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.guardedWrites = options.guardedWrites;
    this.logger = options.logger.child({ component: 'RefChoiceTools' });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'list-ref-choices',
        description:
          'List what a tool parameter can name right now, to pick instead of typing ids: tokens on a scene, actors, scenes, journals and pages, world items, an actor\'s items, combatants, users, folders, compendium packs and entries, playlists, map notes, conditions, modules, dnd5e skills and abilities, any world document by name (kind "document"), pending plans, recorded changes and Tarokka cards. Each row has id, uuid, name, detail and group. Read-only; GM only.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...REF_KINDS], description: 'What to list.' },
            filter: {
              type: 'object',
              description:
                'Optional narrowing: types (actor/item subtypes), playerOwned (actors), role ("gm" | "player"), documentName (folders, packs, compendium entries, document search), undoable (changes).',
            },
            parent: {
              type: 'string',
              description:
                'Narrows by a containing thing: the scene (id or name) for tokens/notes, the pack id for compendium entries, the actor for its items, the journal for its pages, the Tarokka position for cards.',
            },
            query: { type: 'string', description: 'Text to search in names (case-insensitive).' },
            limit: { type: 'integer', description: 'Maximum rows (default 200, max 500).' },
          },
          required: ['kind'],
        },
      },
    ];
  }

  async handleListRefChoices(args: unknown): Promise<RefChoicesResult> {
    const request = requestSchema.parse(args ?? {});
    if (!(BACKEND_REF_KINDS as readonly string[]).includes(request.kind)) {
      return this.fromFoundry(request);
    }
    const limit = request.limit ?? DEFAULT_LIMIT;
    const { choices, note } = await this.listBackendKind(request);
    const query = request.query?.trim().toLowerCase() ?? '';
    const matched = query
      ? choices.filter(c =>
          `${c.name} ${c.detail ?? ''} ${c.group ?? ''} ${c.id}`.toLowerCase().includes(query)
        )
      : choices;
    return {
      kind: request.kind,
      choices: matched.slice(0, limit),
      truncated: matched.length > limit,
      ...(note ? { note } : {}),
    };
  }

  private async fromFoundry(request: ChoicesRequest): Promise<RefChoicesResult> {
    const response = (await this.foundryClient.query(
      'foundry-mcp-bridge.listRefChoices',
      request
    )) as (RefChoicesResult & { success?: boolean; error?: string }) | null;
    if (!response || response.success === false) {
      throw new Error(response?.error ?? 'Foundry did not list the choices');
    }
    return {
      kind: request.kind,
      choices: Array.isArray(response.choices) ? response.choices : [],
      truncated: response.truncated === true,
      ...(response.note ? { note: response.note } : {}),
    };
  }

  private async listBackendKind(
    request: ChoicesRequest
  ): Promise<{ choices: RefChoice[]; note?: string }> {
    switch (request.kind) {
      case 'plan': {
        const plans = this.guardedWrites.listPlans();
        return {
          choices: plans.map(p => ({
            id: p.planId,
            name: p.summary,
            detail: `${p.risk}, expires ${p.expiresAt.slice(11, 16)} UTC`,
            group: p.feature,
          })),
          ...(plans.length === 0
            ? { note: 'No pending plans (plans expire after 15 minutes)' }
            : {}),
        };
      }
      case 'change': {
        const changes = await this.guardedWrites.listRecentChanges(100);
        const rows = request.filter?.undoable ? changes.filter(c => c.canUndo) : changes;
        return {
          choices: rows.map(c => ({
            id: c.changeId,
            name: c.summary,
            detail: `${c.mode}${c.canUndo ? '' : ', cannot be undone'}, ${c.appliedAt.replace('T', ' ').slice(0, 16)}`,
            group: c.feature,
          })),
          ...(rows.length === 0 ? { note: 'No recorded changes' } : {}),
        };
      }
      case 'tarokka-card': {
        const position = request.parent;
        const deck = position && isTarokkaPosition(position) ? POSITION_DECK[position] : undefined;
        const ids = [
          ...(deck !== 'high' ? COMMON_CARD_IDS : []),
          ...(deck !== 'common' ? HIGH_CARD_IDS : []),
        ];
        return {
          choices: ids.map(id => ({
            id,
            name: defaultCardName(id),
            group: (HIGH_CARD_IDS as readonly string[]).includes(id) ? 'High deck' : 'Common deck',
          })),
          ...(deck && position && isTarokkaPosition(position)
            ? { note: `${POSITION_LABELS[position]}: ${deck} deck` }
            : {}),
        };
      }
      default:
        this.logger.warn('Unhandled backend ref kind', { kind: request.kind });
        return { choices: [], note: `Nothing to list for ${request.kind}` };
    }
  }
}
