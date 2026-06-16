import * as shared from './shared.js';
import { permissionManager } from '../permissions.js';

/** Summary of a journal page as surfaced to tool consumers. */
interface PageSummary {
  id: string;
  name: string;
  type: string;
}

/**
 * Journal read + write domain for `FoundryDataAccess`.
 *
 * Backs the quest/lore tools: listing journals, reading a journal's first text
 * page (or a specific page), creating multi-page quest entries, and editing
 * existing pages. Foundry's `JournalEntry` documents are duck-typed throughout
 * (`game.journal` is a Collection of entries; each entry's `.pages` is an
 * embedded Collection), so everything is read defensively with `|| ''`-style
 * fallbacks — Foundry hands us partially-populated docs in the wild.
 *
 * Writes go through {@link permissionManager} at the `createActor` risk level
 * (journals are treated as equivalent to actor creation for the safety gate) and
 * are recorded via {@link shared.auditLog}.
 */
export class JournalDataAccess {
  // ===== READS =====

  /**
   * List every journal entry with lightweight page metadata. The `pageCount`
   * reflects the live embedded-collection size; `pages` carries an id/name/type
   * summary per page so a caller can follow up with {@link getJournalPageContent}.
   */
  async listJournals(): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      pageCount: number;
      pages: PageSummary[];
    }>
  > {
    shared.validateFoundryState();

    return game.journal.map((journal: any) => ({
      id: journal.id || '',
      name: journal.name || '',
      type: 'JournalEntry',
      pageCount: journal.pages?.size || 0,
      pages: this.summarizePages(journal),
    }));
  }

  /**
   * Read a journal's primary text content: the first `text`-type page, plus a
   * manifest of every page. Returns `null` when the journal id is unknown.
   *
   * - No text page at all → `{ content: '', allPages, pageCount }` (no
   *   `currentPage`/`note` keys, signalling "nothing readable here").
   * - One page → `note` is `undefined`.
   * - Many pages → `note` lists the other pages so the caller knows to fetch
   *   them individually.
   */
  async getJournalContent(journalId: string): Promise<{
    content: string;
    currentPage?: { id: string; name: string } | undefined;
    allPages: PageSummary[];
    pageCount: number;
    note?: string | undefined;
  } | null> {
    shared.validateFoundryState();

    const journal = game.journal.get(journalId);
    if (!journal) {
      return null;
    }

    const allPages = this.summarizePages(journal);
    const pageCount = allPages.length;

    const firstText = journal.pages.find((page: any) => page.type === 'text');
    if (!firstText) {
      // No prose to surface — return the manifest only, omitting currentPage/note.
      return { content: '', allPages, pageCount };
    }

    return {
      content: firstText.text?.content || '',
      currentPage: { id: firstText.id || '', name: firstText.name || '' },
      allPages,
      pageCount,
      note: pageCount > 1 ? this.buildPageManifestNote(pageCount, allPages) : undefined,
    };
  }

  /**
   * Read one page by id. Returns `null` if the journal or the page is unknown.
   * Text pages expose their HTML `text.content`; any other page type exposes its
   * `src` instead. (The reported `type` falls back to `'text'`, but the
   * content branch keys off the *raw* type — an untyped page therefore reads its
   * `src`, matching the historical behavior.)
   */
  async getJournalPageContent(
    journalId: string,
    pageId: string
  ): Promise<{ id: string; name: string; type: string; content: string } | null> {
    shared.validateFoundryState();

    const journal = game.journal.get(journalId);
    if (!journal) {
      return null;
    }

    const page = journal.pages.get(pageId);
    if (!page) {
      return null;
    }

    return {
      id: page.id || '',
      name: page.name || '',
      type: page.type || 'text',
      content: page.type === 'text' ? page.text?.content || '' : page.src || '',
    };
  }

  // ===== WRITES =====

  /**
   * Create a journal entry for a quest. The supplied `content` becomes a
   * "Quest Details" text page; each `additionalPages` entry becomes a further
   * text page. The entry is GM-only by default and is filed under a folder named
   * for `folderName` (or the entry name when omitted).
   */
  async createJournalEntry(request: {
    name: string;
    content: string;
    folderName?: string;
    additionalPages?: Array<{ name: string; content: string }>;
  }): Promise<{ id: string; name: string; pageCount: number }> {
    shared.validateFoundryState();
    this.requireJournalWrite('creation');

    try {
      // Main "Quest Details" page first, then any extra pages, all as text.
      const pages = [
        { type: 'text', name: 'Quest Details', text: { content: request.content } },
        ...(request.additionalPages ?? []).map(page => ({
          type: 'text',
          name: page.name,
          text: { content: page.content },
        })),
      ];

      const journal = await JournalEntry.create({
        name: request.name,
        pages,
        ownership: { default: 0 }, // GM only by default
        folder: await shared.getOrCreateFolder(request.folderName || request.name, 'JournalEntry'),
      });

      if (!journal) {
        throw new Error('Failed to create journal entry');
      }

      const result = {
        id: journal.id,
        name: journal.name || request.name,
        pageCount: pages.length,
      };

      shared.auditLog('createJournalEntry', request, 'success');
      return result;
    } catch (error) {
      shared.auditLog('createJournalEntry', request, 'failure', this.errorMessage(error));
      throw error;
    }
  }

  /**
   * Edit a journal's content. Three modes, checked in this order:
   *   1. `newPageName` set → append a brand-new text page (wins over `pageId`).
   *   2. `pageId` set → overwrite that specific page (throws if it's missing).
   *   3. neither → overwrite the first text page, creating a "Quest Details"
   *      page if the journal has none yet.
   * Returns the affected page's id/name.
   */
  async updateJournalContent(request: {
    journalId: string;
    content: string;
    pageId?: string | undefined;
    newPageName?: string | undefined;
  }): Promise<{ success: boolean; pageId?: string | undefined; pageName?: string | undefined }> {
    shared.validateFoundryState();
    this.requireJournalWrite('update');

    try {
      const journal = game.journal.get(request.journalId);
      if (!journal) {
        throw new Error('Journal entry not found');
      }

      let result: { success: boolean; pageId: string; pageName: string };

      if (request.newPageName) {
        // Mode 1: append a new page.
        const page = await this.createTextPage(journal, request.newPageName, request.content);
        result = { success: true, pageId: page?.id || '', pageName: request.newPageName };
      } else if (request.pageId) {
        // Mode 2: overwrite a page selected by id.
        const page = journal.pages.get(request.pageId);
        if (!page) {
          throw new Error(`Page not found: ${request.pageId}`);
        }
        await page.update({ 'text.content': request.content });
        result = { success: true, pageId: page.id, pageName: page.name };
      } else {
        // Mode 3: overwrite the first text page, or seed one if absent.
        const firstText = journal.pages.find((page: any) => page.type === 'text');
        if (firstText) {
          await firstText.update({ 'text.content': request.content });
          result = { success: true, pageId: firstText.id, pageName: firstText.name };
        } else {
          const page = await this.createTextPage(journal, 'Quest Details', request.content);
          result = { success: true, pageId: page?.id || '', pageName: 'Quest Details' };
        }
      }

      shared.auditLog('updateJournalContent', request, 'success');
      return result;
    } catch (error) {
      shared.auditLog('updateJournalContent', request, 'failure', this.errorMessage(error));
      throw error;
    }
  }

  // ===== internals =====

  /** id/name/type summary for each page, defaulting missing types to `'text'`. */
  private summarizePages(journal: any): PageSummary[] {
    return (
      journal.pages?.map((page: any) => ({
        id: page.id || '',
        name: page.name || '',
        type: page.type || 'text',
      })) || []
    );
  }

  /** The "this journal has N pages …" hint listing every page by name + id. */
  private buildPageManifestNote(pageCount: number, pages: PageSummary[]): string {
    const manifest = pages.map(page => `"${page.name}" (${page.id})`).join(', ');
    return `This journal has ${pageCount} pages. Use list-journals with journalId and pageId to read other pages: ${manifest}`;
  }

  /** Append a single text page to a journal and return the created page (if any). */
  private async createTextPage(journal: any, name: string, content: string): Promise<any> {
    const created = await journal.createEmbeddedDocuments('JournalEntryPage', [
      { type: 'text', name, text: { content } },
    ]);
    return created?.[0];
  }

  /**
   * Gate a journal write through the permission manager. Journals reuse the
   * `createActor` risk level (quantity 1). Throws `Journal <action> denied: …`
   * when the operation isn't allowed.
   */
  private requireJournalWrite(action: 'creation' | 'update'): void {
    const check = permissionManager.checkWritePermission('createActor', { quantity: 1 });
    if (!check.allowed) {
      throw new Error(`Journal ${action} denied: ${check.reason}`);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
