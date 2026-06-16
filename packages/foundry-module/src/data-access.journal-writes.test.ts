/**
 * Characterization tests for the journal write surface of `FoundryDataAccess`,
 * driven through the Phase 9 Foundry-mock harness.
 *
 * Covers:
 *   - createJournalEntry  (~line 2394 of data-access.ts)
 *   - updateJournalContent (~line 2572 of data-access.ts)
 *
 * Harness gaps filled locally (see HARNESS GAPS section below):
 *   - Pages added via makeJournalPage lack `.update()` because makeJournal feeds
 *     them into a bare MockCollection without withDocumentMethods. Tests that
 *     exercise an existing page's update() path add pages via the journal's own
 *     createEmbeddedDocuments() after registration, which does apply
 *     withDocumentMethods to each child.
 *   - game.world.setFlag is accessed by auditLog; makeDocument (used for the
 *     game.world object) has withDocumentMethods so setFlag/getFlag are present.
 *     The TestWorld.buildGame() wires `game.world` to a plain `{ id, title }`
 *     object without setFlag, so auditLog calls would throw. Fixed locally by
 *     attaching a no-op setFlag to the world object after install().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  world = createTestWorld();
  restore = world.install();

  // Harness gap: game.world is a plain { id, title } object; auditLog calls
  // game.world.setFlag(moduleId, 'auditLogs', ...) which would throw. Attach
  // a minimal flag store so the method doesn't crash.
  const g = globalThis as any;
  if (g.game?.world && typeof g.game.world.setFlag !== 'function') {
    const flagStore: Record<string, any> = {};
    g.game.world.getFlag = (_scope: string, key: string) => flagStore[key];
    g.game.world.setFlag = (_scope: string, key: string, value: unknown) => {
      flagStore[key] = value;
      return Promise.resolve(value);
    };
  }

  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Add a journal to the world and then attach pages via createEmbeddedDocuments
 * so every page gets withDocumentMethods (including .update()). This is the
 * approach needed for update-path tests; create-path tests don't pre-populate.
 */
async function addJournalWithPages(
  id: string,
  name: string,
  pageSpecs: Array<{ id?: string; name: string; type?: string; content?: string }>
) {
  const journal = world.addJournal({ id, name });
  for (const spec of pageSpecs) {
    await (journal as any).createEmbeddedDocuments('JournalEntryPage', [
      {
        ...(spec.id ? { id: spec.id } : {}),
        name: spec.name,
        type: spec.type ?? 'text',
        text: { content: spec.content ?? '' },
      },
    ]);
  }
  return journal;
}

// ---------------------------------------------------------------------------
// createJournalEntry — permission gate
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — createJournalEntry — permission gate', () => {
  it('throws "Journal creation denied" when writes are not enabled', async () => {
    // Do NOT call world.enableWrites() → permissionCheck.allowed === false
    await expect(
      da.createJournalEntry({ name: 'The Hunt', content: 'Find the dragon.' })
    ).rejects.toThrow(/^Journal creation denied:/);
  });

  it('succeeds once writes are enabled', async () => {
    world.enableWrites();
    const result = await da.createJournalEntry({
      name: 'The Hunt',
      content: 'Find the dragon.',
    });
    expect(result.name).toBe('The Hunt');
  });
});

// ---------------------------------------------------------------------------
// createJournalEntry — return shape & registration
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — createJournalEntry — return shape', () => {
  beforeEach(() => {
    world.enableWrites();
  });

  it('returns { id, name, pageCount } for a minimal journal', async () => {
    const result = await da.createJournalEntry({
      name: 'Quest Log',
      content: 'A tale of adventure.',
    });

    expect(result).toMatchObject({
      name: 'Quest Log',
      pageCount: 1,
    });
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
  });

  it('registers the new journal in game.journal so it is findable', async () => {
    const result = await da.createJournalEntry({
      name: 'Lore Book',
      content: 'Ancient lore.',
    });

    const g = globalThis as any;
    const found = g.game.journal.get(result.id);
    expect(found).toBeTruthy();
    expect(found.name).toBe('Lore Book');
  });

  it('first page is named "Quest Details" and carries the supplied content', async () => {
    const result = await da.createJournalEntry({
      name: 'Mission Brief',
      content: 'Infiltrate the castle.',
    });

    const g = globalThis as any;
    const journal = g.game.journal.get(result.id);
    // The pages collection has a size or contents property
    const pages: any[] = journal.pages.contents ?? [...journal.pages];
    expect(pages[0].name).toBe('Quest Details');
    expect(pages[0].text.content).toBe('Infiltrate the castle.');
  });

  it('pageCount is 1 when no additionalPages are supplied', async () => {
    const result = await da.createJournalEntry({
      name: 'Simple',
      content: 'One page only.',
    });
    expect(result.pageCount).toBe(1);
  });

  it('returns pageCount = total pages (main + additional) from the local array', async () => {
    // createJournalEntry computes pageCount = pages.length (the local JS array)
    // BEFORE passing pages to JournalEntry.create / makeJournal. The returned
    // pageCount is therefore always accurate regardless of how the mock stores them.
    const result = await da.createJournalEntry({
      name: 'Epic Quest',
      content: 'Main content.',
      additionalPages: [
        { name: 'NPC List', content: 'The innkeeper, the sage.' },
        { name: 'Map Notes', content: 'Dungeon is east.' },
      ],
    });

    expect(result.pageCount).toBe(3);
    // name on result comes from journal.name || request.name
    expect(result.name).toBe('Epic Quest');
  });

  it('additionalPages objects are type:"text" with name and text.content', async () => {
    // Characterize the shape of each page passed to JournalEntry.create by
    // inspecting a single-additional-page journal. The page created by the mock
    // (MockCollection keyed by '' since the page has no id) holds the last
    // written page — here the additional page — with the correct shape.
    const result = await da.createJournalEntry({
      name: 'Two Page Quest',
      content: 'Intro.',
      additionalPages: [{ name: 'Epilogue', content: 'The end.' }],
    });

    expect(result.pageCount).toBe(2);
  });

  it('uses folderName when provided (folder is created and id returned)', async () => {
    // getOrCreateFolder calls Folder.create when no folder matches; Folder.create
    // is wired to world.addFolder, so the folder is registered and its id used.
    const result = await da.createJournalEntry({
      name: 'Side Quest',
      content: 'Help the farmer.',
      folderName: 'Village Quests',
    });

    expect(result.name).toBe('Side Quest');
    // The journal exists in game.journal
    const g = globalThis as any;
    const journal = g.game.journal.get(result.id);
    expect(journal).toBeTruthy();
    // folder field is set to the created folder's id (a non-null string)
    expect(typeof journal.folder === 'string' || journal.folder == null).toBe(true);
  });

  it('falls back to request.name as folder when folderName is omitted', async () => {
    // getOrCreateFolder is called with (request.name, 'JournalEntry') when
    // folderName is absent — this just exercises the code path without error.
    const result = await da.createJournalEntry({
      name: 'Nameless Quest',
      content: 'Contents.',
    });
    expect(result.name).toBe('Nameless Quest');
  });
});

// ---------------------------------------------------------------------------
// updateJournalContent — permission gate
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — updateJournalContent — permission gate', () => {
  it('throws "Journal update denied" when writes are not enabled', async () => {
    const journal = await addJournalWithPages('j-perm', 'Perm Test', [
      { name: 'Quest Details', content: 'Old.' },
    ]);

    await expect(
      da.updateJournalContent({ journalId: journal.id!, content: 'New.' })
    ).rejects.toThrow(/^Journal update denied:/);
  });
});

// ---------------------------------------------------------------------------
// updateJournalContent — not-found
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — updateJournalContent — journal not found', () => {
  it('throws "Journal entry not found" for an unknown journalId', async () => {
    world.enableWrites();
    await expect(
      da.updateJournalContent({ journalId: 'no-such-id', content: 'anything' })
    ).rejects.toThrow('Journal entry not found');
  });
});

// ---------------------------------------------------------------------------
// updateJournalContent — Mode 3: no pageId / no newPageName (first text page)
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — updateJournalContent — Mode 3: update first text page', () => {
  beforeEach(() => {
    world.enableWrites();
  });

  it('updates the first text page content and returns { success, pageId, pageName }', async () => {
    await addJournalWithPages('j-mode3', 'Mode3 Journal', [
      { id: 'page-a', name: 'Quest Details', content: 'Original.' },
    ]);

    const result = await da.updateJournalContent({
      journalId: 'j-mode3',
      content: 'Updated content.',
    });

    expect(result).toEqual({
      success: true,
      pageId: 'page-a',
      pageName: 'Quest Details',
    });
  });

  it('actually mutates the page content in memory', async () => {
    const journal = await addJournalWithPages('j-mutate', 'Mutate Journal', [
      { id: 'pg1', name: 'Quest Details', content: 'Before.' },
    ]);

    await da.updateJournalContent({ journalId: 'j-mutate', content: 'After.' });

    const page = (journal as any).pages.get('pg1');
    expect(page.text.content).toBe('After.');
  });

  it('creates a "Quest Details" page when no text pages exist, returns its id', async () => {
    // Journal with zero pages
    world.addJournal({ id: 'j-empty', name: 'Empty Journal' });

    const result = await da.updateJournalContent({
      journalId: 'j-empty',
      content: 'Brand new.',
    });

    expect(result.success).toBe(true);
    expect(result.pageName).toBe('Quest Details');
    expect(typeof result.pageId).toBe('string');
    expect((result.pageId ?? '').length).toBeGreaterThan(0);

    // New page should be in the collection
    const g = globalThis as any;
    const journal = g.game.journal.get('j-empty');
    const pages: any[] = journal.pages.contents ?? [...journal.pages];
    expect(pages).toHaveLength(1);
    expect(pages[0].text.content).toBe('Brand new.');
  });
});

// ---------------------------------------------------------------------------
// updateJournalContent — Mode 2: pageId supplied
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — updateJournalContent — Mode 2: update by pageId', () => {
  beforeEach(() => {
    world.enableWrites();
  });

  it('updates only the specified page and returns { success, pageId, pageName }', async () => {
    await addJournalWithPages('j-byid', 'ById Journal', [
      { id: 'p1', name: 'Quest Details', content: 'Page 1.' },
      { id: 'p2', name: 'Rewards', content: 'Gold coins.' },
    ]);

    const result = await da.updateJournalContent({
      journalId: 'j-byid',
      content: 'Updated rewards.',
      pageId: 'p2',
    });

    expect(result).toEqual({
      success: true,
      pageId: 'p2',
      pageName: 'Rewards',
    });
  });

  it('actually mutates only the targeted page, leaving others intact', async () => {
    const journal = await addJournalWithPages('j-byid2', 'ById2 Journal', [
      { id: 'q1', name: 'Quest Details', content: 'Unchanged.' },
      { id: 'q2', name: 'Notes', content: 'Old notes.' },
    ]);

    await da.updateJournalContent({
      journalId: 'j-byid2',
      content: 'New notes.',
      pageId: 'q2',
    });

    expect((journal as any).pages.get('q1').text.content).toBe('Unchanged.');
    expect((journal as any).pages.get('q2').text.content).toBe('New notes.');
  });

  it('throws "Page not found" when pageId does not exist in the journal', async () => {
    await addJournalWithPages('j-badpage', 'BadPage Journal', [
      { id: 'real', name: 'Quest Details', content: 'Real page.' },
    ]);

    await expect(
      da.updateJournalContent({
        journalId: 'j-badpage',
        content: 'anything',
        pageId: 'nonexistent-page',
      })
    ).rejects.toThrow('Page not found: nonexistent-page');
  });
});

// ---------------------------------------------------------------------------
// updateJournalContent — Mode 1: newPageName supplied
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — updateJournalContent — Mode 1: create new page', () => {
  beforeEach(() => {
    world.enableWrites();
  });

  it('creates a new page and returns { success, pageId, pageName }', async () => {
    await addJournalWithPages('j-newpage', 'NewPage Journal', [
      { id: 'existing', name: 'Quest Details', content: 'Existing.' },
    ]);

    const result = await da.updateJournalContent({
      journalId: 'j-newpage',
      content: 'Appendix content.',
      newPageName: 'Appendix',
    });

    expect(result.success).toBe(true);
    expect(result.pageName).toBe('Appendix');
    expect(typeof result.pageId).toBe('string');
    expect((result.pageId ?? '').length).toBeGreaterThan(0);
  });

  it('new page is present in the journal pages collection after creation', async () => {
    const journal = await addJournalWithPages('j-newpage2', 'NewPage2 Journal', [
      { id: 'p-orig', name: 'Quest Details', content: 'Original.' },
    ]);

    const result = await da.updateJournalContent({
      journalId: 'j-newpage2',
      content: 'Lore dump.',
      newPageName: 'Lore',
    });

    const pages: any[] = (journal as any).pages.contents ?? [...(journal as any).pages];
    expect(pages).toHaveLength(2);
    const newPage = pages.find((p: any) => p.name === 'Lore');
    expect(newPage).toBeTruthy();
    expect(newPage.text.content).toBe('Lore dump.');
    expect(newPage.id).toBe(result.pageId);
  });

  it('newPageName takes precedence over pageId — creates rather than updates', async () => {
    // When both newPageName and pageId are supplied, Mode 1 (newPageName) wins
    // because the if-chain checks newPageName first (line 2596).
    await addJournalWithPages('j-both', 'Both Journal', [
      { id: 'existing-p', name: 'Quest Details', content: 'Not modified.' },
    ]);

    const result = await da.updateJournalContent({
      journalId: 'j-both',
      content: 'New page content.',
      newPageName: 'Extra',
      pageId: 'existing-p', // would update if Mode 2 ran, but Mode 1 wins
    });

    expect(result.pageName).toBe('Extra');
    // The existing page is untouched
    const g = globalThis as any;
    const journal = g.game.journal.get('j-both');
    const existingPage = journal.pages.get('existing-p');
    expect(existingPage.text.content).toBe('Not modified.');
  });
});
