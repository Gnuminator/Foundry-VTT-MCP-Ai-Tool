/**
 * Bridge handlers about journals: reading and writing them, the campaign dashboard status,
 * the session notes folder, "Show it now" and handout notices, link search and what players
 * can see.
 */
import type { BridgeHandlerTable } from '../bridge-handlers.js';
import { MODULE_ID } from '../constants.js';
import { getScenePages } from '../data-access/scene-pages.js';
import { ensureJournalFolder } from '../data-access/journal-folder.js';
import { postHandoutNotice, showJournalPage } from '../data-access/journal-show.js';
import {
  PLAYER_VIEW_QUERIES,
  computePlayerVisibility,
  pagesForPlayers,
} from '../player-visibility.js';
import { searchLinkCandidates } from '../tarokka.js';
import { withCtx, type QueryContext } from './context.js';

/**
 * Registration table: wire method name (after `${MODULE_ID}.`) and its kind. The kind decides
 * the write gate (write-gate.ts): `write` and `recordless-write` are refused while "Allow Write
 * Operations" is off; `read` is never gated.
 */
export function registerJournalHandlers(ctx: QueryContext, table: BridgeHandlerTable): void {
  table.set(`${MODULE_ID}.createJournalEntry`, 'write', withCtx(ctx, createJournalEntry));
  table.set(`${MODULE_ID}.listJournals`, 'read', () => listJournals(ctx));
  table.set(`${MODULE_ID}.getJournalContent`, 'read', withCtx(ctx, getJournalContent));
  table.set(`${MODULE_ID}.getJournalPageContent`, 'read', withCtx(ctx, getJournalPageContent));
  // The pages a scene links (read-aloud shelf, I-167; GM-only, read-only)
  table.set(`${MODULE_ID}.getScenePages`, 'read', (data: { sceneId?: unknown } | undefined) =>
    ctx.withGmGate('Failed to get the scene pages', () =>
      Promise.resolve(getScenePages(typeof data?.sceneId === 'string' ? data.sceneId : undefined))
    )
  );
  table.set(`${MODULE_ID}.updateJournalContent`, 'write', withCtx(ctx, updateJournalContent));

  // The session notes folder (recap lane, D-087; GM-only)
  table.on(`${MODULE_ID}.ensureJournalFolder`, 'recordless-write', (data: unknown) =>
    ctx.withGmGate('Failed to find or create the journal folder', () => ensureJournalFolder(data))
  );
  // "Show it now" (I-110): pops a page up on the players' screens (Show Players)
  table.on(`${MODULE_ID}.showJournalPage`, 'recordless-write', (data: unknown) =>
    ctx.withGmGate('Failed to show the page to the players', () => showJournalPage(data))
  );
  // A handout reveal's chat notice: a whisper that names the page and links to it
  table.on(`${MODULE_ID}.postHandoutNotice`, 'recordless-write', (data: unknown) =>
    ctx.withGmGate('Failed to post the handout notice', () => postHandoutNotice(data))
  );

  // Tarokka (read-only; the backend stores readings in its vault)
  table.set(
    `${MODULE_ID}.searchLinkCandidates`,
    'read',
    (data: { query?: unknown; limit?: unknown } | undefined) =>
      ctx.withGmGate('Failed to search link candidates', () =>
        Promise.resolve(searchLinkCandidates(data))
      )
  );

  // Player view (M2, read-only): what players can currently see, computed
  // on the GM client, and journal-page lookups for the handouts picker.
  table.set(`${MODULE_ID}.${PLAYER_VIEW_QUERIES.visibility}`, 'read', () =>
    ctx.withGmGate('Failed to get player visibility', () =>
      Promise.resolve(computePlayerVisibility())
    )
  );
  table.on(
    `${MODULE_ID}.${PLAYER_VIEW_QUERIES.pages}`,
    'read',
    (data: { uuids?: unknown } | undefined) =>
      ctx.withGmGate('Failed to get pages for players', () =>
        Promise.resolve(pagesForPlayers(data?.uuids))
      )
  );
}

/**
 * Handle journal entry creation
 */
async function createJournalEntry(
  ctx: QueryContext,
  data: {
    name: string;
    content: string;
    folderName?: string | undefined;
    additionalPages?: Array<{ name: string; content: string }> | undefined;
  }
): Promise<unknown> {
  try {
    // SECURITY: Silent GM validation
    const gmCheck = ctx.validateGMAccess();
    if (!gmCheck.allowed) {
      return { error: 'Access denied', success: false };
    }

    if (!data.name) {
      throw new Error('name is required');
    }
    if (!data.content) {
      throw new Error('content is required');
    }

    return await ctx.dataAccess.createJournalEntry({
      name: data.name,
      content: data.content,
      ...(data.additionalPages !== undefined && { additionalPages: data.additionalPages }),
      ...(data.folderName !== undefined && { folderName: data.folderName }),
    });
  } catch (error) {
    throw new Error(
      `Failed to create journal entry: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error }
    );
  }
}

/**
 * Handle list journals request
 */
async function listJournals(ctx: QueryContext): Promise<unknown> {
  return ctx.withGmGate('Failed to list journals', async () => {
    return await ctx.dataAccess.listJournals();
  });
}

/**
 * Handle get journal content request
 */
async function getJournalContent(ctx: QueryContext, data: { journalId: string }): Promise<unknown> {
  return ctx.withGmGate('Failed to get journal content', async () => {
    if (!data.journalId) {
      throw new Error('journalId is required');
    }

    return await ctx.dataAccess.getJournalContent(data.journalId);
  });
}

/**
 * Handle get specific journal page content request
 */
async function getJournalPageContent(
  ctx: QueryContext,
  data: { journalId: string; pageId: string }
): Promise<unknown> {
  return ctx.withGmGate('Failed to get journal page content', async () => {
    if (!data.journalId) {
      throw new Error('journalId is required');
    }
    if (!data.pageId) {
      throw new Error('pageId is required');
    }

    return await ctx.dataAccess.getJournalPageContent(data.journalId, data.pageId);
  });
}

/**
 * Handle update journal content request
 */
async function updateJournalContent(
  ctx: QueryContext,
  data: {
    journalId: string;
    content: string;
    pageId?: string;
    newPageName?: string;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to update journal content', async () => {
    if (!data.journalId) {
      throw new Error('journalId is required');
    }
    if (!data.content) {
      throw new Error('content is required');
    }

    const updateRequest: {
      journalId: string;
      content: string;
      pageId?: string | undefined;
      newPageName?: string | undefined;
    } = {
      journalId: data.journalId,
      content: data.content,
    };
    if (data.pageId) updateRequest.pageId = data.pageId;
    if (data.newPageName) updateRequest.newPageName = data.newPageName;

    return await ctx.dataAccess.updateJournalContent(updateRequest);
  });
}
