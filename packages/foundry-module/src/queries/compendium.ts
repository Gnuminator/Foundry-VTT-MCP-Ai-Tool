/**
 * Bridge handlers that read compendiums: search, rules search, creature lists, packs, full
 * documents, encounter suggestions and the Obsidian Library.
 */
import type { BridgeHandlerTable } from '../bridge-handlers.js';
import { MODULE_ID } from '../constants.js';
import {
  getLibraryDocuments,
  getLibraryIndex,
  LIBRARY_DOCUMENTS_QUERY,
  LIBRARY_INDEX_QUERY,
} from '../library-index.js';
import { withCtx, type DataArg, type QueryContext } from './context.js';

/**
 * Registration table: wire method name (after `${MODULE_ID}.`) and its kind. The kind decides
 * the write gate (write-gate.ts): `write` and `recordless-write` are refused while "Allow Write
 * Operations" is off; `read` is never gated.
 */
export function registerCompendiumHandlers(ctx: QueryContext, table: BridgeHandlerTable): void {
  table.set(`${MODULE_ID}.searchCompendium`, 'read', withCtx(ctx, searchCompendium));
  table.set(`${MODULE_ID}.searchRules`, 'read', withCtx(ctx, searchRules));
  table.set(`${MODULE_ID}.listCreaturesByCriteria`, 'read', withCtx(ctx, listCreaturesByCriteria));
  table.set(`${MODULE_ID}.getAvailablePacks`, 'read', () => getAvailablePacks(ctx));
  table.set(
    `${MODULE_ID}.getCompendiumDocumentFull`,
    'read',
    withCtx(ctx, getCompendiumDocumentFull)
  );
  table.set(
    `${MODULE_ID}.suggestBalancedEncounter`,
    'read',
    withCtx(ctx, suggestBalancedEncounter)
  );

  // Obsidian Library (read-only): compendium content of the packs the GM picked. GM client
  // only, like the export index (both queries refuse non-GM clients themselves).
  table.on(`${MODULE_ID}.${LIBRARY_INDEX_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to build the Library index', () => getLibraryIndex(data))
  );
  table.on(`${MODULE_ID}.${LIBRARY_DOCUMENTS_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to read Library documents', () => getLibraryDocuments(data))
  );
}

/**
 * Handle compendium search request
 */
async function searchCompendium(
  ctx: QueryContext,
  data: {
    query: string;
    packType?: string;
    filters?: {
      challengeRating?: number | { min?: number; max?: number };
      creatureType?: string;
      size?: string;
      alignment?: string;
      hasLegendaryActions?: boolean;
      spellcaster?: boolean;
    };
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to search compendium', async () => {
    // Add better parameter validation
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid data parameter structure');
    }

    if (!data.query || typeof data.query !== 'string') {
      throw new Error('query parameter is required and must be a string');
    }

    return await ctx.dataAccess.searchCompendium(data.query, data.packType, data.filters);
  });
}

/** Full-text rules search over allowlisted compendium journals and items (read-only). */
async function searchRules(
  ctx: QueryContext,
  data: {
    query: string;
    limit?: number;
    includeWorld?: boolean;
    excerptChars?: number;
    includeOtherBooks?: boolean;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to search rules', async () => {
    if (!data || typeof data.query !== 'string') {
      throw new Error('query parameter is required and must be a string');
    }
    return await ctx.dataAccess.searchRules(data);
  });
}

/**
 * Handle list creatures by criteria request
 */
async function listCreaturesByCriteria(
  ctx: QueryContext,
  data: {
    challengeRating?: number | { min?: number; max?: number };
    creatureType?: string;
    size?: string;
    hasSpells?: boolean;
    hasLegendaryActions?: boolean;
    limit?: number;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to list creatures by criteria', async () => {
    const result = await ctx.dataAccess.listCreaturesByCriteria(data);

    // Handle the new format with search summary
    return {
      response: result,
    };
  });
}

/**
 * Handle get available packs request
 */
async function getAvailablePacks(ctx: QueryContext): Promise<unknown> {
  return ctx.withGmGate('Failed to get available packs', async () => {
    return await ctx.dataAccess.getAvailablePacks();
  });
}

/**
 * Handle get compendium document full request
 */
async function getCompendiumDocumentFull(
  ctx: QueryContext,
  data: {
    packId: string;
    documentId: string;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to get compendium document', async () => {
    if (!data.packId) {
      throw new Error('packId is required');
    }

    if (!data.documentId) {
      throw new Error('documentId is required');
    }

    return await ctx.dataAccess.getCompendiumDocumentFull(data.packId, data.documentId);
  });
}

async function suggestBalancedEncounter(
  ctx: QueryContext,
  data: DataArg<'suggestBalancedEncounter'>
): Promise<unknown> {
  return ctx.withGmGate('Failed to suggest encounter', async () => {
    return await ctx.dataAccess.suggestBalancedEncounter(data || {});
  });
}
