import { PLAYER_VIEW_QUERIES, toolRef, type PlayerVisibility } from '@gnuminator/shared';
import { z } from 'zod';

import type { FoundryClient } from '../foundry-client.js';
import type {
  HandoutsService,
  PageRevealPlan,
  PlayerHandoutsView,
  RevealedPageView,
} from '../handouts/service.js';
import type { Logger } from '../logger.js';
import type { SecretTermMatch, SecretTermsService } from '../secret-terms.js';
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

interface PlayerViewToolsOptions {
  handouts: Pick<HandoutsService, 'listRevealed' | 'playerHandouts' | 'planPageReveal'>;
  secretTerms: Pick<SecretTermsService, 'findSecretTerms'>;
  foundryClient: Pick<FoundryClient, 'query'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  logger: Logger;
}

function unwrap<T>(response: unknown, what: string): T {
  const r = response as { success?: unknown; error?: unknown } | null | undefined;
  if (r && typeof r === 'object' && r.success === false) {
    throw new Error(`${what}: ${typeof r.error === 'string' ? r.error : 'refused by Foundry'}`);
  }
  return response as T;
}

/**
 * Player-view tools (plan feature 2, M2). All GM-side and read-only except
 * `plan-page-reveal` (applied through `apply-planned-change`, like every
 * other guarded write). The dashboard is the only caller that shows any of
 * this to a player, and only after its own sanitizing and projection.
 */
export class PlayerViewTools {
  private readonly handouts: PlayerViewToolsOptions['handouts'];
  private readonly secretTerms: PlayerViewToolsOptions['secretTerms'];
  private readonly foundryClient: PlayerViewToolsOptions['foundryClient'];
  private readonly worldIds: PlayerViewToolsOptions['worldIds'];
  private readonly logger: Logger;

  constructor(options: PlayerViewToolsOptions) {
    this.handouts = options.handouts;
    this.secretTerms = options.secretTerms;
    this.foundryClient = options.foundryClient;
    this.worldIds = options.worldIds;
    this.logger = options.logger.child({ component: 'PlayerViewTools' });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get-player-visibility',
        description:
          'GM ONLY. What the players currently see, computed on the Foundry client: actor ids at least one player owns, the active scene as players know it (or a generic label), and which tokens on it players can see and by what name. Read-only.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list-revealed-pages',
        description:
          'GM ONLY. Every journal page on the player reveal allowlist (from any feature: Tarokka reveals, plan-page-reveal), with whether it still exists in Foundry and is currently observable by a player. Titles only, never page content. Read-only.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get-player-handouts',
        description:
          'GM ONLY. Allowlisted journal pages that exist and are currently observable by a player, with the raw GM HTML exactly as stored in Foundry. This is GM data for the dashboard server to sanitize before any player sees it: it is NOT player-safe by itself and must never be forwarded to a player client unsanitized. Read-only.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'plan-page-reveal',
        description:
          'Plan revealing a journal page to players, or hiding one already revealed. Reveal adds the page to the allowlist and, by default (setOwnership: true), raises its ownership to Observer if players cannot already see it, recording the previous ownership to restore later; refused if the page is already allowlisted and still observable. When no player can open the page\'s journal (typical for handouts inside a GM-only adventure chapter), the reveal instead COPIES the page into the player journal "Handouts" (created on first use, Observer for players): the copy gets the page\'s name and content, text without any secret blocks, or an image\'s source and caption; the source page and its journal are never changed. copy: true always copies, copy: false never does. Revealing the same source again updates its copy; only text and image pages can be copied. Destructive class (needs the second confirmation) because a reveal cannot be taken back at the table. Hide removes the page from the allowlist and, by default, restores the ownership recorded at reveal time; for a copied handout (pass the source or the copy) it deletes the copy, the "Handouts" journal stays. Write nothing but a title into the summary. Returns a planId for apply-planned-change, plus copy (where the copy goes) and note when the reveal copies.',
        inputSchema: {
          type: 'object',
          properties: {
            pageUuid: {
              type: 'string',
              description:
                'The journal page to reveal or hide, e.g. JournalEntry.abc123.JournalEntryPage.def456.',
              ...toolRef('journal-page', 'uuid'),
            },
            action: {
              type: 'string',
              enum: ['reveal', 'hide'],
              description: '"reveal" adds it to the player allowlist; "hide" removes it.',
            },
            setOwnership: {
              type: 'boolean',
              description:
                'Also change the page ownership (default true). False only changes the allowlist.',
            },
            copy: {
              type: 'boolean',
              description:
                'Reveal as a copy in the player journal "Handouts" (secret blocks left out, the source unchanged). Omit for automatic: copy exactly when no player can open the page\'s journal. True: always copy. False: never copy (raise the page instead).',
            },
          },
          required: ['pageUuid', 'action'],
        },
      },
      {
        name: 'check-secret-terms',
        description:
          "Check free text for whole-phrase, case-insensitive matches against known secret terms (currently the dealt Tarokka cards' names and the GM's name overrides for them). Use before sending a whisper or any GM-typed text toward players. Read-only.",
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'The text to check (1-5000 characters).',
            },
          },
          required: ['text'],
        },
      },
    ];
  }

  async handleGetPlayerVisibility(_args: unknown): Promise<PlayerVisibility> {
    return unwrap<PlayerVisibility>(
      await this.foundryClient.query(`foundry-mcp-bridge.${PLAYER_VIEW_QUERIES.visibility}`, {}),
      'Player visibility refused'
    );
  }

  async handleListRevealedPages(_args: unknown): Promise<{ pages: RevealedPageView[] }> {
    return { pages: await this.handouts.listRevealed() };
  }

  handleGetPlayerHandouts(_args: unknown): Promise<PlayerHandoutsView> {
    return this.handouts.playerHandouts();
  }

  async handlePlanPageReveal(args: unknown): Promise<PageRevealPlan> {
    const params = z
      .object({
        pageUuid: z.string().min(1).max(300),
        action: z.enum(['reveal', 'hide']),
        setOwnership: z.boolean().optional(),
        copy: z.boolean().optional(),
      })
      .parse(args ?? {});
    return this.logged('page reveal', () =>
      this.handouts.planPageReveal({
        pageUuid: params.pageUuid,
        action: params.action,
        ...(params.setOwnership !== undefined ? { setOwnership: params.setOwnership } : {}),
        ...(params.copy !== undefined ? { copy: params.copy } : {}),
      })
    );
  }

  async handleCheckSecretTerms(args: unknown): Promise<{ matches: SecretTermMatch[] }> {
    const params = z.object({ text: z.string().min(1).max(5000) }).parse(args ?? {});
    const worldId = await this.worldIds.current();
    return this.secretTerms.findSecretTerms(worldId, params.text);
  }

  private async logged<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(`Player view ${what} plan not created`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
