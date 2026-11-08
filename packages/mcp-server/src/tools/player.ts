import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { freeText } from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';
import type { SecretTermsService } from '../secret-terms.js';
import type { WorldIdResolver } from '../vault/world-id.js';

/**
 * The player set (D-136): a player's own Claude reads their character and the books their Foundry
 * user can see. Read-only. These tools are NOT in the call_tool router: the only way to run one is
 * the control message `player_tool`, whose user id comes from the dashboard's verified login. The
 * scope itself (own actors, packs the user can observe, the hard denylist) is enforced in the
 * module's `playerRead` query; this class adds the last-line term filter and the size caps.
 */

/** Always hidden from a player's book results, whatever the packs say (design section 4). */
export const PLAYER_BASE_DENY_TERMS: readonly string[] = [
  'Strahd',
  'Barovia',
  'Ravenloft',
  'Tarokka',
  'Ireena',
  'Vallaki',
];

/** Longest excerpt, search results and entry description handed to a player (characters). */
export const PLAYER_EXCERPT_CHARS = 600;
export const PLAYER_ENTRY_CHARS = 6000;
export const PLAYER_SEARCH_LIMIT = 10;
export const PLAYER_FIND_LIMIT = 20;

export const PLAYER_TOOL_NAMES = [
  'get-my-character',
  'get-my-level-up-options',
  'search-books',
  'find-book-entries',
  'get-book-entry',
] as const;

export type PlayerToolName = (typeof PLAYER_TOOL_NAMES)[number];

interface PlayerToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
  secretTerms: Pick<SecretTermsService, 'findSecretTermsInMany'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  /** Extra deny terms from the Pi config (read at each call, so an edit needs no restart). */
  extraDenyTerms?: () => readonly string[];
}

interface BookHit {
  packId?: string;
  packLabel?: string;
  documentId?: string;
  documentType?: string;
  name?: string;
  pageId?: string;
  pageName?: string;
  snippet?: string;
}

const queryName = freeText('A character name of the player, as shown on their sheet.');

const searchArgs = z.object({
  query: z.string().min(2).max(200),
  limit: z.number().int().min(1).max(PLAYER_SEARCH_LIMIT).optional(),
});
const findArgs = z.object({
  query: z.string().max(200).optional(),
  type: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(PLAYER_FIND_LIMIT).optional(),
});
const entryArgs = z.object({
  packId: z.string().min(1).max(200),
  entryId: z.string().min(1).max(64),
});
const characterArgs = z.object({ name: z.string().max(100).optional() });
const levelUpArgs = z.object({
  name: z.string().max(100).optional(),
  className: z.string().max(100).optional(),
});

/**
 * The control message `player_tool`: `params` is `{ tool, args, userId }`. Anything but a player
 * tool, a missing or blank userId or a failed read answers with an error payload (never throws).
 */
export async function handlePlayerTool(
  tools: Pick<PlayerTools, 'run'>,
  params: unknown
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  const p = (params ?? {}) as { tool?: unknown; args?: unknown; userId?: unknown };
  try {
    const result = await tools.run(p.tool, p.args, p.userId);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'The request failed.';
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
}

/** Env var naming the Pi's `player-connector.json`; its optional `denyTerms` list extends the filter. */
export const PLAYER_CONFIG_ENV = 'FOUNDRY_AI_PLAYER_CONNECTOR_CONFIG';

/** The `denyTerms` strings of the config file, or none (missing file, bad JSON, wrong shape). */
export function readExtraDenyTerms(path: string | undefined): string[] {
  if (!path) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { denyTerms?: unknown };
    return Array.isArray(parsed.denyTerms)
      ? parsed.denyTerms.filter((t): t is string => typeof t === 'string')
      : [];
  } catch {
    return [];
  }
}

function cap(text: unknown, max: number): string {
  const s = typeof text === 'string' ? text : '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export class PlayerTools {
  private readonly foundryClient: FoundryClient;
  private readonly logger: Logger;
  private readonly secretTerms: PlayerToolsOptions['secretTerms'];
  private readonly worldIds: PlayerToolsOptions['worldIds'];
  private readonly extraDenyTerms: () => readonly string[];

  constructor(options: PlayerToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'PlayerTools' });
    this.secretTerms = options.secretTerms;
    this.worldIds = options.worldIds;
    this.extraDenyTerms = options.extraDenyTerms ?? ((): readonly string[] => []);
  }

  getToolDefinitions(): Array<{ name: string; description: string; inputSchema: object }> {
    return [
      {
        name: 'get-my-character',
        description:
          'Your own character sheet(s): abilities, class and level, hit points, proficiencies, spells, features and inventory. Only characters you own. Read-only.',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string', ...queryName } },
        },
      },
      {
        name: 'get-my-level-up-options',
        description:
          'Advice only, changes nothing: what your next class level grants and the choices still open (hit points, ASI or feat, subclass, spells). Only your own characters.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', ...queryName },
            className: {
              type: 'string',
              ...freeText('A class name such as "wizard"; omit for every class.'),
            },
          },
        },
      },
      {
        name: 'search-books',
        description:
          'Search the rulebooks you can read for a rule or term. Returns short excerpts; open one with get-book-entry.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', ...freeText('Words to look for, e.g. "grappling".') },
            limit: { type: 'integer', description: 'Results, 1 to 10 (default 5).' },
          },
          required: ['query'],
        },
      },
      {
        name: 'find-book-entries',
        description:
          'Find entries by name or type (classes, species, backgrounds, feats, spells, items) for building a character. Open one with get-book-entry.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', ...freeText('Part of the entry name.') },
            type: {
              type: 'string',
              ...freeText('An entry type such as class, race, background, feat, spell, weapon.'),
            },
            limit: { type: 'integer', description: 'Results, 1 to 20 (default 10).' },
          },
        },
      },
      {
        name: 'get-book-entry',
        description:
          'One book entry with its description (cut at about 6,000 characters). Use the packId and entryId from search-books or find-book-entries.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: {
              type: 'string',
              ...freeText('The packId from a search-books or find-book-entries result.'),
            },
            entryId: { type: 'string', ...freeText('The entryId (documentId) from a result.') },
          },
          required: ['packId', 'entryId'],
        },
      },
    ];
  }

  /**
   * Run one player tool for `userId`. The id is the verified one from the control message; the
   * tool arguments never carry one (a `userId`, `includeWorld` or `includeOtherBooks` in `args`
   * is dropped by the schemas below).
   */
  async run(tool: unknown, args: unknown, userId: unknown): Promise<unknown> {
    if (typeof userId !== 'string' || userId.trim() === '') {
      throw new Error('No player identity');
    }
    if (typeof tool !== 'string' || !(PLAYER_TOOL_NAMES as readonly string[]).includes(tool)) {
      throw new Error('Not a player tool');
    }
    const id = userId.trim();
    this.logger.info('Player tool call', { tool, userId: id });
    const read = (data: Record<string, unknown>): Promise<unknown> =>
      this.foundryClient.query('foundry-mcp-bridge.playerRead', { userId: id, ...data });

    switch (tool as PlayerToolName) {
      case 'get-my-character': {
        const a = characterArgs.parse(args ?? {});
        return read({ action: 'character', ...(a.name ? { name: a.name } : {}) });
      }
      case 'get-my-level-up-options': {
        const a = levelUpArgs.parse(args ?? {});
        return read({
          action: 'levelUp',
          ...(a.name ? { name: a.name } : {}),
          ...(a.className ? { className: a.className } : {}),
        });
      }
      case 'search-books': {
        const a = searchArgs.parse(args ?? {});
        const raw = (await read({
          action: 'searchBooks',
          query: a.query,
          limit: Math.min(a.limit ?? 5, PLAYER_SEARCH_LIMIT),
          excerptChars: PLAYER_EXCERPT_CHARS,
        })) as { query?: string; results?: BookHit[]; note?: string } | undefined;
        const hits = (Array.isArray(raw?.results) ? raw.results : []).map(h => ({
          ...h,
          snippet: cap(h.snippet, PLAYER_EXCERPT_CHARS),
        }));
        const { kept, hidden } = await this.filter(hits, h => [h.name, h.pageName, h.snippet]);
        return {
          query: raw?.query ?? a.query,
          results: kept.slice(0, PLAYER_SEARCH_LIMIT),
          ...(hidden > 0 ? { note: `${hidden} result${hidden === 1 ? '' : 's'} hidden` } : {}),
          ...(raw?.note && hidden === 0 ? { note: raw.note } : {}),
        };
      }
      case 'find-book-entries': {
        const a = findArgs.parse(args ?? {});
        const raw = (await read({
          action: 'findEntries',
          ...(a.query ? { query: a.query } : {}),
          ...(a.type ? { type: a.type } : {}),
          limit: Math.min(a.limit ?? 10, PLAYER_FIND_LIMIT),
        })) as { results?: Array<{ name?: string }> } | undefined;
        const { kept, hidden } = await this.filter(
          Array.isArray(raw?.results) ? raw.results : [],
          r => [r.name]
        );
        return {
          results: kept.slice(0, PLAYER_FIND_LIMIT),
          ...(hidden > 0 ? { note: `${hidden} result${hidden === 1 ? '' : 's'} hidden` } : {}),
        };
      }
      case 'get-book-entry': {
        const a = entryArgs.parse(args ?? {});
        const raw = (await read({ action: 'getEntry', packId: a.packId, entryId: a.entryId })) as
          | { name?: string; description?: string; truncated?: boolean }
          | undefined;
        const description = cap(raw?.description, PLAYER_ENTRY_CHARS);
        const { hidden } = await this.filter([raw ?? {}], e => [e.name, description]);
        if (hidden > 0) return { note: '1 result hidden' };
        return {
          ...raw,
          description,
          ...(description.length < (raw?.description?.length ?? 0) ? { truncated: true } : {}),
        };
      }
    }
  }

  /**
   * The last-line term filter: an item whose texts hold a base, configured or secret term is
   * dropped and counted. A safety net under the pack rules, not the main gate.
   */
  private async filter<T>(
    items: readonly T[],
    textsOf: (item: T) => Array<string | undefined>
  ): Promise<{ kept: T[]; hidden: number }> {
    if (items.length === 0) return { kept: [], hidden: 0 };
    const terms = [...PLAYER_BASE_DENY_TERMS, ...this.extraDenyTerms()]
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length >= 3);
    const joined = items.map(i => textsOf(i).filter(Boolean).join('\n'));
    let secret: Array<Array<unknown>> = joined.map(() => []);
    try {
      const worldId = await this.worldIds.current();
      secret = await this.secretTerms.findSecretTermsInMany(worldId, joined);
    } catch (error) {
      // Base and configured terms still apply; the live Tarokka terms need a known world.
      this.logger.warn('Player filter: secret terms unavailable', { error: String(error) });
    }
    const kept: T[] = [];
    let hidden = 0;
    items.forEach((item, i) => {
      const lower = joined[i].toLowerCase();
      if (terms.some(t => lower.includes(t)) || (secret[i]?.length ?? 0) > 0) hidden++;
      else kept.push(item);
    });
    return { kept, hidden };
  }
}
