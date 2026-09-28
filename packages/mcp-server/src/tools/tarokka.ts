import { freeText, toolRef } from '@gnuminator/shared';
import { z } from 'zod';

import type { PlanView } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';
import { TAROKKA_POSITIONS } from '../tarokka/deck.js';
import type { TarokkaService, TarokkaView } from '../tarokka/service.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface TarokkaToolsOptions {
  tarokka: Pick<
    TarokkaService,
    'getReading' | 'planImport' | 'planLinks' | 'planReveal' | 'suggestLinks'
  >;
  logger: Logger;
}

const POSITION_SCHEMA = {
  type: 'string',
  enum: [...TAROKKA_POSITIONS],
  description:
    'Reading position: tome, holySymbol, sunsword (common deck), ally, strahdLocation (high deck).',
};

const positionEnum = z.enum(TAROKKA_POSITIONS);

/**
 * Tarokka tools (plan feature 1). All read-only: the plan-* tools return a
 * planId that `apply-planned-change` applies after the GM confirms. Needs the
 * "AI Tool: Tarokka (writes)" switch in the module settings to apply.
 */
export class TarokkaTools {
  private readonly tarokka: TarokkaToolsOptions['tarokka'];
  private readonly logger: Logger;

  constructor(options: TarokkaToolsOptions) {
    this.tarokka = options.tarokka;
    this.logger = options.logger.child({ component: 'TarokkaTools' });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get-tarokka-reading',
        description:
          "GM ONLY. The current Tarokka reading from the bridge vault: each position's card, the GM's note, linked journal page / scene / actor, and whether it was revealed to players. Never share card names or locations with players unless the GM says so.",
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'plan-tarokka-import',
        description:
          'Plan storing a Tarokka reading in the bridge vault (GM-only, outside Foundry). source "auto" (default) takes the reading dealt in the tarokka-reading module when available, otherwise rolls one; "builtin-roll" always deals a fresh reading (3 common + 2 high cards, crypto random); "tarokka-reading" requires that module. A new reading archives the previous one. Returns a planId: show the diff to the GM, then apply-planned-change.',
        inputSchema: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              enum: ['auto', 'builtin-roll', 'tarokka-reading'],
              default: 'auto',
            },
            userId: {
              type: 'string',
              description:
                'The GM user who dealt in tarokka-reading, when that is another client than the bridge (Foundry 14.352+).',
              ...toolRef('user', 'id', { filter: { role: 'gm' } }),
            },
          },
        },
      },
      {
        name: 'suggest-tarokka-links',
        description:
          "Search the world's journals, journal pages, scenes and actors by name to find what a Tarokka card should link to. The GM chooses; nothing is changed.",
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Part of a name (2-100 characters).' },
            limit: { type: 'integer', description: 'Maximum results (default 20, max 50).' },
          },
          required: ['query'],
        },
      },
      {
        name: 'plan-tarokka-links',
        description:
          "Plan linking a position's card to a journal page, scene and/or actor (uuids), renaming the card, or clearing its links (clear: true, destructive). Links are kept per position and card, so the same card in the same position of a later reading is linked already. Pass cardId to link a card that is not in the current reading. Returns a planId for apply-planned-change.",
        inputSchema: {
          type: 'object',
          properties: {
            position: POSITION_SCHEMA,
            cardId: {
              type: 'string',
              description: 'Card id, e.g. swords-7 or raven.',
              ...toolRef('tarokka-card', 'id', { parent: 'position' }),
            },
            journalPageUuid: { type: 'string', ...toolRef('journal-page', 'uuid') },
            sceneUuid: { type: 'string', ...toolRef('scene', 'uuid') },
            actorUuid: { type: 'string', ...toolRef('actor', 'uuid') },
            cardName: {
              type: 'string',
              description: 'Display name for this card.',
              ...freeText('A new display name the GM types for the card'),
            },
            clear: { type: 'boolean', description: "Remove this card's links first." },
          },
          required: ['position'],
        },
      },
      {
        name: 'plan-tarokka-reveal',
        description:
          'Plan revealing one position to the players: publishes a page with exactly the text the GM wrote in a journal players can read (created on first use), and marks the position revealed. Destructive class (needs the second confirmation) because a reveal cannot be taken back at the table. Write only what the players may know. Returns a planId for apply-planned-change.',
        inputSchema: {
          type: 'object',
          properties: {
            position: POSITION_SCHEMA,
            text: {
              type: 'string',
              description: 'What the players read (1-5000 characters, plain text).',
            },
            title: { type: 'string', description: 'Page title (default "Card <n>").' },
            journalName: {
              type: 'string',
              description:
                'Name of the player journal when it is created (default "Tarokka reading").',
              ...freeText('The name for a journal that is created on first use'),
            },
          },
          required: ['position', 'text'],
        },
      },
    ];
  }

  handleGetTarokkaReading(_args: unknown): Promise<TarokkaView> {
    return this.tarokka.getReading();
  }

  async handlePlanTarokkaImport(args: unknown): Promise<PlanView> {
    const params = z
      .object({
        source: z.enum(['auto', 'builtin-roll', 'tarokka-reading']).optional(),
        userId: z.string().min(1).optional(),
      })
      .parse(args ?? {});
    return this.logged('import', () =>
      this.tarokka.planImport({
        ...(params.source ? { source: params.source } : {}),
        ...(params.userId ? { userId: params.userId } : {}),
      })
    );
  }

  async handleSuggestTarokkaLinks(args: unknown): Promise<unknown> {
    const params = z
      .object({
        query: z.string().min(2).max(100),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .parse(args ?? {});
    return this.tarokka.suggestLinks(params.query, params.limit);
  }

  async handlePlanTarokkaLinks(args: unknown): Promise<PlanView> {
    const params = z
      .object({
        position: positionEnum,
        cardId: z.string().min(1).max(40).optional(),
        journalPageUuid: z.string().min(1).optional(),
        sceneUuid: z.string().min(1).optional(),
        actorUuid: z.string().min(1).optional(),
        cardName: z.string().max(120).optional(),
        clear: z.boolean().optional(),
      })
      .parse(args ?? {});
    const { position, ...rest } = params;
    const defined = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined)
    );
    return this.logged('links', () => this.tarokka.planLinks({ position, ...defined }));
  }

  async handlePlanTarokkaReveal(args: unknown): Promise<PlanView> {
    const params = z
      .object({
        position: positionEnum,
        text: z.string().min(1).max(5000),
        title: z.string().max(120).optional(),
        journalName: z.string().max(120).optional(),
      })
      .parse(args ?? {});
    return this.logged('reveal', () =>
      this.tarokka.planReveal({
        position: params.position,
        text: params.text,
        ...(params.title !== undefined ? { title: params.title } : {}),
        ...(params.journalName !== undefined ? { journalName: params.journalName } : {}),
      })
    );
  }

  private async logged<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(`Tarokka ${what} plan not created`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
